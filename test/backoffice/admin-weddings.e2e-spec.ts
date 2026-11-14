import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { addMonths } from '../../src/modules/billing/domain/pricing';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { localDate } from '../../src/shared/time/local-date';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { expectStatus, payForExtension, publishByPayment } from '../support/payments';
import { seedReferrer } from '../support/referrers';
import { signedInUser, staffUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';
const day = (value: string) => new Date(`${value}T00:00:00Z`);

/**
 * Backoffice: o guard do staff e os Casamentos (Backoffice - acesso RN01, RN02,
 * RN05 e RN06). As listas são recortadas pelo indicador do teste (o kore_test é
 * compartilhado).
 */
describe('Backoffice: acesso e casamentos (Backoffice - acesso RN01, RN02, RN05 e RN06; banco real)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;
  const today = localDate({ at: new Date(), timezone: 'America/Sao_Paulo' });
  const eventDate = addMonths({ day: today, months: 2 });
  const endDate = addMonths({ day: eventDate, months: 3 });

  beforeAll(async () => {
    app = await createTestApp();
    worker = await createTestWorker();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const get = (cookie: string, path: string, query: Record<string, string> = {}) =>
    http().get(`/v1/admin${path}`).query(query).set('Cookie', cookie);
  const post = (cookie: string, path: string, body: Record<string, unknown>) =>
    http().post(`/v1/admin${path}`).set('Cookie', cookie).set('Origin', ORIGIN).send(body);

  /** Um casamento de Ana, indicado por Juliana (cerimonialista), opcionalmente publicado. */
  async function referredWedding({
    referrerId,
    publish = false,
    guests = 0,
  }: {
    referrerId: string;
    publish?: boolean;
    guests?: number;
  }) {
    const ana = await signedInUser({ app });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    await db.wedding.update({
      where: { id: weddingId },
      data: { eventDate: day(eventDate), referrerId, referralSource: 'referral_link' },
    });
    if (publish) await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate });
    if (guests > 0) {
      const party = await db.party.create({
        data: {
          weddingId,
          name: 'Família Moreira',
          linkToken: randomBytes(16).toString('base64url'),
        },
      });
      for (let index = 0; index < guests; index++)
        await db.guest.create({
          data: { weddingId, partyId: party.id, name: `Convidado ${index}` },
        });
      // Os números que o app manteria (o grupo veio pelo banco).
      // rsvp_percent é coluna gerada: só as contagens.
      await db.$executeRaw`
        INSERT INTO wedding_stats (wedding_id, guests_total, pending, parties_pending)
        VALUES (${weddingId}::uuid, ${guests}, ${guests}, 1)
        ON CONFLICT (wedding_id) DO UPDATE
        SET guests_total = EXCLUDED.guests_total, pending = EXCLUDED.pending,
            parties_pending = EXCLUDED.parties_pending`;
    }
    return { ana, weddingId };
  }

  async function referrer(name = 'Juliana Prado') {
    const juliana = await seedReferrer({ db, kind: 'planner', name });
    return db.referrer.findUniqueOrThrow({ where: { userId: juliana.userId } });
  }

  describe('RN01 e RN02 - o guard do staff', () => {
    it('RN01 - fora do staff, 403 STAFF_ONLY sem dizer o motivo: login por código, outro domínio, sem papel', async () => {
      const byCode = await staffUser({ app, role: 'admin', authMethod: 'email', domain: null });
      const otherDomain = await staffUser({ app, role: 'admin', domain: 'gmail.com' });
      const noRole = await staffUser({ app, role: 'none' });
      const couple = await signedInUser({ app });
      for (const { cookie } of [byCode, otherDomain, noRole, couple]) {
        const response = await get(cookie, '/weddings').expect(403);
        expect(response.body).toEqual({
          statusCode: 403,
          error: 'STAFF_ONLY',
          message: 'Only the Kore team can access this area.',
        });
      }
      await http().get('/v1/admin/weddings').expect(401);
    });

    it('RN01 - o papel é lido do banco a cada requisição, nunca da sessão', async () => {
      const support = await staffUser({ app, role: 'support' });
      await get(support.cookie, '/weddings').expect(200);
      await db.user.update({ where: { id: support.userId }, data: { platformRole: 'none' } });
      expect((await get(support.cookie, '/weddings').expect(403)).body.error).toBe('STAFF_ONLY');
    });
  });

  describe('RN05 - a lista de Casamentos', () => {
    it('RN05 (decisão 251) - os filtros de status, RSVP e indicador; a Origem e o Bloqueado por cima do status', async () => {
      const admin = await staffUser({ app, role: 'admin' });
      const juliana = await referrer();
      const draft = await referredWedding({ referrerId: juliana.id, guests: 2 });
      const published = await referredWedding({ referrerId: juliana.id, publish: true });
      const awaiting = await referredWedding({ referrerId: juliana.id, publish: true });
      // O rascunho com o Pix da publicação ainda pendente (o pagamento volta a pendente pelo banco).
      await db.wedding.update({
        where: { id: awaiting.weddingId },
        data: {
          status: 'draft',
          publishedAt: null,
          publicationSource: null,
          endDate: null,
          paidThrough: null,
        },
      });
      await db.payment.updateMany({
        where: { weddingId: awaiting.weddingId },
        data: { status: 'pending', paidAt: null, appliedAt: null },
      });
      await post(admin.cookie, `/weddings/${published.weddingId}/block`, {
        reason: 'Denúncia de conteúdo impróprio.',
      }).expect(200);

      const all = await get(admin.cookie, '/weddings', { referrerId: juliana.id }).expect(200);
      expect(all.body).toMatchObject({ page: 1, pageSize: 25, total: 3 });
      const byId = new Map(
        (all.body.items as { id: string }[]).map((item) => [item.id, item] as const),
      );
      expect(byId.get(draft.weddingId)).toMatchObject({
        coupleNames: 'Ana & Marcos',
        status: 'draft',
        displayStatus: 'draft',
        origin: 'planner',
        referralSource: 'referral_link',
        referrer: { id: juliana.id, kind: 'planner', name: 'Juliana Prado' },
        rsvpPercent: 0,
      });
      expect(byId.get(published.weddingId)).toMatchObject({
        status: 'published',
        displayStatus: 'blocked',
        blocked: true,
        rsvpPercent: null,
        endDate,
      });
      expect(byId.get(awaiting.weddingId)).toMatchObject({
        status: 'draft',
        displayStatus: 'awaiting_payment',
      });

      const ids = async (query: Record<string, string>) =>
        (
          (await get(admin.cookie, '/weddings', { referrerId: juliana.id, ...query }).expect(200))
            .body.items as { id: string }[]
        ).map((item) => item.id);
      expect(await ids({ status: 'blocked' })).toEqual([published.weddingId]);
      expect(await ids({ status: 'published' })).toEqual([]);
      expect(await ids({ status: 'awaiting_payment' })).toEqual([awaiting.weddingId]);
      expect(await ids({ status: 'draft' })).toEqual([draft.weddingId]);
      // Sem convidados, a taxa é "—" e só aparece em Todos.
      expect(await ids({ rsvp: 'below_50' })).toEqual([draft.weddingId]);
      expect(await ids({ rsvp: 'from_50' })).toEqual([]);

      await get(admin.cookie, '/weddings', { rsvp: 'none' }).expect(400);
    });
  });

  describe('RN06 - o detalhe do casamento', () => {
    it('RN06 e RN02 - a aba Geral com as pessoas, as datas e o bloqueio com o motivo; o Pix pendente só para o Admin; a leitura vai ao log', async () => {
      const admin = await staffUser({ app, role: 'admin' });
      const support = await staffUser({ app, role: 'support', name: 'Paulo Suporte' });
      const juliana = await referrer();
      const { ana, weddingId } = await referredWedding({ referrerId: juliana.id, publish: true });
      expectStatus(
        await payForExtension({
          app,
          cookie: ana.cookie,
          weddingId,
          endDate: addMonths({ day: endDate, months: 2 }),
          method: 'pix',
        }),
        201,
      );
      // O Pix pendente tem valor: só o Admin o vê (antes do bloqueio, que o cancela pelo worker).
      const pendingAsAdmin = await get(admin.cookie, `/weddings/${weddingId}`).expect(200);
      expect(pendingAsAdmin.body.general.pendingPayment).toEqual(
        expect.objectContaining({ amountCents: expect.any(Number) }),
      );
      const pendingAsSupport = await get(support.cookie, `/weddings/${weddingId}`).expect(200);
      expect(pendingAsSupport.body.general.pendingPayment).toBeNull();

      await post(support.cookie, `/weddings/${weddingId}/block`, {
        reason: 'Denúncia de conteúdo impróprio.',
      }).expect(200);
      const asAdmin = await get(admin.cookie, `/weddings/${weddingId}`).expect(200);
      expect(asAdmin.body.tab).toBe('general');
      expect(asAdmin.body.general).toMatchObject({
        id: weddingId,
        status: 'published',
        displayStatus: 'blocked',
        origin: 'planner',
        people: [expect.objectContaining({ userId: ana.userId, email: ana.email, role: 'owner' })],
        endDate,
        block: {
          blockedAt: expect.any(String),
          blockedByName: 'Paulo Suporte',
          reason: 'Denúncia de conteúdo impróprio.',
        },
      });
      expect(asAdmin.body.general.publishedAt).toEqual(expect.any(String));

      const views = await db.applicationLog.findMany({
        where: { weddingId, action: 'admin.wedding_viewed' },
      });
      expect(views.map((view) => view.actorUserId).sort()).toEqual(
        [admin.userId, admin.userId, support.userId].sort(),
      );
      expect(views[0]).toMatchObject({ actorKind: 'admin' });
    });

    it('RN06 - Números, Convidados (só grupo e nome, com log) e Log (sem centavos para o suporte)', async () => {
      const admin = await staffUser({ app, role: 'admin' });
      const support = await staffUser({ app, role: 'support' });
      const juliana = await referrer();
      const { weddingId } = await referredWedding({
        referrerId: juliana.id,
        publish: true,
        guests: 2,
      });

      const numbers = await get(admin.cookie, `/weddings/${weddingId}`, { tab: 'numbers' }).expect(
        200,
      );
      expect(numbers.body.numbers).toMatchObject({ guestsTotal: expect.any(Number) });

      const guests = await get(support.cookie, `/weddings/${weddingId}`, { tab: 'guests' }).expect(
        200,
      );
      expect(guests.body.guests).toMatchObject({ total: 2, page: 1 });
      expect(Object.keys(guests.body.guests.items[0]).sort()).toEqual(
        ['guestId', 'inTrash', 'name', 'partyId', 'partyName'].sort(),
      );
      await db.applicationLog.findFirstOrThrow({
        where: { weddingId, action: 'admin.guests_listed', actorUserId: support.userId },
      });

      const adminLog = await get(admin.cookie, `/weddings/${weddingId}`, { tab: 'log' }).expect(
        200,
      );
      const supportLog = await get(support.cookie, `/weddings/${weddingId}`, { tab: 'log' }).expect(
        200,
      );
      const withCents = (body: { log: { items: { data: unknown }[] } }) =>
        body.log.items.some((item) => JSON.stringify(item.data ?? {}).includes('Cents'));
      expect(withCents(adminLog.body)).toBe(true);
      expect(withCents(supportLog.body)).toBe(false);
    });

    it('RN06 - a lápide do casamento expurgado; o casamento que não existe é 404', async () => {
      const admin = await staffUser({ app, role: 'admin' });
      const juliana = await referrer();
      const { weddingId } = await referredWedding({ referrerId: juliana.id });
      const purgedAt = new Date('2027-08-23T15:00:00Z');
      await db.$transaction(async (tx) => {
        await tx.membership.deleteMany({ where: { weddingId } });
        await tx.partner.deleteMany({ where: { weddingId } });
        await tx.wedding.update({
          where: { id: weddingId },
          data: {
            status: 'purged',
            purgedAt,
            slug: null,
            eventDate: null,
            timezone: null,
            city: null,
            state: null,
            createdByUserId: null,
            signupSource: null,
          },
        });
      });
      const response = await get(admin.cookie, `/weddings/${weddingId}`).expect(200);
      expect(response.body.general).toEqual({
        id: weddingId,
        status: 'purged',
        purgedAt: purgedAt.toISOString(),
        referralSource: 'referral_link',
        referrer: { id: juliana.id, kind: 'planner', name: 'Juliana Prado' },
        createdAt: expect.any(String),
      });
      const missing = await get(
        admin.cookie,
        '/weddings/0190a5b8-0000-7000-8000-000000000000',
      ).expect(404);
      expect(missing.body.error).toBe('WEDDING_NOT_FOUND');
    });
  });

  describe('RN05 - bloquear e desbloquear', () => {
    it('RN05 - o suporte bloqueia e desbloqueia com o motivo no log; repetir dá 409; motivo curto, 400', async () => {
      const support = await staffUser({ app, role: 'support' });
      const juliana = await referrer();
      const { weddingId } = await referredWedding({ referrerId: juliana.id, publish: true });
      const reason = 'Denúncia de conteúdo impróprio.';

      await post(support.cookie, `/weddings/${weddingId}/block`, { reason: 'curto' }).expect(400);
      expect(
        (await post(support.cookie, `/weddings/${weddingId}/block`, { reason }).expect(200)).body,
      ).toEqual({
        blocked: true,
      });
      expect(
        (await post(support.cookie, `/weddings/${weddingId}/block`, { reason }).expect(409)).body
          .error,
      ).toBe('ALREADY_BLOCKED');
      expect(await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).toMatchObject({
        status: 'published',
        blockedByUserId: support.userId,
      });
      await db.applicationLog.findFirstOrThrow({
        where: {
          weddingId,
          action: 'wedding.blocked',
          actorUserId: support.userId,
          data: { equals: { reason } },
        },
      });

      await post(support.cookie, `/weddings/${weddingId}/unblock`, {
        reason: 'Conteúdo removido pelo casal.',
      }).expect(200);
      expect(
        (
          await post(support.cookie, `/weddings/${weddingId}/unblock`, {
            reason: 'Conteúdo removido pelo casal.',
          }).expect(409)
        ).body.error,
      ).toBe('NOT_BLOCKED');
      await db.applicationLog.findFirstOrThrow({
        where: { weddingId, action: 'wedding.unblocked' },
      });
    });
  });
});
