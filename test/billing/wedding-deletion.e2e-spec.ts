import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { addDays, addMonths } from '../../src/modules/billing/domain/pricing';
import { LocalGatewayStore } from '../../src/modules/billing/infrastructure/backoffice/local-gateway/local-gateway.store';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { localDate } from '../../src/shared/time/local-date';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { waitForInbox } from '../support/mailpit';
import { expectStatus, payForExtension, publishByPayment } from '../support/payments';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';
const SITE_ORIGIN = 'http://localhost:5174';
const DAY_MS = 86_400_000;
const day = (value: string) => new Date(`${value}T00:00:00Z`);

/**
 * Excluir o casamento e cancelar a exclusão (Retenção e expurgo RN05, RN06 e
 * RN08), pela API, com o Pix pendente cancelado pelo worker depois do commit.
 */
describe('Excluir o casamento (Retenção e expurgo RN05, RN06 e RN08; banco real)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;
  const today = localDate({ at: new Date(), timezone: 'America/Sao_Paulo' });
  const eventDate = addMonths({ day: today, months: 2 });
  const endDate = addMonths({ day: eventDate, months: 3 });
  const deletionDay = addDays({ day: today, days: 7 });

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

  /** Ana e Marcos, os dois donos; Juliana colabora. Publicado e pago há `paidDaysAgo` dias. */
  async function wedding({
    publish = true,
    paidDaysAgo = 10,
  }: { publish?: boolean; paidDaysAgo?: number } = {}) {
    const ana = await signedInUser({ app });
    const marcos = await signedInUser({ app, name: 'Marcos Lima' });
    const juliana = await signedInUser({ app, name: 'Juliana Prado' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    await db.membership.create({ data: { weddingId, userId: marcos.userId, role: 'owner' } });
    await db.partner.updateMany({
      where: { weddingId, slot: 2 },
      data: { userId: marcos.userId },
    });
    await db.wedding.update({ where: { id: weddingId }, data: { eventDate: day(eventDate) } });
    let paymentId: string | null = null;
    if (publish) {
      ({ paymentId } = await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate }));
      await db.payment.update({
        where: { id: paymentId },
        data: { paidAt: new Date(Date.now() - paidDaysAgo * DAY_MS) },
      });
    }
    const { slug } = await db.wedding.findUniqueOrThrow({ where: { id: weddingId } });
    return { ana, marcos, juliana, weddingId, slug: slug!, paymentId };
  }

  const requestDeletion = (cookie: string, weddingId: string, confirmName = 'Ana & Marcos') =>
    http()
      .post(`/v1/weddings/${weddingId}/deletion`)
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ confirmName });
  const cancelDeletion = (cookie: string, weddingId: string) =>
    http()
      .post(`/v1/weddings/${weddingId}/deletion/cancel`)
      .set('Cookie', cookie)
      .set('Origin', ORIGIN);
  const site = (slug: string) => http().get(`/v1/sites/${slug}`).set('Origin', SITE_ORIGIN);

  it('RN05 - excluir tira o site do ar, mantém o status, agenda para 7 dias e avisa as pessoas donas', async () => {
    const { ana, marcos, weddingId, slug } = await wedding();
    await site(slug).expect(200);

    const response = await requestDeletion(ana.cookie, weddingId).expect(202);
    expect(response.body).toEqual({ deletionScheduledFor: deletionDay });
    expect(await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).toMatchObject({
      status: 'published',
      deletionScheduledFor: day(deletionDay),
      deletionRequestedByUserId: ana.userId,
    });
    await site(slug).expect(410);
    const me = await http().get('/v1/me').set('Cookie', marcos.cookie).expect(200);
    const membership = (
      me.body.memberships as { weddingId: string; lifecycle: { deletionScheduledFor: string } }[]
    ).find((item) => item.weddingId === weddingId);
    expect(membership?.lifecycle.deletionScheduledFor).toBe(deletionDay);
    for (const owner of [ana, marcos]) {
      const [email] = await waitForInbox({ to: owner.email });
      expect(email.Subject).toBe('O casamento será apagado em 7 dias');
    }
    await db.applicationLog.findFirstOrThrow({
      where: { weddingId, action: 'wedding.deletion_requested', actorUserId: ana.userId },
    });

    // Os dois donos ao mesmo tempo: a segunda chamada recebe a mesma data.
    const again = await requestDeletion(marcos.cookie, weddingId).expect(202);
    expect(again.body).toEqual({ deletionScheduledFor: deletionDay });
  });

  it('RN05 - com a exclusão agendada, a escrita é recusada e o Exportar continua', async () => {
    const { ana, weddingId } = await wedding();
    const createParty = () =>
      http()
        .post(`/v1/weddings/${weddingId}/parties`)
        .set('Cookie', ana.cookie)
        .set('Origin', ORIGIN)
        .send({ name: 'Família Moreira', guests: [{ name: 'Célia Moreira', ageGroup: 'adult' }] });
    // Um grupo antes, para o Exportar ter o que exportar.
    await createParty().expect(201);
    await requestDeletion(ana.cookie, weddingId).expect(202);
    const party = await createParty().expect(409);
    expect(party.body.error).toBe('WEDDING_DELETION_SCHEDULED');
    await http()
      .get(`/v1/weddings/${weddingId}/guests/export`)
      .query({ format: 'xlsx', who: 'all', columns: 'party,name' })
      .set('Cookie', ana.cookie)
      .expect(200);
  });

  it('RN05 - cancelar a exclusão devolve o site ao ar e o lifecycle sem a data', async () => {
    const { ana, marcos, weddingId, slug } = await wedding();
    await requestDeletion(ana.cookie, weddingId).expect(202);

    const response = await cancelDeletion(marcos.cookie, weddingId).expect(200);
    expect(response.body).toEqual({
      lifecycle: expect.objectContaining({
        status: 'published',
        blocked: false,
        deletionScheduledFor: null,
      }),
    });
    await site(slug).expect(200);
    await db.applicationLog.findFirstOrThrow({
      where: { weddingId, action: 'wedding.deletion_canceled', actorUserId: marcos.userId },
    });
    const none = await cancelDeletion(marcos.cookie, weddingId).expect(409);
    expect(none.body.error).toBe('NO_DELETION_SCHEDULED');
  });

  it('RN05 - cancelar fora do ar: o status continua o das rotinas (rascunho)', async () => {
    const { ana, weddingId } = await wedding({ publish: false });
    await requestDeletion(ana.cookie, weddingId).expect(202);
    const response = await cancelDeletion(ana.cookie, weddingId).expect(200);
    expect(response.body.lifecycle).toMatchObject({ status: 'draft', deletionScheduledFor: null });
  });

  it('RN06 - dentro dos 7 dias do CDC, recusa com REFUND_WINDOW_OPEN e o fim do prazo', async () => {
    const { ana, weddingId } = await wedding({ paidDaysAgo: 3 });
    const response = await requestDeletion(ana.cookie, weddingId).expect(409);
    expect(response.body).toMatchObject({
      error: 'REFUND_WINDOW_OPEN',
      refundableUntil: expect.any(String),
    });
    expect(
      (await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).deletionScheduledFor,
    ).toBeNull();
  });

  it('RN06 - reembolso em andamento recusa com REFUND_IN_PROGRESS; contestação, com PAYMENT_DISPUTED', async () => {
    const pending = await wedding();
    await db.payment.update({
      where: { id: pending.paymentId! },
      data: { status: 'refund_requested', refundRequestedAt: new Date(), refundOrigin: 'couple' },
    });
    const inProgress = await requestDeletion(pending.ana.cookie, pending.weddingId).expect(409);
    expect(inProgress.body.error).toBe('REFUND_IN_PROGRESS');

    const disputed = await wedding();
    await db.payment.update({
      where: { id: disputed.paymentId! },
      data: {
        status: 'disputed',
        disputedAt: new Date(),
        disputeDeadline: day(addDays({ day: today, days: 10 })),
      },
    });
    const refused = await requestDeletion(disputed.ana.cookie, disputed.weddingId).expect(409);
    expect(refused.body.error).toBe('PAYMENT_DISPUTED');
  });

  it('RN06 - o Pix pendente é cancelado no gateway depois da gravação', async () => {
    const { ana, weddingId } = await wedding();
    const pix = expectStatus(
      await payForExtension({
        app,
        cookie: ana.cookie,
        weddingId,
        endDate: addMonths({ day: endDate, months: 2 }),
        method: 'pix',
      }),
      201,
    );
    const pixId = pix.body.paymentId as string;

    await requestDeletion(ana.cookie, weddingId).expect(202);
    const deadline = Date.now() + 10_000;
    let status = (await db.payment.findUniqueOrThrow({ where: { id: pixId } })).status;
    while (status === 'pending' && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 100));
      status = (await db.payment.findUniqueOrThrow({ where: { id: pixId } })).status;
    }
    expect(status).toBe('canceled');
    expect(
      await app.get(LocalGatewayStore).chargeByReference({ externalReference: pixId }),
    ).toMatchObject({ status: 'canceled' });
  });

  it('RN08 - sessão de 2 dias atrás recusa com REAUTH_REQUIRED', async () => {
    const { ana, weddingId } = await wedding();
    await db.session.updateMany({
      where: { userId: ana.userId },
      data: { authenticatedAt: new Date(Date.now() - 2 * DAY_MS) },
    });
    const response = await requestDeletion(ana.cookie, weddingId).expect(403);
    expect(response.body.error).toBe('REAUTH_REQUIRED');
  });

  it('RN05 e RN06 - a colaboradora não exclui, o nome errado não confirma e o bloqueado recusa', async () => {
    const { ana, juliana, weddingId } = await wedding();
    expect((await requestDeletion(juliana.cookie, weddingId).expect(403)).body.error).toBe(
      'ACTION_NOT_ALLOWED',
    );
    expect(
      (await requestDeletion(ana.cookie, weddingId, 'Ana e Marcos').expect(422)).body.error,
    ).toBe('CONFIRM_NAME_MISMATCH');
    // Maiúsculas e espaços a mais não contam.
    await requestDeletion(ana.cookie, weddingId, '  ana &  MARCOS ').expect(202);
    await db.wedding.update({ where: { id: weddingId }, data: { blockedAt: new Date() } });
    expect((await cancelDeletion(ana.cookie, weddingId).expect(403)).body.error).toBe(
      'WEDDING_BLOCKED',
    );
    expect((await requestDeletion(ana.cookie, weddingId).expect(403)).body.error).toBe(
      'WEDDING_BLOCKED',
    );
  });
});
