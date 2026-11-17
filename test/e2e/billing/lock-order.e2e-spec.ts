import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { addMonths } from '@/modules/billing/domain/payments/pricing';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { localDate } from '@/shared/kernel/time/local-date';
import { createTestApp } from '../support/harness/create-test-app';
import { createTestWorker } from '../support/harness/create-test-worker';
import { devPaymentEvent, publishByPayment } from '../support/factories/payments';
import { seedReferrer } from '../support/factories/referrers';
import { signedInUser } from '../support/harness/sessions';
import { seedWedding } from '../support/factories/weddings';

const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';
const HOLD_MS = 800;

/**
 * A ordem única das travas (Publicar e pagar RN18, G2; Repasse RN04 e RN06;
 * decisão 275): o pedido de reembolso e a contestação travam o Referrer antes
 * de mexer na comissão, como o Pagar, o Recusar e o Liberar. Com o Referrer
 * preso por outra transação (o Pagar, por exemplo), eles esperam; antes, iam
 * direto à comissão e cruzavam com o repasse (deadlock ou o Pagar somando uma
 * comissão em estorno).
 */
describe('A ordem das travas G2 no reembolso e na contestação (decisão 275; banco real)', () => {
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

  /** Ana pagou um casamento indicado por Juliana: a comissão nasceu. */
  async function referred() {
    const seeded = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId: seeded.userId } });
    const ana = await signedInUser({ app });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        eventDate: new Date(`${eventDate}T00:00:00Z`),
        referrerId: referrer.id,
        referralSource: 'referral_link',
      },
    });
    const { paymentId } = await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate });
    await db.commission.findUniqueOrThrow({ where: { paymentId } });
    return { ana, weddingId, paymentId, referrerId: referrer.id };
  }

  /**
   * Outra transação segura o Referrer (como o Pagar) até `release`; a ação
   * corre em paralelo e não pode terminar antes.
   */
  async function whileReferrerLocked<T>(referrerId: string, action: () => Promise<T>) {
    let release!: () => void;
    let locked!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const holder = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM referrers WHERE id = ${referrerId}::uuid FOR UPDATE`;
        locked();
        await released;
      },
      { timeout: 15_000 },
    );
    await isLocked;
    let stillLocked = true;
    let finishedWhileLocked = false;
    const running = action().then((value) => {
      finishedWhileLocked = stillLocked;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    stillLocked = false;
    release();
    await holder;
    const value = await running;
    return { value, finishedWhileLocked };
  }

  it('RN18 (G2) - o pedido de reembolso do casal espera o Referrer antes de reter a comissão', async () => {
    const { ana, weddingId, paymentId, referrerId } = await referred();
    const { value, finishedWhileLocked } = await whileReferrerLocked(referrerId, () =>
      request(app.getHttpServer())
        .post(`/v1/weddings/${weddingId}/payments/${paymentId}/refund-request`)
        .set('Cookie', ana.cookie)
        .set('Origin', ORIGIN)
        .send({}),
    );
    expect(finishedWhileLocked).toBe(false);
    expect(value.status).toBe(202);
    expect(await db.commission.findUniqueOrThrow({ where: { paymentId } })).toMatchObject({
      status: 'held',
    });
  });

  it('RN18 (G2) - a contestação e a contestação perdida esperam o Referrer antes de mexer na comissão', async () => {
    const { paymentId, referrerId } = await referred();
    const disputed = await whileReferrerLocked(referrerId, () =>
      devPaymentEvent({ app, paymentId, event: 'dispute' }),
    );
    expect(disputed.finishedWhileLocked).toBe(false);
    expect(disputed.value.status).toBe(200);
    expect((await db.commission.findUniqueOrThrow({ where: { paymentId } })).status).toBe('held');

    const lost = await whileReferrerLocked(referrerId, () =>
      devPaymentEvent({ app, paymentId, event: 'dispute-lost' }),
    );
    expect(lost.finishedWhileLocked).toBe(false);
    expect((await db.commission.findUniqueOrThrow({ where: { paymentId } })).status).toBe(
      'reversed',
    );
  });
});
