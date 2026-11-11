import { Controller, Get, HttpCode, INestApplication, Param, Post } from '@nestjs/common';
import request from 'supertest';
import { Public } from '../../src/shared/http/public.decorator';
import { SiteRoute } from '../../src/shared/http/site-route.decorator';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';

const APP_ORIGIN = 'http://localhost:5173';
const SITE_ORIGIN = 'http://localhost:5174';

/** Uma rota do site, só do teste, como as de /v1/sites/* da S5. */
@Controller('sites-test/:slug')
@SiteRoute()
@Public()
class SiteTestController {
  @Get()
  read(@Param('slug') slug: string): { slug: string } {
    return { slug };
  }

  @Post('ping')
  @HttpCode(200)
  ping(): { ok: true } {
    return { ok: true };
  }
}

/** Origem por rota: CORS, OriginGuard e SessionGuard (Site público RN07; decisão 207, item 4). */
describe('Origem por rota: o site só fala com as rotas do site (API inteira)', () => {
  let app: INestApplication;
  let cookie: string;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [SiteTestController] });
    cookie = (await signedInUser({ app, name: 'Ana' })).cookie;
  });

  afterAll(async () => {
    await app?.close();
  });

  const preflight = (path: string, origin: string) =>
    request(app.getHttpServer())
      .options(path)
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST');

  it('RN07 - preflight de uma rota do app: só a origem do app recebe CORS', async () => {
    const fromApp = await preflight('/v1/me', APP_ORIGIN);
    const fromSite = await preflight('/v1/me', SITE_ORIGIN);

    expect(fromApp.headers['access-control-allow-origin']).toBe(APP_ORIGIN);
    expect(fromSite.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('RN07 - preflight de uma rota @SiteRoute(), com parâmetro no caminho: a origem do site recebe CORS com credenciais', async () => {
    const response = await preflight('/v1/sites-test/ana-e-marcos/ping', SITE_ORIGIN);

    expect(response.headers['access-control-allow-origin']).toBe(SITE_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('RN07 - um GET do app vindo da origem do site não recebe CORS e não usa a sessão do casal', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/me')
      .set('Origin', SITE_ORIGIN)
      .set('Cookie', cookie)
      .expect(401);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    // A mesma sessão, da origem do app, vale.
    await request(app.getHttpServer())
      .get('/v1/me')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', cookie)
      .expect(200);
  });

  it('RN07 - escrita numa rota do app vinda da origem do site: 403 ORIGIN_NOT_ALLOWED', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .set('Origin', SITE_ORIGIN)
      .set('Cookie', cookie)
      .expect(403);

    expect(response.body.error).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('RN07 - escrita numa rota do site vinda do site passa, com CORS', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/sites-test/ana-e-marcos/ping')
      .set('Origin', SITE_ORIGIN)
      .set('Cookie', 'kore_party_0195b2e4-0000-7000-8000-000000000000=assinado')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe(SITE_ORIGIN);
  });

  it.each([
    ['a sessão', () => cookie],
    ['o cookie do grupo', () => 'kore_party_0195b2e4-0000-7000-8000-000000000000=assinado'],
    ['o cookie da prévia', () => 'kore_site_preview_0195b2e4-0000-7000-8000-000000000000=assinado'],
  ])('RN07 - escrita sem Origin e com %s: 403', async (_, credential) => {
    const response = await request(app.getHttpServer())
      .post('/v1/sites-test/ana-e-marcos/ping')
      .set('Cookie', credential())
      .expect(403);

    expect(response.body.error).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('RN07 - escrita sem Origin e sem credencial (Bruno): passa', async () => {
    await request(app.getHttpServer()).post('/v1/sites-test/ana-e-marcos/ping').expect(200);
  });
});
