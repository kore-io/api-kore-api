import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { seedInvitation } from '../support/invitations';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedReferrerWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

/**
 * Decisão 224, bloqueantes 1 e 2: a colaboradora não sai de casamento sem dono,
 * e o indicador do casamento não aceita o convite do casal dele. Juntas, as duas
 * regras fecham o contorno "criar, gerar o link, sair e aceitar o próprio link".
 */
describe('Sair sem dono e autoindicação (banco real; decisão 224)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const send = (cookie: string, weddingId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/v1/weddings/${weddingId}/access-invitations`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);
  const leave = (cookie: string, weddingId: string, id: string) =>
    request(app.getHttpServer())
      .delete(`/v1/weddings/${weddingId}/memberships/${id}`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN);
  const accept = (token: string, cookie: string) =>
    request(app.getHttpServer())
      .post(`/v1/access-invitations/${token}/accept`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send({ partnerIndex: 1, myTitle: 'bride' });
  const tokenOf = (url: string) => url.split('/').pop() ?? '';

  /** Juliana, cerimonialista, criou o casamento de Fernanda e João (sem dono, atribuído a ela). */
  async function julianaWedding() {
    const { userId } = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const cookie = await openSession({ app, userId });
    const { weddingId } = await seedReferrerWedding({ db, referrerUserId: userId });
    const membership = await db.membership.findFirstOrThrow({
      where: { weddingId, userId, removedAt: null },
    });
    return { userId, cookie, weddingId, membershipId: membership.id };
  }

  it('decisão 224 (1) - a colaboradora não sai de casamento sem dono: 409 WEDDING_HAS_NO_OWNER, vínculo mantido e sem log', async () => {
    const { cookie, weddingId, membershipId } = await julianaWedding();

    const response = await leave(cookie, weddingId, membershipId).expect(409);

    expect(response.body.error).toBe('WEDDING_HAS_NO_OWNER');
    expect(
      (await db.membership.findUniqueOrThrow({ where: { id: membershipId } })).removedAt,
    ).toBeNull();
    expect(
      await db.applicationLog.count({
        where: { action: 'membership.left', entityId: membershipId },
      }),
    ).toBe(0);
  });

  it('decisão 224 (1) - com o casal já dono, a colaboradora sai (204)', async () => {
    const { cookie, weddingId, membershipId } = await julianaWedding();
    const fernanda = await signedInUser({ app, name: 'Fernanda Alves' });
    await db.membership.create({ data: { weddingId, userId: fernanda.userId, role: 'owner' } });

    await leave(cookie, weddingId, membershipId).expect(204);
  });

  it('decisão 224 (1 e 2) - contorno: criar, gerar o link, sair e aceitar o próprio link é recusado nas duas pontas', async () => {
    const { userId, cookie, weddingId, membershipId } = await julianaWedding();

    const link = await send(cookie, weddingId, { kind: 'couple' }).expect(201);
    const token = tokenOf(link.body.invitations[0].url as string);

    expect((await leave(cookie, weddingId, membershipId).expect(409)).body.error).toBe(
      'WEDDING_HAS_NO_OWNER',
    );
    // Ainda colaboradora: a recusa é a da autoindicação, não o ALREADY_MEMBER.
    expect((await accept(token, cookie).expect(409)).body.error).toBe('SELF_REFERRAL');

    // Sem o vínculo (se houvesse outro caminho para sair), o aceite segue recusado.
    await db.membership.update({ where: { id: membershipId }, data: { removedAt: new Date() } });
    expect((await accept(token, cookie).expect(409)).body.error).toBe('SELF_REFERRAL');

    expect(await db.membership.count({ where: { weddingId, userId, role: 'owner' } })).toBe(0);
    const invitation = await db.accessInvitation.findFirstOrThrow({
      where: { weddingId, email: null, supersededAt: null },
    });
    expect(invitation.acceptedAt).toBeNull();
  });

  it('decisão 224 (2) - o convite do casal por e-mail também recusa o indicador (com outra conta confirmada)', async () => {
    const { userId, cookie, weddingId } = await julianaWedding();
    const { token } = await seedInvitation({
      db,
      weddingId,
      kind: 'couple',
      email: `fernanda.${randomUUID()}@kore.local`,
      invitedByUserId: userId,
    });

    const response = await request(app.getHttpServer())
      .post(`/v1/access-invitations/${token}/accept`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send({ partnerIndex: 1, myTitle: 'bride', confirmOtherAccount: true })
      .expect(409);

    expect(response.body.error).toBe('SELF_REFERRAL');
  });

  it('decisão 224 (2) - outra pessoa aceita o mesmo link normalmente', async () => {
    const { cookie, weddingId } = await julianaWedding();
    const link = await send(cookie, weddingId, { kind: 'couple' }).expect(201);
    const fernanda = await signedInUser({ app, name: 'Fernanda Alves' });

    await accept(tokenOf(link.body.invitations[0].url as string), fernanda.cookie).expect(200);
  });
});
