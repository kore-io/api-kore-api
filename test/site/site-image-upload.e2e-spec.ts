import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../src/shared/storage/application/object-storage.port';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const MB = 1024 * 1024;

/** Autorização de envio das imagens do site (S4 RN04, RN07 e RN10; banco e MinIO reais). */
describe('Imagens do site: autorização de envio (banco e MinIO reais)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  let storage: ObjectStorage;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
    storage = app.get(OBJECT_STORAGE);
  });

  afterAll(async () => {
    await app?.close();
  });

  const authorize = (cookie: string, weddingId: string, body: object) =>
    request(app.getHttpServer())
      .post(`/v1/weddings/${weddingId}/site-images/upload-authorizations`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);

  async function anaWedding() {
    const ana = await signedInUser({ app, name: 'Ana' });
    const juliana = await signedInUser({ app, name: 'Juliana Prado' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    return { ana, juliana, weddingId };
  }

  async function seedImages({
    weddingId,
    count,
    status,
  }: {
    weddingId: string;
    count: number;
    status: 'uploading' | 'processing' | 'ready' | 'failed';
  }) {
    const now = new Date();
    await db.siteImage.createMany({
      data: Array.from({ length: count }, () => {
        const id = uuidV7();
        return {
          id,
          keyToken: id,
          weddingId,
          status,
          storageKey: `site/${id}/display.jpg`,
          sizeBytes: MB,
          ...(status === 'ready'
            ? {
                thumbKey: `site/${id}/thumb.jpg`,
                ogKey: `site/${id}/og.jpg`,
                width: 2560,
                height: 1707,
                readyAt: now,
                unusedSince: now,
              }
            : {}),
        };
      }),
    });
  }

  it('RN04 - cria a imagem em "uploading" e devolve o PUT do original, preso a tipo e tamanho, por 5 minutos', async () => {
    const { ana, weddingId } = await anaWedding();
    const before = Date.now();

    const response = await authorize(ana.cookie, weddingId, {
      contentType: 'image/jpeg',
      sizeBytes: 12,
    }).expect(201);

    const { imageId, uploadUrl, method, headers, expiresAt } = response.body as {
      imageId: string;
      uploadUrl: string;
      method: string;
      headers: Record<string, string>;
      expiresAt: string;
    };
    expect(method).toBe('PUT');
    expect(headers).toEqual({ 'Content-Type': 'image/jpeg', 'Content-Length': '12' });
    const expires = new Date(expiresAt).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 1000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000);
    // A chave leva um token aleatório de 128 bits, não o id (decisão 229(f)).
    const { keyToken } = await db.siteImage.findUniqueOrThrow({ where: { id: imageId } });
    expect(keyToken).toMatch(/^[0-9a-f]{32}$/);
    expect(uploadUrl).not.toContain(imageId);
    expect(new URL(uploadUrl).pathname).toBe(
      `/${process.env.STORAGE_PRIVATE_BUCKET}/site/${keyToken}/original`,
    );
    expect(await db.siteImage.findUniqueOrThrow({ where: { id: imageId } })).toMatchObject({
      weddingId,
      status: 'uploading',
      storageKey: `site/${keyToken}/display.jpg`,
      sizeBytes: 12,
      uploadedByUserId: ana.userId,
      readyAt: null,
      unusedSince: null,
    });

    const put = await fetch(uploadUrl, {
      method: 'PUT',
      body: new Uint8Array(Buffer.from('foto de teste')).slice(0, 12),
      headers: { 'Content-Type': 'image/jpeg' },
    });
    expect(put.status).toBe(200);
    expect(await storage.head({ bucket: 'private', key: `site/${keyToken}/original` })).toEqual({
      sizeBytes: 12,
    });
    await storage.delete({ bucket: 'private', keys: [`site/${keyToken}/original`] });
  });

  it('RN04 - só JPEG, de 1 byte a 4 MB, com os erros pelo campo', async () => {
    const { ana, weddingId } = await anaWedding();

    const png = await authorize(ana.cookie, weddingId, {
      contentType: 'image/png',
      sizeBytes: MB,
    }).expect(400);
    expect(png.body.errors).toEqual([expect.objectContaining({ path: 'contentType' })]);
    await authorize(ana.cookie, weddingId, { contentType: 'image/jpeg', sizeBytes: 0 }).expect(400);
    await authorize(ana.cookie, weddingId, {
      contentType: 'image/jpeg',
      sizeBytes: 4 * MB + 1,
    }).expect(400);
    await authorize(ana.cookie, weddingId, {
      contentType: 'image/jpeg',
      sizeBytes: 4 * MB,
    }).expect(201);
    expect(await db.siteImage.count({ where: { weddingId } })).toBe(1);
  });

  it('RN10 - a cerimonialista também envia (manage_site); quem não tem vínculo recebe "não encontrado"', async () => {
    const { juliana, weddingId } = await anaWedding();
    const estranha = await signedInUser({ app, name: 'Estranha' });

    await authorize(juliana.cookie, weddingId, {
      contentType: 'image/jpeg',
      sizeBytes: MB,
    }).expect(201);
    const response = await authorize(estranha.cookie, weddingId, {
      contentType: 'image/jpeg',
      sizeBytes: MB,
    }).expect(404);
    expect(response.body.error).toBe('WEDDING_NOT_FOUND');
  });

  it('RN07 - com 40 imagens guardadas, recusa com SITE_IMAGE_LIMIT; "failed" não conta', async () => {
    const { ana, weddingId } = await anaWedding();
    await seedImages({ weddingId, count: 20, status: 'ready' });
    await seedImages({ weddingId, count: 10, status: 'processing' });
    await seedImages({ weddingId, count: 9, status: 'uploading' });
    await seedImages({ weddingId, count: 5, status: 'failed' });

    await authorize(ana.cookie, weddingId, { contentType: 'image/jpeg', sizeBytes: MB }).expect(
      201,
    );
    const refused = await authorize(ana.cookie, weddingId, {
      contentType: 'image/jpeg',
      sizeBytes: MB,
    }).expect(409);

    expect(refused.body).toEqual({
      statusCode: 409,
      error: 'SITE_IMAGE_LIMIT',
      message: expect.any(String),
    });
    expect(await db.siteImage.count({ where: { weddingId, status: { not: 'failed' } } })).toBe(40);
  });

  it('RN07 - duas autorizações ao mesmo tempo com 39 guardadas: só uma é emitida', async () => {
    const { ana, juliana, weddingId } = await anaWedding();
    await seedImages({ weddingId, count: 39, status: 'ready' });

    const statuses = (
      await Promise.all([
        authorize(ana.cookie, weddingId, { contentType: 'image/jpeg', sizeBytes: MB }),
        authorize(juliana.cookie, weddingId, { contentType: 'image/jpeg', sizeBytes: MB }),
      ])
    ).map((response) => response.status);

    expect(statuses.sort()).toEqual([201, 409]);
    expect(await db.siteImage.count({ where: { weddingId } })).toBe(40);
  });

  it('RN07 - 30 pedidos por minuto por usuário; o 31º dá 429, e outra pessoa não é afetada', async () => {
    const { ana, juliana, weddingId } = await anaWedding();
    for (let i = 0; i < 30; i++) {
      await authorize(ana.cookie, weddingId, { contentType: 'image/png', sizeBytes: 1 }).expect(
        400,
      );
    }

    const blocked = await authorize(ana.cookie, weddingId, {
      contentType: 'image/jpeg',
      sizeBytes: MB,
    }).expect(429);

    expect(blocked.body).toEqual({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'Too many requests.',
    });
    await authorize(juliana.cookie, weddingId, {
      contentType: 'image/jpeg',
      sizeBytes: MB,
    }).expect(201);
  });
});
