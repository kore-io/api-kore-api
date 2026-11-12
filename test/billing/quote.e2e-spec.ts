import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { addDays, addMonths } from '../../src/modules/billing/domain/pricing';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { localDate } from '../../src/shared/time/local-date';
import { createTestApp } from '../support/create-test-app';
import { seedReferrer } from '../support/referrers';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

/**
 * Preço e cotação (RN01 a RN07) pela API, com o banco real. As datas são
 * relativas a hoje (a rota usa o relógio do servidor); a conta com as datas da
 * spec fica nos unitários do domínio.
 */
describe('Preço e cotação (Preço e cotação RN01 a RN07; banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  const today = localDate({ at: new Date(), timezone: 'America/Sao_Paulo' });
  // Casamento daqui a 4 meses; a data de saída do ar, 3 meses depois dele.
  const eventDate = addMonths({ day: today, months: 4 });
  const endDate = addMonths({ day: eventDate, months: 3 });

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Ana, dona; Juliana, colaboradora e indicadora (assessoria, com desconto). */
  async function scenario({
    referrerStatus = 'active',
  }: { referrerStatus?: 'active' | 'blocked' | 'inactive' } = {}) {
    const ana = await signedInUser({ app });
    const juliana = await signedInUser({ app, name: 'Juliana Prado' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    const planner = await seedReferrer({
      db,
      kind: 'planner',
      name: 'Juliana Prado',
      status: referrerStatus,
    });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId: planner.userId } });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        eventDate: new Date(`${eventDate}T00:00:00Z`),
        referrerId: referrer.id,
        referralSource: 'referral_link',
      },
    });
    return { ana, juliana, weddingId };
  }

  const quote = (cookie: string, weddingId: string, query: Record<string, string | number>) =>
    request(app.getHttpServer())
      .get(`/v1/weddings/${weddingId}/billing/quote`)
      .set('Cookie', cookie)
      .query(query);

  it('RN04 - o dono recebe todas as linhas, os totais por forma e os limites', async () => {
    const { ana, weddingId } = await scenario();
    const response = await quote(ana.cookie, weddingId, {
      kind: 'publication',
      endDate,
      method: 'card',
      installments: 8,
    }).expect(200);
    const body = response.body as Record<string, unknown> & {
      totalCents: number;
      monthsCovered: number;
    };
    expect(body).toMatchObject({
      priceVersion: '2026-11',
      periodStart: today,
      periodEnd: endDate,
      activationListCents: 14_900,
      monthlyListCents: 2_900,
      referralDiscountCents: 1_490,
      referralLabel: 'assessoria',
      pixDiscountCents: 0,
      installments: 8,
      maxInstallments: 12,
      endDateMin: addDays({ day: eventDate, days: 1 }),
      endDateMax: addMonths({ day: eventDate, months: 12 }),
      canExtend: true,
      cannotExtendReason: null,
    });
    expect(body.monthsCovered).toBeGreaterThanOrEqual(7);
    // O total é a soma das linhas (RN01).
    expect(body.totalCents).toBe(
      (body.listTotalCents as number) -
        (body.capDiscountCents as number) -
        (body.referralDiscountCents as number) +
        (body.installmentInterestCents as number),
    );
    expect((body.installmentInterestCents as number) > 0).toBe(true);
  });

  it('RN04 - a colaboradora não pede cotação: ACTION_NOT_ALLOWED', async () => {
    const { juliana, weddingId } = await scenario();
    const response = await quote(juliana.cookie, weddingId, {
      kind: 'publication',
      endDate,
      method: 'pix',
    }).expect(403);
    expect(response.body).toMatchObject({ error: 'ACTION_NOT_ALLOWED' });
  });

  it('RN04 - quem não é do casamento: 404', async () => {
    const { weddingId } = await scenario();
    const stranger = await signedInUser({ app });
    await quote(stranger.cookie, weddingId, { kind: 'publication', endDate, method: 'pix' }).expect(
      404,
    );
  });

  it('RN01 (D15) - indicador bloqueado mantém o desconto da assessoria; inativo, não', async () => {
    const blocked = await scenario({ referrerStatus: 'blocked' });
    const withDiscount = await quote(blocked.ana.cookie, blocked.weddingId, {
      kind: 'publication',
      endDate,
      method: 'card',
    }).expect(200);
    expect(withDiscount.body).toMatchObject({ referralDiscountCents: 1_490 });

    const inactive = await scenario({ referrerStatus: 'inactive' });
    const without = await quote(inactive.ana.cookie, inactive.weddingId, {
      kind: 'publication',
      endDate,
      method: 'card',
    }).expect(200);
    expect(without.body).toMatchObject({ referralDiscountCents: 0, referralLabel: null });
  });

  it('RN03 - data fora dos limites: 422 com endDateMin e endDateMax', async () => {
    const { ana, weddingId } = await scenario();
    const response = await quote(ana.cookie, weddingId, {
      kind: 'publication',
      endDate: eventDate,
      method: 'pix',
    }).expect(422);
    expect(response.body).toMatchObject({
      error: 'END_DATE_OUT_OF_RANGE',
      endDateMin: addDays({ day: eventDate, days: 1 }),
      endDateMax: addMonths({ day: eventDate, months: 12 }),
    });
  });

  it('RN04 - extensão de casamento que nunca publicou: NOT_PUBLISHED; publicação publicada: NOT_DRAFT', async () => {
    const { ana, weddingId } = await scenario();
    const extension = await quote(ana.cookie, weddingId, {
      kind: 'extension',
      endDate,
      method: 'pix',
    }).expect(409);
    expect(extension.body).toMatchObject({ error: 'NOT_PUBLISHED' });

    await db.wedding.update({
      where: { id: weddingId },
      data: {
        status: 'published',
        publishedAt: new Date(),
        endDate: new Date(`${endDate}T00:00:00Z`),
        publicationSource: 'courtesy',
      },
    });
    const publication = await quote(ana.cookie, weddingId, {
      kind: 'publication',
      endDate,
      method: 'pix',
    }).expect(409);
    expect(publication.body).toMatchObject({ error: 'NOT_DRAFT' });
  });

  it('RN01 e RN03 - extensão no Pix, a partir da data atual, sem ativação nem indicação', async () => {
    const { ana, weddingId } = await scenario();
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        status: 'published',
        publishedAt: new Date(),
        endDate: new Date(`${endDate}T00:00:00Z`),
        publicationSource: 'courtesy',
      },
    });
    const response = await quote(ana.cookie, weddingId, {
      kind: 'extension',
      endDate: addMonths({ day: endDate, months: 3 }),
      method: 'pix',
    }).expect(200);
    expect(response.body).toMatchObject({
      periodStart: endDate,
      monthsCovered: 3,
      activationListCents: 0,
      referralDiscountCents: 0,
      referralLabel: null,
      pixDiscountCents: 261,
      totalCents: 8_439,
    });
  });

  it('RN01 (B1-2) - parcela mínima: a extensão de 1 mês em 12x é recusada com o máximo de 5', async () => {
    const { ana, weddingId } = await scenario();
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        status: 'published',
        publishedAt: new Date(),
        endDate: new Date(`${endDate}T00:00:00Z`),
        publicationSource: 'courtesy',
      },
    });
    const response = await quote(ana.cookie, weddingId, {
      kind: 'extension',
      endDate: addMonths({ day: endDate, months: 1 }),
      method: 'card',
      installments: 12,
    }).expect(400);
    expect(response.body).toMatchObject({ error: 'INSTALLMENTS_OUT_OF_RANGE', maxInstallments: 5 });
  });

  it('RN03 (D6) - não dá mais para renovar: canExtend falso com END_DATE_LIMIT_REACHED', async () => {
    const { ana, weddingId } = await scenario();
    // O casamento foi há mais de 12 meses, e o site expirou.
    const pastEvent = addMonths({ day: today, months: -14 });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        status: 'expired',
        eventDate: new Date(`${pastEvent}T00:00:00Z`),
        publishedAt: new Date('2025-01-01T00:00:00Z'),
        endDate: new Date(`${addMonths({ day: pastEvent, months: 3 })}T00:00:00Z`),
        publicationSource: 'courtesy',
      },
    });
    const response = await quote(ana.cookie, weddingId, {
      kind: 'extension',
      method: 'pix',
    }).expect(200);
    expect(response.body).toMatchObject({
      canExtend: false,
      cannotExtendReason: 'END_DATE_LIMIT_REACHED',
      totalCents: null,
      endDateMin: null,
    });
  });

  it('validação - parâmetros fora do formato: 400', async () => {
    const { ana, weddingId } = await scenario();
    await quote(ana.cookie, weddingId, { kind: 'renewal', method: 'pix' }).expect(400);
    await quote(ana.cookie, weddingId, { kind: 'publication', method: 'boleto' }).expect(400);
    await quote(ana.cookie, weddingId, {
      kind: 'publication',
      method: 'card',
      installments: 13,
    }).expect(400);
    await quote(ana.cookie, weddingId, {
      kind: 'publication',
      method: 'pix',
      endDate: '14/02/2027',
    }).expect(400);
  });

  it('RN07 - o preço público, sem login e com cache curto', async () => {
    const response = await request(app.getHttpServer()).get('/v1/pricing').expect(200);
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    expect(response.body).toEqual({
      priceVersion: '2026-11',
      activationCents: 14_900,
      monthlyCents: 2_900,
      capCents: 44_900,
      pixDiscountPercent: 3,
      installments: {
        max: 12,
        interestFreeUpTo: 6,
        interestPercent: 3.99,
        interestBasisPoints: 399,
        interestFixedCents: 49,
        minInstallmentCents: 500,
      },
      endDateMaxMonthsAfterEvent: 12,
      referralDiscountPercent: 10,
    });
  });
});
