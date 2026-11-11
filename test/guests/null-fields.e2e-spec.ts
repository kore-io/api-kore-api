import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

/**
 * Campos opcionais que não aceitam null: o pedido com null dá 400 no campo, e
 * não 500 (Crivo na feature/67-tags). Os anuláveis (observação, telefone,
 * e-mail e faixa etária no PATCH) continuam apagando com null.
 */
describe('Null nos campos de grupo (banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  let cookie: string;
  let weddingId: string;
  let partyId: string;
  let guestId: string;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
    const ana = await signedInUser({ app, name: 'Ana' });
    cookie = ana.cookie;
    weddingId = (await seedWedding({ db, ownerId: ana.userId })).weddingId;
    const party = await post({
      name: 'Família Moreira',
      guests: [{ name: 'Célia Moreira', phone: '19998763310', ageGroup: 'adult' }],
      internalNote: 'Chegam no sábado.',
    }).expect(201);
    partyId = party.body.id;
    guestId = party.body.guests[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  function post(body: object) {
    return request(app.getHttpServer())
      .post(`/v1/weddings/${weddingId}/parties`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);
  }
  function patch(body: object) {
    return request(app.getHttpServer())
      .patch(`/v1/weddings/${weddingId}/parties/${partyId}`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);
  }
  const paths = (body: { errors: { path: string }[] }) => [
    ...new Set(body.errors.map((error) => error.path)),
  ];

  it.each([['contactIndex'], ['plusOneSlots'], ['tagIds']])(
    'RN03 - POST com %s nulo dá 400 no campo',
    async (field) => {
      const response = await post({
        name: 'Família Rocha',
        guests: [{ name: 'Márcia Rocha' }],
        [field]: null,
      }).expect(400);

      expect(paths(response.body)).toEqual([field]);
    },
  );

  it.each([
    ['name', { name: null }, 'name'],
    ['guests', { guests: null }, 'guests'],
    ['contactGuestId', { contactGuestId: null }, 'contactGuestId'],
    ['plusOneSlots', { plusOneSlots: null }, 'plusOneSlots'],
    ['tagIds', { tagIds: null }, 'tagIds'],
    ['guests[].id', { guests: [{ id: null, name: 'Nova' }] }, 'guests.0.id'],
    ['guests[].name', { guests: [{ name: null }] }, 'guests.0.name'],
    ['guests[].tagIds', { guests: [{ tagIds: null, name: 'Nova' }] }, 'guests.0.tagIds'],
  ])('RN09 - PATCH com %s nulo dá 400 no campo, e nada muda', async (_, body, path) => {
    const response = await patch(body).expect(400);

    expect(paths(response.body)).toEqual([path]);
    const party = await db.party.findUniqueOrThrow({ where: { id: partyId } });
    expect(party).toMatchObject({ name: 'Família Moreira', plusOneSlots: 0 });
  });

  it('RN09 - os anuláveis continuam apagando com null: observação, telefone, e-mail e faixa etária', async () => {
    const response = await patch({
      internalNote: null,
      guests: [{ id: guestId, phone: null, email: null, ageGroup: null }],
    }).expect(200);

    expect(response.body).toMatchObject({
      internalNote: null,
      guests: [{ id: guestId, phone: null, email: null, ageGroup: null }],
    });
  });
});
