import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { signedInUser, staffUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';

/** Remover a pedido do titular (Backoffice - acesso RN10; decisão 253(3)). */
describe('Backoffice: remover a pedido do titular (Backoffice - acesso RN10; banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const erase = (cookie: string, weddingId: string, guestId: string) =>
    http()
      .post(`/v1/admin/weddings/${weddingId}/guests/${guestId}/erase`)
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ requestChannel: 'email' });

  async function weddingWithParty(guests: string[], partyName: string, plusOneSlots = 0) {
    const ana = await signedInUser({ app });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    const created = await http()
      .post(`/v1/weddings/${weddingId}/parties`)
      .set('Cookie', ana.cookie)
      .set('Origin', ORIGIN)
      .send({
        name: partyName,
        guests: guests.map((name) => ({ name, ageGroup: 'adult' })),
        ...(plusOneSlots > 0 ? { plusOneSlots } : {}),
      })
      .expect(201);
    const partyId = created.body.id as string;
    const rows = await db.guest.findMany({
      where: { partyId, name: { not: null } },
      orderBy: { createdAt: 'asc' },
    });
    // O aviso de RSVP da central guarda o nome do grupo (Central RN04).
    await db.notification.create({
      data: {
        userId: ana.userId,
        weddingId,
        type: 'rsvp',
        groupKey: `rsvp:${randomUUID()}`,
        count: 1,
        payload: [
          { partyId, name: partyName, confirmed: 1, declined: 0, at: new Date().toISOString() },
        ],
      },
    });
    return { ana, weddingId, partyId, guestIds: rows.map((row) => row.id) };
  }

  it('RN10 - o suporte remove Pedro: sai da lista, dos números e das respostas; o log não tem o nome; o grupo com outras pessoas fica', async () => {
    const support = await staffUser({ app, role: 'support' });
    const { weddingId, partyId, guestIds } = await weddingWithParty(
      ['Pedro Moreira', 'Célia Moreira'],
      'Família Moreira',
    );
    const [pedro] = guestIds;
    expect((await db.weddingStats.findUniqueOrThrow({ where: { weddingId } })).guestsTotal).toBe(2);

    expect((await erase(support.cookie, weddingId, pedro).expect(200)).body).toEqual({
      status: 'erased',
    });
    expect(await db.guest.count({ where: { id: pedro } })).toBe(0);
    expect(await db.guestResponse.count({ where: { guestId: pedro } })).toBe(0);
    expect((await db.weddingStats.findUniqueOrThrow({ where: { weddingId } })).guestsTotal).toBe(1);
    expect((await db.party.findUniqueOrThrow({ where: { id: partyId } })).name).toBe(
      'Família Moreira',
    );
    const log = await db.applicationLog.findFirstOrThrow({
      where: { weddingId, action: 'guest.erased_on_request', entityId: pedro },
    });
    expect(log).toMatchObject({
      actorUserId: support.userId,
      actorKind: 'admin',
      ipHash: expect.any(String),
    });
    expect(JSON.stringify(log.data)).not.toContain('Pedro');
    expect(log.data).toMatchObject({ requestChannel: 'email' });
    // O aviso de RSVP guarda o nome do grupo, que fica.
    const [notice] = await db.notification.findMany({ where: { weddingId, type: 'rsvp' } });
    expect(notice.payload).toEqual([expect.objectContaining({ name: 'Família Moreira' })]);

    expect((await erase(support.cookie, weddingId, pedro).expect(404)).body.error).toBe(
      'GUEST_NOT_FOUND',
    );
  });

  it('RN10 (decisão 253(3)) - o grupo de uma pessoa só com o nome dela vira "Grupo removido" e o nome sai dos avisos; vale na lixeira e no bloqueado', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const { weddingId, partyId, guestIds } = await weddingWithParty(
      ['Pedro Moreira'],
      'pedro  MOREIRA',
    );
    await db.guest.update({ where: { id: guestIds[0] }, data: { deletedAt: new Date() } });
    await db.wedding.update({ where: { id: weddingId }, data: { blockedAt: new Date() } });

    await erase(admin.cookie, weddingId, guestIds[0]).expect(200);
    expect((await db.party.findUniqueOrThrow({ where: { id: partyId } })).name).toBe(
      'Grupo removido',
    );
    const [notice] = await db.notification.findMany({ where: { weddingId, type: 'rsvp' } });
    expect(notice.payload).toEqual([
      expect.objectContaining({ partyId, name: null, confirmed: 1, declined: 0 }),
    ]);
  });

  it('RN10 - o convidado de outro casamento é 404; fora do staff, 403', async () => {
    const support = await staffUser({ app, role: 'support' });
    const first = await weddingWithParty(['Pedro Moreira'], 'Família Moreira');
    const second = await weddingWithParty(['Lia Souza'], 'Família Souza');
    await erase(support.cookie, first.weddingId, second.guestIds[0]).expect(404);
    expect(await db.guest.count({ where: { id: second.guestIds[0] } })).toBe(1);
    await erase(first.ana.cookie, first.weddingId, first.guestIds[0]).expect(403);
    // Decisão 256(2): o canal é de uma lista fechada (o nome do titular não vai ao log).
    await request(app.getHttpServer())
      .post(`/v1/admin/weddings/${first.weddingId}/guests/${first.guestIds[0]}/erase`)
      .set('Cookie', support.cookie)
      .set('Origin', ORIGIN)
      .send({ requestChannel: 'E-mail do Pedro Moreira' })
      .expect(400);
  });

  it('RN10 (decisão 253(3)) - a vaga de acompanhante sem nome não é outra pessoa: Pedro + vaga vira "Grupo removido"', async () => {
    const support = await staffUser({ app, role: 'support' });
    const { weddingId, partyId, guestIds } = await weddingWithParty(
      ['Pedro Moreira'],
      'Pedro Moreira',
      1,
    );
    expect(await db.guest.count({ where: { partyId, isPlusOne: true, name: null } })).toBe(1);

    await erase(support.cookie, weddingId, guestIds[0]).expect(200);
    expect((await db.party.findUniqueOrThrow({ where: { id: partyId } })).name).toBe(
      'Grupo removido',
    );
    const [notice] = await db.notification.findMany({ where: { weddingId, type: 'rsvp' } });
    expect(notice.payload).toEqual([expect.objectContaining({ partyId, name: null })]);
    // A vaga continua, sem nome.
    expect(await db.guest.count({ where: { partyId } })).toBe(1);
  });
});
