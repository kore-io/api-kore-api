import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { seedReferrer } from '../support/referrers';

describe('GET /v1/referrals/{code} (Cadastro, RN08 e RN09; banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const get = (code: string) => request(app.getHttpServer()).get(`/v1/referrals/${code}`);

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
});
