import { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { seedWedding } from '../support/weddings';

/**
 * A função site_public_by_slug com o usuário real da API, sem app.user_id
 * (o visitante): o recorte do visitante sai do banco (Site público RN05).
 */
describe('Função site_public_by_slug (banco real, usuário kore_api sem sessão)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  let api: Client;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
    api = new Client({ connectionString: process.env.DATABASE_URL });
    await api.connect();
  });

  afterAll(async () => {
    await api?.end();
    await app?.close();
  });

  async function wedding(status: 'published' | 'draft') {
    const owner = await db.user.create({ data: { email: `${randomUUID()}@kore.local` } });
    const { weddingId } = await seedWedding({ db, ownerId: owner.id });
    const slug = `site-${randomUUID().slice(0, 8)}`;
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        slug,
        status,
        publishedAt: status === 'published' ? new Date() : null,
        contactWhatsapp: '+5519998764521',
        contactEmail: 'casal@exemplo.kore.local',
      },
    });
    await db.section.updateMany({
      where: { weddingId, type: 'ceremony' },
      data: { enabled: true },
    });
    await db.sectionContent.updateMany({
      where: { weddingId, section: { type: 'ceremony' } },
      data: {
        content: {
          venues: [
            {
              title: 'Cerimônia',
              placeName: 'Capela',
              date: null,
              time: '16:30',
              address: 'Rua X, 1',
            },
          ],
        },
      },
    });
    return slug;
  }

  const read = async (slug: string) =>
    (await api.query('SELECT site_public_by_slug($1::citext) AS site', [slug])).rows[0]
      ?.site as Record<string, unknown> | null;

  it('RN05 - publicado: só as colunas públicas; da Cerimônia, só a quantidade de locais', async () => {
    const site = await read(await wedding('published'));

    expect(site).toMatchObject({ status: 'published', city: 'Campinas' });
    const raw = JSON.stringify(site);
    for (const secret of ['+5519998764521', 'casal@exemplo', 'Capela', 'Rua X', '16:30'])
      expect(raw).not.toContain(secret);
    expect(site?.sections).toContainEqual(
      expect.objectContaining({ type: 'ceremony', content: { venueCount: 1 } }),
    );
  });

  it('RN04 - rascunho: só o status, nenhum dado do casal; endereço inexistente: nulo', async () => {
    expect(await read(await wedding('draft'))).toEqual({ status: 'draft' });
    expect(await read(`nao-existe-${randomUUID().slice(0, 8)}`)).toBeNull();
  });

  it('a API não lê as tabelas do site sem a função (a RLS barra o visitante)', async () => {
    const slug = await wedding('published');
    const { rows } = await api.query('SELECT id FROM weddings WHERE slug = $1::citext', [slug]);
    expect(rows).toEqual([]);
  });

  it('ADR-36 item 2 - site_party_view só devolve com o grupo do casamento, fora da lixeira e com a versão do link', async () => {
    const slug = await wedding('published');
    const other = await wedding('published');
    const [weddingId, otherId] = await Promise.all(
      [slug, other].map(
        async (value) => (await db.wedding.findFirstOrThrow({ where: { slug: value } })).id,
      ),
    );
    const party = await db.party.create({
      data: {
        weddingId,
        name: 'Família Moreira',
        linkToken: randomBytes(16).toString('base64url'),
      },
    });
    const view = async (wedding: string, version: number) =>
      (
        await api.query('SELECT site_party_view($1::uuid, $2::uuid, $3::int) AS view', [
          wedding,
          party.id,
          version,
        ])
      ).rows[0]?.view as Record<string, unknown> | null;

    expect(await view(weddingId, 1)).toMatchObject({
      partyName: 'Família Moreira',
      contactWhatsapp: '+5519998764521',
      venues: [expect.objectContaining({ address: 'Rua X, 1' })],
    });
    expect(await view(weddingId, 2)).toBeNull();
    expect(await view(otherId, 1)).toBeNull();
    const byToken = async () =>
      (await api.query('SELECT site_party_by_token($1) AS party', [party.linkToken])).rows[0]
        ?.party as Record<string, unknown> | null;
    expect(await byToken()).toMatchObject({ partyId: party.id, slug, linkVersion: 1 });
    await db.party.update({ where: { id: party.id }, data: { deletedAt: new Date() } });
    expect(await view(weddingId, 1)).toBeNull();
    expect(await byToken()).toBeNull();
  });
});
