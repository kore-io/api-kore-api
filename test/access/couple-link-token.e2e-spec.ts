import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { coupleLinkCipherContext } from '../../src/modules/access/domain/access-invitation';
import { AccessCleanupProcessor } from '../../src/modules/access/infrastructure/access-cleanup.job';
import {
  FIELD_CIPHER,
  type FieldCipher,
} from '../../src/shared/crypto/application/field-cipher.port';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedReferrerWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

/**
 * O link do casal cifrado (Meus casamentos RN09; N1(b), decisão 224), com o
 * banco real: só o convite do casal sem e-mail guarda o token, cifrado pelo
 * FieldCipher no contexto do casamento, e a coluna sai no aceite, no
 * cancelamento, na substituição (Gerar novo link) e no vencimento.
 */
describe('Link do casal cifrado (banco real; N1(b))', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;
  let cipher: FieldCipher;

  beforeAll(async () => {
    app = await createTestApp();
    worker = await createTestWorker();
    db = app.get(BackofficePrismaService);
    cipher = app.get<FieldCipher>(FIELD_CIPHER);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  const send = (cookie: string, weddingId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/v1/weddings/${weddingId}/access-invitations`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);
  const tokenOf = (url: unknown) => String(url).split('/').pop() ?? '';
  const stored = (id: string) => db.accessInvitation.findUniqueOrThrow({ where: { id } });

  async function plannerWedding() {
    const { userId } = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const cookie = await openSession({ app, userId });
    const { weddingId } = await seedReferrerWedding({ db, referrerUserId: userId });
    return { cookie, weddingId };
  }

  async function generateLink(cookie: string, weddingId: string) {
    const response = await send(cookie, weddingId, { kind: 'couple' }).expect(201);
    const [link] = response.body.invitations as { id: string; url: string }[];
    return { id: link.id, token: tokenOf(link.url) };
  }

  it('condição 1 - o link sem e-mail guarda o token cifrado, que decifra só no contexto do casamento; o convite com e-mail não guarda', async () => {
    const { cookie, weddingId } = await plannerWedding();

    const link = await generateLink(cookie, weddingId);
    const { tokenEncrypted } = await stored(link.id);

    expect(tokenEncrypted).not.toBeNull();
    expect(tokenEncrypted).not.toContain(link.token);
    expect(
      await cipher.decrypt({
        ciphertext: tokenEncrypted ?? '',
        context: coupleLinkCipherContext({ weddingId }),
      }),
    ).toBe(link.token);
    const other = await seedReferrerWedding({
      db,
      referrerUserId: (await seedReferrer({ db, kind: 'planner', name: 'Clara Dias' })).userId,
    });
    await expect(
      cipher.decrypt({
        ciphertext: tokenEncrypted ?? '',
        context: coupleLinkCipherContext({ weddingId: other.weddingId }),
      }),
    ).rejects.toThrow();

    const byEmail = await send(cookie, weddingId, {
      kind: 'couple',
      emails: ['fernanda.alves@kore.local'],
    }).expect(201);
    expect((await stored(byEmail.body.invitations[0].id as string)).tokenEncrypted).toBeNull();
  });

  it('condição 2 - Gerar novo link zera o token do anterior', async () => {
    const { cookie, weddingId } = await plannerWedding();
    const first = await generateLink(cookie, weddingId);

    const second = await generateLink(cookie, weddingId);

    expect((await stored(first.id)).tokenEncrypted).toBeNull();
    expect((await stored(second.id)).tokenEncrypted).not.toBeNull();
  });

  it('condição 2 - Cancelar link zera o token', async () => {
    const { cookie, weddingId } = await plannerWedding();
    const link = await generateLink(cookie, weddingId);

    await request(app.getHttpServer())
      .delete(`/v1/weddings/${weddingId}/access-invitations/${link.id}`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .expect(204);

    expect((await stored(link.id)).tokenEncrypted).toBeNull();
  });

  it('condição 2 - o aceite do casal zera o token, na função do banco', async () => {
    const { cookie, weddingId } = await plannerWedding();
    const link = await generateLink(cookie, weddingId);
    const fernanda = await signedInUser({ app, name: 'Fernanda Alves' });

    await request(app.getHttpServer())
      .post(`/v1/access-invitations/${link.token}/accept`)
      .set('Cookie', fernanda.cookie)
      .set('Origin', APP_ORIGIN)
      .send({ partnerIndex: 1, myTitle: 'bride' })
      .expect(200);

    expect(await stored(link.id)).toMatchObject({
      tokenEncrypted: null,
      acceptedByUserId: fernanda.userId,
    });
  });

  it('condição 2 - o token do link vencido sai na limpeza diária; o vigente fica', async () => {
    const { cookie, weddingId } = await plannerWedding();
    const expired = await generateLink(cookie, weddingId);
    await db.accessInvitation.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const other = await plannerWedding();
    const valid = await generateLink(other.cookie, other.weddingId);

    await worker.get(AccessCleanupProcessor).process();

    expect((await stored(expired.id)).tokenEncrypted).toBeNull();
    expect((await stored(valid.id)).tokenEncrypted).not.toBeNull();
  });
});
