import { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { RATE_LIMIT_CLOCK } from '@/shared/rate-limit/ip-failure-limit';
import { createTestApp } from '../support/harness/create-test-app';
import { signedInUser } from '../support/harness/sessions';
import { seedWedding } from '../support/factories/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const SITE_ORIGIN = 'http://localhost:5174';

/**
 * O limite `site_lookup` no GET /v1/sites/{slug} (decisão 306(2); Gazua,
 * rodada 3): 20 falhas (SITE_NOT_FOUND e SITE_DRAFT) por minuto por IP; acima,
 * 429. O SITE_DRAFT, o 410 e o 423 seguem como estão. Banco real; o relógio do
 * limite é o do teste.
 */
describe('Site público: o limite de falhas por IP na leitura (banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
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

  // Cada caso com o próprio IP (TRUST_PROXY_HOPS=1 no teste), para o limite não somar.
  const ip = () => `10.${[1, 2, 3].map(() => Math.floor(Math.random() * 250)).join('.')}`;
  const site = (slug: string, from: string, cookie?: string) => {
    const call = request(app.getHttpServer())
      .get(`/v1/sites/${slug}`)
      .set('Origin', SITE_ORIGIN)
      .set('X-Forwarded-For', from);
    return cookie ? call.set('Cookie', cookie) : call;
  };
  const missing = () => `nao-existe-${randomUUID().slice(0, 8)}`;

  async function wedding(status: 'published' | 'draft' = 'published') {
    const ana = await signedInUser({ app, name: 'Ana' });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    const slug = `ana-e-marcos-${randomUUID().slice(0, 8)}`;
    await db.wedding.update({
      where: { id: weddingId },
      data: { slug, status, publishedAt: status === 'published' ? new Date() : null },
    });
    return { ana, weddingId, slug };
  }

  /** O cookie do grupo, pela troca do link (RN06), de outro IP. */
  async function partyCookie({ weddingId, slug }: { weddingId: string; slug: string }) {
    const party = await db.party.create({
      data: {
        weddingId,
        name: 'Família Moreira',
        linkToken: randomBytes(16).toString('base64url'),
      },
    });
    const exchanged = await request(app.getHttpServer())
      .post(`/v1/sites/${slug}/party-session`)
      .set('Origin', SITE_ORIGIN)
      .set('X-Forwarded-For', ip())
      .send({ token: party.linkToken })
      .expect(200);
    return {
      party,
      cookie: ([] as string[]).concat(exchanged.headers['set-cookie'] ?? [])[0].split(';')[0],
    };
  }

  it('decisão 306(2) - site_lookup: SITE_NOT_FOUND e SITE_DRAFT somam 20 por minuto por IP; acima, 429 até no site publicado; outro IP não é afetado', async () => {
    const published = await wedding();
    const draft = await wedding('draft');
    const crowded = ip();
    for (let i = 0; i < 25; i++) await site(published.slug, crowded).expect(200);
    for (let i = 0; i < 10; i++)
      expect((await site(missing(), crowded).expect(404)).body.error).toBe('SITE_NOT_FOUND');
    for (let i = 0; i < 10; i++)
      expect((await site(draft.slug, crowded).expect(404)).body.error).toBe('SITE_DRAFT');

    const blocked = await site(published.slug, crowded).expect(429);

    expect(blocked.body).toEqual({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'Too many requests.',
    });
    // O rascunho e o endereço livre também ficam iguais: 429.
    await site(draft.slug, crowded).expect(429);
    await site(missing(), crowded).expect(429);
    expect(blocked.headers['cache-control']).toBe('private, no-store');
    await site(published.slug, ip()).expect(200);
    expect((await site(draft.slug, ip()).expect(404)).body.error).toBe('SITE_DRAFT');
  });

  it('decisão 306(2) - site_lookup: expirado (410) e bloqueado (423) seguem como estão e não contam', async () => {
    const expired = await wedding();
    await db.wedding.update({ where: { id: expired.weddingId }, data: { status: 'expired' } });
    const unavailable = await wedding();
    await db.wedding.update({
      where: { id: unavailable.weddingId },
      data: { blockedAt: new Date() },
    });
    const crowded = ip();

    for (let i = 0; i < 15; i++) {
      expect((await site(expired.slug, crowded).expect(410)).body.error).toBe('SITE_EXPIRED');
      expect((await site(unavailable.slug, crowded).expect(423)).body.error).toBe(
        'SITE_UNAVAILABLE',
      );
    }

    for (let i = 0; i < 20; i++) await site(missing(), crowded).expect(404);
    await site(missing(), crowded).expect(429);
  });

  it('decisão 306(2) - site_lookup: a janela é de um minuto pelo relógio; no minuto seguinte o IP volta', async () => {
    const published = await wedding();
    const crowded = ip();
    now = new Date('2026-11-21T15:01:00.000Z');
    for (let i = 0; i < 20; i++) await site(missing(), crowded).expect(404);
    now = new Date('2026-11-21T15:01:59.999Z');
    await site(published.slug, crowded).expect(429);

    now = new Date('2026-11-21T15:02:00.000Z');

    await site(published.slug, crowded).expect(200);
    await site(missing(), crowded).expect(404);
  });

  it('decisão 306(2) - a prévia (cookie assinado do casal) não é barrada pelo limite do IP', async () => {
    const draft = await wedding('draft');
    const crowded = ip();
    const { url } = (
      await request(app.getHttpServer())
        .post(`/v1/weddings/${draft.weddingId}/site-previews`)
        .set('Cookie', draft.ana.cookie)
        .set('Origin', APP_ORIGIN)
        .send({ mode: 'visitor' })
        .expect(201)
    ).body as { url: string };
    const exchanged = await request(app.getHttpServer())
      .post(`/v1/sites/${draft.slug}/preview-session`)
      .set('Origin', SITE_ORIGIN)
      .set('X-Forwarded-For', ip())
      .send({ token: new URL(url).searchParams.get('previa') })
      .expect(200);
    const previewCookie = ([] as string[])
      .concat(exchanged.headers['set-cookie'] ?? [])[0]
      .split(';')[0];
    for (let i = 0; i < 20; i++) await site(draft.slug, crowded).expect(404);
    await site(draft.slug, crowded).expect(429);

    const response = await site(draft.slug, crowded, previewCookie).expect(200);

    expect(response.body.viewer.kind).toBe('preview');
  });

  it('decisão 307(1) - o grupo com cookie válido não é barrado nem conta com o IP no limite; cookie forjado ou que não vale mais é visitante', async () => {
    const published = await wedding();
    const { party, cookie } = await partyCookie(published);
    const crowded = ip();
    for (let i = 0; i < 20; i++) await site(missing(), crowded).expect(404);
    await site(published.slug, crowded).expect(429);

    const response = await site(published.slug, crowded, cookie).expect(200);

    expect(response.body.viewer).toEqual({
      kind: 'party',
      party: { name: 'Família Moreira' },
      preview: null,
    });
    // O que vale é o cookie assinado e ainda válido.
    const [name, value] = cookie.split('=');
    await site(published.slug, crowded, `${name}=${value.slice(0, -2)}xx`).expect(429);
    await db.party.update({ where: { id: party.id }, data: { linkVersion: { increment: 1 } } });
    await site(published.slug, crowded, cookie).expect(429);
  });
});
