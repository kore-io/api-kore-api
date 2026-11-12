import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

type Dashboard = {
  role: string;
  stats: Record<string, number>;
  delivery: Record<string, number>;
  reminderQueue: { parties: number; guests: number; notReminded: number };
  site: { status: string; slug: string | null; publishedAt: string | null; endDate: string | null };
  rsvpDeadline: string | null;
  eventDate: string | null;
  daysUntilEvent: number | null;
  checklist: { key: string; done: boolean; progress: { done: number; total: number } | null }[];
  recentActivity: {
    source: string;
    count: number;
    groups: Record<string, unknown>[];
    readAt: string | null;
  }[];
};

/** Dashboard do casal (Dashboard RN01 a RN08; banco real). */
describe('Dashboard do casal (banco real)', () => {
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

  async function scenario({ published = true }: { published?: boolean } = {}) {
    const ana = await signedInUser({ app, name: 'Ana' });
    const juliana = await signedInUser({ app, name: 'Juliana Prado' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    const slug = `ana-e-marcos-${randomUUID().slice(0, 8)}`;
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        slug,
        eventDate: new Date('2026-11-14T00:00:00Z'),
        rsvpDeadline: new Date('2026-10-15T00:00:00Z'),
        appearanceSetAt: new Date(),
        ...(published
          ? {
              status: 'published' as const,
              publishedAt: new Date(),
              endDate: new Date('2027-02-14T00:00:00Z'),
              publicationSource: 'courtesy' as const,
            }
          : {}),
      },
    });
    const createParty = async (body: Record<string, unknown>) =>
      (
        await http()
          .post(`/v1/weddings/${weddingId}/parties`)
          .set('Cookie', ana.cookie)
          .set('Origin', APP_ORIGIN)
          .send(body)
          .expect(201)
      ).body as { id: string; guests: { id: string; name: string | null }[] };
    return { ana, juliana, weddingId, slug, createParty };
  }
  const dashboard = async (cookie: string, weddingId: string) => {
    const response = await http()
      .get(`/v1/weddings/${weddingId}/dashboard`)
      .set('Cookie', cookie)
      .expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    return response.body as Dashboard;
  };
  const answer = (
    cookie: string,
    weddingId: string,
    guestId: string,
    status: string,
    version = 1,
  ) =>
    http()
      .put(`/v1/weddings/${weddingId}/guests/${guestId}/response`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send({ version, status })
      .expect(200);

  it('RN02 e RN08 - os números do casamento na hora: convidados, buffet, taxa de resposta e status do site', async () => {
    const { ana, weddingId, slug, createParty } = await scenario();
    const moreira = await createParty({
      name: 'Família Moreira',
      guests: [
        { name: 'Célia', ageGroup: 'adult' },
        { name: 'Pedro', ageGroup: 'child' },
      ],
      plusOneSlots: 1,
    });
    const duarte = await createParty({
      name: 'Família Duarte',
      guests: [{ name: 'Carla', ageGroup: 'adult' }],
    });
    await answer(ana.cookie, weddingId, moreira.guests[0].id, 'confirmed');
    await answer(ana.cookie, weddingId, duarte.guests[0].id, 'declined');

    const view = await dashboard(ana.cookie, weddingId);

    expect(view.stats).toEqual({
      guestsTotal: 4,
      confirmed: 1,
      declined: 1,
      pending: 2,
      adultsConfirmed: 1,
      childrenConfirmed: 0,
      babiesConfirmed: 0,
      partiesPending: 1,
      rsvpPercent: 50,
      partiesTotal: 2,
    });
    expect(view).toMatchObject({
      role: 'owner',
      rsvpDeadline: '2026-10-15',
      eventDate: '2026-11-14',
      site: { status: 'published', slug, endDate: '2027-02-14' },
      delivery: { notSent: 1, sent: 0, viewed: 0, responded: 1 },
    });
    expect(typeof view.daysUntilEvent).toBe('number');

    // Uma resposta nova muda os números na leitura seguinte.
    await answer(ana.cookie, weddingId, moreira.guests[1].id, 'confirmed', 2);
    expect((await dashboard(ana.cookie, weddingId)).stats).toMatchObject({
      confirmed: 2,
      pending: 1,
      childrenConfirmed: 1,
    });
  });

  it('RN03 - antes de publicar: convidados e aparência feitos, publicar é o próximo, sem o lembrete', async () => {
    const { ana, weddingId, createParty } = await scenario({ published: false });
    await createParty({ name: 'Família Moreira', guests: [{ name: 'Célia' }] });

    expect((await dashboard(ana.cookie, weddingId)).checklist).toEqual([
      { key: 'guests', done: true, progress: null },
      { key: 'appearance', done: true, progress: null },
      { key: 'publish', done: false, progress: null },
      { key: 'invites', done: false, progress: { done: 0, total: 1 } },
    ]);
  });

  it('RN03 - os envios e a fila do lembrete; o grupo que respondeu sem envio conta como enviado', async () => {
    const { ana, weddingId, createParty } = await scenario();
    const ids = [];
    for (const name of ['A', 'B', 'C', 'D'])
      ids.push((await createParty({ name, guests: [{ name: `${name} 1` }] })).id);
    const sentAt = new Date('2026-09-02T12:00:00Z');
    // A e B enviados e pendentes; C respondeu sem envio; D não enviado.
    await db.party.updateMany({
      where: { id: { in: ids.slice(0, 2) } },
      data: { deliveryStatus: 'sent', sentAt },
    });
    await db.party.update({ where: { id: ids[2] }, data: { deliveryStatus: 'responded' } });
    await db.guest.updateMany({
      where: { partyId: ids[2] },
      data: { rsvpStatus: 'confirmed', respondedAt: new Date() },
    });

    let view = await dashboard(ana.cookie, weddingId);
    expect(view.reminderQueue).toEqual({ parties: 2, guests: 2, notReminded: 2 });
    expect(view.checklist.slice(3)).toEqual([
      { key: 'invites', done: false, progress: { done: 3, total: 4 } },
      { key: 'reminders', done: false, progress: { done: 0, total: 2 } },
    ]);

    // Um lembrete antes do convite não conta; depois, conta.
    await db.party.update({
      where: { id: ids[0] },
      data: { lastReminderAt: new Date('2026-09-01T12:00:00Z') },
    });
    await db.party.update({
      where: { id: ids[1] },
      data: { lastReminderAt: new Date('2026-09-10T12:00:00Z') },
    });
    expect((await dashboard(ana.cookie, weddingId)).reminderQueue.notReminded).toBe(1);
    await db.party.update({
      where: { id: ids[0] },
      data: { lastReminderAt: new Date('2026-09-10T12:00:00Z') },
    });
    await db.party.update({ where: { id: ids[3] }, data: { deliveryStatus: 'sent', sentAt } });
    await db.party.update({
      where: { id: ids[3] },
      data: { lastReminderAt: new Date('2026-09-11T12:00:00Z') },
    });

    view = await dashboard(ana.cookie, weddingId);
    expect(view.checklist.slice(3)).toEqual([
      { key: 'invites', done: true, progress: { done: 4, total: 4 } },
      { key: 'reminders', done: true, progress: { done: 3, total: 3 } },
    ]);
  });

  it('RN03 e RN06 - sem grupos, os convidados e os envios não ficam feitos', async () => {
    const { ana, weddingId } = await scenario();

    const view = await dashboard(ana.cookie, weddingId);

    expect(view.stats.partiesTotal).toBe(0);
    expect(view.checklist.find((item) => item.key === 'guests')?.done).toBe(false);
    expect(view.checklist.find((item) => item.key === 'invites')?.done).toBe(false);
  });

  it('RN04 - a Atividade recente: as notificações do dono (inclusive as lidas); a colaboradora vê as respostas do grupo', async () => {
    const { ana, juliana, weddingId, createParty } = await scenario();
    const moreira = await createParty({ name: 'Família Moreira', guests: [{ name: 'Célia' }] });
    const entry = (name: string, at: string) => ({
      partyId: moreira.id,
      name,
      confirmed: 1,
      declined: 0,
      at,
    });
    for (let index = 0; index < 6; index++)
      await db.notification.create({
        data: {
          userId: ana.userId,
          weddingId,
          type: 'rsvp',
          groupKey: `rsvp:${weddingId}`,
          payload: [entry('Família Moreira', `2026-09-1${index}T20:00:00.000Z`)],
          readAt: new Date(),
          updatedAt: new Date(Date.UTC(2026, 8, 10 + index, 20)),
        },
      });
    await db.rsvpSubmission.create({
      data: { weddingId, partyId: moreira.id, actor: 'party', confirmedCount: 1, declinedCount: 0 },
    });
    await db.guest.updateMany({
      where: { partyId: moreira.id },
      data: { dietaryRestriction: 'sem glúten' },
    });

    const owner = await dashboard(ana.cookie, weddingId);
    expect(owner.recentActivity).toHaveLength(5);
    expect(owner.recentActivity[0]).toMatchObject({ source: 'notification', count: 1 });
    expect(owner.recentActivity[0].readAt).not.toBeNull();
    expect(owner.recentActivity[0].groups[0]).toMatchObject({ at: '2026-09-15T20:00:00.000Z' });

    const collaborator = await dashboard(juliana.cookie, weddingId);
    expect(collaborator.role).toBe('collaborator');
    expect(collaborator.recentActivity).toEqual([
      expect.objectContaining({
        source: 'submission',
        count: 1,
        readAt: null,
        groups: [
          expect.objectContaining({ partyId: moreira.id, name: 'Família Moreira', confirmed: 1 }),
        ],
      }),
    ]);
    expect(JSON.stringify([owner, collaborator])).not.toContain('glúten');
    expect(JSON.stringify(collaborator)).not.toContain('Célia');
  });

  it('decisão 153 - outro casamento não lê o Dashboard', async () => {
    const { weddingId } = await scenario();
    const other = await scenario();

    await http()
      .get(`/v1/weddings/${weddingId}/dashboard`)
      .set('Cookie', other.ana.cookie)
      .expect(404);
  });
});
