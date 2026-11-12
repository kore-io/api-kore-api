import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import jsQR from 'jsqr';
import sharp from 'sharp';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const SITE_URL = 'http://localhost:5174';

/** Supertest junta o corpo binário num Buffer. */
const binary = (response: request.Response, done: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => done(null, Buffer.concat(chunks)));
};

/** O QR code do convite impresso (Envios RN09; banco real). */
describe('QR code do convite (banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());

  async function scenario({ status = 'published' }: { status?: 'published' | 'draft' } = {}) {
    const ana = await signedInUser({ app, name: 'Ana' });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    const slug = `ana-e-marcos-${randomUUID().slice(0, 8)}`;
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        slug,
        status,
        eventDate: new Date('2026-11-14T00:00:00Z'),
        ...(status === 'published'
          ? {
              publishedAt: new Date(),
              endDate: new Date('2027-02-14T00:00:00Z'),
              publicationSource: 'courtesy' as const,
            }
          : {}),
      },
    });
    const parties = [];
    for (const name of [
      'Família Moreira',
      'Família Duarte',
      'Carla e Rafael',
      'Tio Jorge',
      'Igreja',
      'Padrinhos',
    ]) {
      const created = await http()
        .post(`/v1/weddings/${weddingId}/parties`)
        .set('Cookie', ana.cookie)
        .set('Origin', APP_ORIGIN)
        .send({ name, guests: [{ name: `${name} 1` }] })
        .expect(201);
      parties.push(await db.party.findUniqueOrThrow({ where: { id: created.body.id as string } }));
    }
    return { ana, weddingId, slug, parties };
  }

  const qr = (cookie: string, weddingId: string, body: object) =>
    http()
      .post(`/v1/weddings/${weddingId}/parties/qr-codes`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body)
      .buffer(true)
      .parse(binary);

  it('RN09 - 6 grupos: um PDF com 6 páginas, e os 6 ficam enviados pelo QR', async () => {
    const { ana, weddingId, slug, parties } = await scenario();

    const response = await qr(ana.cookie, weddingId, {
      partyIds: parties.map((party) => party.id),
      format: 'pdf',
    }).expect(200);

    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="qr-${slug}.pdf"; filename*=UTF-8''qr-${slug}.pdf`,
    );
    expect(response.headers['access-control-expose-headers']).toContain('Content-Disposition');
    const pdf = (response.body as Buffer).toString('latin1');
    expect(pdf.startsWith('%PDF')).toBe(true);
    expect(pdf.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(6);
    const stored = await db.party.findMany({ where: { weddingId } });
    expect(
      stored.every((party) => party.deliveryStatus === 'sent' && party.lastChannel === 'qr'),
    ).toBe(true);
    expect(
      await db.partyDelivery.count({ where: { weddingId, channel: 'qr', kind: 'invite' } }),
    ).toBe(6);
  });

  it('RN09 - 1 grupo: o PNG de 1024 × 1024 com o link do grupo e nada mais', async () => {
    const { ana, weddingId, slug, parties } = await scenario();
    const [moreira] = parties;

    const response = await qr(ana.cookie, weddingId, {
      partyIds: [moreira.id],
      format: 'png',
    }).expect(200);

    expect(response.headers['content-type']).toBe('image/png');
    const { data, info } = await sharp(response.body as Buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1024, 1024]);
    expect(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data).toBe(
      `${SITE_URL}/${slug}/grupo/${moreira.linkToken}`,
    );
  });

  it('RN09 - o PNG é de 1 grupo só: com vários, 400', async () => {
    const { ana, weddingId, parties } = await scenario();

    const response = await qr(ana.cookie, weddingId, {
      partyIds: [parties[0].id, parties[1].id],
      format: 'png',
    }).expect(400);

    expect(JSON.parse((response.body as Buffer).toString()).errors).toEqual([
      { path: 'format', code: 'PNG_SINGLE_PARTY', params: {} },
    ]);
    expect(await db.partyDelivery.count({ where: { weddingId } })).toBe(0);
  });

  it('RN09 (R4-1) - um GET no endereço dos QR codes não marca nenhum grupo', async () => {
    const { ana, weddingId } = await scenario();

    const response = await http()
      .get(`/v1/weddings/${weddingId}/parties/qr-codes`)
      .set('Cookie', ana.cookie);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await db.partyDelivery.count({ where: { weddingId } })).toBe(0);
  });

  it('RN01 - antes de publicar: DELIVERIES_CLOSED, sem arquivo e sem marcar', async () => {
    const { ana, weddingId, parties } = await scenario({ status: 'draft' });

    const response = await qr(ana.cookie, weddingId, {
      partyIds: [parties[0].id],
      format: 'pdf',
    }).expect(409);

    expect(JSON.parse((response.body as Buffer).toString())).toMatchObject({
      error: 'DELIVERIES_CLOSED',
      reason: 'not_published',
    });
    expect(await db.partyDelivery.count({ where: { weddingId } })).toBe(0);
  });
});
