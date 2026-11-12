import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

/** Tags dos convidados (banco real). */
describe('Tags dos convidados (banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  type Tag = { id: string; name: string; color: string | null; guests: number };
  type Party = { id: string; guests: { id: string; name: string | null }[] };

  const http = () => request(app.getHttpServer());
  const write = (method: 'post' | 'patch', url: string, cookie: string, body: object) =>
    http()[method](url).set('Cookie', cookie).set('Origin', APP_ORIGIN).send(body);
  const createTag = (cookie: string, weddingId: string, body: object) =>
    write('post', `/v1/weddings/${weddingId}/tags`, cookie, body);
  const updateTag = (cookie: string, weddingId: string, tagId: string, body: object) =>
    write('patch', `/v1/weddings/${weddingId}/tags/${tagId}`, cookie, body);
  const apply = (cookie: string, weddingId: string, tagId: string, body: object) =>
    write('post', `/v1/weddings/${weddingId}/tags/${tagId}/apply`, cookie, body);
  const listTags = async (cookie: string, weddingId: string) =>
    (await http().get(`/v1/weddings/${weddingId}/tags`).set('Cookie', cookie).expect(200)).body as {
      limit: number;
      data: Tag[];
    };
  const createParty = async (cookie: string, weddingId: string, body: object) =>
    (await write('post', `/v1/weddings/${weddingId}/parties`, cookie, body).expect(201))
      .body as Party;

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

  const tagNames = async (cookie: string, weddingId: string) =>
    (await listTags(cookie, weddingId)).data.map((tag) => tag.name);

  describe('Criar e editar (RN01, RN02, RN03, RN04, RN06)', () => {
    it('RN02 e RN04 - cria uma tag sem cor, com 0 convidados, e a lista conta de 10', async () => {
      const { ana, weddingId } = await anaWedding();

      const response = await createTag(ana.cookie, weddingId, { name: '  Vizinhos  ' }).expect(201);

      expect(response.body).toMatchObject({ name: 'Vizinhos', color: null, guests: 0 });
      expect(await listTags(ana.cookie, weddingId)).toMatchObject({
        limit: 10,
        data: [{ name: 'Vizinhos' }],
      });
    });

    it('RN01 - a 11ª tag é recusada; tag na lixeira não conta no limite', async () => {
      const { ana, weddingId } = await anaWedding();
      for (let i = 1; i <= 10; i++)
        await createTag(ana.cookie, weddingId, { name: `Tag ${i}` }).expect(201);

      expect(
        (await createTag(ana.cookie, weddingId, { name: 'Onze' }).expect(409)).body.error,
      ).toBe('TAG_LIMIT_REACHED');
      expect(await db.tag.count({ where: { weddingId, deletedAt: null } })).toBe(10);

      await db.tag.updateMany({
        where: { weddingId, name: 'Tag 1' },
        data: { deletedAt: new Date() },
      });
      await createTag(ana.cookie, weddingId, { name: 'Onze' }).expect(201);
    });

    it('RN01 - duas criações ao mesmo tempo com 9 tags: só uma passa', async () => {
      const { ana, juliana, weddingId } = await anaWedding();
      for (let i = 1; i <= 9; i++)
        await createTag(ana.cookie, weddingId, { name: `Tag ${i}` }).expect(201);

      // Duas pessoas (duas sessões): a mesma sessão já passaria uma de cada vez.
      const statuses = (
        await Promise.all([
          createTag(ana.cookie, weddingId, { name: 'Décima' }),
          createTag(juliana.cookie, weddingId, { name: 'Outra décima' }),
        ])
      )
        .map((response) => response.status)
        .sort();

      expect(statuses).toEqual([201, 409]);
      expect(await db.tag.count({ where: { weddingId, deletedAt: null } })).toBe(10);
    });

    it('RN02 - nome repetido sem diferenciar maiúsculas, ao criar e ao renomear; na lixeira, pode recriar', async () => {
      const { ana, weddingId } = await anaWedding();
      await createTag(ana.cookie, weddingId, { name: 'Padrinhos' }).expect(201);
      const igreja = await createTag(ana.cookie, weddingId, { name: 'Igreja' }).expect(201);

      expect(
        (await createTag(ana.cookie, weddingId, { name: 'padrinhos' }).expect(409)).body.error,
      ).toBe('TAG_NAME_TAKEN');
      expect(
        (await updateTag(ana.cookie, weddingId, igreja.body.id, { name: 'PADRINHOS' }).expect(409))
          .body.error,
      ).toBe('TAG_NAME_TAKEN');

      await db.tag.update({ where: { id: igreja.body.id }, data: { deletedAt: new Date() } });
      await createTag(ana.cookie, weddingId, { name: 'Igreja' }).expect(201);
    });

    it('RN02 e RN03 - nome com 41 caracteres, vazio ou cor fora da paleta dão 400 no campo', async () => {
      const { ana, weddingId } = await anaWedding();

      expect(
        (await createTag(ana.cookie, weddingId, { name: 'a'.repeat(41) }).expect(400)).body.errors,
      ).toEqual([{ path: 'name', code: 'MAX_LENGTH', params: { max: 40 } }]);
      expect(
        (await createTag(ana.cookie, weddingId, { name: '   ' }).expect(400)).body.errors,
      ).toEqual([{ path: 'name', code: 'IS_NOT_EMPTY', params: {} }]);
      for (const color of ['#123456', 'rose'])
        expect(
          (await createTag(ana.cookie, weddingId, { name: 'Vizinhos', color }).expect(400)).body
            .errors,
        ).toEqual([
          {
            path: 'color',
            code: 'IS_IN',
            params: { values: ['wine', 'champagne', 'green', 'amber', 'red', 'blue'] },
          },
        ]);
    });

    it('RN03 e RN06 - as cores de tag do Design System; renomear, trocar e tirar a cor', async () => {
      const { ana, weddingId } = await anaWedding();
      const tag = await createTag(ana.cookie, weddingId, {
        name: 'Trabalho da Ana',
        color: 'wine',
      }).expect(201);
      expect(tag.body.color).toBe('wine');

      const renamed = await updateTag(ana.cookie, weddingId, tag.body.id, {
        name: 'Trabalho',
        color: 'blue',
      }).expect(200);
      expect(renamed.body).toMatchObject({ name: 'Trabalho', color: 'blue' });

      const cleared = await updateTag(ana.cookie, weddingId, tag.body.id, { color: null }).expect(
        200,
      );
      expect(cleared.body).toMatchObject({ name: 'Trabalho', color: null });
    });

    it('RN02 - renomear com nome nulo ou vazio dá 400 em "name", e a tag não muda', async () => {
      const { ana, weddingId } = await anaWedding();
      const tag = await createTag(ana.cookie, weddingId, { name: 'Igreja' }).expect(201);

      for (const name of [null, '  '])
        expect(
          (await updateTag(ana.cookie, weddingId, tag.body.id, { name }).expect(400)).body.errors,
        ).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'name' })]));
      expect((await db.tag.findUniqueOrThrow({ where: { id: tag.body.id } })).name).toBe('Igreja');
    });

    it('RN06 - tag na lixeira, de outro casamento ou id inválido: 404 TAG_NOT_FOUND', async () => {
      const { ana, weddingId } = await anaWedding();
      const other = await anaWedding();
      const foreign = await createTag(other.ana.cookie, other.weddingId, { name: 'Outra' }).expect(
        201,
      );
      const trashed = await createTag(ana.cookie, weddingId, { name: 'Velha' }).expect(201);
      await db.tag.update({ where: { id: trashed.body.id }, data: { deletedAt: new Date() } });

      for (const tagId of [foreign.body.id, trashed.body.id, 'nao-e-uuid'])
        expect(
          (await updateTag(ana.cookie, weddingId, tagId, { name: 'X' }).expect(404)).body.error,
        ).toBe('TAG_NOT_FOUND');
    });
  });

  describe('Aplicar e contar (RN05, RN07, RN08, RN10)', () => {
    it('RN05 - a contagem junta grupo e convidado sem repetir, e a vaga vazia não conta', async () => {
      const { ana, weddingId } = await anaWedding();
      const familia = (await createTag(ana.cookie, weddingId, { name: 'Família da Ana' }))
        .body as Tag;
      const amigos = (await createTag(ana.cookie, weddingId, { name: 'Amigos da faculdade' }))
        .body as Tag;
      const moreira = await createParty(ana.cookie, weddingId, {
        name: 'Família Moreira',
        guests: [{ name: 'Luiz' }, { name: 'Célia' }, { name: 'Pedro' }],
        tagIds: [familia.id],
      });
      await db.guestTag.create({
        data: { weddingId, guestId: moreira.guests[2].id, tagId: familia.id },
      });
      const carla = await createParty(ana.cookie, weddingId, {
        name: 'Carla e Rafael',
        guests: [{ name: 'Carla' }, { name: 'Rafael' }],
        plusOneSlots: 2,
        tagIds: [amigos.id],
      });
      // Uma vaga ainda pendente e um "não vou levar": nenhuma das duas conta.
      await db.guest.update({
        where: { id: carla.guests[3].id },
        data: { rsvpStatus: 'declined' },
      });
      // Convidado na lixeira não conta.
      await db.guest.update({
        where: { id: moreira.guests[0].id },
        data: { deletedAt: new Date() },
      });

      const counts = Object.fromEntries(
        (await listTags(ana.cookie, weddingId)).data.map((tag) => [tag.name, tag.guests]),
      );
      expect(counts).toEqual({ 'Amigos da faculdade': 2, 'Família da Ana': 2 });
    });

    it('RN08 - aplica a tag a vários grupos numa gravação, sem repetir quem já tinha', async () => {
      const { ana, weddingId } = await anaWedding();
      const igreja = (await createTag(ana.cookie, weddingId, { name: 'Igreja' })).body as Tag;
      const parties = [
        await createParty(ana.cookie, weddingId, {
          name: 'A',
          guests: [{ name: 'Ana' }],
          tagIds: [igreja.id],
        }),
        await createParty(ana.cookie, weddingId, { name: 'B', guests: [{ name: 'Bia' }] }),
        await createParty(ana.cookie, weddingId, { name: 'C', guests: [{ name: 'Caio' }] }),
      ];

      const response = await apply(ana.cookie, weddingId, igreja.id, {
        partyIds: parties.map((party) => party.id),
      }).expect(200);

      expect(response.body).toEqual({ parties: 3 });
      expect(await db.partyTag.count({ where: { tagId: igreja.id } })).toBe(3);
      expect(
        (await apply(ana.cookie, weddingId, igreja.id, { partyIds: [parties[1].id] })).body,
      ).toEqual({
        parties: 1,
      });
    });

    it('RN08 - grupo de outro casamento ou na lixeira recusa o pedido inteiro, e nada é gravado', async () => {
      const { ana, weddingId } = await anaWedding();
      const other = await anaWedding();
      const igreja = (await createTag(ana.cookie, weddingId, { name: 'Igreja' })).body as Tag;
      const mine = await createParty(ana.cookie, weddingId, {
        name: 'A',
        guests: [{ name: 'Ana' }],
      });
      const trashed = await createParty(ana.cookie, weddingId, {
        name: 'T',
        guests: [{ name: 'T' }],
      });
      await db.party.update({ where: { id: trashed.id }, data: { deletedAt: new Date() } });
      const foreign = await createParty(other.ana.cookie, other.weddingId, {
        name: 'Outro',
        guests: [{ name: 'Outra' }],
      });

      const response = await apply(ana.cookie, weddingId, igreja.id, {
        partyIds: [mine.id, foreign.id, trashed.id],
      }).expect(400);

      expect(response.body.errors).toEqual([
        { path: 'partyIds.1', code: 'PARTY_NOT_FOUND', params: {} },
        { path: 'partyIds.2', code: 'PARTY_NOT_FOUND', params: {} },
      ]);
      expect(await db.partyTag.count({ where: { tagId: igreja.id } })).toBe(0);
    });

    it('RN08 - lista vazia, acima de 200 ou com guestIds dá 400; tag na lixeira dá 404', async () => {
      const { ana, weddingId } = await anaWedding();
      const igreja = (await createTag(ana.cookie, weddingId, { name: 'Igreja' })).body as Tag;
      const party = await createParty(ana.cookie, weddingId, {
        name: 'A',
        guests: [{ name: 'Ana' }],
      });

      await apply(ana.cookie, weddingId, igreja.id, { partyIds: [] }).expect(400);
      await apply(ana.cookie, weddingId, igreja.id, {
        partyIds: Array.from({ length: 201 }, () => party.id),
      }).expect(400);
      await apply(ana.cookie, weddingId, igreja.id, {
        partyIds: [party.id],
        guestIds: [party.guests[0].id],
      }).expect(400);
      await db.tag.update({ where: { id: igreja.id }, data: { deletedAt: new Date() } });
      expect(
        (await apply(ana.cookie, weddingId, igreja.id, { partyIds: [party.id] }).expect(404)).body
          .error,
      ).toBe('TAG_NOT_FOUND');
    });

    it('RN06 - a tag na lixeira some da lista de tags e do painel do grupo e do convidado', async () => {
      const { ana, weddingId } = await anaWedding();
      const igreja = (await createTag(ana.cookie, weddingId, { name: 'Igreja' })).body as Tag;
      const moreira = await createParty(ana.cookie, weddingId, {
        name: 'Família Moreira',
        guests: [{ name: 'Pedro Moreira' }],
        tagIds: [igreja.id],
      });
      await db.guestTag.create({
        data: { weddingId, guestId: moreira.guests[0].id, tagId: igreja.id },
      });
      await db.tag.update({ where: { id: igreja.id }, data: { deletedAt: new Date() } });

      const panel = await http()
        .get(`/v1/weddings/${weddingId}/parties/${moreira.id}`)
        .set('Cookie', ana.cookie)
        .expect(200);

      expect(await tagNames(ana.cookie, weddingId)).toEqual([]);
      expect(panel.body.tags).toEqual([]);
      expect(panel.body.guests[0].tags).toEqual([]);
    });

    it('RN10 - a cerimonialista cria e aplica tags, e Ana vê a tag e o grupo marcado; sem vínculo, não existe', async () => {
      const { ana, juliana, weddingId } = await anaWedding();
      const party = await createParty(ana.cookie, weddingId, {
        name: 'Buffet',
        guests: [{ name: 'Rita' }],
      });

      const tag = (await createTag(juliana.cookie, weddingId, { name: 'Fornecedores' }).expect(201))
        .body as Tag;
      await apply(juliana.cookie, weddingId, tag.id, { partyIds: [party.id] }).expect(200);

      expect((await listTags(ana.cookie, weddingId)).data).toMatchObject([
        { name: 'Fornecedores', guests: 1 },
      ]);
      const stranger = await signedInUser({ app, name: 'Estranha' });
      for (const response of [
        await http().get(`/v1/weddings/${weddingId}/tags`).set('Cookie', stranger.cookie),
        await createTag(stranger.cookie, weddingId, { name: 'X' }),
        await updateTag(stranger.cookie, weddingId, tag.id, { name: 'X' }),
        await apply(stranger.cookie, weddingId, tag.id, { partyIds: [party.id] }),
      ]) {
        expect(response.status).toBe(404);
        expect(response.body.error).toBe('WEDDING_NOT_FOUND');
      }
    });
  });
});
