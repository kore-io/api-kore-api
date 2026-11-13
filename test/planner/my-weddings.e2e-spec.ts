import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { localDate } from '../../src/shared/time/local-date';
import { createTestApp } from '../support/create-test-app';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedReferrerWedding, seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const DAY_MS = 86_400_000;

/**
 * Meus casamentos e alertas (F6, C2), com o banco real e o kore_app: a lista
 * só com os vínculos de colaboradora, os testes de isolamento do mapa das
 * leituras fora da RLS por casamento (decisão 224), os alertas contados na
 * leitura e o detalhe com o link do casal decifrado só para quem o gerou.
 */
describe('Meus casamentos e alertas (banco real; decisões 223 e 224)', () => {
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
  const list = (cookie: string) => http().get('/v1/me/weddings').set('Cookie', cookie);
  const detail = (cookie: string, weddingId: string) =>
    http().get(`/v1/me/weddings/${weddingId}`).set('Cookie', cookie);
  const dayIn = (days: number) =>
    localDate({ at: new Date(Date.now() + days * DAY_MS), timezone: 'America/Sao_Paulo' });
  const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

  async function juliana() {
    const { userId } = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const cookie = await openSession({ app, userId });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId } });
    return { userId, cookie, referrerId: referrer.id };
  }

  /** Casamento de um casal em que ela colabora; pelo link dela, quando `viaLink`. */
  async function coupleWedding({
    plannerId,
    referrerId = null,
  }: {
    plannerId: string;
    referrerId?: string | null;
  }) {
    const ana = await signedInUser({ app, name: 'Ana Beatriz' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [plannerId],
    });
    if (referrerId)
      await db.wedding.update({
        where: { id: weddingId },
        data: { referrerId, referralSource: 'referral_link' },
      });
    return { weddingId, ana };
  }

  async function parties(weddingId: string, statuses: ('not_sent' | 'sent')[]) {
    for (const deliveryStatus of statuses)
      await db.party.create({
        data: {
          weddingId,
          name: 'Família',
          linkToken: randomBytes(16).toString('base64url'),
          deliveryStatus,
        },
      });
  }

  describe('GET /v1/me/weddings (RN01 a RN07)', () => {
    it('RN01 - só os vínculos de colaboradora; o casamento próprio, o de outra assessoria, o de quem saiu, o removido e o expurgado não entram', async () => {
      const planner = await juliana();
      const created = await seedReferrerWedding({
        db,
        referrerUserId: planner.userId,
        status: 'awaiting_couple',
      });
      const viaLink = await coupleWedding({
        plannerId: planner.userId,
        referrerId: planner.referrerId,
      });
      const invited = await coupleWedding({ plannerId: planner.userId });
      await db.wedding.update({
        where: { id: invited.weddingId },
        data: { eventDate: asDate('2027-01-30'), status: 'published' },
      });
      await db.wedding.update({
        where: { id: created.weddingId },
        data: { eventDate: asDate('2027-03-20') },
      });
      // Fora da lista:
      await seedWedding({ db, ownerId: planner.userId });
      const other = await seedReferrer({ db, kind: 'planner', name: 'Clara Dias' });
      await seedReferrerWedding({ db, referrerUserId: other.userId });
      const left = await coupleWedding({ plannerId: planner.userId });
      await db.membership.updateMany({
        where: { weddingId: left.weddingId, userId: planner.userId },
        data: { removedAt: new Date() },
      });
      const purged = await coupleWedding({ plannerId: planner.userId });
      await db.wedding.update({
        where: { id: purged.weddingId },
        data: { status: 'purged', purgedAt: new Date() },
      });

      const response = await list(planner.cookie).expect(200);

      expect(response.body.weddings).toEqual([
        {
          weddingId: invited.weddingId,
          partnerNames: ['Ana', 'Marcos'],
          eventDate: '2027-01-30',
          city: 'Campinas',
          state: 'SP',
          status: 'published',
          rsvpPercent: 0,
          guestsTotal: 0,
          origin: 'couple_invite',
          createdByMe: false,
          // Comissões RN08: sem Pix pendente.
          awaitingPayment: false,
        },
        expect.objectContaining({
          weddingId: created.weddingId,
          partnerNames: ['Fernanda', 'João'],
          eventDate: '2027-03-20',
          status: 'awaiting_couple',
          origin: 'created_by_me',
          createdByMe: true,
        }),
        expect.objectContaining({
          weddingId: viaLink.weddingId,
          eventDate: null,
          origin: 'referral_link',
          createdByMe: false,
        }),
      ]);
      expect(response.body.summary).toEqual({
        active: 3,
        awaitingCouple: 1,
        // Comissões RN08: nenhum Pix pendente e nenhuma comissão disponível.
        awaitingPayment: 0,
        commissionAvailableCents: 0,
      });
    });

    it('RN05 e RN06 - os alertas: respostas pendentes com prazo em 7 dias e convites não enviados a 90 dias; só os nomes do casal', async () => {
      const planner = await juliana();
      const pendente = await coupleWedding({ plannerId: planner.userId });
      await db.wedding.update({
        where: { id: pendente.weddingId },
        data: {
          status: 'published',
          rsvpDeadline: asDate(dayIn(3)),
          eventDate: asDate(dayIn(200)),
        },
      });
      await db.weddingStats.update({
        where: { weddingId: pendente.weddingId },
        data: { guestsTotal: 120, pending: 49, confirmed: 60, declined: 11 },
      });
      const quarenta = await coupleWedding({ plannerId: planner.userId });
      await db.wedding.update({
        where: { id: quarenta.weddingId },
        data: {
          status: 'published',
          rsvpDeadline: asDate(dayIn(3)),
          eventDate: asDate(dayIn(200)),
        },
      });
      await db.weddingStats.update({
        where: { weddingId: quarenta.weddingId },
        data: { guestsTotal: 120, pending: 48 },
      });
      const naoEnviado = await coupleWedding({ plannerId: planner.userId });
      await db.wedding.update({
        where: { id: naoEnviado.weddingId },
        data: { status: 'published', eventDate: asDate(dayIn(30)) },
      });
      await parties(naoEnviado.weddingId, ['not_sent', 'not_sent', 'not_sent']);
      const vinte = await coupleWedding({ plannerId: planner.userId });
      await db.wedding.update({
        where: { id: vinte.weddingId },
        data: { status: 'published', eventDate: asDate(dayIn(30)) },
      });
      await parties(vinte.weddingId, ['not_sent', 'sent', 'sent', 'sent', 'sent']);

      const { body } = await list(planner.cookie).expect(200);

      expect(body.alerts).toEqual({
        pendingResponses: [
          {
            weddingId: pendente.weddingId,
            partnerNames: ['Ana', 'Marcos'],
            rsvpDeadline: dayIn(3),
          },
        ],
        invitationsNotSent: [
          {
            weddingId: naoEnviado.weddingId,
            partnerNames: ['Ana', 'Marcos'],
            eventDate: dayIn(30),
          },
        ],
      });
    });

    it('revisão C2-8 - ler o painel e o detalhe não é atividade do casamento', async () => {
      const planner = await juliana();
      const { weddingId } = await seedReferrerWedding({ db, referrerUserId: planner.userId });
      const before = new Date('2026-09-01T00:00:00Z');
      await db.wedding.update({ where: { id: weddingId }, data: { lastActivityAt: before } });

      await list(planner.cookie).expect(200);
      await detail(planner.cookie, weddingId).expect(200);

      expect(
        (await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).lastActivityAt,
      ).toEqual(before);
    });

    it('decisão 224(3) - sem o perfil de cerimonialista: 403 PROFILE_NOT_OWNED', async () => {
      const ana = await signedInUser({ app });
      const inactive = await seedReferrer({
        db,
        kind: 'planner',
        name: 'Juliana Prado',
        status: 'inactive',
      });

      expect((await list(ana.cookie).expect(403)).body.error).toBe('PROFILE_NOT_OWNED');
      const cookie = await openSession({ app, userId: inactive.userId });
      expect((await list(cookie).expect(403)).body.error).toBe('PROFILE_NOT_OWNED');
    });
  });

  describe('GET /v1/me/weddings/{id} (RN08 e RN09)', () => {
    it('RN09 - o casamento criado por ela, com o link do casal decifrado para quem o gerou; no-store', async () => {
      const planner = await juliana();
      const { weddingId } = await seedReferrerWedding({ db, referrerUserId: planner.userId });
      const generated = await http()
        .post(`/v1/weddings/${weddingId}/access-invitations`)
        .set('Cookie', planner.cookie)
        .set('Origin', APP_ORIGIN)
        .send({ kind: 'couple' })
        .expect(201);
      const link = generated.body.invitations[0] as { id: string; url: string };

      const response = await detail(planner.cookie, weddingId).expect(200);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toMatchObject({
        weddingId,
        origin: 'created_by_me',
        createdByMe: true,
        status: 'awaiting_couple',
        slug: expect.any(String),
        stats: { guestsTotal: 0, confirmed: 0, declined: 0, pending: 0 },
        hasOwner: false,
        canEditIdentity: true,
        coupleInvitations: [
          {
            type: 'link',
            id: link.id,
            expiresAt: expect.any(String),
            state: 'active',
            url: link.url,
          },
        ],
      });
    });

    it('RN09 - o convite por e-mail mostra o e-mail e o envio; o link vencido vem sem url', async () => {
      const planner = await juliana();
      const { weddingId } = await seedReferrerWedding({ db, referrerUserId: planner.userId });
      const send = (body: Record<string, unknown>) =>
        http()
          .post(`/v1/weddings/${weddingId}/access-invitations`)
          .set('Cookie', planner.cookie)
          .set('Origin', APP_ORIGIN)
          .send(body)
          .expect(201);
      await send({ kind: 'couple', emails: ['fernanda.alves@kore.local'] });
      const link = (await send({ kind: 'couple' })).body.invitations[0] as { id: string };
      await db.accessInvitation.update({
        where: { id: link.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const { body } = await detail(planner.cookie, weddingId).expect(200);

      expect(body.coupleInvitations).toEqual([
        {
          type: 'email',
          id: expect.any(String),
          email: 'fernanda.alves@kore.local',
          sentAt: expect.any(String),
          expiresAt: expect.any(String),
        },
        { type: 'link', id: link.id, expiresAt: expect.any(String), state: 'expired', url: null },
      ]);
    });

    it('RN08 - no casamento do casal (não criado por ela), sem convites e sem a identidade', async () => {
      const planner = await juliana();
      const { weddingId } = await coupleWedding({ plannerId: planner.userId });

      const { body } = await detail(planner.cookie, weddingId).expect(200);

      expect(body).toMatchObject({
        createdByMe: false,
        hasOwner: true,
        canEditIdentity: false,
        coupleInvitations: [],
      });
    });

    it('RN01 - sem vínculo de colaboradora (outra assessoria, o casamento próprio, quem saiu): 404', async () => {
      const planner = await juliana();
      const other = await seedReferrer({ db, kind: 'planner', name: 'Clara Dias' });
      const otherWedding = await seedReferrerWedding({ db, referrerUserId: other.userId });
      const own = await seedWedding({ db, ownerId: planner.userId });
      const left = await coupleWedding({ plannerId: planner.userId });
      await db.membership.updateMany({
        where: { weddingId: left.weddingId, userId: planner.userId },
        data: { removedAt: new Date() },
      });

      for (const weddingId of [otherWedding.weddingId, own.weddingId, left.weddingId, 'nao-e-uuid'])
        expect((await detail(planner.cookie, weddingId).expect(404)).body.error).toBe(
          'WEDDING_NOT_FOUND',
        );
    });
  });
});
