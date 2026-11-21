import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { RATE_LIMIT_CLOCK } from '@/shared/rate-limit/ip-failure-limit';
import { createTestApp } from '../support/harness/create-test-app';
import { seedReferrer } from '../support/factories/referrers';

describe('GET /v1/referrals/{code} (Cadastro, RN08 e RN09; banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  // O relógio do limite de falhas (decisão 306(1)): o teste vira o minuto sem esperar.
  let now = new Date('2026-11-21T15:00:10.000Z');

  beforeAll(async () => {
    app = await createTestApp({
      override: (builder) =>
        builder.overrideProvider(RATE_LIMIT_CLOCK).useValue({ now: () => now }),
    });
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const get = (code: string, from?: string) => {
    const call = request(app.getHttpServer()).get(`/v1/referrals/${code}`);
    return from ? call.set('X-Forwarded-For', from) : call;
  };
  // Cada caso do limite com o próprio IP (TRUST_PROXY_HOPS=1 no teste), para não somar.
  const ip = () => `10.${[1, 2, 3].map(() => Math.floor(Math.random() * 250)).join('.')}`;

  it('RN08 - dado o cerimonialista ativo, quando o casal abre o link sem sessão, então vê o nome de crédito e o desconto de 10%', async () => {
    const { referralCode, userId } = await seedReferrer({
      db,
      kind: 'planner',
      name: 'Juliana Prado',
    });
    await db.user.update({ where: { id: userId }, data: { name: 'Juliana P.' } });

    const response = await get(referralCode).expect(200);

    expect(response.body).toEqual({
      code: referralCode,
      referrerName: 'Juliana Prado',
      kind: 'planner',
      discountPercent: 10,
    });
  });

  it('RN08 - dado o vendedor ativo, então o nome é o da conta, e o código vale sem diferenciar maiúsculas', async () => {
    const { referralCode } = await seedReferrer({ db, kind: 'seller', name: 'Lucas Lima' });

    const response = await get(referralCode.toUpperCase()).expect(200);

    expect(response.body).toMatchObject({
      code: referralCode,
      referrerName: 'Lucas Lima',
      kind: 'seller',
    });
  });

  it('RN09 - dado o desconto de indicação desligado, então discountPercent é nulo', async () => {
    const { referralCode } = await seedReferrer({
      db,
      kind: 'planner',
      name: 'Rita Souza',
      referralDiscountEnabled: false,
    });

    const response = await get(referralCode).expect(200);

    expect(response.body.discountPercent).toBeNull();
  });

  it.each([
    ['código inexistente', null],
    ['indicador inativo', { status: 'inactive' as const }],
    ['indicador bloqueado', { status: 'blocked' as const }],
    ['conta do indicador bloqueada (decisão 162)', { accountStatus: 'blocked' as const }],
  ])('RN08 - dado %s, então 404 REFERRAL_NOT_FOUND, sem diferenciar', async (_, scenario) => {
    const code = scenario
      ? (await seedReferrer({ db, kind: 'planner', name: 'Clara Dias', ...scenario })).referralCode
      : 'nao-existe';

    const response = await get(code).expect(404);

    expect(response.body).toEqual({
      statusCode: 404,
      error: 'REFERRAL_NOT_FOUND',
      message: 'Referral not found.',
    });
  });

  it('decisão 306(1) - referral_lookup: 20 códigos que não existem por minuto por IP; os acertos não contam, e outro IP não é afetado', async () => {
    const { referralCode } = await seedReferrer({ db, kind: 'planner', name: 'Marta Reis' });
    const { referralCode: inactive } = await seedReferrer({
      db,
      kind: 'seller',
      name: 'Davi Reis',
      status: 'inactive',
    });
    const crowded = ip();
    for (let i = 0; i < 25; i++) await get(referralCode, crowded).expect(200);
    for (let i = 0; i < 10; i++) await get(`nao-existe-${i}`, crowded).expect(404);
    // O indicador inativo é o mesmo 404 e conta igual.
    for (let i = 0; i < 10; i++) await get(inactive, crowded).expect(404);

    // Acima de 20, 429 também para o código que existe: o oráculo fecha.
    const blocked = await get(referralCode, crowded).expect(429);

    expect(blocked.body).toEqual({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'Too many requests.',
    });
    await get('nao-existe-0', crowded).expect(429);
    await get(referralCode, ip()).expect(200);
  });

  it('decisão 306(1) - referral_lookup: a janela é de um minuto pelo relógio; no minuto seguinte o IP volta', async () => {
    const { referralCode } = await seedReferrer({ db, kind: 'planner', name: 'Sara Nunes' });
    const crowded = ip();
    now = new Date('2026-11-21T15:01:00.000Z');
    for (let i = 0; i < 20; i++) await get(`nao-existe-${i}`, crowded).expect(404);
    now = new Date('2026-11-21T15:01:59.999Z');
    await get(referralCode, crowded).expect(429);

    now = new Date('2026-11-21T15:02:00.000Z');

    await get(referralCode, crowded).expect(200);
    await get('nao-existe', crowded).expect(404);
  });
});
