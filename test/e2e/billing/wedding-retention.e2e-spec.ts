import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  WEDDING_RETENTION_STORE,
  type WeddingRetentionStore,
} from '@/modules/billing/application/ports/wedding-retention.port';
import { AdvanceWeddingLifecycle } from '@/modules/billing/application/wedding-lifecycle/advance-wedding-lifecycle.use-case';
import { PurgeRetainedWeddings } from '@/modules/billing/application/wedding-lifecycle/purge-retained-weddings.use-case';
import { ReleaseCommissions } from '@/modules/billing/application/payouts/release-commissions.use-case';
import {
  WEDDING_LIFECYCLE_QUEUE,
  WEDDING_LIFECYCLE_SCHEDULER_ID,
  WeddingLifecycleProcessor,
} from '@/modules/billing/infrastructure/jobs/wedding-lifecycle.job';
import { siteImageKeys } from '@/modules/site/domain/site-image';
import { uuidV7 } from '@/shared/kernel/ids/uuid-v7';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '@/shared/storage/application/object-storage.port';
import { LocalGatewayStore } from '@/modules/billing/infrastructure/backoffice/local-gateway/local-gateway.store';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { EmailDeliveryFailures } from '@/shared/email/application/email-delivery-failures';
import { createTestApp } from '../support/harness/create-test-app';
import { createTestWorker } from '../support/harness/create-test-worker';
import { waitForInbox } from '../support/harness/mailpit';
import { seedPaidExtension } from '../support/factories/payments';
import { seedReferrer } from '../support/factories/referrers';
import { signedInUser } from '../support/harness/sessions';
import { seedWedding } from '../support/factories/weddings';

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

  it('RN03 - o expurgo leva o site, as imagens e os arquivos delas no armazenamento', async () => {
    const { weddingId } = await expiredWedding();
    const storage = worker.get<ObjectStorage>(OBJECT_STORAGE);
    const id = uuidV7();
    const keyToken = randomBytes(16).toString('hex');
    const keys = siteImageKeys({ keyToken });
    await db.siteImage.create({
      data: {
        id,
        keyToken,
        weddingId,
        status: 'ready',
        storageKey: keys.display,
        thumbKey: keys.thumb,
        ogKey: keys.og,
        sizeBytes: 3,
        width: 10,
        height: 10,
        readyAt: new Date(),
      },
    });
    for (const key of [keys.display, keys.thumb, keys.og])
      await storage.put({
        bucket: 'public',
        key,
        body: Buffer.from('jpg'),
        contentType: 'image/jpeg',
      });
    await db.wedding.update({ where: { id: weddingId }, data: { coverImageId: id } });
    expect(await db.section.count({ where: { weddingId } })).toBeGreaterThan(0);

    await run(weddingId, '2027-07-23');
    expect(await run(weddingId, '2027-08-23')).toMatchObject({ purged: 1 });

    expect(await db.siteImage.count({ where: { weddingId } })).toBe(0);
    expect(await db.section.count({ where: { weddingId } })).toBe(0);
    const heads = await Promise.all(
      [keys.display, keys.thumb, keys.og].map((key) => storage.head({ bucket: 'public', key })),
    );
    expect(heads.filter(Boolean)).toHaveLength(0);
  });

  it('RN04 - o expurgo que falha não para a rodada: abre um alerta purge_failed por casamento, sem repetir enquanto aberto', async () => {
    const { weddingId } = await expiredWedding();
    await run(weddingId, '2027-07-23');
    const store = worker.get<WeddingRetentionStore>(WEDDING_RETENTION_STORE);
    const failing = jest.spyOn(store, 'purge').mockRejectedValue(new Error('storage fora'));
    expect(await run(weddingId, '2027-08-23')).toEqual({ notices: 0, purged: 0, failed: 1 });
    expect(await run(weddingId, '2027-08-24')).toMatchObject({ failed: 1 });
    failing.mockRestore();
    const alerts = await db.alert.findMany({
      where: { type: 'purge_failed', entityType: 'wedding', entityId: weddingId },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ status: 'open', weddingId, data: { error: 'Error' } });
    expect((await wedding(weddingId)).status).toBe('expired');
  });

  it('RN02 e RN03 - a rotina diária fica agendada às 3h30 e roda a retenção depois das passagens', async () => {
    const queue = worker.get<Queue>(getQueueToken(WEDDING_LIFECYCLE_QUEUE));
    expect(await queue.getJobScheduler(WEDDING_LIFECYCLE_SCHEDULER_ID)).toMatchObject({
      pattern: '30 3 * * *',
    });
    const order: string[] = [];
    const advance = jest
      .spyOn(worker.get(AdvanceWeddingLifecycle), 'execute')
      .mockImplementation(() => {
        order.push('advance');
        return Promise.resolve({ grace: 0, expired: 0, notices: 0, errors: 0 });
      });
    const release = jest.spyOn(worker.get(ReleaseCommissions), 'execute').mockImplementation(() => {
      order.push('commissions');
      return Promise.resolve({ released: 0 });
    });
    const purge = jest.spyOn(retention, 'execute').mockImplementation(() => {
      order.push('retention');
      return Promise.resolve({ notices: 0, purged: 0, failed: 0 });
    });
    await worker.get(WeddingLifecycleProcessor).process();
    expect(order).toEqual(['advance', 'commissions', 'retention']);
    for (const spy of [advance, release, purge]) spy.mockRestore();
  });

  it('RN02 - sem o aviso, sem expurgo: a rodada depois do purgeAt avisa com o dia real, 30 dias depois', async () => {
    const { ana, weddingId } = await expiredWedding();
    expect(await run(weddingId, '2027-08-23')).toEqual({ notices: 1, purged: 0, failed: 0 });
    expect((await wedding(weddingId)).status).toBe('expired');
    // O aviso atrasado promete 22/09 (o aviso + 30), não o purgeAt que já passou.
    const items = await db.notification.findMany({ where: { weddingId, type: 'billing' } });
    expect(items.map((item) => [item.groupKey, item.payload])).toEqual([
      [
        'billing:purge_soon:2027-09-22',
        [expect.objectContaining({ kind: 'purge_soon', purgeAt: '2027-09-22' })],
      ],
    ]);
    const [email] = await waitForInbox({ to: ana.email });
    const { Text } = (await (
      await fetch(
        `${process.env.MAILPIT_API_URL ?? 'http://localhost:8025'}/api/v1/message/${email.ID}`,
      )
    ).json()) as { Text: string };
    expect(Text).toContain('Em 22 de set., os convidados, as respostas e o site serão apagados.');

    expect(await run(weddingId, '2027-09-21')).toMatchObject({ purged: 0 });
    expect(await run(weddingId, '2027-09-22')).toMatchObject({ purged: 1 });
  });

  it('RN02 (decisão 180(8)) - o worker desiste do e-mail: a marca sai, fica no log e a rodada seguinte avisa de novo', async () => {
    const { weddingId } = await expiredWedding();
    await run(weddingId, '2027-07-23');
    const noticeSentAt = noonInSaoPaulo('2027-07-23');
    expect((await wedding(weddingId)).purgeNoticeSentAt).toEqual(noticeSentAt);

    // O processador da fila avisa assim depois da última tentativa (testado no unitário dele).
    await worker.get(EmailDeliveryFailures).gaveUp({
      tag: {
        kind: 'retention_purge_notice',
        data: { weddingId, noticeSentAt: noticeSentAt.toISOString() },
      },
    });

    expect((await wedding(weddingId)).purgeNoticeSentAt).toBeNull();
    await db.applicationLog.findFirstOrThrow({
      where: { action: 'wedding.purge_notice_failed', weddingId },
    });
    // Sem o aviso, o expurgo espera; a rodada seguinte avisa de novo.
    expect(await run(weddingId, '2027-08-23')).toEqual({ notices: 1, purged: 0, failed: 0 });
    expect((await wedding(weddingId)).purgeNoticeSentAt).toEqual(noonInSaoPaulo('2027-08-23'));
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
