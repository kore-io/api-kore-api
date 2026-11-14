import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import { PurgeRetainedWeddings } from '../../src/modules/billing/application/purge-retained-weddings.use-case';
import { LocalGatewayStore } from '../../src/modules/billing/infrastructure/backoffice/local-gateway/local-gateway.store';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { waitForInbox } from '../support/mailpit';
import { seedPaidExtension } from '../support/payments';
import { seedReferrer } from '../support/referrers';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const day = (value: string) => new Date(`${value}T00:00:00Z`);
/** Meio-dia em São Paulo (UTC−3) do dia dado: o relógio injetado da rotina. */
const noonInSaoPaulo = (value: string) => new Date(`${value}T15:00:00Z`);

/**
 * A rotina da retenção e do expurgo (Retenção e expurgo RN02, RN03 e RN05),
 * com o relógio injetado e recortada ao casamento do teste (o kore_test é
 * compartilhado). O Contexto do Gherkin: "Ana & Marcos" expirou em 22/02/2027,
 * com o expurgo em 22/08/2027, e Juliana Prado indicou o casamento.
 */
describe('Retenção e expurgo do casamento (RN02, RN03 e RN05; banco real)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;
  let retention: PurgeRetainedWeddings;

  beforeAll(async () => {
    app = await createTestApp();
    worker = await createTestWorker();
    db = app.get(BackofficePrismaService);
    retention = worker.get(PurgeRetainedWeddings);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  async function expiredWedding({ collaboratorIds = [] }: { collaboratorIds?: string[] } = {}) {
    const ana = await signedInUser({ app });
    const juliana = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId: juliana.userId } });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId, collaboratorIds });
    const slug = `ana-e-marcos-${randomUUID().slice(0, 8)}`;
    const paymentId = await seedPaidExtension({
      db,
      gateway: app.get(LocalGatewayStore),
      weddingId,
      ownerId: ana.userId,
      periodStart: '2026-11-14',
      periodEnd: '2027-02-14',
      paidAt: new Date('2026-11-14T15:00:00Z'),
    });
    await db.payment.update({ where: { id: paymentId }, data: { refundReason: 'Mudamos a data' } });
    await db.gatewayEvent.create({
      data: {
        gateway: 'local',
        gatewayEventId: `evt-${randomUUID()}`,
        type: 'payment.confirmed',
        paymentId,
        payload: {
          type: 'payment.confirmed',
          externalReference: paymentId,
          gatewayPaymentId: 'pay_1',
          chargedCents: 8700,
          feeCents: 300,
          netCents: 8400,
        },
      },
    });
    await db.commission.create({
      data: {
        referrerId: referrer.id,
        weddingId,
        paymentId,
        baseAmountCents: 8700,
        ratePercent: 20,
        amountCents: 1740,
        status: 'available',
        availableAt: new Date('2026-11-21T15:00:00Z'),
      },
    });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        slug,
        status: 'expired',
        publishedAt: new Date('2026-11-14T15:00:00Z'),
        eventDate: day('2027-01-20'),
        publicationSource: 'payment',
        graceUntil: day('2027-02-21'),
        expiredAt: day('2027-02-22'),
        purgeAt: day('2027-08-22'),
        referrerId: referrer.id,
        referralSource: 'referral_link',
      },
    });
    const party = await db.party.create({
      data: {
        weddingId,
        name: 'Família Moreira',
        linkToken: randomBytes(16).toString('base64url'),
      },
    });
    await db.guest.create({ data: { weddingId, partyId: party.id, name: 'Helena Moreira' } });
    return { ana, juliana, weddingId, slug, paymentId, partyId: party.id };
  }

  const run = (weddingId: string, at: string) =>
    retention.execute({ now: noonInSaoPaulo(at), weddingId });
  const wedding = (id: string) => db.wedding.findUniqueOrThrow({ where: { id } });

  it('RN02 - o aviso sai 30 dias antes, com o e-mail às pessoas donas e o item da central', async () => {
    const { ana, weddingId } = await expiredWedding();
    expect(await run(weddingId, '2027-07-22')).toEqual({ notices: 0, purged: 0, failed: 0 });

    expect(await run(weddingId, '2027-07-23')).toEqual({ notices: 1, purged: 0, failed: 0 });
    expect((await wedding(weddingId)).purgeNoticeSentAt).toEqual(noonInSaoPaulo('2027-07-23'));
    const items = await db.notification.findMany({ where: { weddingId, type: 'billing' } });
    expect(items.map((item) => item.payload)).toEqual([
      [expect.objectContaining({ kind: 'purge_soon', purgeAt: '2027-08-22' })],
    ]);
    const [email] = await waitForInbox({ to: ana.email });
    expect(email.Subject).toBe('Os dados do casamento serão apagados em 30 dias');
    // A mesma rodada de novo não repete.
    expect(await run(weddingId, '2027-07-23')).toMatchObject({ notices: 0 });
  });

  it('RN03 - depois do aviso, o expurgo deixa a lápide, libera o endereço e mantém os pagamentos e a comissão', async () => {
    const { weddingId, slug, paymentId, partyId } = await expiredWedding();
    await run(weddingId, '2027-07-23');
    expect(await run(weddingId, '2027-08-22')).toMatchObject({ purged: 0 });

    expect(await run(weddingId, '2027-08-23')).toEqual({ notices: 0, purged: 1, failed: 0 });
    const tombstone = await wedding(weddingId);
    expect(tombstone).toMatchObject({
      status: 'purged',
      purgedAt: noonInSaoPaulo('2027-08-23'),
      slug: null,
      endDate: null,
      expiredAt: null,
      purgeAt: null,
      purgeNoticeSentAt: null,
      publicationSource: null,
      referralSource: 'referral_link',
    });
    expect(tombstone.referrerId).not.toBeNull();
    expect(await db.wedding.count({ where: { slug } })).toBe(0);
    expect(await db.party.count({ where: { id: partyId } })).toBe(0);
    expect(await db.guest.count({ where: { weddingId } })).toBe(0);
    expect(await db.partner.count({ where: { weddingId } })).toBe(0);
    expect(await db.membership.count({ where: { weddingId } })).toBe(0);
    // O Payment fica, sem o motivo do reembolso; o evento do gateway, só com o tipo e os ids.
    const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment).toMatchObject({ status: 'paid', refundReason: null, payerTaxIdLast4: '4725' });
    const [event] = await db.gatewayEvent.findMany({ where: { paymentId } });
    expect(event.payload).toEqual({
      type: 'payment.confirmed',
      externalReference: paymentId,
      gatewayPaymentId: 'pay_1',
    });
    expect(await db.commission.count({ where: { weddingId, status: 'available' } })).toBe(1);
    const [log] = await db.applicationLog.findMany({
      where: { weddingId, action: 'wedding.purged' },
    });
    expect(log.data).toMatchObject({ reason: 'retention' });
  });

  it('RN02 - sem o aviso, sem expurgo: a rodada depois do purgeAt só avisa', async () => {
    const { weddingId } = await expiredWedding();
    expect(await run(weddingId, '2027-08-23')).toEqual({ notices: 1, purged: 0, failed: 0 });
    expect((await wedding(weddingId)).status).toBe('expired');
  });

  it('RN03 - o casamento bloqueado não é avisado nem apagado', async () => {
    const { weddingId } = await expiredWedding();
    await run(weddingId, '2027-07-23');
    await db.wedding.update({ where: { id: weddingId }, data: { blockedAt: new Date() } });
    expect(await run(weddingId, '2027-09-30')).toEqual({ notices: 0, purged: 0, failed: 0 });
    expect((await wedding(weddingId)).status).toBe('expired');
  });

  it('RN05 - a exclusão pedida expurga no dia agendado, sem o aviso, e a cerimonialista colaboradora é avisada', async () => {
    const carla = await seedReferrer({ db, kind: 'planner', name: 'Carla Souza' });
    const { ana, weddingId } = await expiredWedding({ collaboratorIds: [carla.userId] });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        status: 'published',
        graceUntil: null,
        expiredAt: null,
        purgeAt: null,
        endDate: day('2027-02-14'),
        paidThrough: day('2027-02-14'),
        deletionScheduledFor: day('2026-11-21'),
        deletionRequestedByUserId: ana.userId,
      },
    });
    expect(await run(weddingId, '2026-11-20')).toMatchObject({ purged: 0 });

    expect(await run(weddingId, '2026-11-21')).toEqual({ notices: 0, purged: 1, failed: 0 });
    expect(await wedding(weddingId)).toMatchObject({
      status: 'purged',
      deletionScheduledFor: null,
      deletionRequestedByUserId: null,
      paidThrough: null,
    });
    const [log] = await db.applicationLog.findMany({
      where: { weddingId, action: 'wedding.purged' },
    });
    expect(log.data).toMatchObject({ reason: 'owner_request', requestedByUserId: ana.userId });
    const notices = await db.notification.findMany({
      where: { userId: carla.userId, weddingId, type: 'membership_removed' },
    });
    expect(notices.map((notice) => notice.payload)).toEqual([
      [{ partnerNames: ['Ana', 'Marcos'] }],
    ]);
  });
});
