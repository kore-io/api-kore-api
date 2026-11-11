import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

/** Lixeira de convidados: mandar, listar e restaurar (banco real). */
describe('Lixeira de convidados (banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  type Guest = { id: string; name: string | null };
  type Party = { id: string; name: string; contactGuestId: string | null; guests: Guest[] };
  type TrashItem = { type: string; id: string; name: string; guests?: number; partyName?: string };

  const http = () => request(app.getHttpServer());
  const send = (method: 'post' | 'delete', url: string, cookie: string, body?: object) =>
    http()[method](url).set('Cookie', cookie).set('Origin', APP_ORIGIN).send(body);
  const createParty = async (cookie: string, weddingId: string, body: object) =>
    (await send('post', `/v1/weddings/${weddingId}/parties`, cookie, body).expect(201))
      .body as Party;
  const trashParty = (cookie: string, weddingId: string, partyId: string) =>
    send('delete', `/v1/weddings/${weddingId}/parties/${partyId}`, cookie);
  const trashParties = (cookie: string, weddingId: string, partyIds: string[]) =>
    send('post', `/v1/weddings/${weddingId}/parties/trash`, cookie, { partyIds });
  const trashGuest = (cookie: string, weddingId: string, guestId: string) =>
    send('delete', `/v1/weddings/${weddingId}/guests/${guestId}`, cookie);
  const trashTag = (cookie: string, weddingId: string, tagId: string) =>
    send('delete', `/v1/weddings/${weddingId}/tags/${tagId}`, cookie);
  const restore = (cookie: string, weddingId: string, type: string, id: string) =>
    send('post', `/v1/weddings/${weddingId}/trash/restore`, cookie, { type, id });
  const listTrash = async (cookie: string, weddingId: string) =>
    (await http().get(`/v1/weddings/${weddingId}/trash`).set('Cookie', cookie).expect(200)).body
      .data as TrashItem[];
  const getParty = (cookie: string, weddingId: string, partyId: string) =>
    http().get(`/v1/weddings/${weddingId}/parties/${partyId}`).set('Cookie', cookie);
  const stats = (weddingId: string) => db.weddingStats.findUniqueOrThrow({ where: { weddingId } });
  const logs = (weddingId: string, action: string) =>
    db.applicationLog.findMany({ where: { weddingId, action }, orderBy: { createdAt: 'asc' } });

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

  /** Família Moreira: Luiz, Célia (contato, com telefone), Pedro (com e-mail) e 1 vaga. */
  async function moreira() {
    const wedding = await anaWedding();
    const familia = await createParty(wedding.ana.cookie, wedding.weddingId, {
      name: 'Família Moreira',
      guests: [
        { name: 'Luiz Moreira' },
        { name: 'Célia Moreira', phone: '19998763310' },
        { name: 'Pedro Moreira', email: 'pedro@exemplo.kore.local' },
      ],
      plusOneSlots: 1,
    });
    const [luiz, celia, pedro, slot] = familia.guests;
    return { ...wedding, familia, luiz, celia, pedro, slot };
  }

  describe('Mandar para a lixeira (RN01, RN03, RN04, RN05, RN06, RN11)', () => {
    it('RN01, RN03 e RN11 - o grupo vai com os convidados e a vaga, o mesmo trashBatchId, os números e o log só com ids', async () => {
      const { ana, weddingId, familia } = await moreira();

      const response = await trashParty(ana.cookie, weddingId, familia.id).expect(200);

      expect(response.body).toMatchObject({ id: familia.id, name: 'Família Moreira', guests: 3 });
      expect(response.body.purgeAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const guests = await db.guest.findMany({ where: { partyId: familia.id } });
      expect(guests.every((guest) => guest.deletedAt !== null)).toBe(true);
      expect(new Set(guests.map((guest) => guest.trashBatchId)).size).toBe(1);
      expect(await stats(weddingId)).toMatchObject({
        guestsTotal: 0,
        pending: 0,
        partiesPending: 0,
      });
      const [log] = await logs(weddingId, 'party.deleted');
      expect(log).toMatchObject({
        entityType: 'party',
        entityId: familia.id,
        actorUserId: ana.userId,
      });
      expect(JSON.stringify(log)).not.toContain('Moreira');
      await getParty(ana.cookie, weddingId, familia.id).expect(404);
    });

    it('RN04 - o convidado vai sozinho, e o contato passa ao próximo; o último com nome não vai; vaga vazia não vai', async () => {
      const { ana, weddingId, familia, luiz, celia, pedro, slot } = await moreira();

      const response = await trashGuest(ana.cookie, weddingId, celia.id).expect(200);

      expect(response.body).toMatchObject({
        id: celia.id,
        name: 'Célia Moreira',
        partyId: familia.id,
      });
      expect((await db.party.findUniqueOrThrow({ where: { id: familia.id } })).contactGuestId).toBe(
        pedro.id,
      );
      expect(await stats(weddingId)).toMatchObject({ guestsTotal: 3, pending: 3 });
      expect((await trashGuest(ana.cookie, weddingId, slot.id).expect(409)).body.error).toBe(
        'EMPTY_PLUS_ONE',
      );
      await trashGuest(ana.cookie, weddingId, luiz.id).expect(200);
      expect((await trashGuest(ana.cookie, weddingId, pedro.id).expect(409)).body.error).toBe(
        'LAST_GUEST',
      );
      const [log] = await logs(weddingId, 'guest.deleted');
      expect(log).toMatchObject({ entityId: celia.id, data: { partyId: familia.id } });
    });

    it('RN04 - o acompanhante com nome leva a vaga para a lixeira', async () => {
      const { ana, weddingId, familia, slot } = await moreira();
      await db.guest.update({
        where: { id: slot.id },
        data: { name: 'Bruno Lima', rsvpStatus: 'confirmed' },
      });

      await trashGuest(ana.cookie, weddingId, slot.id).expect(200);

      expect((await db.party.findUniqueOrThrow({ where: { id: familia.id } })).plusOneSlots).toBe(
        0,
      );
    });

    it('RN05 - excluir a tag a tira dos grupos e convidados, guarda os vínculos e libera o limite', async () => {
      const { ana, weddingId, familia, pedro } = await moreira();
      const igreja = await db.tag.create({ data: { weddingId, name: 'Igreja' } });
      await db.partyTag.create({ data: { weddingId, partyId: familia.id, tagId: igreja.id } });
      await db.guestTag.create({ data: { weddingId, guestId: pedro.id, tagId: igreja.id } });

      const response = await trashTag(ana.cookie, weddingId, igreja.id).expect(200);

      expect(response.body).toMatchObject({ name: 'Igreja', guests: 3 });
      const panel = (await getParty(ana.cookie, weddingId, familia.id).expect(200)).body as {
        tags: unknown[];
        guests: { tags: unknown[] }[];
      };
      expect(panel.tags).toEqual([]);
      expect(panel.guests[2].tags).toEqual([]);
      expect(await db.partyTag.count({ where: { tagId: igreja.id } })).toBe(1);
      expect(await db.guestTag.count({ where: { tagId: igreja.id } })).toBe(1);
      expect((await trashTag(ana.cookie, weddingId, igreja.id).expect(404)).body.error).toBe(
        'TAG_NOT_FOUND',
      );
      expect(await logs(weddingId, 'tag.deleted')).toHaveLength(1);
    });

    it('RN06 - vários grupos de uma vez, cada um com o seu trashBatchId; um id inválido não grava nada', async () => {
      const { ana, weddingId } = await anaWedding();
      const other = await anaWedding();
      const parties = [
        await createParty(ana.cookie, weddingId, { name: 'A', guests: [{ name: 'Ana' }] }),
        await createParty(ana.cookie, weddingId, { name: 'B', guests: [{ name: 'Bia' }] }),
      ];
      const foreign = await createParty(other.ana.cookie, other.weddingId, {
        name: 'Outro',
        guests: [{ name: 'Outra' }],
      });

      const refused = await trashParties(ana.cookie, weddingId, [parties[0].id, foreign.id]).expect(
        400,
      );
      expect(refused.body.errors).toEqual([
        { path: 'partyIds.1', code: 'PARTY_NOT_FOUND', params: {} },
      ]);
      expect(await db.party.count({ where: { weddingId, deletedAt: { not: null } } })).toBe(0);

      const ok = await trashParties(
        ana.cookie,
        weddingId,
        parties.map((party) => party.id),
      ).expect(200);
      expect(ok.body).toEqual({ trashed: 2, skipped: [] });
      const batches = await db.guest.findMany({
        where: { weddingId },
        select: { trashBatchId: true },
      });
      expect(new Set(batches.map((guest) => guest.trashBatchId)).size).toBe(2);
    });
  });

  describe('Quem pode (RN07)', () => {
    it('RN07 - a cerimonialista não manda para a lixeira grupo nem convidado que respondeu; a dona manda', async () => {
      const { ana, juliana, weddingId, familia, pedro } = await moreira();
      await db.guest.update({ where: { id: pedro.id }, data: { rsvpStatus: 'confirmed' } });

      expect((await trashGuest(juliana.cookie, weddingId, pedro.id).expect(403)).body.error).toBe(
        'ALREADY_RESPONDED',
      );
      expect((await trashParty(juliana.cookie, weddingId, familia.id).expect(403)).body.error).toBe(
        'ALREADY_RESPONDED',
      );
      await trashGuest(ana.cookie, weddingId, pedro.id).expect(200);
    });

    it('RN07 - na seleção múltipla, os que responderam ficam e voltam em skipped', async () => {
      const { juliana, weddingId, familia, pedro, ana } = await moreira();
      const amigos = await createParty(ana.cookie, weddingId, {
        name: 'Amigos do vôlei',
        guests: [{ name: 'Rita' }],
      });
      await db.guest.update({ where: { id: pedro.id }, data: { rsvpStatus: 'declined' } });

      const response = await trashParties(juliana.cookie, weddingId, [
        familia.id,
        amigos.id,
      ]).expect(200);

      expect(response.body).toEqual({
        trashed: 1,
        skipped: [{ id: familia.id, name: 'Família Moreira', reason: 'ALREADY_RESPONDED' }],
      });
    });

    it('RN07 - a cerimonialista manda grupo sem resposta, exclui tag e restaura', async () => {
      const { juliana, weddingId, familia } = await moreira();
      const tag = await db.tag.create({ data: { weddingId, name: 'Vizinhos' } });

      await trashParty(juliana.cookie, weddingId, familia.id).expect(200);
      await trashTag(juliana.cookie, weddingId, tag.id).expect(200);
      await restore(juliana.cookie, weddingId, 'party', familia.id).expect(200);
    });
  });

  describe('Lixeira e restaurar (RN08, RN09, RN11)', () => {
    it('RN08 - a Lixeira mostra grupo, convidado e tag, do mais novo para o mais antigo; quem foi com o grupo fica dentro dele', async () => {
      const { ana, weddingId } = await anaWedding();
      const rocha = await createParty(ana.cookie, weddingId, {
        name: 'Família Rocha',
        guests: [{ name: 'Antônio Rocha' }, { name: 'Bruno Lima' }],
      });
      const amigos = await createParty(ana.cookie, weddingId, {
        name: 'Amigos do vôlei',
        guests: [{ name: 'Rita' }, { name: 'Caio' }],
      });
      const vizinhos = await db.tag.create({ data: { weddingId, name: 'Vizinhos' } });
      await trashTag(ana.cookie, weddingId, vizinhos.id).expect(200);
      await trashGuest(ana.cookie, weddingId, rocha.guests[1].id).expect(200);
      await trashParty(ana.cookie, weddingId, amigos.id).expect(200);
      // Passou do purgeAt, mas não foi expurgado: continua visível (RN08).
      await db.tag.update({
        where: { id: vizinhos.id },
        data: { deletedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) },
      });

      const items = await listTrash(ana.cookie, weddingId);

      expect(items).toMatchObject([
        { type: 'party', name: 'Amigos do vôlei', guests: 2 },
        { type: 'guest', name: 'Bruno Lima', partyName: 'Família Rocha' },
        { type: 'tag', name: 'Vizinhos', guests: 0 },
      ]);
    });

    it('RN01, RN09 e RN11 - restaurar o grupo devolve as respostas, as tags, as vagas, o link e os números', async () => {
      const { ana, weddingId, familia, pedro } = await moreira();
      const tag = await db.tag.create({ data: { weddingId, name: 'Família da Ana' } });
      await db.partyTag.create({ data: { weddingId, partyId: familia.id, tagId: tag.id } });
      await db.guest.update({ where: { id: pedro.id }, data: { rsvpStatus: 'confirmed' } });
      await db.weddingStats.update({
        where: { weddingId },
        data: { confirmed: 1, pending: { decrement: 1 } },
      });
      const before = await stats(weddingId);
      const linkBefore = await db.party.findUniqueOrThrow({ where: { id: familia.id } });
      await trashParty(ana.cookie, weddingId, familia.id).expect(200);

      const response = await restore(ana.cookie, weddingId, 'party', familia.id).expect(200);

      expect(response.body).toEqual({ type: 'party', id: familia.id, name: 'Família Moreira' });
      const panel = (await getParty(ana.cookie, weddingId, familia.id).expect(200))
        .body as Party & {
        tags: { name: string }[];
        plusOneSlots: number;
        guests: (Guest & { rsvpStatus: string })[];
      };
      expect(panel.guests).toHaveLength(4);
      expect(panel.guests[2]).toMatchObject({ name: 'Pedro Moreira', rsvpStatus: 'confirmed' });
      expect(panel.tags).toMatchObject([{ name: 'Família da Ana' }]);
      expect(panel.plusOneSlots).toBe(1);
      const linkAfter = await db.party.findUniqueOrThrow({ where: { id: familia.id } });
      expect([linkAfter.linkToken, linkAfter.linkVersion]).toEqual([
        linkBefore.linkToken,
        linkBefore.linkVersion,
      ]);
      expect(await stats(weddingId)).toMatchObject({
        guestsTotal: before.guestsTotal,
        confirmed: before.confirmed,
        pending: before.pending,
        partiesPending: before.partiesPending,
      });
      expect(await logs(weddingId, 'party.restored')).toMatchObject([{ entityId: familia.id }]);
    });

    it('RN03 e RN09 - quem foi sozinho antes não volta com o grupo; restaurar o convidado traz o grupo junto', async () => {
      const { ana, weddingId, familia, luiz } = await moreira();
      await trashGuest(ana.cookie, weddingId, luiz.id).expect(200);
      await trashParty(ana.cookie, weddingId, familia.id).expect(200);

      await restore(ana.cookie, weddingId, 'party', familia.id).expect(200);
      expect(
        (await db.guest.findUniqueOrThrow({ where: { id: luiz.id } })).deletedAt,
      ).not.toBeNull();

      await trashParty(ana.cookie, weddingId, familia.id).expect(200);
      const response = await restore(ana.cookie, weddingId, 'guest', luiz.id).expect(200);

      expect(response.body).toEqual({
        type: 'guest',
        id: luiz.id,
        name: 'Luiz Moreira',
        restoredParty: { id: familia.id, name: 'Família Moreira' },
      });
      const panel = (await getParty(ana.cookie, weddingId, familia.id).expect(200)).body as Party;
      expect(panel.guests.map((guest) => guest.name)).toEqual([
        'Luiz Moreira',
        'Célia Moreira',
        'Pedro Moreira',
        null,
      ]);
      expect((await stats(weddingId)).guestsTotal).toBe(4);
    });

    it('RN09 - o restaurado só volta a ser contato se o grupo estiver sem contato', async () => {
      const { ana, weddingId, familia, celia, pedro } = await moreira();
      await trashGuest(ana.cookie, weddingId, celia.id).expect(200);

      await restore(ana.cookie, weddingId, 'guest', celia.id).expect(200);
      expect((await db.party.findUniqueOrThrow({ where: { id: familia.id } })).contactGuestId).toBe(
        pedro.id,
      );

      await db.party.update({ where: { id: familia.id }, data: { contactGuestId: null } });
      await db.guest.update({ where: { id: pedro.id }, data: { email: null } });
      await trashGuest(ana.cookie, weddingId, celia.id).expect(200);
      await restore(ana.cookie, weddingId, 'guest', celia.id).expect(200);
      expect((await db.party.findUniqueOrThrow({ where: { id: familia.id } })).contactGuestId).toBe(
        celia.id,
      );
    });

    it('RN09 - o acompanhante com nome volta como convidado comum, sem mudar as vagas', async () => {
      const { ana, weddingId, familia, slot } = await moreira();
      await db.guest.update({ where: { id: slot.id }, data: { name: 'Bruno Lima' } });
      await trashGuest(ana.cookie, weddingId, slot.id).expect(200);

      await restore(ana.cookie, weddingId, 'guest', slot.id).expect(200);

      expect(await db.guest.findUniqueOrThrow({ where: { id: slot.id } })).toMatchObject({
        isPlusOne: false,
        deletedAt: null,
      });
      expect((await db.party.findUniqueOrThrow({ where: { id: familia.id } })).plusOneSlots).toBe(
        0,
      );
    });

    it('RN05 e RN09 - restaurar a tag devolve os vínculos; com 10 tags ou nome repetido, recusa', async () => {
      const { ana, weddingId, familia } = await moreira();
      const igreja = await db.tag.create({ data: { weddingId, name: 'Igreja' } });
      await db.partyTag.create({ data: { weddingId, partyId: familia.id, tagId: igreja.id } });
      await trashTag(ana.cookie, weddingId, igreja.id).expect(200);
      const novaIgreja = await db.tag.create({ data: { weddingId, name: 'IGREJA' } });

      const taken = await restore(ana.cookie, weddingId, 'tag', igreja.id).expect(409);
      expect(taken.body).toMatchObject({ error: 'TAG_NAME_TAKEN', conflictName: 'IGREJA' });

      await db.tag.update({ where: { id: novaIgreja.id }, data: { name: 'Igreja Matriz' } });
      await db.tag.createMany({
        data: Array.from({ length: 9 }, (_, i) => ({ weddingId, name: `Tag ${i}` })),
      });
      expect((await restore(ana.cookie, weddingId, 'tag', igreja.id).expect(409)).body.error).toBe(
        'TAG_LIMIT_REACHED',
      );

      await db.tag.deleteMany({ where: { weddingId, name: { startsWith: 'Tag ' } } });
      await restore(ana.cookie, weddingId, 'tag', igreja.id).expect(200);
      const panel = (await getParty(ana.cookie, weddingId, familia.id).expect(200)).body as {
        tags: { name: string }[];
      };
      expect(panel.tags).toMatchObject([{ name: 'Igreja' }]);
      expect(await logs(weddingId, 'tag.restored')).toHaveLength(1);
    });

    it('RN09 - grupo com o nome de um grupo ativo restaura', async () => {
      const { ana, weddingId, familia } = await moreira();
      await trashParty(ana.cookie, weddingId, familia.id).expect(200);
      await createParty(ana.cookie, weddingId, {
        name: 'Família Moreira',
        guests: [{ name: 'Outra' }],
      });

      await restore(ana.cookie, weddingId, 'party', familia.id).expect(200);
    });

    it('RN09 - item que não está na lixeira, de outro casamento ou que foi junto com o grupo: 404; tipo fora da lista: 400', async () => {
      const { ana, weddingId, familia, celia } = await moreira();
      const other = await anaWedding();
      const foreign = await createParty(other.ana.cookie, other.weddingId, {
        name: 'Outro',
        guests: [{ name: 'Outra' }],
      });
      await trashParty(other.ana.cookie, other.weddingId, foreign.id).expect(200);

      for (const [type, id] of [
        ['party', familia.id],
        ['party', foreign.id],
      ])
        expect((await restore(ana.cookie, weddingId, type, id).expect(404)).body.error).toBe(
          'TRASH_ITEM_NOT_FOUND',
        );
      await trashParty(ana.cookie, weddingId, familia.id).expect(200);
      expect((await restore(ana.cookie, weddingId, 'guest', celia.id).expect(404)).body.error).toBe(
        'TRASH_ITEM_NOT_FOUND',
      );
      await restore(ana.cookie, weddingId, 'gift', familia.id).expect(400);
    });

    it('RN12 - sem vínculo, a lixeira não existe', async () => {
      const { weddingId, familia } = await moreira();
      const stranger = await signedInUser({ app, name: 'Estranha' });

      for (const response of [
        await http().get(`/v1/weddings/${weddingId}/trash`).set('Cookie', stranger.cookie),
        await trashParty(stranger.cookie, weddingId, familia.id),
        await restore(stranger.cookie, weddingId, 'party', familia.id),
      ]) {
        expect(response.status).toBe(404);
        expect(response.body.error).toBe('WEDDING_NOT_FOUND');
      }
    });
  });
});
