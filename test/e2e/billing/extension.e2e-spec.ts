import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { addDays, addMonths } from '@/modules/billing/domain/payments/pricing';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { PrismaService } from '@/shared/database/prisma.service';
import { localDate } from '@/shared/kernel/time/local-date';
import { createTestApp } from '../support/harness/create-test-app';
import { createTestWorker } from '../support/harness/create-test-worker';
import {
  devPaymentEvent,
  expectStatus,
  payForExtension,
  publishByPayment,
} from '../support/factories/payments';
import { signedInUser } from '../support/harness/sessions';
import { seedWedding } from '../support/factories/weddings';

const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';
const day = (value: string) => new Date(`${value}T00:00:00Z`);
const iso = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;

/**
 * A extensão e a mudança da data de saída do ar (Data de saída do ar RN04, RN05
 * e RN10), pela API, com a confirmação pela rota dev (RN11).
 */
describe('Extensão e data de saída do ar (Data de saída do ar RN04 e RN05; banco real)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;
  const today = localDate({ at: new Date(), timezone: 'America/Sao_Paulo' });
  // O casamento foi há 2 meses; a data de saída do ar, daqui a 1 mês.
  const eventDate = addMonths({ day: today, months: -2 });
  const endDate = addMonths({ day: today, months: 1 });

  beforeAll(async () => {
    app = await createTestApp();
    worker = await createTestWorker();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  /** Ana publicou pagando (até `endDate`) e o casamento passou: pós-evento. */
  async function published() {
    const ana = await signedInUser({ app });
    const juliana = await signedInUser({ app, name: 'Juliana Prado' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    // Publica com o casamento por vir e depois o leva ao passado (pós-evento).
    await db.wedding.update({
      where: { id: weddingId },
      data: { eventDate: day(addMonths({ day: today, months: 1 })) },
    });
    await publishByPayment({
      app,
      cookie: ana.cookie,
      weddingId,
      endDate: addMonths({ day: today, months: 2 }),
    });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        status: 'post_event',
        eventDate: day(eventDate),
        endDate: day(endDate),
        paidThrough: day(endDate),
      },
    });
    return { ana, juliana, weddingId };
  }

  const wedding = (id: string) => db.wedding.findUniqueOrThrow({ where: { id } });
  const extend = async (
    cookie: string,
    weddingId: string,
    to: string,
    method: 'pix' | 'card' = 'card',
  ) => {
    const created = expectStatus(
      await payForExtension({ app, cookie, weddingId, endDate: to, method }),
      201,
    );
    return created.body.paymentId as string;
  };
  const confirm = (paymentId: string) =>
    devPaymentEvent({ app, paymentId, event: 'confirm' }).then((response) =>
      expectStatus(response, 200),
    );
  const patchEndDate = (cookie: string, weddingId: string, value: unknown) =>
    request(app.getHttpServer())
      .patch(`/v1/weddings/${weddingId}/end-date`)
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ endDate: value });

  it('RN04 - adiar no pós-evento: a nova data e o paidThrough na confirmação, com o log e o aviso', async () => {
    const { ana, weddingId } = await published();
    const to = addMonths({ day: endDate, months: 3 });
    const paymentId = await extend(ana.cookie, weddingId, to);
    expect((await wedding(weddingId)).endDate).toEqual(day(endDate));

    await confirm(paymentId);
    const after = await wedding(weddingId);
    expect(after).toMatchObject({ status: 'post_event', endDate: day(to), paidThrough: day(to) });
    const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment).toMatchObject({ kind: 'extension', status: 'paid', monthsCovered: 3 });
    expect(iso(payment.periodStart)).toBe(endDate);
    expect(iso(payment.previousEndDate)).toBe(endDate);
    expect(payment.appliedAt).not.toBeNull();
    expect(
      await db.applicationLog.count({ where: { weddingId, action: 'wedding.extended' } }),
    ).toBe(1);
    expect(
      await db.notification.count({ where: { weddingId, groupKey: `billing:${paymentId}` } }),
    ).toBe(1);
  });

  it('RN04 - adiar na carência volta ao pós-evento, sem graceUntil', async () => {
    const { ana, weddingId } = await published();
    const lapsed = addDays({ day: today, days: -2 });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        status: 'grace',
        endDate: day(lapsed),
        paidThrough: day(lapsed),
        graceUntil: day(addDays({ day: lapsed, days: 7 })),
      },
    });
    const to = addMonths({ day: lapsed, months: 3 });
    await confirm(await extend(ana.cookie, weddingId, to));
    expect(await wedding(weddingId)).toMatchObject({
      status: 'post_event',
      graceUntil: null,
      endDate: day(to),
    });
  });

  it('RN04 (B4-3) - renovar o expirado conta de hoje, e o expurgo previsto e o aviso de expurgo somem', async () => {
    const { ana, weddingId } = await published();
    const lapsed = addDays({ day: today, days: -12 });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        status: 'expired',
        endDate: day(lapsed),
        paidThrough: day(lapsed),
        graceUntil: day(addDays({ day: lapsed, days: 7 })),
        expiredAt: day(addDays({ day: lapsed, days: 8 })),
        purgeAt: day(addMonths({ day: addDays({ day: lapsed, days: 8 }), months: 6 })),
        purgeNoticeSentAt: new Date(),
      },
    });
    const to = addMonths({ day: today, months: 3 });
    const paymentId = await extend(ana.cookie, weddingId, to);
    const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(iso(payment.periodStart)).toBe(today);
    expect(payment.monthsCovered).toBe(3);

    await confirm(paymentId);
    expect(await wedding(weddingId)).toMatchObject({
      status: 'post_event',
      endDate: day(to),
      graceUntil: null,
      expiredAt: null,
      purgeAt: null,
      purgeNoticeSentAt: null,
    });
  });

  it('RN04 (B4-8) - cotada na carência e paga já no expirado: aplica como foi cotada', async () => {
    const { ana, weddingId } = await published();
    const lapsed = addDays({ day: today, days: -2 });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        status: 'grace',
        endDate: day(lapsed),
        paidThrough: day(lapsed),
        graceUntil: day(addDays({ day: lapsed, days: 7 })),
      },
    });
    const to = addMonths({ day: lapsed, months: 3 });
    const paymentId = await extend(ana.cookie, weddingId, to, 'pix');
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        status: 'expired',
        expiredAt: day(addDays({ day: lapsed, days: 8 })),
        purgeAt: day(addMonths({ day: addDays({ day: lapsed, days: 8 }), months: 6 })),
      },
    });
    await confirm(paymentId);
    expect(await wedding(weddingId)).toMatchObject({
      status: 'post_event',
      endDate: day(to),
      expiredAt: null,
    });
  });

  it('Publicar e pagar RN08 (B2-9) - a extensão cuja base mudou vira estorno automático', async () => {
    const { ana, weddingId } = await published();
    const paymentId = await extend(
      ana.cookie,
      weddingId,
      addMonths({ day: endDate, months: 2 }),
      'pix',
    );
    // Outra extensão (ou a cortesia do Admin) moveu a base antes da confirmação.
    const moved = addMonths({ day: endDate, months: 1 });
    await db.wedding.update({
      where: { id: weddingId },
      data: { endDate: day(moved), paidThrough: day(moved) },
    });
    await confirm(paymentId);
    expect(await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({
      status: 'refund_requested',
      refundOrigin: 'automatic',
      appliedAt: null,
    });
    expect((await wedding(weddingId)).endDate).toEqual(day(moved));
  });

  it('RN05 - antecipar não cobra, mantém o paidThrough e cancela o Pix de extensão pendente', async () => {
    const { ana, weddingId } = await published();
    const pixId = await extend(
      ana.cookie,
      weddingId,
      addMonths({ day: endDate, months: 2 }),
      'pix',
    );
    const earlier = addDays({ day: endDate, days: -10 });

    const response = await patchEndDate(ana.cookie, weddingId, earlier).expect(200);
    expect(response.body).toEqual({ endDate: earlier, paidThrough: endDate, status: 'post_event' });
    expect(await wedding(weddingId)).toMatchObject({
      endDate: day(earlier),
      paidThrough: day(endDate),
    });
    expect(
      await db.applicationLog.count({
        where: { weddingId, action: 'wedding.end_date_brought_forward' },
      }),
    ).toBe(1);
    expect(await db.payment.findUniqueOrThrow({ where: { id: pixId } })).toMatchObject({
      status: 'canceled',
    });
    expect(await db.payment.count({ where: { weddingId, kind: 'extension' } })).toBe(1);
  });

  it('RN05 (B4-1) - voltar de graça até o paidThrough; depois dele, END_DATE_BEYOND_PAID; a cotação conta do paidThrough', async () => {
    const { ana, weddingId } = await published();
    await patchEndDate(ana.cookie, weddingId, addDays({ day: endDate, days: -10 })).expect(200);

    await patchEndDate(ana.cookie, weddingId, endDate).expect(200);
    expect(
      await db.applicationLog.count({ where: { weddingId, action: 'wedding.end_date_restored' } }),
    ).toBe(1);
    const beyond = await patchEndDate(
      ana.cookie,
      weddingId,
      addDays({ day: endDate, days: 1 }),
    ).expect(422);
    expect(beyond.body).toMatchObject({ error: 'END_DATE_BEYOND_PAID', paidThrough: endDate });

    await patchEndDate(ana.cookie, weddingId, addDays({ day: endDate, days: -10 })).expect(200);
    const quote = await request(app.getHttpServer())
      .get(`/v1/weddings/${weddingId}/billing/quote`)
      .set('Cookie', ana.cookie)
      .query({
        kind: 'extension',
        endDate: addMonths({ day: endDate, months: 3 }),
        method: 'card',
        installments: 1,
      })
      .expect(200);
    expect(quote.body).toMatchObject({ periodStart: endDate, monthsCovered: 3 });
  });

  it('RN05 - voltar a data na carência (quem antecipou) a encerra', async () => {
    const { ana, weddingId } = await published();
    const lapsed = addDays({ day: today, days: -1 });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        status: 'grace',
        endDate: day(lapsed),
        graceUntil: day(addDays({ day: lapsed, days: 7 })),
      },
    });
    const response = await patchEndDate(ana.cookie, weddingId, endDate).expect(200);
    expect(response.body).toMatchObject({ status: 'post_event' });
    expect(await wedding(weddingId)).toMatchObject({ status: 'post_event', graceUntil: null });
  });

  it('RN05 e RN10 - recusas: hoje ou antes, fora do formato, colaboradora, rascunho, bloqueado e exclusão agendada', async () => {
    const { ana, juliana, weddingId } = await published();
    expect((await patchEndDate(ana.cookie, weddingId, today).expect(422)).body).toMatchObject({
      error: 'END_DATE_OUT_OF_RANGE',
    });
    await patchEndDate(ana.cookie, weddingId, '14/02/2027').expect(400);
    await patchEndDate(ana.cookie, weddingId, null).expect(400);
    expect(
      (
        await patchEndDate(juliana.cookie, weddingId, addDays({ day: endDate, days: -1 })).expect(
          403,
        )
      ).body,
    ).toMatchObject({ error: 'ACTION_NOT_ALLOWED' });

    await db.wedding.update({ where: { id: weddingId }, data: { blockedAt: new Date() } });
    expect(
      (await patchEndDate(ana.cookie, weddingId, addDays({ day: endDate, days: -1 })).expect(403))
        .body,
    ).toMatchObject({ error: 'WEDDING_BLOCKED' });
    const blockedPay = await payForExtension({
      app,
      cookie: ana.cookie,
      weddingId,
      endDate: addMonths({ day: endDate, months: 1 }),
    });
    expect(blockedPay.status).toBe(403);
    expect(blockedPay.body).toMatchObject({ error: 'WEDDING_BLOCKED' });
    await db.wedding.update({
      where: { id: weddingId },
      data: { blockedAt: null, deletionScheduledFor: day(addDays({ day: today, days: 7 })) },
    });
    expect(
      (await patchEndDate(ana.cookie, weddingId, addDays({ day: endDate, days: -1 })).expect(409))
        .body,
    ).toMatchObject({ error: 'WEDDING_DELETION_SCHEDULED' });
    // Retenção RN05: com a exclusão agendada, a extensão também não é paga.
    const scheduledPay = await payForExtension({
      app,
      cookie: ana.cookie,
      weddingId,
      endDate: addMonths({ day: endDate, months: 1 }),
    });
    expect(scheduledPay.status).toBe(409);
    expect(scheduledPay.body).toMatchObject({ error: 'WEDDING_DELETION_SCHEDULED' });

    const draft = await signedInUser({ app });
    const { weddingId: draftId } = await seedWedding({ db, ownerId: draft.userId });
    expect(
      (await patchEndDate(draft.cookie, draftId, addDays({ day: today, days: 30 })).expect(409))
        .body,
    ).toMatchObject({ error: 'NOT_PUBLISHED' });
  });

  it('RN05 - o 422 também antes do casamento por vir; o publicado por Cortesia (sem paidThrough) só antecipa, até a endDate dele', async () => {
    const { ana, weddingId } = await published();
    const eventDate = addMonths({ day: today, months: 1 });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        status: 'published',
        eventDate: day(eventDate),
        endDate: day(addMonths({ day: eventDate, months: 2 })),
        paidThrough: day(addMonths({ day: eventDate, months: 2 })),
      },
    });
    const before = await patchEndDate(ana.cookie, weddingId, eventDate).expect(422);
    expect(before.body).toMatchObject({ error: 'END_DATE_OUT_OF_RANGE' });

    const courtesy = await published();
    const current = (await wedding(courtesy.weddingId)).endDate!.toISOString().slice(0, 10);
    await db.wedding.update({
      where: { id: courtesy.weddingId },
      data: { publicationSource: 'courtesy', paidThrough: null },
    });
    const beyond = await patchEndDate(
      courtesy.ana.cookie,
      courtesy.weddingId,
      addDays({ day: current, days: 1 }),
    ).expect(422);
    expect(beyond.body).toMatchObject({ error: 'END_DATE_BEYOND_PAID' });
    const earlier = addDays({ day: current, days: -3 });
    await patchEndDate(courtesy.ana.cookie, courtesy.weddingId, earlier).expect(200);
    expect(await wedding(courtesy.weddingId)).toMatchObject({
      endDate: day(earlier),
      paidThrough: null,
    });
  });

  it('RN05 e RN10 (isolamento) - a dona de outro casamento: 404 e nada muda; a set_wedding_end_date no kore_app não muda o casamento de outra pessoa nem passa dos limites', async () => {
    const { ana, weddingId } = await published();
    const other = await published();
    const before = await wedding(weddingId);
    const target = addDays({ day: before.endDate!.toISOString().slice(0, 10), days: -2 });
    const refused = await patchEndDate(other.ana.cookie, weddingId, target).expect(404);
    expect(refused.body).toMatchObject({ error: 'WEDDING_NOT_FOUND' });
    expect((await wedding(weddingId)).endDate).toEqual(before.endDate);

    // A função, direto no papel do app: só a dona, e só entre amanhã e o paidThrough.
    const prisma = app.get(PrismaService);
    const call = (userId: string, endDate: string) =>
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
        const [row] = await tx.$queryRaw<{ status: string | null }[]>`
          SELECT set_wedding_end_date(${weddingId}::uuid, ${endDate}::date, ${today}::date, now())
            AS status`;
        return row.status;
      });
    const paidThrough = before.paidThrough!.toISOString().slice(0, 10);
    expect(await call(other.ana.userId, target)).toBeNull();
    expect(await call(ana.userId, addDays({ day: paidThrough, days: 1 }))).toBeNull();
    expect(await call(ana.userId, today)).toBeNull();
    expect((await wedding(weddingId)).endDate).toEqual(before.endDate);
    expect(await call(ana.userId, target)).toBe('post_event');
    expect((await wedding(weddingId)).endDate).toEqual(day(target));
  });
});
