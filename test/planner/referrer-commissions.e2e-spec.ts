import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { ReleaseCommissions } from '../../src/modules/billing/application/release-commissions.use-case';
import { addMonths } from '../../src/modules/billing/domain/pricing';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { localDate } from '../../src/shared/time/local-date';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { expectStatus, payForPublication, publishByPayment } from '../support/payments';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const day = (value: string) => new Date(`${value}T00:00:00Z`);

/**
 * A leitura das comissões pela indicadora (Comissões do indicador RN02, RN07,
 * RN08 e RN10): a tela Comissões, o Resumo de Meus casamentos e a coluna do
 * Link de indicação.
 */
describe('Comissões: a leitura da indicadora (Comissões RN07, RN08 e RN10; banco real)', () => {
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

  const http = () => request(app.getHttpServer());

  /** Juliana indicou Ana pelo link e colabora no casamento (ou não). */
  async function referred(juliana: { userId: string }, { collaborates = true } = {}) {
    const ana = await signedInUser({ app });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId: juliana.userId } });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: collaborates ? [juliana.userId] : [],
    });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        eventDate: day(eventDate),
        referrerId: referrer.id,
        referralSource: 'referral_link',
      },
    });
    return { ana, weddingId, referrerId: referrer.id };
  }

  async function planner() {
    const juliana = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    return { ...juliana, cookie: await openSession({ app, userId: juliana.userId }) };
  }

  it('RN02, RN07 e RN10 - os saldos, a comissão por pagamento e por casamento, sem dado do pagador', async () => {
    const juliana = await planner();
    const { ana, weddingId, referrerId } = await referred(juliana);
    const { paymentId } = await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate });
    const commission = await db.commission.findUniqueOrThrow({ where: { paymentId } });

    const before = await http()
      .get('/v1/me/referrer/commissions')
      .set('Cookie', juliana.cookie)
      .expect(200);
    expect(before.body.balances).toEqual({
      availableCents: 0,
      pendingCents: commission.amountCents,
      receivedCents: 0,
      inPayoutCents: 0,
    });
    expect(before.body.items).toEqual([
      expect.objectContaining({
        weddingId,
        partnerNames: ['Ana', 'Marcos'],
        clickable: true,
        paymentKind: 'publication',
        baseAmountCents: commission.baseAmountCents,
        amountCents: commission.amountCents,
        ratePercent: 20,
        status: 'pending',
      }),
    ]);
    expect(JSON.stringify(before.body)).not.toMatch(/payer|taxId|Beatriz/i);
    expect(before.body.byWedding).toEqual([
      expect.objectContaining({
        weddingId,
        pendingCents: commission.amountCents,
        availableCents: 0,
      }),
    ]);

    await worker.get(ReleaseCommissions).execute({
      now: new Date(commission.availableAt.getTime() + 60_000),
      referrerId,
    });
    const after = await http()
      .get('/v1/me/referrer/commissions')
      .set('Cookie', juliana.cookie)
      .expect(200);
    expect(after.body.balances).toMatchObject({
      availableCents: commission.amountCents,
      pendingCents: 0,
    });
  });

  it('RN07 e RN10 - sem colaborar, a linha não abre; casamento apagado, sem nome', async () => {
    const juliana = await planner();
    const { ana, weddingId } = await referred(juliana, { collaborates: false });
    await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate });
    const closed = await http()
      .get('/v1/me/referrer/commissions')
      .set('Cookie', juliana.cookie)
      .expect(200);
    expect(closed.body.items[0]).toMatchObject({
      weddingId: null,
      clickable: false,
      partnerNames: ['Ana', 'Marcos'],
    });

    await db.wedding.update({
      where: { id: weddingId },
      data: {
        status: 'purged',
        purgedAt: new Date(),
        endDate: null,
        paidThrough: null,
        publicationSource: null,
      },
    });
    const purged = await http()
      .get('/v1/me/referrer/commissions')
      .set('Cookie', juliana.cookie)
      .expect(200);
    expect(purged.body.items[0]).toMatchObject({
      weddingPurged: true,
      partnerNames: null,
      weddingId: null,
    });
  });

  it('RN08 - Meus casamentos: Aguardando pagamento e Comissão disponível no Resumo; o item marcado', async () => {
    const juliana = await planner();
    const { ana, weddingId } = await referred(juliana);
    expectStatus(
      await payForPublication({ app, cookie: ana.cookie, weddingId, endDate, method: 'pix' }),
      201,
    );
    const mine = await http().get('/v1/me/weddings').set('Cookie', juliana.cookie).expect(200);
    expect(mine.body.summary).toMatchObject({ awaitingPayment: 1, commissionAvailableCents: 0 });
    expect(
      (mine.body.weddings as { weddingId: string; awaitingPayment: boolean }[]).find(
        (item) => item.weddingId === weddingId,
      ),
    ).toMatchObject({ awaitingPayment: true, status: 'draft' });
    const detail = await http()
      .get(`/v1/me/weddings/${weddingId}`)
      .set('Cookie', juliana.cookie)
      .expect(200);
    expect(detail.body.awaitingPayment).toBe(true);
  });

  it('RN08 - a coluna Comissão do Link de indicação: a soma por estado; sem pagamento, nula', async () => {
    const juliana = await planner();
    const paid = await referred(juliana);
    const { paymentId } = await publishByPayment({
      app,
      cookie: paid.ana.cookie,
      weddingId: paid.weddingId,
      endDate,
    });
    const unpaid = await referred(juliana);
    const commission = await db.commission.findUniqueOrThrow({ where: { paymentId } });

    const link = await http()
      .get('/v1/me/referrer/weddings')
      .set('Cookie', juliana.cookie)
      .expect(200);
    const byId = new Map(
      (link.body as { weddingId: string; commission: unknown }[]).map((row) => [
        row.weddingId,
        row.commission,
      ]),
    );
    expect(byId.get(paid.weddingId)).toEqual({
      availableCents: 0,
      pendingCents: commission.amountCents,
    });
    expect(byId.get(unpaid.weddingId)).toBeNull();
  });
});
