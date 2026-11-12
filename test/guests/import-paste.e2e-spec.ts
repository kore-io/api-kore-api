import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

/** Importação de convidados: Colar a lista (banco real). */
describe('Importação: Colar a lista (banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const post = (cookie: string, url: string, body: object) =>
    request(app.getHttpServer())
      .post(url)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);
  const preview = (cookie: string, weddingId: string, text: string) =>
    post(cookie, `/v1/weddings/${weddingId}/guest-imports/paste/preview`, { text });
  const importList = (cookie: string, weddingId: string, body: object) =>
    post(cookie, `/v1/weddings/${weddingId}/guest-imports/paste`, body);

  async function anaWedding() {
    const ana = await signedInUser({ app, name: 'Ana' });
    const juliana = await signedInUser({ app, name: 'Juliana Prado' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    return { ana, juliana, weddingId };
  }

  describe('Prévia (RN07, RN10, RN11)', () => {
    it('RN10 e RN11 - devolve os grupos, as contagens e as pessoas sem nome, sem gravar nada', async () => {
      const { ana, weddingId } = await anaWedding();

      const response = await preview(
        ana.cookie,
        weddingId,
        'Família Moreira: Jorge, Célia, Pedro\nCarla Nunes + 2 filhos\nRafael e Bianca\nMárcia Rocha',
      ).expect(200);

      expect(response.body).toEqual({
        parties: 4,
        guests: 9,
        missingNames: 2,
        groups: [
          {
            line: 1,
            source: 'Família Moreira: Jorge, Célia, Pedro',
            name: 'Família Moreira',
            guests: [{ name: 'Jorge' }, { name: 'Célia' }, { name: 'Pedro' }],
            warnings: [],
            duplicatesRemoved: 0,
          },
          {
            line: 2,
            source: 'Carla Nunes + 2 filhos',
            name: 'Carla Nunes',
            guests: [{ name: 'Carla Nunes' }, { name: null }, { name: null }],
            warnings: [],
            duplicatesRemoved: 0,
          },
          {
            line: 3,
            source: 'Rafael e Bianca',
            name: 'Rafael e Bianca',
            guests: [{ name: 'Rafael' }, { name: 'Bianca' }],
            warnings: [],
            duplicatesRemoved: 0,
          },
          {
            line: 4,
            source: 'Márcia Rocha',
            name: 'Márcia Rocha',
            guests: [{ name: 'Márcia Rocha' }],
            warnings: [],
            duplicatesRemoved: 0,
          },
        ],
        droppedLines: [],
      });
      expect(await db.party.count({ where: { weddingId } })).toBe(0);
    });

    it('RN14 (decisão 210(4)) - cada grupo diz quantos nomes repetidos saíram: "Jorge, jorge, JORGE" dá 2', async () => {
      const { ana, weddingId } = await anaWedding();

      const response = await preview(
        ana.cookie,
        weddingId,
        'Família Moreira: Jorge, jorge, JORGE, Célia\nRafael e Bianca',
      ).expect(200);

      expect(
        (
          response.body.groups as {
            guests: unknown[];
            warnings: string[];
            duplicatesRemoved: number;
          }[]
        ).map(({ guests, warnings, duplicatesRemoved }) => ({
          guests: guests.length,
          warnings,
          duplicatesRemoved,
        })),
      ).toEqual([
        { guests: 2, warnings: ['DUPLICATE_REMOVED'], duplicatesRemoved: 2 },
        { guests: 2, warnings: [], duplicatesRemoved: 0 },
      ]);
    });

    it('RN07 - avisa o grupo com o nome de um grupo ativo (sem diferenciar maiúsculas, acentos e espaços); na lixeira não conta', async () => {
      const { ana, weddingId } = await anaWedding();
      await post(ana.cookie, `/v1/weddings/${weddingId}/parties`, {
        name: 'Márcia Rocha',
        guests: [{ name: 'Márcia Rocha' }],
      }).expect(201);
      const trashed = await post(ana.cookie, `/v1/weddings/${weddingId}/parties`, {
        name: 'Família Duarte',
        guests: [{ name: 'Paulo' }],
      }).expect(201);
      await db.party.update({ where: { id: trashed.body.id }, data: { deletedAt: new Date() } });

      const response = await preview(
        ana.cookie,
        weddingId,
        'MARCIA  rocha\nFamilia Duarte: Paulo',
      ).expect(200);

      expect(
        (response.body.groups as { warnings: string[] }[]).map((group) => group.warnings),
      ).toEqual([['PARTY_NAME_EXISTS'], []]);
    });

    it('RN10 - grupo sem ninguém sai para droppedLines e fica fora das contagens', async () => {
      const { ana, weddingId } = await anaWedding();

      const response = await preview(ana.cookie, weddingId, 'Ana\n+ 0\nCarla + 99').expect(200);

      expect(response.body).toMatchObject({ parties: 2, guests: 2, droppedLines: [2] });
      expect(response.body.groups[1].warnings).toEqual(['PLUS_OUT_OF_RANGE']);
    });

    it('RN10 - mais de 1.000 convidados, contando as pessoas sem nome: 422 TOO_MANY_GUESTS', async () => {
      const { ana, weddingId } = await anaWedding();
      const text = Array.from({ length: 48 }, (_, i) => `Grupo ${i} + 20`).join('\n');

      const response = await preview(ana.cookie, weddingId, text).expect(422);

      expect(response.body).toMatchObject({ error: 'TOO_MANY_GUESTS', max: 1000 });
    });

    it('RN10 - texto vazio dá 400', async () => {
      const { ana, weddingId } = await anaWedding();

      await preview(ana.cookie, weddingId, '').expect(400);
    });
  });

  describe('Importar (RN11, RN12, RN14)', () => {
    it('RN12 e RN14 - cria os grupos pendentes, sem contato nem vagas, numa transação, com os números e o evento', async () => {
      const { ana, weddingId } = await anaWedding();

      const response = await importList(ana.cookie, weddingId, {
        groups: [
          { name: 'Família Moreira', guests: ['Jorge', 'Célia', 'Pedro'] },
          { name: ' Carla Nunes ', guests: ['Carla Nunes', 'Lucas Nunes', 'Ana Nunes'] },
        ],
        removedInPreview: 2,
      }).expect(201);

      expect(response.body).toEqual({ parties: 2, guests: 6 });
      const parties = await db.party.findMany({
        where: { weddingId },
        include: { guests: { orderBy: [{ joinedPartyAt: 'asc' }, { id: 'asc' }] } },
        orderBy: { id: 'asc' },
      });
      expect(parties.map((party) => party.name)).toEqual(['Família Moreira', 'Carla Nunes']);
      expect(parties[0].guests.map((guest) => guest.name)).toEqual(['Jorge', 'Célia', 'Pedro']);
      expect(
        parties.every((party) => party.contactGuestId === null && party.plusOneSlots === 0),
      ).toBe(true);
      expect(
        parties
          .flatMap((party) => party.guests)
          .every((guest) => guest.rsvpStatus === 'pending' && guest.phone === null),
      ).toBe(true);
      expect(await db.weddingStats.findUniqueOrThrow({ where: { weddingId } })).toMatchObject({
        guestsTotal: 6,
        pending: 6,
        partiesPending: 2,
      });
      const event = await db.productEvent.findFirst({
        where: { name: 'importacao' },
        orderBy: { createdAt: 'desc' },
      });
      expect(event?.props).toEqual({ metodo: 'lista', linhas_erro: 2 });
    });

    it('RN11 - nome repetido no mesmo grupo do payload: 422 DUPLICATE com o caminho, e nada é gravado', async () => {
      const { ana, weddingId } = await anaWedding();

      const response = await importList(ana.cookie, weddingId, {
        groups: [
          { name: 'A', guests: ['Ana'] },
          { name: 'B', guests: ['Bia', 'Caio', ' bia '] },
        ],
        removedInPreview: 0,
      }).expect(422);

      expect(response.body).toMatchObject({ error: 'DUPLICATE', path: 'groups.1.guests.2' });
      expect(await db.party.count({ where: { weddingId } })).toBe(0);
    });

    it('RN12 - grupo sem nome ou sem convidado, nome acima de 80 e removedInPreview ausente dão 400 com o caminho', async () => {
      const { ana, weddingId } = await anaWedding();

      const response = await importList(ana.cookie, weddingId, {
        groups: [
          { name: '', guests: ['Ana'] },
          { name: 'B', guests: [] },
          { name: 'C', guests: ['a'.repeat(81)] },
        ],
      }).expect(400);

      const paths = (response.body.errors as { path: string }[]).map((error) => error.path);
      expect(paths).toEqual(
        expect.arrayContaining([
          'groups.0.name',
          'groups.1.guests',
          'groups.2.guests',
          'removedInPreview',
        ]),
      );
    });

    it('RN10 - mais de 1.000 convidados na confirmação: 422 TOO_MANY_GUESTS', async () => {
      const { ana, weddingId } = await anaWedding();
      const groups = Array.from({ length: 11 }, (_, g) => ({
        name: `G${g}`,
        guests: Array.from({ length: 100 }, (__, i) => `P${i}`),
      }));

      expect(
        (await importList(ana.cookie, weddingId, { groups, removedInPreview: 0 }).expect(422)).body
          .error,
      ).toBe('TOO_MANY_GUESTS');
    });
  });

  describe('Quem pode e limite (RN01, RN13)', () => {
    it('RN13 - a cerimonialista importa; sem vínculo, o casamento não existe', async () => {
      const { juliana, weddingId } = await anaWedding();
      const stranger = await signedInUser({ app, name: 'Estranha' });

      await importList(juliana.cookie, weddingId, {
        groups: [{ name: 'Família Prado', guests: ['Rita'] }],
        removedInPreview: 0,
      }).expect(201);
      expect((await preview(stranger.cookie, weddingId, 'Ana').expect(404)).body.error).toBe(
        'WEDDING_NOT_FOUND',
      );
    });

    it('RN01 - 20 pedidos por minuto por usuário, somados entre as rotas; a 21ª dá 429, e outra pessoa não é afetada', async () => {
      const { ana, juliana, weddingId } = await anaWedding();
      for (let i = 0; i < 20; i++) {
        if (i % 2) await preview(ana.cookie, weddingId, 'Ana').expect(200);
        else
          await importList(ana.cookie, weddingId, {
            groups: [{ name: `G${i}`, guests: ['Ana'] }],
            removedInPreview: 0,
          }).expect(201);
      }

      const blocked = await preview(ana.cookie, weddingId, 'Ana').expect(429);

      expect(blocked.body).toEqual({
        statusCode: 429,
        error: 'RATE_LIMITED',
        message: 'Too many requests.',
      });
      await preview(juliana.cookie, weddingId, 'Ana').expect(200);
    });
  });
});
