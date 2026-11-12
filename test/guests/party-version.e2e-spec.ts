import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

/**
 * A versão do grupo nos casos de uso da F1 (RSVP RN11; decisão 216, D11): o
 * que muda o formulário de RSVP sobe a Party.version, e o PUT do RSVP com a
 * versão velha recebe 409 RSVP_CHANGED (PR do RSVP). Banco real.
 */
describe('Versão do grupo (RSVP RN11; banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  type Guest = { id: string; name: string | null; isPlusOne: boolean };
  type Party = { id: string; guests: Guest[] };

  const http = () => request(app.getHttpServer());
  const send = (call: request.Test, cookie: string) =>
    call.set('Cookie', cookie).set('Origin', APP_ORIGIN);
  const version = async (id: string) =>
    (await db.party.findUniqueOrThrow({ where: { id } })).version;

  /** Família Moreira (Célia, Luiz, Pedro, 1 vaga) e Padrinhos (Leonardo). */
  async function scenario() {
    const ana = await signedInUser({ app, name: 'Ana' });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    const create = async (body: Record<string, unknown>) =>
      (
        await send(http().post(`/v1/weddings/${weddingId}/parties`), ana.cookie)
          .send(body)
          .expect(201)
      ).body as Party;
    const moreira = await create({
      name: 'Família Moreira',
      guests: [{ name: 'Célia Moreira' }, { name: 'Luiz Moreira' }, { name: 'Pedro Moreira' }],
      plusOneSlots: 1,
    });
    const padrinhos = await create({ name: 'Padrinhos', guests: [{ name: 'Leonardo Prado' }] });
    const guest = (name: string) => moreira.guests.find((item) => item.name === name)!;
    const patch = (body: Record<string, unknown>) =>
      send(http().patch(`/v1/weddings/${weddingId}/parties/${moreira.id}`), ana.cookie).send(body);
    return { ana, weddingId, moreira, padrinhos, guest, patch };
  }

  it('RN11 - mover sobe a versão dos dois grupos', async () => {
    const { ana, weddingId, moreira, padrinhos, guest } = await scenario();

    await send(
      http().post(`/v1/weddings/${weddingId}/guests/${guest('Pedro Moreira').id}/move`),
      ana.cookie,
    )
      .send({ partyId: padrinhos.id })
      .expect(200);

    expect(await version(moreira.id)).toBe(2);
    expect(await version(padrinhos.id)).toBe(2);
  });

  it('RN11 - mandar o convidado para a lixeira e restaurar sobem a versão', async () => {
    const { ana, weddingId, moreira, guest } = await scenario();
    const pedro = guest('Pedro Moreira').id;

    await send(http().delete(`/v1/weddings/${weddingId}/guests/${pedro}`), ana.cookie).expect(
      (response) => expect(response.status).toBeLessThan(300),
    );
    expect(await version(moreira.id)).toBe(2);

    await send(http().post(`/v1/weddings/${weddingId}/trash/restore`), ana.cookie)
      .send({ type: 'guest', id: pedro })
      .expect((response) => expect(response.status).toBeLessThan(300));
    expect(await version(moreira.id)).toBe(3);
  });

  it('RN11 - mandar o grupo para a lixeira e restaurar sobem a versão', async () => {
    const { ana, weddingId, moreira } = await scenario();

    await send(http().delete(`/v1/weddings/${weddingId}/parties/${moreira.id}`), ana.cookie).expect(
      (response) => expect(response.status).toBeLessThan(300),
    );
    expect(await version(moreira.id)).toBe(2);

    await send(http().post(`/v1/weddings/${weddingId}/trash/restore`), ana.cookie)
      .send({ type: 'party', id: moreira.id })
      .expect((response) => expect(response.status).toBeLessThan(300));
    expect(await version(moreira.id)).toBe(3);
  });

  it('RN11 - Editar grupo: convidado novo, vagas e nome trocado sobem a versão', async () => {
    const { moreira, guest, patch } = await scenario();

    await patch({ guests: [{ name: 'Rita Souza' }] }).expect(200);
    expect(await version(moreira.id)).toBe(2);

    await patch({ plusOneSlots: 2 }).expect(200);
    expect(await version(moreira.id)).toBe(3);

    // Apagar a vaga vazia também.
    await patch({ plusOneSlots: 1 }).expect(200);
    expect(await version(moreira.id)).toBe(4);

    await patch({ guests: [{ id: guest('Luiz Moreira').id, name: 'Luiz Carlos Moreira' }] }).expect(
      200,
    );
    expect(await version(moreira.id)).toBe(5);
  });

  it('RN11 - Editar grupo sem mexer no formulário do RSVP não sobe a versão', async () => {
    const { moreira, guest, patch } = await scenario();
    const celia = guest('Célia Moreira').id;

    await patch({
      name: 'Família Moreira Souza',
      internalNote: 'Mesa perto da pista',
      guests: [
        { id: celia, name: 'Célia Moreira', phone: '19998763310', ageGroup: 'adult' },
        { id: guest('Luiz Moreira').id, email: 'luiz@exemplo.kore.local' },
      ],
      contactGuestId: celia,
      plusOneSlots: 1,
    }).expect(200);

    expect(await version(moreira.id)).toBe(1);
  });
});
