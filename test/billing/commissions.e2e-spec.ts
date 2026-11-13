import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { ReleaseCommissions } from '../../src/modules/billing/application/release-commissions.use-case';
import { addMonths } from '../../src/modules/billing/domain/pricing';
import {
  TAX_ID_HASHER,
  type TaxIdHasher,
} from '../../src/shared/crypto/application/tax-id-hasher.port';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { localDate } from '../../src/shared/time/local-date';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import {
  devPaymentEvent,
  expectStatus,
  payForExtension,
  publishByPayment,
  randomCpf,
} from '../support/payments';
import { seedReferrer } from '../support/referrers';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';
const DAY = 86_400_000;
const day = (value: string) => new Date(`${value}T00:00:00Z`);

/**
 * As comissões do indicador (Comissões do indicador RN01 a RN06), nascendo na
 * aplicação do pagamento e mudando com a liberação, o reembolso e a contestação.
 */
describe('Comissões do indicador (Comissões RN01 a RN06; banco real)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;
  const today = localDate({ at: new Date(), timezone: 'America/Sao_Paulo' });
  const eventDate = addMonths({ day: today, months: 4 });
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

  /** Ana, indicada por Juliana (20%), publica no cartão. */
  async function published({
    referrer = 'active',
    ratePercent = 20,
    selfReferral = false,
  }: {
    referrer?: 'active' | 'blocked' | 'none';
    ratePercent?: number;
    selfReferral?: boolean;
  } = {}) {
    const ana = await signedInUser({ app });
    // Um CPF por rodada: o hash do indicador é único no kore_test compartilhado.
    const payerTaxId = randomCpf();
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    await db.wedding.update({ where: { id: weddingId }, data: { eventDate: day(eventDate) } });
    let referrerId: string | null = null;
    if (referrer !== 'none') {
      const juliana = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
      const row = await db.referrer.findUniqueOrThrow({ where: { userId: juliana.userId } });
      referrerId = row.id;
      const taxIdHash = selfReferral
        ? app.get<TaxIdHasher>(TAX_ID_HASHER).digest({ taxId: payerTaxId }).hash
        : null;
      await db.referrer.update({
        where: { id: row.id },
        data: {
          ratePercent,
          ...(referrer === 'blocked' ? { status: 'blocked' } : {}),
          ...(taxIdHash
            ? { taxIdType: 'cpf', taxIdHash, taxIdHashVersion: 1, taxIdEncrypted: 'x' }
            : {}),
        },
      });
      await db.wedding.update({
        where: { id: weddingId },
        data: { referrerId: row.id, referralSource: 'referral_link' },
      });
    }
    const { paymentId } = await publishByPayment({
      app,
      cookie: ana.cookie,
      weddingId,
      endDate,
      payerTaxId,
    });
    return { ana, weddingId, paymentId, referrerId };
  }

  const commissionOf = (paymentId: string) => db.commission.findUnique({ where: { paymentId } });
  const dispute = (paymentId: string, event: string) =>
    devPaymentEvent({ app, paymentId, event }).then((response) => expectStatus(response, 200));

  it('RN01 - nasce na aplicação: base sem os juros, 20%, ao centavo, aguardando liberação por 30 dias', async () => {
    const { paymentId } = await published();
    const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const commission = await commissionOf(paymentId);
    const base = payment.amountCents - payment.installmentInterestCents;
    expect(commission).toMatchObject({
      status: 'pending',
      blockReason: null,
      ratePercent: 20,
      baseAmountCents: base,
      amountCents: Math.floor((base * 20 + 50) / 100),
      payoutId: null,
    });
    expect(commission!.availableAt.getTime() - payment.paidAt!.getTime()).toBe(30 * DAY);
  });

  it('RN01 - sem indicador, ou com 0%, não nasce', async () => {
    expect(await commissionOf((await published({ referrer: 'none' })).paymentId)).toBeNull();
    expect(await commissionOf((await published({ ratePercent: 0 })).paymentId)).toBeNull();
  });

  it('RN03 e RN04 - autoindicação e indicador bloqueado: nasce bloqueada', async () => {
    expect(await commissionOf((await published({ selfReferral: true })).paymentId)).toMatchObject({
      status: 'blocked',
      blockReason: 'self_referral',
    });
    expect(await commissionOf((await published({ referrer: 'blocked' })).paymentId)).toMatchObject({
      status: 'blocked',
      blockReason: 'referrer_blocked',
    });
  });

  it('RN01 - a extensão também gera comissão', async () => {
    const { ana, weddingId } = await published();
    const created = expectStatus(
      await payForExtension({
        app,
        cookie: ana.cookie,
        weddingId,
        endDate: addMonths({ day: endDate, months: 1 }),
      }),
      201,
    );
    const extensionId = created.body.paymentId as string;
    await dispute(extensionId, 'confirm');
    const extension = await db.payment.findUniqueOrThrow({ where: { id: extensionId } });
    expect(await commissionOf(extensionId)).toMatchObject({
      status: 'pending',
      amountCents: Math.floor((extension.amountCents * 20 + 50) / 100),
    });
  });

  it('RN02 e RN09 - a liberação pela data em São Paulo, com a notificação commission à indicadora', async () => {
    const { paymentId, referrerId, weddingId } = await published();
    const release = worker.get(ReleaseCommissions);
    const commission = (await commissionOf(paymentId))!;
    const releaseDay = localDate({ at: commission.availableAt, timezone: 'America/Sao_Paulo' });

    // Na véspera, nada.
    const eve = new Date(`${releaseDay}T03:00:00Z`).getTime() - DAY + 4 * 3_600_000;
    expect(await release.execute({ now: new Date(eve), referrerId: referrerId! })).toEqual({
      released: 0,
    });
    // Às 4h do dia, mesmo antes da hora do pagamento.
    const at4am = new Date(`${releaseDay}T07:00:00Z`);
    expect(await release.execute({ now: at4am, referrerId: referrerId! })).toEqual({ released: 1 });
    expect(await commissionOf(paymentId)).toMatchObject({ status: 'available' });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { id: referrerId! } });
    const [notice] = await db.notification.findMany({
      where: { userId: referrer.userId, type: 'commission' },
    });
    expect(notice).toMatchObject({ weddingId, groupKey: `commission:${commission.id}` });
    expect(notice.payload).toEqual([
      expect.objectContaining({
        amountCents: commission.amountCents,
        partnerNames: ['Ana', 'Marcos'],
      }),
    ]);
    expect(await release.execute({ now: at4am, referrerId: referrerId! })).toEqual({ released: 0 });
  });

  it('RN05 - o pedido do reembolso retém; o estorno confirmado estorna', async () => {
    const { ana, weddingId, paymentId } = await published();
    await request(app.getHttpServer())
      .post(`/v1/weddings/${weddingId}/payments/${paymentId}/refund-request`)
      .set('Cookie', ana.cookie)
      .set('Origin', ORIGIN)
      .send({})
      .expect(202);
    expect(await commissionOf(paymentId)).toMatchObject({ status: 'held' });
    // O job de estorno roda no worker; a confirmação vem pela rota dev.
    const deadline = Date.now() + 10_000;
    while ((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).refundAttempts < 1) {
      if (Date.now() > deadline) throw new Error('Sem a tentativa de estorno.');
      await new Promise((done) => setTimeout(done, 100));
    }
    await dispute(paymentId, 'refund');
    const reversed = await commissionOf(paymentId);
    expect(reversed).toMatchObject({ status: 'reversed' });
    expect(reversed!.reversedAt).not.toBeNull();
  });

  it('RN06 - a contestação retém; ganha, volta a aguardar; perdida, estorna', async () => {
    const won = await published();
    await dispute(won.paymentId, 'dispute');
    expect(await commissionOf(won.paymentId)).toMatchObject({ status: 'held' });
    await dispute(won.paymentId, 'dispute-won');
    expect(await commissionOf(won.paymentId)).toMatchObject({ status: 'pending' });

    const lost = await published();
    await dispute(lost.paymentId, 'dispute');
    await dispute(lost.paymentId, 'dispute-lost');
    expect(await commissionOf(lost.paymentId)).toMatchObject({ status: 'reversed' });
  });

  it('RN06 - a comissão bloqueada continua bloqueada na contestação', async () => {
    const { paymentId } = await published({ referrer: 'blocked' });
    await dispute(paymentId, 'dispute');
    expect(await commissionOf(paymentId)).toMatchObject({ status: 'blocked' });
  });
});
