import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

/** Editar grupo e Mover de grupo (Grupos RN06 a RN10 e RN16; banco real). */
describe('Editar e mover (banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  type Guest = { id: string; name: string | null; isPlusOne: boolean; rsvpStatus: string };
  type Party = { id: string; contactGuestId: string | null; guests: Guest[] };

  const http = () => request(app.getHttpServer());
  const create = async (cookie: string, weddingId: string, body: Record<string, unknown>) =>
    (
      await http()
        .post(`/v1/weddings/${weddingId}/parties`)
        .set('Cookie', cookie)
        .set('Origin', APP_ORIGIN)
        .send(body)
        .expect(201)
    ).body as Party;
  const patch = (
    cookie: string,
    weddingId: string,
    partyId: string,
    body: Record<string, unknown>,
  ) =>
    http()
      .patch(`/v1/weddings/${weddingId}/parties/${partyId}`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);
  const move = (cookie: string, weddingId: string, guestId: string, partyId: string) =>
    http()
      .post(`/v1/weddings/${weddingId}/guests/${guestId}/move`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send({ partyId });
  const get = async (cookie: string, weddingId: string, partyId: string) =>
    (
      await http()
        .get(`/v1/weddings/${weddingId}/parties/${partyId}`)
        .set('Cookie', cookie)
        .expect(200)
    ).body as Party & Record<string, unknown>;
  const stats = (weddingId: string) => db.weddingStats.findUniqueOrThrow({ where: { weddingId } });
  const party = (id: string) => db.party.findUniqueOrThrow({ where: { id } });
  const logs = (weddingId: string, action: string) =>
    db.applicationLog.findMany({ where: { weddingId, action } });

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

  /** Família Moreira (Luiz, Célia contato, Pedro com e-mail) e Padrinhos (Leonardo). */
  async function moreira() {
    const wedding = await anaWedding();
    const { ana, weddingId } = wedding;
    const familia = await create(ana.cookie, weddingId, {
      name: 'Família Moreira',
      guests: [
        { name: 'Luiz Moreira', ageGroup: 'adult' },
        { name: 'Célia Moreira', ageGroup: 'adult', phone: '19998763310' },
        { name: 'Pedro Moreira', ageGroup: 'child', email: 'pedro@exemplo.kore.local' },
      ],
    });
    const padrinhos = await create(ana.cookie, weddingId, {
      name: 'Padrinhos',
      guests: [{ name: 'Leonardo Castro' }],
    });
    const [luiz, celia, pedro] = familia.guests;
    return { ...wedding, familia, padrinhos, luiz, celia, pedro };
  }

  describe('Editar grupo (RN06, RN07, RN09, RN16)', () => {
    it('RN09 - edita o nome, o telefone e a observação; o painel mostra o novo', async () => {
      const { ana, weddingId, familia, celia } = await moreira();

      const response = await patch(ana.cookie, weddingId, familia.id, {
        name: 'Família Moreira Rocha',
        guests: [{ id: celia.id, phone: '(19) 99812-2076' }],
        internalNote: 'Pedro tem 7 anos e vai de pajem.',
      }).expect(200);

      expect(response.body).toMatchObject({
        name: 'Família Moreira Rocha',
        internalNote: 'Pedro tem 7 anos e vai de pajem.',
        guests: [{ name: 'Luiz Moreira' }, { name: 'Célia Moreira', phone: '+5519998122076' }, {}],
      });
      const cleared = await patch(ana.cookie, weddingId, familia.id, { internalNote: '' }).expect(
        200,
      );
      expect(cleared.body.internalNote).toBeNull();
    });

    it('RN09 e RN16 - + Adicionar convidado entra no fim dos com nome, pendente, e conta no casamento', async () => {
      const { ana, weddingId, familia } = await moreira();
      await patch(ana.cookie, weddingId, familia.id, { plusOneSlots: 1 }).expect(200);
      const before = await stats(weddingId);

      const response = await patch(ana.cookie, weddingId, familia.id, {
        guests: [{ name: 'Ana Clara Moreira', ageGroup: 'child' }],
      }).expect(200);

      expect((response.body as Party).guests.map((guest) => guest.name)).toEqual([
        'Luiz Moreira',
        'Célia Moreira',
        'Pedro Moreira',
        'Ana Clara Moreira',
        null,
      ]);
      expect(await stats(weddingId)).toMatchObject({
        guestsTotal: before.guestsTotal + 1,
        pending: before.pending + 1,
        partiesPending: before.partiesPending,
      });
    });

    it('RN09 - o convidado novo precisa de nome; id de outro grupo ou de uma vaga é recusado; nada é gravado', async () => {
      const { ana, weddingId, familia, padrinhos } = await moreira();
      await patch(ana.cookie, weddingId, familia.id, { plusOneSlots: 1 }).expect(200);
      const slot = (await get(ana.cookie, weddingId, familia.id)).guests[3];

      const response = await patch(ana.cookie, weddingId, familia.id, {
        name: 'Não grava',
        guests: [
          { ageGroup: 'adult' },
          { id: padrinhos.guests[0].id, name: 'Leo' },
          { id: slot.id, name: 'Bruno' },
          { id: familia.guests[0].id, phone: '9876-1402' },
        ],
      }).expect(400);

      expect(response.body.errors).toEqual([
        { path: 'guests.0.name', code: 'IS_NOT_EMPTY', params: {} },
        { path: 'guests.1.id', code: 'GUEST_NOT_IN_PARTY', params: {} },
        { path: 'guests.2.id', code: 'GUEST_NOT_IN_PARTY', params: {} },
        { path: 'guests.3.phone', code: 'PHONE_TOO_SHORT', params: { n: 8 } },
      ]);
      expect((await party(familia.id)).name).toBe('Família Moreira');
    });

    it('RN06 - trocar o contato à mão; contato sem telefone nem e-mail é recusado', async () => {
      const { ana, weddingId, familia, luiz, pedro } = await moreira();

      const ok = await patch(ana.cookie, weddingId, familia.id, {
        contactGuestId: pedro.id,
      }).expect(200);
      expect(ok.body.contactGuestId).toBe(pedro.id);

      const refused = await patch(ana.cookie, weddingId, familia.id, {
        contactGuestId: luiz.id,
      }).expect(400);
      expect(refused.body.errors).toEqual([
        { path: 'contactGuestId', code: 'CONTACT_WITHOUT_PHONE_OR_EMAIL', params: {} },
      ]);
    });

    it('RN06 - o contato que perde telefone e e-mail passa a vez; se ninguém mais tiver, o grupo fica sem contato', async () => {
      const { ana, weddingId, familia, celia, pedro } = await moreira();

      const first = await patch(ana.cookie, weddingId, familia.id, {
        guests: [{ id: celia.id, phone: null }],
      }).expect(200);
      expect(first.body.contactGuestId).toBe(pedro.id);

      const second = await patch(ana.cookie, weddingId, familia.id, {
        guests: [{ id: pedro.id, email: '' }],
      }).expect(200);
      expect(second.body.contactGuestId).toBeNull();
    });

    it('RN07 e RN16 - dar 2 vagas cria 2 acompanhantes pendentes; voltar a 0 devolve as contagens', async () => {
      const { ana, weddingId, padrinhos } = await moreira();
      const before = await stats(weddingId);

      const two = await patch(ana.cookie, weddingId, padrinhos.id, { plusOneSlots: 2 }).expect(200);
      expect(two.body.plusOneSlots).toBe(2);
      expect((two.body as Party).guests.slice(1)).toMatchObject([
        { name: null, isPlusOne: true, rsvpStatus: 'pending' },
        { name: null, isPlusOne: true, rsvpStatus: 'pending' },
      ]);
      expect(await stats(weddingId)).toMatchObject({
        guestsTotal: before.guestsTotal + 2,
        pending: before.pending + 2,
      });

      await patch(ana.cookie, weddingId, padrinhos.id, { plusOneSlots: 0 }).expect(200);
      expect(await stats(weddingId)).toMatchObject({
        guestsTotal: before.guestsTotal,
        pending: before.pending,
      });
      expect((await party(padrinhos.id)).plusOneSlots).toBe(0);
    });

    it('RN07 - diminuir tira só a vaga vazia; abaixo das respondidas, 409 PLUS_ONES_IN_USE', async () => {
      const { ana, weddingId, padrinhos } = await moreira();
      const two = await patch(ana.cookie, weddingId, padrinhos.id, { plusOneSlots: 2 }).expect(200);
      // Uma vaga respondeu "não vou levar" (Fase 4).
      await db.guest.update({
        where: { id: (two.body as Party).guests[1].id },
        data: { rsvpStatus: 'declined' },
      });

      const one = await patch(ana.cookie, weddingId, padrinhos.id, { plusOneSlots: 1 }).expect(200);
      expect((one.body as Party).guests.slice(1)).toMatchObject([{ rsvpStatus: 'declined' }]);

      const refused = await patch(ana.cookie, weddingId, padrinhos.id, { plusOneSlots: 0 }).expect(
        409,
      );
      expect(refused.body).toMatchObject({ error: 'PLUS_ONES_IN_USE', inUse: 1 });
    });

    it('RN09 e RN16 - editar quem já respondeu mantém a resposta, move a faixa etária confirmada e o log leva só os nomes dos campos', async () => {
      const { ana, weddingId, familia, pedro } = await moreira();
      await db.guest.update({ where: { id: pedro.id }, data: { rsvpStatus: 'confirmed' } });
      await db.weddingStats.update({
        where: { weddingId },
        data: { confirmed: { increment: 1 }, pending: { decrement: 1 }, childrenConfirmed: 1 },
      });

      const response = await patch(ana.cookie, weddingId, familia.id, {
        guests: [{ id: pedro.id, email: 'pedro.m@exemplo.kore.local', ageGroup: 'adult' }],
      }).expect(200);

      expect((response.body as Party).guests[2]).toMatchObject({ rsvpStatus: 'confirmed' });
      expect(await stats(weddingId)).toMatchObject({ childrenConfirmed: 0, adultsConfirmed: 1 });
      const [log] = await logs(weddingId, 'guest.updated');
      expect(log).toMatchObject({
        entityType: 'guest',
        entityId: pedro.id,
        data: { partyId: familia.id, fields: ['ageGroup', 'email'] },
      });
      expect(JSON.stringify(log)).not.toContain('exemplo.kore.local');
    });

    it('RN09 - editar quem está pendente não vai para o log', async () => {
      const { ana, weddingId, familia, celia } = await moreira();

      await patch(ana.cookie, weddingId, familia.id, {
        guests: [{ id: celia.id, name: 'Célia M.' }],
      }).expect(200);

      expect(await logs(weddingId, 'guest.updated')).toEqual([]);
    });

    it('Tags RN07 - substitui as tags do grupo e as do convidado', async () => {
      const { ana, weddingId, familia, pedro } = await moreira();
      const [familiaDaAna, pajens] = await Promise.all([
        db.tag.create({ data: { weddingId, name: 'Família da Ana' } }),
        db.tag.create({ data: { weddingId, name: 'Pajens' } }),
      ]);

      const response = await patch(ana.cookie, weddingId, familia.id, {
        tagIds: [familiaDaAna.id],
        guests: [{ id: pedro.id, tagIds: [pajens.id] }],
      }).expect(200);
      expect(response.body.tags).toMatchObject([{ name: 'Família da Ana' }]);
      expect(response.body.guests[2].tags).toMatchObject([{ name: 'Pajens' }]);

      const cleared = await patch(ana.cookie, weddingId, familia.id, {
        tagIds: [],
        guests: [{ id: pedro.id, tagIds: [] }],
      }).expect(200);
      expect(cleared.body.tags).toEqual([]);
      expect(cleared.body.guests[2].tags).toEqual([]);
    });

    it('RN09 - grupo na lixeira ou de outro casamento: 404 PARTY_NOT_FOUND', async () => {
      const { ana, weddingId, familia } = await moreira();
      const other = await anaWedding();
      const foreign = await create(other.ana.cookie, other.weddingId, {
        name: 'Outro',
        guests: [{ name: 'Outra' }],
      });
      await db.party.update({ where: { id: familia.id }, data: { deletedAt: new Date() } });

      for (const partyId of [familia.id, foreign.id])
        expect(
          (await patch(ana.cookie, weddingId, partyId, { name: 'X' }).expect(404)).body.error,
        ).toBe('PARTY_NOT_FOUND');
    });
  });

  describe('Mover de grupo (RN06, RN08, RN10, RN16)', () => {
    it('RN10 - mantém a resposta e as tags, e o movido entra no fim dos com nome do destino, antes das vagas', async () => {
      const { ana, weddingId, padrinhos, pedro } = await moreira();
      const pajens = await db.tag.create({ data: { weddingId, name: 'Pajens' } });
      await db.guestTag.create({ data: { weddingId, guestId: pedro.id, tagId: pajens.id } });
      await db.guest.update({ where: { id: pedro.id }, data: { rsvpStatus: 'confirmed' } });
      await patch(ana.cookie, weddingId, padrinhos.id, { plusOneSlots: 1 }).expect(200);

      const response = await move(ana.cookie, weddingId, pedro.id, padrinhos.id).expect(200);

      expect(response.body).toMatchObject({ guestId: pedro.id, toPartyId: padrinhos.id });
      const destination = await get(ana.cookie, weddingId, padrinhos.id);
      expect(destination.guests.map((guest) => guest.name)).toEqual([
        'Leonardo Castro',
        'Pedro Moreira',
        null,
      ]);
      expect(destination.guests[1]).toMatchObject({
        rsvpStatus: 'confirmed',
        tags: [{ name: 'Pajens' }],
      });
    });

    it('RN16 - mover muda só os grupos pendentes', async () => {
      const { ana, weddingId, familia, padrinhos, luiz, celia, pedro } = await moreira();
      // Na Família Moreira só Pedro está pendente; Padrinhos não tem pendente.
      await db.guest.updateMany({
        where: { id: { in: [luiz.id, celia.id, padrinhos.guests[0].id] } },
        data: { rsvpStatus: 'confirmed' },
      });
      await db.party.updateMany({
        where: { id: { in: [familia.id, padrinhos.id] } },
        data: { deliveryStatus: 'viewed', firstViewedAt: new Date() },
      });
      await db.party.update({ where: { id: padrinhos.id }, data: { deliveryStatus: 'responded' } });
      await db.weddingStats.update({ where: { weddingId }, data: { partiesPending: 1 } });
      const before = await stats(weddingId);

      await move(ana.cookie, weddingId, pedro.id, padrinhos.id).expect(200);

      expect(await stats(weddingId)).toMatchObject({
        guestsTotal: before.guestsTotal,
        pending: before.pending,
        partiesPending: 1,
      });
      // RN10: o status de envio dos dois grupos é recalculado (decisão 199(1)).
      expect((await party(familia.id)).deliveryStatus).toBe('responded');
      expect((await party(padrinhos.id)).deliveryStatus).toBe('viewed');
    });

    it('RN06 - o contato sai e o próximo com contato assume; o movido vira contato de um grupo sem contato', async () => {
      const { ana, weddingId, familia, celia, pedro } = await moreira();
      const helena = await create(ana.cookie, weddingId, {
        name: 'Vó Helena',
        guests: [{ name: 'Helena Moreira' }],
      });

      await move(ana.cookie, weddingId, celia.id, helena.id).expect(200);
      expect((await party(familia.id)).contactGuestId).toBe(pedro.id);
      expect((await party(helena.id)).contactGuestId).toBe(celia.id);

      const vh = await get(ana.cookie, weddingId, helena.id);
      expect(vh.guests.map((guest) => guest.name)).toEqual(['Helena Moreira', 'Célia Moreira']);
    });

    it('RN10 - o acompanhante com nome vira convidado comum no destino; a origem perde a vaga e o destino não ganha', async () => {
      const { ana, weddingId, padrinhos } = await moreira();
      const carla = await create(ana.cookie, weddingId, {
        name: 'Carla e Rafael',
        guests: [{ name: 'Carla Nunes' }],
        plusOneSlots: 2,
      });
      await patch(ana.cookie, weddingId, padrinhos.id, { plusOneSlots: 5 }).expect(200);
      // Bruno preencheu uma vaga no RSVP (Fase 4).
      const bruno = carla.guests[1];
      await db.guest.update({
        where: { id: bruno.id },
        data: { name: 'Bruno Lima', rsvpStatus: 'confirmed' },
      });

      await move(ana.cookie, weddingId, bruno.id, padrinhos.id).expect(200);

      expect(await db.guest.findUniqueOrThrow({ where: { id: bruno.id } })).toMatchObject({
        partyId: padrinhos.id,
        isPlusOne: false,
        rsvpStatus: 'confirmed',
      });
      expect((await party(carla.id)).plusOneSlots).toBe(1);
      expect((await party(padrinhos.id)).plusOneSlots).toBe(5);
    });

    it('RN08 - o último convidado com nome não sai do grupo (dona e cerimonialista)', async () => {
      const { ana, juliana, weddingId, padrinhos, familia } = await moreira();
      await patch(ana.cookie, weddingId, padrinhos.id, { plusOneSlots: 1 }).expect(200);

      for (const cookie of [ana.cookie, juliana.cookie])
        expect(
          (await move(cookie, weddingId, padrinhos.guests[0].id, familia.id).expect(409)).body
            .error,
        ).toBe('LAST_GUEST');
    });

    it('RN10 - vaga vazia não se move (409 EMPTY_PLUS_ONE)', async () => {
      const { ana, weddingId, padrinhos, familia } = await moreira();
      const withSlot = await patch(ana.cookie, weddingId, familia.id, { plusOneSlots: 1 }).expect(
        200,
      );

      const response = await move(
        ana.cookie,
        weddingId,
        (withSlot.body as Party).guests[3].id,
        padrinhos.id,
      ).expect(409);

      expect(response.body.error).toBe('EMPTY_PLUS_ONE');
    });

    it('RN10 - destino igual, de outro casamento ou na lixeira: 400; convidado de outro casamento ou na lixeira: 404', async () => {
      const { ana, weddingId, familia, padrinhos, luiz, celia } = await moreira();
      const other = await anaWedding();
      const foreign = await create(other.ana.cookie, other.weddingId, {
        name: 'Outro',
        guests: [{ name: 'Outra' }, { name: 'Outro' }],
      });
      await db.party.update({ where: { id: padrinhos.id }, data: { deletedAt: new Date() } });

      expect(
        (await move(ana.cookie, weddingId, luiz.id, familia.id).expect(400)).body.errors,
      ).toEqual([{ path: 'partyId', code: 'SAME_PARTY', params: {} }]);
      for (const partyId of [foreign.id, padrinhos.id])
        expect(
          (await move(ana.cookie, weddingId, luiz.id, partyId).expect(400)).body.errors,
        ).toEqual([{ path: 'partyId', code: 'PARTY_NOT_FOUND', params: {} }]);
      await db.guest.update({ where: { id: celia.id }, data: { deletedAt: new Date() } });
      for (const guestId of [foreign.guests[0].id, celia.id, 'nao-e-uuid'])
        expect(
          (await move(ana.cookie, weddingId, guestId, familia.id).expect(404)).body.error,
        ).toBe('GUEST_NOT_FOUND');
    });

    it('RN09 e RN10 - mover quem já respondeu vai para o log só com ids; pendente não vai', async () => {
      const { ana, juliana, weddingId, familia, padrinhos, luiz, celia } = await moreira();
      await db.guest.update({ where: { id: celia.id }, data: { rsvpStatus: 'confirmed' } });

      await move(juliana.cookie, weddingId, celia.id, padrinhos.id).expect(200);
      await move(ana.cookie, weddingId, luiz.id, padrinhos.id).expect(200);

      const moved = await logs(weddingId, 'guest.moved');
      expect(moved).toHaveLength(1);
      expect(moved[0]).toMatchObject({
        actorUserId: juliana.userId,
        entityType: 'guest',
        entityId: celia.id,
        data: { fromPartyId: familia.id, toPartyId: padrinhos.id },
      });
      expect(JSON.stringify(moved[0])).not.toMatch(/Célia|998763310/);
    });
  });
});
