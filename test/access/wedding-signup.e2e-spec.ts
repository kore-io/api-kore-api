import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

describe('Cadastro do casal: POST /v1/weddings e GET /v1/weddings/slug-availability (banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const uniqueSlug = () => `ana-e-marcos-${randomUUID().slice(0, 8)}`;
  const body = (overrides: Record<string, unknown> = {}) => ({
    myName: ' Ana  Beatriz Moreira ',
    myTitle: 'bride',
    partnerName: 'Marcos Vinícius Rocha',
    eventDate: '2026-11-14',
    city: 'Campinas',
    state: 'SP',
    slug: uniqueSlug(),
    termsVersion: '2026-09',
    utmSource: 'instagram',
    utmMedium: 'social',
    utmCampaign: 'lancamento',
    ...overrides,
  });
  const create = (cookie: string, payload: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/v1/weddings')
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(payload);
  const availability = (cookie: string, query: Record<string, string>) =>
    request(app.getHttpServer())
      .get('/v1/weddings/slug-availability')
      .query(query)
      .set('Cookie', cookie);

  it('RN07 e RN11 - cria o rascunho com a pessoa dona, os dois noivos, o fuso, a origem e o aceite dos Termos', async () => {
    const { userId, cookie } = await signedInUser({ app, name: 'Ana' });
    const payload = body({ state: 'MT' });

    const response = await create(cookie, payload).expect(201);

    expect(response.body).toEqual({
      weddingId: expect.any(String),
      slug: payload.slug,
      status: 'draft',
      timezone: 'America/Cuiaba',
      referrer: null,
    });
    const wedding = await db.wedding.findUniqueOrThrow({
      where: { id: response.body.weddingId },
      include: { partners: { orderBy: { slot: 'asc' } }, memberships: true },
    });
    expect(wedding).toMatchObject({
      status: 'draft',
      eventDate: new Date('2026-11-14T00:00:00Z'),
      city: 'Campinas',
      state: 'MT',
      createdByUserId: userId,
      referrerId: null,
      referralSource: null,
      signupSource: 'direct',
      utmSource: 'instagram',
      utmMedium: 'social',
      utmCampaign: 'lancamento',
    });
    expect(wedding.memberships).toMatchObject([{ userId, role: 'owner', removedAt: null }]);
    expect(wedding.partners).toMatchObject([
      { slot: 1, displayName: 'Ana Beatriz Moreira', title: 'bride', userId },
      // Sem título até o aceite (decisão 167).
      { slot: 2, displayName: 'Marcos Vinícius Rocha', title: null, userId: null },
    ]);
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user).toMatchObject({ name: 'Ana Beatriz Moreira', termsVersion: '2026-09' });
    expect(user.termsAcceptedAt).toBeInstanceOf(Date);
  });

  it('RN02 - a data é opcional', async () => {
    const { cookie } = await signedInUser({ app });

    const response = await create(cookie, body({ eventDate: undefined })).expect(201);

    const wedding = await db.wedding.findUniqueOrThrow({ where: { id: response.body.weddingId } });
    expect(wedding.eventDate).toBeNull();
  });

  it.each([
    ['sem cidade', { city: '   ' }],
    ['UF inexistente', { state: 'XX' }],
    ['endereço fora do formato (RN04)', { slug: '-ana--e-marcos' }],
    ['data que não existe', { eventDate: '2026-02-30' }],
    ['origem que o cliente não pode mandar', { signupSource: 'referral_link' }],
    ['noivo ou noiva fora da lista', { myTitle: 'noiva' }],
  ])('RN02 - %s dá 400', async (_, overrides) => {
    const { cookie } = await signedInUser({ app });

    await create(cookie, body(overrides)).expect(400);
  });

  it('RN11 - dada outra versão dos Termos, então 409 TERMS_VERSION_OUTDATED, sem criar (decisão 166)', async () => {
    const { userId, cookie } = await signedInUser({ app });

    const response = await create(cookie, body({ termsVersion: '2025-01' })).expect(409);

    expect(response.body.error).toBe('TERMS_VERSION_OUTDATED');
    expect(await db.wedding.count({ where: { createdByUserId: userId } })).toBe(0);
  });

  it('RN06 - dada a dona de um casamento ativo, então 409 ALREADY_OWNER com o casamento dela', async () => {
    const { cookie } = await signedInUser({ app });
    const first = await create(cookie, body()).expect(201);

    const response = await create(cookie, body()).expect(409);

    expect(response.body).toMatchObject({
      error: 'ALREADY_OWNER',
      weddingId: first.body.weddingId,
    });
  });

  it('RN06 - ser colaboradora de outros casamentos não impede o cadastro', async () => {
    const { userId, cookie } = await signedInUser({ app });
    const owner = await signedInUser({ app });
    await seedWedding({ db, ownerId: owner.userId, collaboratorIds: [userId] });

    await create(cookie, body()).expect(201);
  });

  it('RN06 - dois cadastros ao mesmo tempo da mesma pessoa criam um só casamento', async () => {
    const { userId, cookie } = await signedInUser({ app });

    const results = await Promise.all([create(cookie, body()), create(cookie, body())]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.wedding.count({ where: { createdByUserId: userId } })).toBe(1);
  });

  it('RN05 - dado o endereço de outro casamento, então 409 SLUG_UNAVAILABLE com a sugestão do ano', async () => {
    const other = await signedInUser({ app });
    const slug = uniqueSlug();
    await create(other.cookie, body({ slug })).expect(201);
    const { cookie } = await signedInUser({ app });

    const response = await create(cookie, body({ slug })).expect(409);

    expect(response.body).toMatchObject({ error: 'SLUG_UNAVAILABLE', suggestion: `${slug}-2026` });
  });

  it('RN05 - dois casais com o mesmo endereço ao mesmo tempo: o UNIQUE decide e quem perde vê o erro', async () => {
    const [ana, bia] = [await signedInUser({ app }), await signedInUser({ app })];
    const slug = uniqueSlug();

    const results = await Promise.all([
      create(ana.cookie, body({ slug })),
      create(bia.cookie, body({ slug })),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.error).toBe('SLUG_UNAVAILABLE');
  });

  it('RN08 e RN09 - pelo link de um indicador ativo, o casamento nasce atribuído, com o desconto e a origem referral_link', async () => {
    const { referralCode } = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const { cookie } = await signedInUser({ app });

    const response = await create(cookie, body({ referralCode, signupSource: 'simulator' })).expect(
      201,
    );

    expect(response.body.referrer).toEqual({ name: 'Juliana Prado', discountPercent: 10 });
    const wedding = await db.wedding.findUniqueOrThrow({
      where: { id: response.body.weddingId },
      include: { referrer: true },
    });
    expect(wedding).toMatchObject({
      referralSource: 'referral_link',
      signupSource: 'referral_link',
    });
    expect(wedding.referrer?.referralCode).toBe(referralCode);
  });

  it('RN08 - o próprio indicador não se atribui o casamento', async () => {
    const { referralCode, userId } = await seedReferrer({
      db,
      kind: 'planner',
      name: 'Juliana Prado',
    });
    const cookie = await openSession({ app, userId });

    const response = await create(cookie, body({ referralCode })).expect(201);

    expect(response.body.referrer).toBeNull();
    const wedding = await db.wedding.findUniqueOrThrow({ where: { id: response.body.weddingId } });
    expect(wedding).toMatchObject({ referrerId: null, signupSource: 'direct' });
  });

  it('RN08 - indicador inativo: segue sem atribuição, sem erro', async () => {
    const { referralCode } = await seedReferrer({
      db,
      kind: 'seller',
      name: 'Lucas Lima',
      status: 'inactive',
    });
    const { cookie } = await signedInUser({ app });

    const response = await create(cookie, body({ referralCode })).expect(201);

    expect(response.body.referrer).toBeNull();
  });

  it('sem sessão, 401 nas duas rotas', async () => {
    await request(app.getHttpServer())
      .post('/v1/weddings')
      .set('Origin', APP_ORIGIN)
      .send(body())
      .expect(401);
    await request(app.getHttpServer())
      .get('/v1/weddings/slug-availability')
      .query({ slug: 'ana-e-marcos' })
      .expect(401);
  });

  describe('GET /v1/weddings/slug-availability', () => {
    it('RN05 - enxerga o endereço de um casamento que a pessoa não vê (RLS) e sugere com o ano', async () => {
      const other = await signedInUser({ app });
      const slug = uniqueSlug();
      await create(other.cookie, body({ slug })).expect(201);
      const { cookie } = await signedInUser({ app });

      const response = await availability(cookie, { slug, eventDate: '2026-11-14' }).expect(200);

      expect(response.body).toEqual({
        slug,
        available: false,
        reason: 'taken',
        suggestion: `${slug}-2026`,
      });
    });

    it('RN05 - endereço livre', async () => {
      const { cookie } = await signedInUser({ app });
      const slug = uniqueSlug();

      const response = await availability(cookie, { slug }).expect(200);

      expect(response.body).toEqual({ slug, available: true, reason: null, suggestion: null });
    });

    it('RN05 - palavra reservada', async () => {
      const { cookie } = await signedInUser({ app });

      const response = await availability(cookie, { slug: 'entrar' }).expect(200);

      expect(response.body).toMatchObject({ available: false, reason: 'reserved' });
      expect(response.body.suggestion).toMatch(/^entrar-\d+$/);
    });

    it('RN04 - formato inválido', async () => {
      const { cookie } = await signedInUser({ app });

      const response = await availability(cookie, { slug: '-ana--e-marcos' }).expect(200);

      expect(response.body).toEqual({
        slug: '-ana--e-marcos',
        available: false,
        reason: 'invalid_format',
        suggestion: null,
      });
    });
  });
});
