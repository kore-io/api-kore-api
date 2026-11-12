import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  PLANNER_PROFILES,
  type PlannerProfiles,
} from '../../src/modules/access/application/ports/planner-profiles.port';
import { PlannerProfileExistsError } from '../../src/modules/access/domain/access.errors';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { TenantTransaction } from '../../src/shared/database/tenant-transaction';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { seedInvitation } from '../support/invitations';
import { waitForInbox } from '../support/mailpit';
import { seedReferrer } from '../support/referrers';
import { SESSION_COOKIE } from '../../src/modules/access/presentation/session-cookie';
import { openSession, signedInUser } from '../support/sessions';
import { seedReferrerWedding, seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

describe('Convites de acesso: ler, aceitar e recusar (banco real; decisões 168 e 172)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    // O aviso de recusa sai pela fila comum: o worker é quem envia.
    worker = await createTestWorker();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  const read = (token: string, cookie?: string) => {
    const call = request(app.getHttpServer()).get(`/v1/access-invitations/${token}`);
    return cookie ? call.set('Cookie', cookie) : call;
  };
  const accept = (token: string, cookie: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(`/v1/access-invitations/${token}/accept`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);
  const decline = (token: string) =>
    request(app.getHttpServer())
      .post(`/v1/access-invitations/${token}/decline`)
      .set('Origin', APP_ORIGIN);

  /** Casamento de Ana (dona, noiva 1) e Marcos (noivo 2 sem login nem título). */
  async function anaWedding() {
    const ana = await signedInUser({ app, name: 'Ana Beatriz' });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    await db.partner.updateMany({ where: { weddingId, slot: 2 }, data: { title: null } });
    return { ana, weddingId };
  }

  async function plannerWedding(kind: 'planner' | 'seller' = 'planner') {
    const { userId } = await seedReferrer({
      db,
      kind,
      name: kind === 'planner' ? 'Juliana Prado' : 'Lucas Lima',
    });
    const { weddingId } = await seedReferrerWedding({
      db,
      referrerUserId: userId,
      referrerKind: kind,
      status: 'awaiting_couple',
    });
    return { referrerUserId: userId, weddingId };
  }

  describe('GET /v1/access-invitations/{token} (RN06, RN07, RN12)', () => {
    it('RN06 - o convite do parceiro mostra o casamento e quem convidou, sem sessão', async () => {
      const { ana, weddingId } = await anaWedding();
      const { token } = await seedInvitation({
        db,
        weddingId,
        kind: 'partner',
        email: 'marcos@kore.local',
        invitedByUserId: ana.userId,
      });

      const response = await read(token).expect(200);

      expect(response.body).toEqual({
        kind: 'partner',
        email: 'marcos@kore.local',
        invitedBy: { name: 'Ana', role: 'owner' },
        wedding: {
          names: 'Ana & Marcos',
          eventDate: null,
          city: 'Campinas',
          state: 'SP',
          partnerTitleNeeded: true,
        },
        sessionEmailMismatch: false,
        needsName: false,
      });
    });

    it('RN07 - com a sessão de outro e-mail, sessionEmailMismatch é true', async () => {
      const { ana, weddingId } = await anaWedding();
      const { token } = await seedInvitation({
        db,
        weddingId,
        kind: 'partner',
        email: 'marcos@kore.local',
        invitedByUserId: ana.userId,
      });
      const other = await signedInUser({ app });

      expect((await read(token, other.cookie).expect(200)).body.sessionEmailMismatch).toBe(true);
    });

    it('RN14 - o link do casal traz os dois nomes, a prévia nula e o indicador com o desconto', async () => {
      const { referrerUserId, weddingId } = await plannerWedding();
      const { token } = await seedInvitation({
        db,
        weddingId,
        kind: 'couple',
        email: null,
        invitedByUserId: referrerUserId,
      });

      const response = await read(token).expect(200);

      expect(response.body).toEqual({
        kind: 'couple',
        email: null,
        invitedBy: { name: 'Juliana Prado', role: 'planner' },
        wedding: {
          names: 'Fernanda & João',
          eventDate: '2027-03-20',
          city: 'Valinhos',
          state: 'SP',
          partnerNames: ['Fernanda Alves', 'João Lima'],
        },
        sitePreview: null,
        referrer: { name: 'Juliana Prado', discountPercent: 10 },
        sessionEmailMismatch: false,
        needsName: false,
      });
    });

    it('decisão 173 - o convite do casal por e-mail também traz os dois nomes', async () => {
      const { referrerUserId, weddingId } = await plannerWedding();
      const { token } = await seedInvitation({
        db,
        weddingId,
        kind: 'couple',
        email: `${randomUUID()}@kore.local`,
        invitedByUserId: referrerUserId,
      });

      const response = await read(token).expect(200);

      expect(response.body.wedding.partnerNames).toEqual(['Fernanda Alves', 'João Lima']);
    });

    it('decisão 173 - needsName: do cerimonialista, com sessão de conta sem nome; sem sessão, false', async () => {
      const { ana, weddingId } = await anaWedding();
      const juliana = await signedInUser({ app });
      await db.user.update({ where: { id: juliana.userId }, data: { name: null } });
      const { token } = await seedInvitation({
        db,
        weddingId,
        kind: 'planner',
        email: `${randomUUID()}@kore.local`,
        invitedByUserId: ana.userId,
      });

      expect((await read(token, juliana.cookie).expect(200)).body.needsName).toBe(true);
      expect((await read(token).expect(200)).body.needsName).toBe(false);
      const named = await signedInUser({ app, name: 'Rita' });
      expect((await read(token, named.cookie).expect(200)).body.needsName).toBe(false);
    });

    it.each([
      ['revoked', { revokedAt: new Date() }],
      ['superseded', { supersededAt: new Date() }],
      ['used', { acceptedAt: new Date() }],
      ['used', { declinedAt: new Date() }],
      ['expired', { expiresAt: new Date(Date.now() - 1000) }],
    ])('RN12 - convite %s: 410 só com o motivo, sem dados do casamento', async (reason, data) => {
      const { ana, weddingId } = await anaWedding();
      const { token, invitationId } = await seedInvitation({
        db,
        weddingId,
        kind: 'partner',
        email: `${randomUUID()}@kore.local`,
        invitedByUserId: ana.userId,
      });
      await db.accessInvitation.update({ where: { id: invitationId }, data });

      const response = await read(token).expect(410);

      expect(response.body).toEqual({
        statusCode: 410,
        error: 'INVITATION_INVALID',
        message: 'Invitation is no longer valid.',
        reason,
      });
    });

    it('RN12 - token desconhecido: 410 used', async () => {
      expect((await read('token-que-nao-existe').expect(410)).body.reason).toBe('used');
    });
  });

  describe('POST /v1/access-invitations/{token}/accept', () => {
    it('RN08 - o parceiro aceita: vira dono e o noivo 2, com o título que escolheu (decisão 172)', async () => {
      const { ana, weddingId } = await anaWedding();
      const marcos = await signedInUser({ app, name: 'Marcos' });
      const email = (await db.user.findUniqueOrThrow({ where: { id: marcos.userId } })).email;
      const { token, invitationId } = await seedInvitation({
        db,
        weddingId,
        kind: 'partner',
        email,
        invitedByUserId: ana.userId,
      });

      await accept(token, marcos.cookie).expect(400);
      const response = await accept(token, marcos.cookie, { myTitle: 'groom' }).expect(200);

      expect(response.body).toEqual({
        weddingId,
        role: 'owner',
        weddingStatus: 'draft',
        attributedToMe: false,
      });
      const partner = await db.partner.findFirstOrThrow({ where: { weddingId, slot: 2 } });
      expect(partner).toMatchObject({ userId: marcos.userId, title: 'groom' });
      const invitation = await db.accessInvitation.findUniqueOrThrow({
        where: { id: invitationId },
      });
      expect(invitation).toMatchObject({ acceptedByUserId: marcos.userId, acceptedForEmail: null });
      expect(invitation.acceptedAt).toBeInstanceOf(Date);
      await accept(token, marcos.cookie, { myTitle: 'groom' }).expect(410);
    });

    it('decisão 178 - quem vira dono passa ao perfil de casal na sessão; um erro e o aceite de cerimonialista não mexem na sessão', async () => {
      const { ana, weddingId } = await anaWedding();
      const me = async (cookie: string) =>
        (await request(app.getHttpServer()).get('/v1/me').set('Cookie', cookie).expect(200)).body
          .activeProfile as string | null;
      const marcos = await signedInUser({ app });
      const partner = await seedInvitation({
        db,
        weddingId,
        kind: 'partner',
        email: 'outro@kore.local',
        invitedByUserId: ana.userId,
      });

      await accept(partner.token, marcos.cookie, { myTitle: 'groom' }).expect(409);
      expect(await me(marcos.cookie)).toBeNull();
      await accept(partner.token, marcos.cookie, {
        myTitle: 'groom',
        confirmOtherAccount: true,
      }).expect(200);
      expect(await me(marcos.cookie)).toBe('couple');

      const rita = await signedInUser({ app, name: 'Rita' });
      const planner = await seedInvitation({
        db,
        weddingId,
        kind: 'planner',
        email: (await db.user.findUniqueOrThrow({ where: { id: rita.userId } })).email,
        invitedByUserId: ana.userId,
      });
      await accept(planner.token, rita.cookie).expect(200);
      expect(await me(rita.cookie)).toBeNull();
    });

    it('RN07 - outra conta: 409 EMAIL_MISMATCH; confirmando, vale para a conta da sessão', async () => {
      const { ana, weddingId } = await anaWedding();
      const { token, invitationId } = await seedInvitation({
        db,
        weddingId,
        kind: 'partner',
        email: 'marcos@kore.local',
        invitedByUserId: ana.userId,
      });
      const other = await signedInUser({ app });

      expect((await accept(token, other.cookie, { myTitle: 'groom' }).expect(409)).body.error).toBe(
        'EMAIL_MISMATCH',
      );
      await accept(token, other.cookie, { myTitle: 'groom', confirmOtherAccount: true }).expect(
        200,
      );

      const invitation = await db.accessInvitation.findUniqueOrThrow({
        where: { id: invitationId },
      });
      const otherEmail = (await db.user.findUniqueOrThrow({ where: { id: other.userId } })).email;
      expect(invitation.acceptedForEmail).toBe(otherEmail);
    });

    it('RN08 - quem já é dona de outro casamento ativo: 409 ALREADY_OWNER com o casamento dela', async () => {
      const { ana, weddingId } = await anaWedding();
      const bia = await signedInUser({ app });
      const own = await seedWedding({ db, ownerId: bia.userId });
      const { token } = await seedInvitation({
        db,
        weddingId,
        kind: 'partner',
        email: `${randomUUID()}@kore.local`,
        invitedByUserId: ana.userId,
      });

      const response = await accept(token, bia.cookie, {
        myTitle: 'bride',
        confirmOtherAccount: true,
      }).expect(409);

      expect(response.body).toMatchObject({ error: 'ALREADY_OWNER', weddingId: own.weddingId });
    });

    it('decisão 172 (3) revista - a dona deste casamento abrindo o convite dele: 409 ALREADY_MEMBER', async () => {
      const { ana, weddingId } = await anaWedding();
      const { token } = await seedInvitation({
        db,
        weddingId,
        kind: 'partner',
        email: `${randomUUID()}@kore.local`,
        invitedByUserId: ana.userId,
      });

      const response = await accept(token, ana.cookie, {
        myTitle: 'groom',
        confirmOtherAccount: true,
      }).expect(409);

      expect(response.body.error).toBe('ALREADY_MEMBER');
    });

    it('decisão 172 (3) - quem já tem vínculo neste casamento: 409 ALREADY_MEMBER', async () => {
      const { ana, weddingId } = await anaWedding();
      const juliana = await signedInUser({ app });
      await db.membership.create({
        data: { weddingId, userId: juliana.userId, role: 'collaborator' },
      });
      const { token } = await seedInvitation({
        db,
        weddingId,
        kind: 'partner',
        email: `${randomUUID()}@kore.local`,
        invitedByUserId: ana.userId,
      });

      const response = await accept(token, juliana.cookie, {
        myTitle: 'groom',
        confirmOtherAccount: true,
      }).expect(409);

      expect(response.body.error).toBe('ALREADY_MEMBER');
    });

    it('RN09 e RN14 - o casal aceita o link: "Quem é você?", rascunho, cerimonialista continua, casal_aceitou; o link vale uma vez', async () => {
      const { referrerUserId, weddingId } = await plannerWedding();
      const { token } = await seedInvitation({
        db,
        weddingId,
        kind: 'couple',
        email: null,
        invitedByUserId: referrerUserId,
      });
      const fernanda = await signedInUser({ app, name: 'Fernanda' });
      const events = await db.productEvent.count({ where: { name: 'casal_aceitou' } });

      await accept(token, fernanda.cookie, { myTitle: 'bride' }).expect(400);
      const response = await accept(token, fernanda.cookie, {
        partnerIndex: 1,
        myTitle: 'bride',
      }).expect(200);

      expect(response.body).toEqual({
        weddingId,
        role: 'owner',
        weddingStatus: 'draft',
        attributedToMe: false,
      });
      const memberships = await db.membership.findMany({ where: { weddingId, removedAt: null } });
      expect(
        memberships
          .map(({ userId, role }) => ({ userId, role }))
          .sort((a, b) => a.role.localeCompare(b.role)),
      ).toEqual([
        { userId: referrerUserId, role: 'collaborator' },
        { userId: fernanda.userId, role: 'owner' },
      ]);
      const partner = await db.partner.findFirstOrThrow({ where: { weddingId, slot: 1 } });
      expect(partner).toMatchObject({ userId: fernanda.userId, title: 'bride' });
      expect(await db.productEvent.count({ where: { name: 'casal_aceitou' } })).toBe(events + 1);

      const joao = await signedInUser({ app });
      expect(
        (await accept(token, joao.cookie, { partnerIndex: 2, myTitle: 'groom' }).expect(410)).body
          .reason,
      ).toBe('used');
    });

    it('RN09 - no casamento do vendedor, o vendedor sai no primeiro aceite (decisão 172, item 5)', async () => {
      const { referrerUserId, weddingId } = await plannerWedding('seller');
      const { token } = await seedInvitation({
        db,
        weddingId,
        kind: 'couple',
        email: null,
        invitedByUserId: referrerUserId,
      });
      const fernanda = await signedInUser({ app });

      await accept(token, fernanda.cookie, { partnerIndex: 1, myTitle: 'bride' }).expect(200);

      const seller = await db.membership.findFirstOrThrow({
        where: { weddingId, userId: referrerUserId },
      });
      expect(seller.removedAt).toBeInstanceOf(Date);
      expect(seller.removedByUserId).toBeNull();
    });

    it('RN10 - cerimonialista sem perfil e sem nome: pede o nome; com ele, ganha o perfil mínimo e o casamento sem indicador fica atribuído a ela', async () => {
      const { ana, weddingId } = await anaWedding();
      const juliana = await signedInUser({ app });
      await db.user.update({ where: { id: juliana.userId }, data: { name: null } });
      const email = (await db.user.findUniqueOrThrow({ where: { id: juliana.userId } })).email;
      const { token } = await seedInvitation({
        db,
        weddingId,
        kind: 'planner',
        email,
        invitedByUserId: ana.userId,
      });

      const missing = (await accept(token, juliana.cookie).expect(400)).body;
      expect(missing.message).toEqual(['name is required to accept this invitation']);
      expect(missing.errors).toEqual([{ path: 'name', code: 'IS_NOT_EMPTY', params: {} }]);
      const response = await accept(token, juliana.cookie, { name: ' Juliana  Prado ' }).expect(
        200,
      );

      expect(response.body).toMatchObject({ role: 'collaborator', attributedToMe: true });
      const referrer = await db.referrer.findUniqueOrThrow({
        where: { userId: juliana.userId },
        include: { planner: true },
      });
      expect(referrer).toMatchObject({ kind: 'planner', status: 'active', ratePercent: 20 });
      expect(referrer.referralCode).toMatch(/^juliana-prado(-\d+)?$/);
      expect(referrer.planner?.creditName).toBe('Juliana Prado');
      const member = await db.organizationMember.findFirstOrThrow({
        where: { userId: juliana.userId },
        include: { organization: true },
      });
      expect(member).toMatchObject({ role: 'owner', organization: { name: 'Juliana Prado' } });
      expect((await db.user.findUniqueOrThrow({ where: { id: juliana.userId } })).name).toBe(
        'Juliana Prado',
      );
      const wedding = await db.wedding.findUniqueOrThrow({ where: { id: weddingId } });
      expect(wedding).toMatchObject({
        referrerId: referrer.id,
        referralSource: 'invited_before_payment',
      });
    });

    it('RN10 (decisão 211) - com 55 códigos do mesmo nome em uso, o aceite pega o próximo número; dois aceites juntos pegam números diferentes', async () => {
      // Um nome por rodada, para não somar os códigos das rodadas anteriores.
      const name = `Clara ${randomUUID().slice(0, 8)}`;
      const base = name.toLowerCase().replace(' ', '-');
      const taken = [base, ...Array.from({ length: 54 }, (_, i) => `${base}-${i + 2}`)];
      for (const referralCode of taken) {
        const user = await db.user.create({ data: { email: `${referralCode}@kore.local` } });
        await db.referrer.create({
          data: { userId: user.id, kind: 'planner', referralCode, ratePercent: 20 },
        });
      }
      async function plannerAccepts() {
        const { ana, weddingId } = await anaWedding();
        const clara = await signedInUser({ app, name });
        const { token } = await seedInvitation({
          db,
          weddingId,
          kind: 'planner',
          email: (await db.user.findUniqueOrThrow({ where: { id: clara.userId } })).email,
          invitedByUserId: ana.userId,
        });
        return { accept: () => accept(token, clara.cookie), userId: clara.userId };
      }
      const code = async (userId: string) =>
        (await db.referrer.findUniqueOrThrow({ where: { userId } })).referralCode;

      const first = await plannerAccepts();
      await first.accept().expect(200);
      expect(await code(first.userId)).toBe(`${base}-56`);

      const [second, third] = [await plannerAccepts(), await plannerAccepts()];
      const responses = await Promise.all([second.accept(), third.accept()]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect([await code(second.userId), await code(third.userId)].sort()).toEqual([
        `${base}-57`,
        `${base}-58`,
      ]);
      // Quem já tem perfil de indicador não entra num laço: o erro é o do
      // PLANNER_PROFILE_EXISTS (Cadastro e perfil RN03), na transação da pessoa.
      await expect(
        app.get(TenantTransaction).run({
          userId: first.userId,
          work: () =>
            app
              .get<PlannerProfiles>(PLANNER_PROFILES)
              .createMinimal({ userId: first.userId, name, now: new Date() }),
        }),
      ).rejects.toThrow(PlannerProfileExistsError);
    });

    it('RN10 - casamento que já tem indicador: a cerimonialista entra sem atribuição', async () => {
      const { referrerUserId } = await plannerWedding();
      const { ana, weddingId } = await anaWedding();
      const otherReferrer = await db.referrer.findUniqueOrThrow({
        where: { userId: referrerUserId },
      });
      await db.wedding.update({
        where: { id: weddingId },
        data: { referrerId: otherReferrer.id, referralSource: 'referral_link' },
      });
      const rita = await signedInUser({ app, name: 'Rita Souza' });
      const email = (await db.user.findUniqueOrThrow({ where: { id: rita.userId } })).email;
      const { token } = await seedInvitation({
        db,
        weddingId,
        kind: 'planner',
        email,
        invitedByUserId: ana.userId,
      });

      const response = await accept(token, rita.cookie).expect(200);

      expect(response.body.attributedToMe).toBe(false);
      expect((await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).referrerId).toBe(
        otherReferrer.id,
      );
    });

    it('decisão 175 - quem tem perfil de vendedor: 409 SELLER_CANNOT_BE_PLANNER, sem vínculo', async () => {
      const { ana, weddingId } = await anaWedding();
      const { userId } = await seedReferrer({ db, kind: 'seller', name: 'Lucas Lima' });
      const cookie = await openSession({ app, userId });
      const email = (await db.user.findUniqueOrThrow({ where: { id: userId } })).email;
      const { token } = await seedInvitation({
        db,
        weddingId,
        kind: 'planner',
        email,
        invitedByUserId: ana.userId,
      });

      expect((await accept(token, cookie).expect(409)).body.error).toBe('SELLER_CANNOT_BE_PLANNER');
      expect(await db.membership.count({ where: { weddingId, userId } })).toBe(0);
    });

    it('RN10 - casamento que já tem cerimonialista: 409 PLANNER_ALREADY', async () => {
      const { ana, weddingId } = await anaWedding();
      const first = await signedInUser({ app });
      await db.membership.create({
        data: { weddingId, userId: first.userId, role: 'collaborator' },
      });
      const second = await signedInUser({ app, name: 'Clara' });
      const email = (await db.user.findUniqueOrThrow({ where: { id: second.userId } })).email;
      const { token } = await seedInvitation({
        db,
        weddingId,
        kind: 'planner',
        email,
        invitedByUserId: ana.userId,
      });

      expect((await accept(token, second.cookie).expect(409)).body.error).toBe('PLANNER_ALREADY');
    });

    it('RN08 - dois aceites ao mesmo tempo do mesmo convite: só um vale', async () => {
      const { ana, weddingId } = await anaWedding();
      const { token } = await seedInvitation({
        db,
        weddingId,
        kind: 'partner',
        email: `${randomUUID()}@kore.local`,
        invitedByUserId: ana.userId,
      });
      const [a, b] = [await signedInUser({ app }), await signedInUser({ app })];
      const body = { myTitle: 'groom', confirmOtherAccount: true };

      const statuses = (
        await Promise.all([accept(token, a.cookie, body), accept(token, b.cookie, body)])
      )
        .map((response) => response.status)
        .sort();

      expect(statuses).toEqual([200, 410]);
      expect(
        await db.membership.count({ where: { weddingId, role: 'owner', removedAt: null } }),
      ).toBe(2);
    });

    it('sem sessão: 401', async () => {
      await request(app.getHttpServer())
        .post('/v1/access-invitations/qualquer/accept')
        .set('Origin', APP_ORIGIN)
        .send({})
        .expect(401);
    });
  });

  describe('POST /v1/access-invitations/{token}/decline (RN11; decisão 136)', () => {
    it('RN11 - recusa sem login: 204, o link cai e quem convidou recebe o e-mail 5', async () => {
      const { ana, weddingId } = await anaWedding();
      const anaEmail = (await db.user.findUniqueOrThrow({ where: { id: ana.userId } })).email;
      const { token } = await seedInvitation({
        db,
        weddingId,
        kind: 'partner',
        email: `${randomUUID()}@kore.local`,
        invitedByUserId: ana.userId,
      });

      await decline(token).expect(204);

      expect((await read(token).expect(410)).body.reason).toBe('used');
      const [message] = await waitForInbox({ to: anaEmail });
      expect(message?.Subject).toBe('Marcos recusou o convite');
    });

    it('RN11 - no convite do casal, o aviso usa o e-mail convidado', async () => {
      const { referrerUserId, weddingId } = await plannerWedding();
      const julianaEmail = (await db.user.findUniqueOrThrow({ where: { id: referrerUserId } }))
        .email;
      const fernanda = `${randomUUID()}@kore.local`;
      const { token } = await seedInvitation({
        db,
        weddingId,
        kind: 'couple',
        email: fernanda,
        invitedByUserId: referrerUserId,
      });

      await decline(token).expect(204);

      expect((await waitForInbox({ to: julianaEmail }))[0]?.Subject).toBe(
        `${fernanda} recusou o convite`,
      );
    });

    it('decisão 136 (8) - o link sem e-mail não tem Recusar: 409 e o link segue válido', async () => {
      const { referrerUserId, weddingId } = await plannerWedding();
      const { token } = await seedInvitation({
        db,
        weddingId,
        kind: 'couple',
        email: null,
        invitedByUserId: referrerUserId,
      });

      expect((await decline(token).expect(409)).body.error).toBe('INVITATION_NOT_DECLINABLE');
      await read(token).expect(200);
    });

    it('RN12 - recusar um convite que já não vale: 410', async () => {
      const { ana, weddingId } = await anaWedding();
      const { token, invitationId } = await seedInvitation({
        db,
        weddingId,
        kind: 'partner',
        email: `${randomUUID()}@kore.local`,
        invitedByUserId: ana.userId,
      });
      await db.accessInvitation.update({
        where: { id: invitationId },
        data: { revokedAt: new Date() },
      });

      expect((await decline(token).expect(410)).body.reason).toBe('revoked');
    });
  });

  it('a sessão inválida no GET segue como sem sessão (sessão opcional)', async () => {
    const { ana, weddingId } = await anaWedding();
    const { token } = await seedInvitation({
      db,
      weddingId,
      kind: 'partner',
      email: `${randomUUID()}@kore.local`,
      invitedByUserId: ana.userId,
    });

    const response = await read(token, `${SESSION_COOKIE}=invalida`).expect(200);

    expect(response.body.sessionEmailMismatch).toBe(false);
  });
});
