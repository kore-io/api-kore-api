import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { LAST_PROFILE_COOKIE } from '../../src/modules/access/presentation/last-profile-cookie';
import { AppConfigService } from '../../src/shared/config/app-config.service';
import type { Env } from '../../src/shared/config/env.schema';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { seedInvitation } from '../support/invitations';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const TERMS = '2026-09';

/**
 * Cadastro e perfil do cerimonialista (F6, C1) e o Link de indicação (RN01 e
 * RN02), com o banco real: o cadastro pela página de parceria, a chave do
 * cadastro, o Meu perfil, o perfil mínimo e o GET /v1/me/referrer.
 */
describe('Cadastro e perfil do cerimonialista (banco real; decisões 223 e 224)', () => {
  let app: INestApplication;
  let closed: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    // A mesma API com o cadastro desligado (RN02: sem valor, desligado).
    closed = await createTestApp({
      override: (builder) =>
        builder.overrideProvider(AppConfigService).useFactory({
          inject: [ConfigService],
          factory: (config: ConfigService<Env, true>) => {
            const service = new AppConfigService(config);
            const get = service.get.bind(service);
            service.get = (({ key }: { key: keyof Env }) =>
              key === 'PLANNER_SIGNUP_ENABLED' ? false : get({ key })) as typeof service.get;
            return service;
          },
        }),
    });
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await closed?.close();
    await app?.close();
  });

  const http = (target: INestApplication = app) => request(target.getHttpServer());
  const signup = (cookie: string, body: Record<string, unknown>, target = app) =>
    http(target).post('/v1/me/planner').set('Cookie', cookie).set('Origin', APP_ORIGIN).send(body);
  const read = (cookie: string) => http().get('/v1/me/planner').set('Cookie', cookie);
  const save = (cookie: string, body: Record<string, unknown>) =>
    http().patch('/v1/me/planner').set('Cookie', cookie).set('Origin', APP_ORIGIN).send(body);
  const referrer = (cookie: string) => http().get('/v1/me/referrer').set('Cookie', cookie);

  const profile = (extra: Record<string, unknown> = {}) => ({
    creditName: 'Prado Assessoria',
    phone: '(19) 3333-4444',
    whatsapp: '(19) 99999-8888',
    cities: ['Campinas (SP)', 'Valinhos (SP)'],
    termsVersion: TERMS,
    ...extra,
  });

  /** Uma pessoa com conta e nome únicos, para o código de indicação não colidir. */
  async function person({ name }: { name?: string | null } = {}) {
    const unique = `Juliana ${randomUUID().slice(0, 8)}`;
    const user = await signedInUser({ app, name: name === undefined ? unique : 'x' });
    if (name !== undefined) await db.user.update({ where: { id: user.userId }, data: { name } });
    return { ...user, name: name === undefined ? unique : name };
  }

  describe('POST /v1/me/planner (RN01 a RN05)', () => {
    it('RN05 - cria o perfil completo, o link, a assessoria, os Termos, a sessão em planner e o log', async () => {
      const juliana = await person();

      const response = await signup(juliana.cookie, profile()).expect(201);

      const code = String(juliana.name).toLowerCase().replace(/\s+/g, '-');
      expect(response.body).toEqual({ referralCode: code, home: '/cerimonialista' });
      expect(String(response.headers['set-cookie'])).toContain(`${LAST_PROFILE_COOKIE}=planner`);
      const saved = await db.referrer.findUniqueOrThrow({
        where: { userId: juliana.userId },
        include: { planner: true, user: true },
      });
      expect(saved).toMatchObject({
        kind: 'planner',
        status: 'active',
        ratePercent: 20,
        referralDiscountEnabled: true,
        referralCode: code,
        planner: {
          creditName: 'Prado Assessoria',
          phone: '1933334444',
          whatsapp: '19999998888',
          cities: ['Campinas (SP)', 'Valinhos (SP)'],
        },
        user: { name: juliana.name, termsVersion: TERMS },
      });
      expect(saved.user.termsAcceptedAt).not.toBeNull();
      const member = await db.organizationMember.findFirstOrThrow({
        where: { userId: juliana.userId },
        include: { organization: true },
      });
      expect(member).toMatchObject({ role: 'owner', organization: { name: 'Prado Assessoria' } });
      const me = await http().get('/v1/me').set('Cookie', juliana.cookie).expect(200);
      expect(me.body).toMatchObject({ activeProfile: 'planner', profiles: ['planner'] });
      const log = await db.applicationLog.findFirstOrThrow({
        where: { action: 'planner.created', actorUserId: juliana.userId },
      });
      expect(log.data).toEqual({ referrerId: saved.id });
    });

    it('RN03 e RN08 - o casal cria o perfil na mesma conta e passa a ter os dois', async () => {
      const juliana = await person();
      await seedWedding({ db, ownerId: juliana.userId });

      await signup(juliana.cookie, profile()).expect(201);

      const me = await http().get('/v1/me').set('Cookie', juliana.cookie).expect(200);
      expect(me.body.profiles).toEqual(['couple', 'planner']);
    });

    it('RN02 - com o cadastro desligado: 409 PLANNER_SIGNUP_DISABLED, e o GET /v1/me diz que está fechado', async () => {
      const juliana = await person();

      const response = await signup(juliana.cookie, profile(), closed).expect(409);

      expect(response.body.error).toBe('PLANNER_SIGNUP_DISABLED');
      expect(await db.referrer.count({ where: { userId: juliana.userId } })).toBe(0);
      const me = (target: INestApplication) =>
        http(target).get('/v1/me').set('Cookie', juliana.cookie).expect(200);
      expect((await me(closed)).body.plannerSignupEnabled).toBe(false);
      expect((await me(app)).body.plannerSignupEnabled).toBe(true);
    });

    it('RN02 - com o cadastro desligado, o aceite do convite de cerimonialista continua criando o perfil mínimo', async () => {
      const bianca = await signedInUser({ app, name: 'Bianca Lopes' });
      const { weddingId } = await seedWedding({ db, ownerId: bianca.userId });
      const clara = await signedInUser({ app, name: `Clara ${randomUUID().slice(0, 8)}` });
      const { token } = await seedInvitation({
        db,
        weddingId,
        kind: 'planner',
        email: clara.email,
        invitedByUserId: bianca.userId,
      });

      await http(closed)
        .post(`/v1/access-invitations/${token}/accept`)
        .set('Cookie', clara.cookie)
        .set('Origin', APP_ORIGIN)
        .send({})
        .expect(200);

      expect(await db.planner.count({ where: { referrer: { userId: clara.userId } } })).toBe(1);
    });

    it('RN03 - duas abas: a segunda recebe 409 PLANNER_PROFILE_EXISTS, também quando chegam juntas', async () => {
      const juliana = await person();
      await signup(juliana.cookie, profile()).expect(201);
      expect((await signup(juliana.cookie, profile()).expect(409)).body.error).toBe(
        'PLANNER_PROFILE_EXISTS',
      );

      const clara = await person();
      const otherTab = await openSession({ app, userId: clara.userId });
      const results = await Promise.all([
        signup(clara.cookie, profile()),
        signup(otherTab, profile()),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      expect(results.find((result) => result.status === 409)?.body.error).toBe(
        'PLANNER_PROFILE_EXISTS',
      );
      expect(await db.referrer.count({ where: { userId: clara.userId } })).toBe(1);
    });

    it('RN03 - quem tem perfil de vendedor: 409 SELLER_CANNOT_BE_PLANNER', async () => {
      const { userId } = await seedReferrer({ db, kind: 'seller', name: 'Lucas Andrade' });
      const cookie = await openSession({ app, userId });

      expect((await signup(cookie, profile()).expect(409)).body.error).toBe(
        'SELLER_CANNOT_BE_PLANNER',
      );
    });

    it('RN04 - Termos de versão antiga: 409 TERMS_VERSION_OUTDATED', async () => {
      const juliana = await person();

      expect(
        (await signup(juliana.cookie, profile({ termsVersion: '2025-01' })).expect(409)).body.error,
      ).toBe('TERMS_VERSION_OUTDATED');
    });

    it.each([
      'Prado Assessoria www.prado.com.br',
      'Prado prado.com.br',
      'Prado 11 9 9999-9999',
      'Prado juliana@prado.com',
      'Prado http://x',
      'Prado <b>',
    ])('RN04 - nome da assessoria com contato (%j): CREDIT_NAME_INVALID', async (creditName) => {
      const juliana = await person();

      const response = await signup(juliana.cookie, profile({ creditName })).expect(400);

      expect(response.body.errors).toEqual([
        { path: 'creditName', code: 'CREDIT_NAME_INVALID', params: {} },
      ]);
    });

    it('RN04 - nome com os caracteres aceitos é criado', async () => {
      const juliana = await person();

      await signup(
        juliana.cookie,
        profile({ creditName: 'Prado & Filhos (Eventos), Ltda.' }),
      ).expect(201);
    });

    it('RN04 - sem cidade, sem nome na conta e com telefone inválido: os erros por campo', async () => {
      const semNome = await person({ name: null });

      const response = await signup(
        semNome.cookie,
        profile({ cities: [], phone: '9999-8888' }),
      ).expect(400);

      expect(response.body.errors).toEqual([
        { path: 'name', code: 'REQUIRED', params: {} },
        { path: 'phone', code: 'PHONE_INVALID', params: {} },
        { path: 'cities', code: 'REQUIRED', params: {} },
      ]);
    });

    it('RN04 - sem nome na conta, o Seu nome vai para a conta e para o código', async () => {
      const semNome = await person({ name: null });
      const name = `Clara ${randomUUID().slice(0, 8)}`;

      const response = await signup(semNome.cookie, profile({ name })).expect(201);

      expect(response.body.referralCode).toBe(name.toLowerCase().replace(/\s+/g, '-'));
      expect((await db.user.findUniqueOrThrow({ where: { id: semNome.userId } })).name).toBe(name);
    });

    it('RN04 - teto técnico: 51 cidades recebem TOO_MANY', async () => {
      const juliana = await person();
      const cities = Array.from({ length: 51 }, (_, index) => `Cidade ${index} (SP)`);

      const response = await signup(juliana.cookie, profile({ cities })).expect(400);

      expect(response.body.errors).toEqual([
        { path: 'cities', code: 'TOO_MANY', params: { max: 50 } },
      ]);
    });

    it('RN05 - nome repetido ganha o próximo sufixo; código reservado vale como repetido', async () => {
      const first = await person();
      const second = await person({ name: first.name });
      const base = String(first.name).toLowerCase().replace(/\s+/g, '-');

      expect((await signup(first.cookie, profile()).expect(201)).body.referralCode).toBe(base);
      expect((await signup(second.cookie, profile()).expect(201)).body.referralCode).toBe(
        `${base}-2`,
      );

      const suporte = await person({ name: 'Suporte' });
      expect((await signup(suporte.cookie, profile()).expect(201)).body.referralCode).toMatch(
        /^suporte-\d+$/,
      );
    });
  });

  describe('GET e PATCH /v1/me/planner (RN09 e RN10)', () => {
    it('sem o perfil: 404 PLANNER_NOT_FOUND', async () => {
      const ana = await person();

      expect((await read(ana.cookie).expect(404)).body.error).toBe('PLANNER_NOT_FOUND');
      expect((await save(ana.cookie, { cities: ['Campinas (SP)'] }).expect(404)).body.error).toBe(
        'PLANNER_NOT_FOUND',
      );
    });

    it('RN09 - o perfil completo, e o creditHidden do Admin sem o motivo', async () => {
      const juliana = await person();
      await signup(juliana.cookie, profile()).expect(201);

      expect((await read(juliana.cookie).expect(200)).body).toEqual({
        email: juliana.email,
        name: juliana.name,
        creditName: 'Prado Assessoria',
        phone: '1933334444',
        whatsapp: '19999998888',
        cities: ['Campinas (SP)', 'Valinhos (SP)'],
        profileComplete: true,
        termsAccepted: true,
        creditHidden: false,
      });

      await db.planner.updateMany({
        where: { referrer: { userId: juliana.userId } },
        data: { creditHiddenAt: new Date(), creditHiddenReason: 'nome com propaganda' },
      });
      const hidden = (await read(juliana.cookie).expect(200)).body;
      expect(hidden.creditHidden).toBe(true);
      expect(JSON.stringify(hidden)).not.toContain('propaganda');
    });

    it('RN09 - mudar o nome da assessoria: a assessoria acompanha, o log tem o antigo e o novo, e o link não muda', async () => {
      const juliana = await person();
      const created = await signup(juliana.cookie, profile()).expect(201);

      const response = await save(juliana.cookie, { creditName: 'Prado Eventos' }).expect(200);

      expect(response.body.creditName).toBe('Prado Eventos');
      const saved = await db.referrer.findUniqueOrThrow({ where: { userId: juliana.userId } });
      expect(saved.referralCode).toBe(created.body.referralCode);
      const member = await db.organizationMember.findFirstOrThrow({
        where: { userId: juliana.userId },
        include: { organization: true },
      });
      expect(member.organization.name).toBe('Prado Eventos');
      const log = await db.applicationLog.findFirstOrThrow({
        where: { action: 'planner.credit_name_changed', actorUserId: juliana.userId },
      });
      expect(log.data).toEqual({ from: 'Prado Assessoria', to: 'Prado Eventos' });
    });

    it('RN09 - as mesmas validações do cadastro, e telefone nulo apaga', async () => {
      const juliana = await person();
      await signup(juliana.cookie, profile()).expect(201);

      expect(
        (await save(juliana.cookie, { creditName: 'Prado www.prado.com' }).expect(400)).body.errors,
      ).toEqual([{ path: 'creditName', code: 'CREDIT_NAME_INVALID', params: {} }]);
      expect((await save(juliana.cookie, { phone: null }).expect(200)).body.phone).toBeNull();
    });

    it('RN10 - perfil mínimo: incompleto, pede os Termos para salvar e completa com cidade e Termos', async () => {
      // Sem dígitos: um sufixo hexadecimal só de números teria 8 dígitos, e o
      // nome não passaria no predicado do Nome da assessoria (RN04).
      const name = `Clara ${randomUUID().slice(0, 8).replace(/[0-9]/g, 'x')}`;
      const { userId } = await seedReferrer({ db, kind: 'planner', name });
      const cookie = await openSession({ app, userId });

      expect((await read(cookie).expect(200)).body).toMatchObject({
        cities: [],
        termsAccepted: false,
        profileComplete: false,
      });
      expect((await save(cookie, { cities: ['Campinas (SP)'] }).expect(400)).body.errors).toEqual([
        { path: 'termsVersion', code: 'REQUIRED', params: {} },
      ]);

      const response = await save(cookie, {
        cities: ['Campinas (SP)'],
        termsVersion: TERMS,
      }).expect(200);

      expect(response.body).toMatchObject({ termsAccepted: true, profileComplete: true });
    });

    it('RN10 - perfil mínimo com nome que não passa no predicado: profileComplete false', async () => {
      const { userId } = await seedReferrer({
        db,
        kind: 'planner',
        name: `Clara www.clara${randomUUID().slice(0, 4)}.com`,
      });
      const cookie = await openSession({ app, userId });

      const response = await save(cookie, {
        cities: ['Campinas (SP)'],
        termsVersion: TERMS,
      }).expect(200);

      expect(response.body).toMatchObject({ termsAccepted: true, profileComplete: false });
    });
  });

  it.each([
    ['POST', { creditName: null }, 'creditName', 'IS_STRING'],
    ['POST', { cities: null }, 'cities', 'IS_ARRAY'],
    ['PATCH', { creditName: null }, 'creditName', 'IS_STRING'],
    ['PATCH', { name: null }, 'name', 'IS_STRING'],
    ['PATCH', { cities: null }, 'cities', 'IS_ARRAY'],
  ] as const)(
    'RN04 - %s com null em campo não anulável (%j): 400, não 500',
    async (method, body, path, code) => {
      const juliana = await person();
      if (method === 'PATCH') await signup(juliana.cookie, profile()).expect(201);

      const response =
        method === 'POST'
          ? await signup(juliana.cookie, profile(body)).expect(400)
          : await save(juliana.cookie, body).expect(400);

      expect(response.body.errors).toContainEqual(expect.objectContaining({ path, code }));
    },
  );

  describe('GET /v1/me/referrer (Link de indicação RN01 e RN02)', () => {
    it('o link e o desconto do casal, sem o percentual da comissão', async () => {
      const juliana = await person();
      const created = await signup(juliana.cookie, profile()).expect(201);

      const response = await referrer(juliana.cookie).expect(200);

      expect(response.body).toEqual({
        referralCode: created.body.referralCode,
        link: `https://kore.com.br/i/${created.body.referralCode}`,
        discountPercent: 10,
        // Repasse, Contrato: sem dados para receber ainda.
        taxIdMasked: null,
        pixKeyMasked: null,
        payoutDataComplete: false,
      });
    });

    it('com o desconto desligado, discountPercent nulo', async () => {
      const { userId } = await seedReferrer({
        db,
        kind: 'planner',
        name: 'Juliana Prado',
        referralDiscountEnabled: false,
      });
      const cookie = await openSession({ app, userId });

      expect((await referrer(cookie).expect(200)).body.discountPercent).toBeNull();
    });

    it('decisão 224(3) - sem o perfil de cerimonialista (inclusive vendedor ou inativo): 403 PROFILE_NOT_OWNED', async () => {
      const ana = await person();
      const seller = await seedReferrer({ db, kind: 'seller', name: 'Lucas Andrade' });
      const inactive = await seedReferrer({
        db,
        kind: 'planner',
        name: 'Juliana Prado',
        status: 'inactive',
      });

      for (const cookie of [
        ana.cookie,
        await openSession({ app, userId: seller.userId }),
        await openSession({ app, userId: inactive.userId }),
      ])
        expect((await referrer(cookie).expect(403)).body.error).toBe('PROFILE_NOT_OWNED');
    });
  });
});
