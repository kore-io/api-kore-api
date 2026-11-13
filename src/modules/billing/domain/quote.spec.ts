import {
  BillingEndDateOutOfRangeError,
  BillingEventDateMissingError,
  BillingNotDraftError,
  BillingSlugMissingError,
  NotPublishedError,
} from './billing.errors';
import { buildQuote, type QuoteWedding, referralDiscountFor } from './quote';

// Hoje é 10/08/2026 às 15h20 em São Paulo (Contexto do Gherkin).
const now = new Date('2026-08-10T18:20:00Z');
const draft: QuoteWedding = {
  status: 'draft',
  slug: 'ana-e-marcos',
  eventDate: '2026-11-14',
  timezone: 'America/Sao_Paulo',
  endDate: null,
  paidThrough: null,
  publishedAt: null,
};
const published: QuoteWedding = {
  ...draft,
  status: 'published',
  endDate: '2027-02-14',
  paidThrough: '2027-02-14',
  publishedAt: new Date('2026-08-10T18:30:00Z'),
};
const assessoria = { percent: 10, label: 'assessoria' as const };

describe('buildQuote (Preço e cotação RN02 a RN05)', () => {
  it('RN02 - publicação: começa hoje no fuso do casamento; 14/02/2027 = 7 meses', () => {
    const quote = buildQuote({
      wedding: draft,
      kind: 'publication',
      endDate: '2027-02-14',
      method: 'card',
      installments: 2,
      referral: assessoria,
      now,
    });
    expect(quote).toMatchObject({
      periodStart: '2026-08-10',
      periodEnd: '2027-02-14',
      endDateMin: '2026-11-15',
      endDateMax: '2027-11-14',
      canExtend: true,
      referralLabel: 'assessoria',
    });
    expect(quote.lines).toMatchObject({ monthsCovered: 7, totalCents: 33_710 });
  });

  it.each([
    ['America/Manaus', '2026-08-10T03:30:00Z'],
    ['America/Rio_Branco', '2026-08-10T03:30:00Z'],
  ])('RN02 (B1-6) - no fuso %s, 23h30 ou 22h30 do dia 09 ainda é dia 09', (timezone, at) => {
    const quote = buildQuote({
      wedding: { ...draft, timezone, eventDate: '2026-08-20' },
      kind: 'publication',
      endDate: '2026-09-09',
      method: 'card',
      installments: 1,
      referral: null,
      now: new Date(at),
    });
    expect(quote.periodStart).toBe('2026-08-09');
    expect(quote.lines?.monthsCovered).toBe(1);
  });

  it('RN03 - extensão: começa na data de saída do ar atual; 14/05/2027 = 3 meses, sem ativação', () => {
    const quote = buildQuote({
      wedding: published,
      kind: 'extension',
      endDate: '2027-05-14',
      method: 'pix',
      installments: 1,
      referral: assessoria,
      now,
    });
    expect(quote).toMatchObject({
      periodStart: '2027-02-14',
      endDateMin: '2027-02-15',
      referralLabel: null,
    });
    expect(quote.lines).toMatchObject({
      monthsCovered: 3,
      activationListCents: 0,
      referralDiscountCents: 0,
      totalCents: 8_439,
    });
  });

  it('B4-1 - com a data antecipada, a extensão conta a partir do paidThrough', () => {
    const quote = buildQuote({
      wedding: { ...published, endDate: '2026-12-14' },
      kind: 'extension',
      endDate: '2027-05-14',
      method: 'card',
      installments: 1,
      referral: null,
      now,
    });
    expect(quote.periodStart).toBe('2027-02-14');
    expect(quote.lines?.monthsCovered).toBe(3);
  });

  it('decisão 38 - no expirado, a extensão começa hoje', () => {
    const quote = buildQuote({
      wedding: { ...published, status: 'expired', endDate: '2027-02-14' },
      kind: 'extension',
      endDate: '2027-07-01',
      method: 'card',
      installments: 1,
      referral: null,
      now: new Date('2027-03-01T15:00:00Z'),
    });
    expect(quote.periodStart).toBe('2027-03-01');
    expect(quote.lines?.monthsCovered).toBe(4);
  });

  it('RN03 (D6) - expirado há mais de 12 meses do casamento: não dá para estender', () => {
    const quote = buildQuote({
      wedding: { ...published, status: 'expired' },
      kind: 'extension',
      endDate: '2028-01-01',
      method: 'pix',
      installments: 1,
      referral: null,
      now: new Date('2027-12-01T15:00:00Z'),
    });
    expect(quote).toMatchObject({
      canExtend: false,
      cannotExtendReason: 'END_DATE_LIMIT_REACHED',
      endDateMin: null,
      lines: null,
    });
  });

  it('RN03 - data fora dos limites: 422 com os limites', () => {
    const run = (endDate: string) =>
      buildQuote({
        wedding: draft,
        kind: 'publication',
        endDate,
        method: 'pix',
        installments: 1,
        referral: null,
        now,
      });
    expect(() => run('2026-11-14')).toThrow(BillingEndDateOutOfRangeError);
    expect(() => run('2027-11-15')).toThrow(BillingEndDateOutOfRangeError);
    // No limite: de 10/08/2026 a 14/11/2027 são 16 meses (o teto corta).
    expect(run('2027-11-14').lines).toMatchObject({ monthsCovered: 16, totalCents: 43_553 });
  });

  it('RN04 - sem a data, só os limites', () => {
    expect(
      buildQuote({
        wedding: draft,
        kind: 'publication',
        endDate: null,
        method: 'pix',
        installments: 1,
        referral: null,
        now,
      }),
    ).toMatchObject({ lines: null, canExtend: true, endDateMin: '2026-11-15' });
  });

  it('RN04 - recusas: publicação fora de rascunho, sem endereço, sem data; extensão sem publicar', () => {
    const run = (wedding: QuoteWedding, kind: 'publication' | 'extension') =>
      buildQuote({
        wedding,
        kind,
        endDate: '2027-02-14',
        method: 'pix',
        installments: 1,
        referral: null,
        now,
      });
    expect(() => run(published, 'publication')).toThrow(BillingNotDraftError);
    expect(() => run({ ...draft, slug: null }, 'publication')).toThrow(BillingSlugMissingError);
    expect(() => run({ ...draft, eventDate: null }, 'publication')).toThrow(
      BillingEventDateMissingError,
    );
    expect(() => run(draft, 'extension')).toThrow(NotPublishedError);
  });
});

describe('referralDiscountFor (Preço e cotação RN01, passo 4)', () => {
  const referrer = {
    kind: 'planner' as const,
    status: 'active' as const,
    referralDiscountEnabled: true,
  };

  it('RN01 - assessoria com desconto ligado: 10%, "assessoria"', () => {
    expect(referralDiscountFor({ referrer, percent: 10 })).toEqual(assessoria);
  });

  it('D15 - o indicador bloqueado mantém o desconto do casal', () => {
    expect(
      referralDiscountFor({ referrer: { ...referrer, status: 'blocked' }, percent: 10 }),
    ).toEqual(assessoria);
  });

  it('RN01 - inativo, desconto desligado, sem indicador ou 0%: sem desconto; vendedor: "indicacao"', () => {
    expect(
      referralDiscountFor({ referrer: { ...referrer, status: 'inactive' }, percent: 10 }),
    ).toBeNull();
    expect(
      referralDiscountFor({
        referrer: { ...referrer, referralDiscountEnabled: false },
        percent: 10,
      }),
    ).toBeNull();
    expect(referralDiscountFor({ referrer: null, percent: 10 })).toBeNull();
    expect(referralDiscountFor({ referrer, percent: 0 })).toBeNull();
    expect(referralDiscountFor({ referrer: { ...referrer, kind: 'seller' }, percent: 10 })).toEqual(
      {
        percent: 10,
        label: 'indicacao',
      },
    );
  });
});
