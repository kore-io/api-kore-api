import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LAST_PROFILE_COOKIE } from '../../src/modules/access/presentation/last-profile-cookie';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { seedInvitation } from '../support/invitations';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

describe('Papéis e perfis: /me, perfil ativo e colaboradores (banco real; decisões 163, 174, 177)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const me = (cookie: string) => request(app.getHttpServer()).get('/v1/me').set('Cookie', cookie);
  const choose = (cookie: string, profile: string) =>
    request(app.getHttpServer())
      .post('/v1/me/active-profile')
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send({ profile });
  const members = (cookie: string, weddingId: string) =>
    request(app.getHttpServer()).get(`/v1/weddings/${weddingId}/memberships`).set('Cookie', cookie);
  const remove = (cookie: string, weddingId: string, id: string) =>
    request(app.getHttpServer())
      .delete(`/v1/weddings/${weddingId}/memberships/${id}`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN);

  /** Juliana: cerimonialista ativa, dona do próprio casamento e colaboradora de outro. */
  async function julianaWithTwoProfiles() {
    const { userId } = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId } });
    await db.planner.update({
      where: { referrerId: referrer.id },
      data: { creditName: 'Prado Assessoria' },
    });
    const cookie = await openSession({ app, userId });
    const own = await seedWedding({ db, ownerId: userId });
    await db.wedding.update({
      where: { id: own.weddingId },
      data: { eventDate: new Date('2027-03-20T00:00:00Z'), city: 'Valinhos' },
    });
    const ana = await signedInUser({ app });
    const client = await seedWedding({ db, ownerId: ana.userId, collaboratorIds: [userId] });
    return { userId, cookie, referrer, own, client, ana };
  }

  describe('GET /v1/me', () => {
    it('RN14 e decisão 174 - perfis, vínculos dos cartões, o resumo do cerimonialista e o indicador', async () => {
      const { cookie, referrer, own, client } = await julianaWithTwoProfiles();

      const response = await me(cookie).expect(200);

      expect(response.body).toMatchObject({
        profiles: ['couple', 'planner'],
        activeProfile: null,
        lastProfileOnDevice: null,
        planner: { organization: 'Prado Assessoria', weddingsCount: 1 },
        referrer: { kind: 'planner', referralCode: referrer.referralCode },
      });
      expect(response.body.memberships).toEqual([
        {
          weddingId: own.weddingId,
          role: 'owner',
          weddingName: 'Ana & Marcos',
          eventDate: '2027-03-20',
          city: 'Valinhos',
          state: 'SP',
        },
        {
          weddingId: client.weddingId,
          role: 'collaborator',
          weddingName: 'Ana & Marcos',
          eventDate: null,
          city: 'Campinas',
          state: 'SP',
        },
      ]);
    });

    it('decisão 177 (4) - indicador inativo não dá perfil, e casamento expurgado não conta', async () => {
      const { userId } = await seedReferrer({
        db,
        kind: 'seller',
        name: 'Lucas',
        status: 'inactive',
      });
      const cookie = await openSession({ app, userId });
      const purged = await seedWedding({ db, ownerId: userId });
      await db.wedding.update({
        where: { id: purged.weddingId },
        data: { status: 'purged', purgedAt: new Date() },
      });

      const response = await me(cookie).expect(200);

      expect(response.body).toMatchObject({ profiles: [], memberships: [], planner: null });
      expect(response.body.referrer).toMatchObject({ kind: 'seller' });
    });
  });

  describe('POST /v1/me/active-profile (RN14, RN16)', () => {
    it('escolhe o perfil, devolve o home e o GET /me mostra o último perfil do aparelho', async () => {
      const { cookie } = await julianaWithTwoProfiles();

      const response = await choose(cookie, 'planner').expect(200);

      expect(response.body).toEqual({ activeProfile: 'planner', home: '/cerimonialista' });
      const lastProfile = (response.headers['set-cookie'] as unknown as string[]).find((value) =>
        value.startsWith(`${LAST_PROFILE_COOKIE}=`),
      );
      expect(lastProfile).toMatch(
        /kore_last_profile=planner; Max-Age=\d+; Path=\/v1\/me; .*HttpOnly; Secure; SameSite=Lax/,
      );
      const after = await me(`${cookie}; ${LAST_PROFILE_COOKIE}=planner`).expect(200);
      expect(after.body).toMatchObject({
        activeProfile: 'planner',
        lastProfileOnDevice: 'planner',
      });

      expect((await choose(cookie, 'couple').expect(200)).body).toEqual({
        activeProfile: 'couple',
        home: '/app',
      });
    });

    it('RN14 - perfil que a conta não tem: 403 PROFILE_NOT_OWNED, e a sessão não muda', async () => {
      const { cookie } = await julianaWithTwoProfiles();

      expect((await choose(cookie, 'seller').expect(403)).body.error).toBe('PROFILE_NOT_OWNED');
      expect((await me(cookie).expect(200)).body.activeProfile).toBeNull();
      await choose(cookie, 'admin').expect(400);
    });

    it('o cookie do último perfil com um perfil que a conta já não tem é ignorado', async () => {
      const ana = await signedInUser({ app });

      const response = await me(`${ana.cookie}; ${LAST_PROFILE_COOKIE}=planner`).expect(200);

      expect(response.body.lastProfileOnDevice).toBeNull();
    });
  });

  describe('GET /v1/weddings/{weddingId}/memberships (RN02, RN05)', () => {
    it('donos, a cerimonialista com o tipo e os convites pendentes (inclusive o link e o vencido)', async () => {
      const { client, ana } = await julianaWithTwoProfiles();
      const expired = await seedInvitation({
        db,
        weddingId: client.weddingId,
        kind: 'partner',
        email: 'marcos@kore.local',
        invitedByUserId: ana.userId,
        expiresAt: new Date(Date.now() - 1000),
      });
      const link = await seedInvitation({
        db,
        weddingId: client.weddingId,
        kind: 'couple',
        email: null,
        invitedByUserId: ana.userId,
      });

      const response = await members(ana.cookie, client.weddingId).expect(200);

      expect(response.body.members).toEqual([
        { id: expect.any(String), name: 'Ana Beatriz Moreira', role: 'owner' },
        { id: expect.any(String), name: 'Juliana Prado', role: 'collaborator', kind: 'planner' },
      ]);
      const pending = response.body.pendingInvitations as { id: string }[];
      expect(pending.map(({ id }) => id)).toEqual([expired.invitationId, link.invitationId]);
    });

    it('RN03 - a colaboradora vê a lista; RN01 - quem não tem vínculo recebe 404', async () => {
      const { cookie, client } = await julianaWithTwoProfiles();
      const stranger = await signedInUser({ app });

      await members(cookie, client.weddingId).expect(200);
      expect((await members(stranger.cookie, client.weddingId).expect(404)).body.error).toBe(
        'WEDDING_NOT_FOUND',
      );
    });
  });

  describe('DELETE /v1/weddings/{weddingId}/memberships/{id} (RN06, RN07, RN10)', () => {
    const membershipOf = (weddingId: string, userId: string) =>
      db.membership.findFirstOrThrow({ where: { weddingId, userId, removedAt: null } });

    it('RN06 e RN10 - o dono remove a cerimonialista: o acesso cai na hora e fica no log', async () => {
      const { userId, cookie, client, ana } = await julianaWithTwoProfiles();
      const target = await membershipOf(client.weddingId, userId);

      await remove(ana.cookie, client.weddingId, target.id).expect(204);

      expect(
        (await db.membership.findUniqueOrThrow({ where: { id: target.id } })).removedByUserId,
      ).toBe(ana.userId);
      await members(cookie, client.weddingId).expect(404);
      const log = await db.applicationLog.findFirstOrThrow({
        where: { action: 'membership.removed', entityId: target.id },
      });
      expect(log).toMatchObject({
        actorUserId: ana.userId,
        weddingId: client.weddingId,
        actorKind: 'user',
      });
      expect(log.data).toEqual({ membershipId: target.id, role: 'collaborator' });
    });

    it('RN06 - a cerimonialista sai por conta própria (membership.left)', async () => {
      const { userId, cookie, client } = await julianaWithTwoProfiles();
      const own = await membershipOf(client.weddingId, userId);

      await remove(cookie, client.weddingId, own.id).expect(204);

      await db.applicationLog.findFirstOrThrow({
        where: { action: 'membership.left', entityId: own.id },
      });
    });

    it('RN03 - a colaboradora não remove o dono (403 ACTION_NOT_ALLOWED)', async () => {
      const { cookie, client, ana } = await julianaWithTwoProfiles();
      const owner = await membershipOf(client.weddingId, ana.userId);

      expect((await remove(cookie, client.weddingId, owner.id).expect(403)).body.error).toBe(
        'ACTION_NOT_ALLOWED',
      );
    });

    it('RN07 - um dono não remove o outro; o último dono não sai; o dono que sai solta o login do noivo (decisão 177)', async () => {
      const ana = await signedInUser({ app });
      const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
      const marcos = await signedInUser({ app });
      await db.membership.create({ data: { weddingId, userId: marcos.userId, role: 'owner' } });
      await db.partner.updateMany({
        where: { weddingId, slot: 2 },
        data: { userId: marcos.userId },
      });
      const anaMembership = await membershipOf(weddingId, ana.userId);
      const marcosMembership = await membershipOf(weddingId, marcos.userId);

      expect(
        (await remove(ana.cookie, weddingId, marcosMembership.id).expect(409)).body.error,
      ).toBe('CANNOT_REMOVE_OWNER');
      await remove(marcos.cookie, weddingId, marcosMembership.id).expect(204);
      expect(
        (await db.partner.findFirstOrThrow({ where: { weddingId, slot: 2 } })).userId,
      ).toBeNull();
      expect((await db.partner.findFirstOrThrow({ where: { weddingId, slot: 1 } })).userId).toBe(
        ana.userId,
      );
      expect((await remove(ana.cookie, weddingId, anaMembership.id).expect(409)).body.error).toBe(
        'LAST_OWNER',
      );
    });

    it('decisão 179 - o dono que sai deixa a outra sessão dele em couple no banco, mas o /me devolve activeProfile null', async () => {
      const ana = await signedInUser({ app });
      const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
      const marcos = await signedInUser({ app });
      await db.membership.create({ data: { weddingId, userId: marcos.userId, role: 'owner' } });
      const otherDevice = await openSession({ app, userId: marcos.userId });
      await choose(otherDevice, 'couple').expect(200);
      await choose(marcos.cookie, 'couple').expect(200);

      await remove(
        marcos.cookie,
        weddingId,
        (await membershipOf(weddingId, marcos.userId)).id,
      ).expect(204);

      const body = (await me(otherDevice).expect(200)).body as {
        profiles: string[];
        activeProfile: string | null;
      };
      expect(body).toMatchObject({ profiles: [], activeProfile: null });
    });

    it('vínculo de outro casamento ou id inválido: 404 MEMBERSHIP_NOT_FOUND', async () => {
      const a = await signedInUser({ app });
      const b = await signedInUser({ app });
      const weddingA = await seedWedding({ db, ownerId: a.userId });
      const weddingB = await seedWedding({ db, ownerId: b.userId });
      const otherMembership = await membershipOf(weddingB.weddingId, b.userId);

      expect(
        (await remove(a.cookie, weddingA.weddingId, otherMembership.id).expect(404)).body.error,
      ).toBe('MEMBERSHIP_NOT_FOUND');
      await remove(a.cookie, weddingA.weddingId, 'nao-e-uuid').expect(404);
    });
  });
});
