import { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const SITE_ORIGIN = 'http://localhost:5174';
const ADDRESS = 'Rua Barão de Jaguara, 1200, Centro, Campinas, SP';
const WHATSAPP = '+5519998764521';

/** O link do grupo no site (Site público RN04 a RN06, RN08 e RN13; ADR-36; banco real). */
describe('Site público: o link do grupo (banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  // Cada caso com o próprio IP (TRUST_PROXY_HOPS=1 no teste), para o limite não somar.
  const ip = () => `10.${[1, 2, 3].map(() => Math.floor(Math.random() * 250)).join('.')}`;
  const exchange = (slug: string, token: string, from = ip()) =>
    request(app.getHttpServer())
      .post(`/v1/sites/${slug}/party-session`)
      .set('Origin', SITE_ORIGIN)
      .set('X-Forwarded-For', from)
      .send({ token });
  const site = (slug: string, cookie?: string) => {
    const call = request(app.getHttpServer()).get(`/v1/sites/${slug}`).set('Origin', SITE_ORIGIN);
    return cookie ? call.set('Cookie', cookie) : call;
  };
  const token = () => randomBytes(16).toString('base64url');
  const cookieOf = (response: request.Response) =>
    ([] as string[]).concat(response.headers['set-cookie'] ?? []);

  async function wedding(status: 'published' | 'draft' = 'published') {
    const ana = await signedInUser({ app, name: 'Ana' });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    const slug = `ana-e-marcos-${randomUUID().slice(0, 8)}`;
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        slug,
        status,
        publishedAt: status === 'published' ? new Date() : null,
        contactWhatsapp: WHATSAPP,
      },
    });
    await db.sectionContent.updateMany({
      where: { weddingId, section: { type: 'ceremony' } },
      data: {
        content: {
          venues: [
            {
              title: 'Cerimônia',
              placeName: 'Capela',
              date: '2026-11-14',
              time: '16:30',
              address: ADDRESS,
            },
          ],
        },
      },
    });
    const party = await db.party.create({
      data: { weddingId, name: 'Família Moreira', linkToken: token() },
    });
    return { weddingId, slug, party };
  }

  it('RN06 e RN08 - troca o token pelo cookie assinado do grupo, sem renovar, só nas rotas do site', async () => {
    const { weddingId, slug, party } = await wedding();

    const response = await exchange(slug, party.linkToken).expect(200);

    expect(response.body).toEqual({ slug, party: { name: 'Família Moreira' } });
    const [cookie] = cookieOf(response);
    expect(cookie).toMatch(new RegExp(`^kore_party_${weddingId}=[^;]+;`));
    expect(cookie).toContain('Max-Age=34560000');
    expect(cookie).toContain('Path=/v1/sites');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['access-control-allow-origin']).toBe(SITE_ORIGIN);
  });

  it('RSVP RN02 - abrir o link marca o convite como visualizado; abrir de novo não muda a data', async () => {
    const { slug, party } = await wedding();
    await db.party.update({
      where: { id: party.id },
      data: { deliveryStatus: 'sent', sentAt: new Date('2026-09-02T13:42:00Z') },
    });
    const before = new Date();

    await exchange(slug, party.linkToken).expect(200);

    const viewed = await db.party.findUniqueOrThrow({ where: { id: party.id } });
    expect(viewed.deliveryStatus).toBe('viewed');
    expect(viewed.firstViewedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(viewed.version).toBe(1);

    await exchange(slug, party.linkToken).expect(200);

    expect((await db.party.findUniqueOrThrow({ where: { id: party.id } })).firstViewedAt).toEqual(
      viewed.firstViewedAt,
    );
  });

  it('RSVP RN02 - não enviado também fica visualizado; respondido não muda', async () => {
    const { slug, party } = await wedding();
    const { party: responded } = await wedding();
    await db.party.update({ where: { id: responded.id }, data: { deliveryStatus: 'responded' } });

    await exchange(slug, party.linkToken).expect(200);
    await exchange(
      (await db.wedding.findUniqueOrThrow({ where: { id: responded.weddingId } })).slug!,
      responded.linkToken,
    ).expect(200);

    expect((await db.party.findUniqueOrThrow({ where: { id: party.id } })).deliveryStatus).toBe(
      'viewed',
    );
    const after = await db.party.findUniqueOrThrow({ where: { id: responded.id } });
    expect(after.deliveryStatus).toBe('responded');
    expect(after.firstViewedAt).not.toBeNull();
  });

  it('RSVP RN02 e decisão 216 (D12) - só o POST grava: a URL do link aberta só com GET, o site pelo cookie e a prévia do link não marcam', async () => {
    const { slug, party } = await wedding();
    await db.party.update({ where: { id: party.id }, data: { deliveryStatus: 'sent' } });
    const { party: other } = await wedding();
    const otherSlug = (await db.wedding.findUniqueOrThrow({ where: { id: other.weddingId } }))
      .slug!;
    const [cookie] = cookieOf(await exchange(otherSlug, other.linkToken).expect(200));
    await db.party.update({
      where: { id: other.id },
      data: { firstViewedAt: null, deliveryStatus: 'sent' },
    });

    // O robô do WhatsApp: GET na URL do link e na prévia do link, sem POST.
    await request(app.getHttpServer()).get(`/${slug}/grupo/${party.linkToken}`);
    await request(app.getHttpServer()).get(`/v1/public/sites/${slug}/preview`).expect(200);
    await site(slug).expect(200);
    // Entrar depois pelo cookie.
    await site(otherSlug, cookie.split(';')[0]).expect(200);

    for (const id of [party.id, other.id])
      expect(await db.party.findUniqueOrThrow({ where: { id } })).toMatchObject({
        deliveryStatus: 'sent',
        firstViewedAt: null,
      });
  });

  it('RSVP RN02 - no pós-evento, o link identifica o grupo e não marca visita', async () => {
    const { weddingId, slug, party } = await wedding();
    await db.wedding.update({ where: { id: weddingId }, data: { status: 'post_event' } });

    await exchange(slug, party.linkToken).expect(200);

    expect(await db.party.findUniqueOrThrow({ where: { id: party.id } })).toMatchObject({
      deliveryStatus: 'not_sent',
      firstViewedAt: null,
    });
  });

  it('RN05 - com o cookie, o grupo vê os locais, o contato e a faixa do convite; o visitante, não', async () => {
    const { slug, party } = await wedding();
    const [cookie] = cookieOf(await exchange(slug, party.linkToken).expect(200));

    const asParty = (await site(slug, cookie.split(';')[0]).expect(200)).body;
    const asVisitor = (await site(slug).expect(200)).body;

    expect(asParty).toMatchObject({
      viewer: { kind: 'party', party: { name: 'Família Moreira' }, preview: null },
      contact: { whatsapp: WHATSAPP, email: null },
    });
    expect(asParty.sections).toContainEqual({
      type: 'ceremony',
      title: 'Cerimônia & Recepção',
      locked: false,
      content: {
        venues: [
          {
            title: 'Cerimônia',
            placeName: 'Capela',
            date: '2026-11-14',
            time: '16:30',
            address: ADDRESS,
          },
        ],
      },
    });
    expect(asVisitor).toMatchObject({ viewer: { kind: 'visitor' }, contact: null });
    expect(JSON.stringify(asVisitor)).not.toContain(ADDRESS);
  });

  it('ADR-36 item 2 - link regenerado ou grupo na lixeira: o cookie é apagado e a leitura é de visitante', async () => {
    const { slug, party } = await wedding();
    const [cookie] = cookieOf(await exchange(slug, party.linkToken).expect(200));
    const header = cookie.split(';')[0];

    await db.party.update({
      where: { id: party.id },
      data: { linkVersion: 2, linkToken: token() },
    });
    const regenerated = await site(slug, header).expect(200);
    expect(regenerated.body.viewer.kind).toBe('visitor');
    expect(cookieOf(regenerated)[0]).toMatch(
      /^kore_party_[^=]+=; Path=\/v1\/sites; Expires=Thu, 01 Jan 1970/,
    );

    const other = await wedding();
    const [otherCookie] = cookieOf(await exchange(other.slug, other.party.linkToken).expect(200));
    await db.party.update({ where: { id: other.party.id }, data: { deletedAt: new Date() } });
    expect((await site(other.slug, otherCookie.split(';')[0]).expect(200)).body.viewer.kind).toBe(
      'visitor',
    );
  });

  it('RN06 - cookie forjado ou de outro casamento é ignorado', async () => {
    const first = await wedding();
    const second = await wedding();
    const [cookie] = cookieOf(await exchange(first.slug, first.party.linkToken).expect(200));
    const [, value] = cookie.split(';')[0].split('=');

    const forged = await site(second.slug, `kore_party_${second.weddingId}=${value}`).expect(200);

    expect(forged.body.viewer.kind).toBe('visitor');
  });

  it('RN06 - endereço errado: o grupo é o do token, e a resposta traz o endereço certo', async () => {
    const { slug, party } = await wedding();
    const other = await wedding();

    const response = await exchange(other.slug, party.linkToken).expect(200);

    expect(response.body.slug).toBe(slug);
  });

  it('RN04 e RN06 - rascunho vem antes de tudo: a mesma resposta com token válido ou não, sem cookie', async () => {
    const draft = await wedding('draft');
    const published = await wedding();

    const responses = [
      await exchange(draft.slug, draft.party.linkToken).expect(404),
      await exchange(draft.slug, token()).expect(404),
      // Token de um rascunho pedido no endereço de outro casamento: não revela o endereço certo.
      await exchange(published.slug, draft.party.linkToken).expect(404),
    ];

    for (const response of responses) {
      expect(response.body).toEqual({
        statusCode: 404,
        error: 'SITE_DRAFT',
        message: expect.any(String),
      });
      expect(cookieOf(response)).toEqual([]);
    }
  });

  it('RN06 - token que não resolve: LINK_INVALID num site publicado; SITE_NOT_FOUND num endereço que não existe', async () => {
    const { slug } = await wedding();

    expect((await exchange(slug, token()).expect(404)).body.error).toBe('LINK_INVALID');
    expect(
      (await exchange(`nao-existe-${randomUUID().slice(0, 8)}`, token()).expect(404)).body.error,
    ).toBe('SITE_NOT_FOUND');
    await exchange(slug, 'curto').expect(400);
  });

  it('Data de saída do ar RN08 - expirado: SITE_EXPIRED (410) na leitura e na troca do link, sem cookie', async () => {
    const { weddingId, slug, party } = await wedding();
    await db.wedding.update({ where: { id: weddingId }, data: { status: 'expired' } });

    const read = await request(app.getHttpServer())
      .get(`/v1/sites/${slug}`)
      .set('Origin', SITE_ORIGIN)
      .expect(410);
    expect(read.body.error).toBe('SITE_EXPIRED');
    const exchanged = await exchange(slug, party.linkToken).expect(410);
    expect(exchanged.body.error).toBe('SITE_EXPIRED');
    expect(cookieOf(exchanged)).toEqual([]);
  });

  it('RN06 - party_link: 20 falhas por minuto por IP; os acertos não contam, e outro IP não é afetado', async () => {
    const { slug, party } = await wedding();
    const crowded = ip();
    for (let i = 0; i < 25; i++) await exchange(slug, party.linkToken, crowded).expect(200);
    for (let i = 0; i < 20; i++) await exchange(slug, token(), crowded).expect(404);

    const blocked = await exchange(slug, party.linkToken, crowded).expect(429);

    expect(blocked.body).toEqual({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'Too many requests.',
    });
    // O bloqueio não grava o cookie do grupo, mesmo com o link certo.
    expect(cookieOf(blocked)).toEqual([]);
    await exchange(slug, party.linkToken).expect(200);
  });

  it('RN07 - escrita sem Origin com o cookie do grupo: 403', async () => {
    const { slug, party } = await wedding();

    await request(app.getHttpServer())
      .post(`/v1/sites/${slug}/party-session`)
      .set('Cookie', 'kore_party_0195b2e4-0000-7000-8000-000000000000=x')
      .send({ token: party.linkToken })
      .expect(403);
  });
});
