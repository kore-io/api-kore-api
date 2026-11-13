import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { NOTIFICATIONS_QUEUE } from '../../src/modules/notifications/infrastructure/notifications-queue';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import { REDIS_CLIENT } from '../../src/shared/redis/redis.module';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const SITE_ORIGIN = 'http://localhost:5174';
const DAY_MS = 86_400_000;

interface Form {
  party: { version: number };
  guests: { id: string; name: string | null }[];
}

/**
 * O RSVP com o Redis fora do ar (decisão 97, item 3): o teto por grupo é
 * contado no banco e continua valendo (RSVP RN10), e o aviso da notificação
 * pela fila falha na hora, sem segurar a resposta (Central RN02).
 */
describe('RSVP com o Redis fora do ar (RSVP RN10; Central RN02; banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  const refused = () => Promise.reject(new Error('connect ECONNREFUSED'));
  // A fila produtora sem fila offline: o add recusa na hora (Connection is closed).
  const offlineQueue = {
    add: () => Promise.reject(new Error('Connection is closed.')),
    close: () => Promise.resolve(),
    on: () => undefined,
  };

  beforeAll(async () => {
    app = await createTestApp({
      override: (builder) =>
        builder
          .overrideProvider(REDIS_CLIENT)
          .useValue({
            connect: refused,
            ping: refused,
            eval: refused,
            get: refused,
            set: refused,
            incr: refused,
            disconnect: () => undefined,
          })
          .overrideProvider(getQueueToken(NOTIFICATIONS_QUEUE))
          .useValue(offlineQueue),
    });
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const ip = () => `10.${[1, 2, 3].map(() => Math.floor(Math.random() * 250)).join('.')}`;
  const day = (offset: number) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);

  /** Ana & Marcos publicado, com a Família Moreira (Célia e Luiz) e a sessão do grupo. */
  async function scenario() {
    const ana = await signedInUser({ app, name: 'Ana' });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    const slug = `ana-e-marcos-${randomUUID().slice(0, 8)}`;
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        slug,
        status: 'published',
        publishedAt: new Date(Date.now() - 10 * DAY_MS),
        eventDate: new Date(`${day(60)}T00:00:00Z`),
        endDate: new Date(`${day(90)}T00:00:00Z`),
        paidThrough: new Date(`${day(90)}T00:00:00Z`),
        publicationSource: 'payment',
      },
    });
    const created = await http()
      .post(`/v1/weddings/${weddingId}/parties`)
      .set('Cookie', ana.cookie)
      .set('Origin', APP_ORIGIN)
      .send({
        name: 'Família Moreira',
        guests: [{ name: 'Célia Moreira' }, { name: 'Luiz Moreira' }],
      })
      .expect(201);
    const party = await db.party.findUniqueOrThrow({ where: { id: created.body.id } });
    const from = ip();
    const session = await http()
      .post(`/v1/sites/${slug}/party-session`)
      .set('Origin', SITE_ORIGIN)
      .set('X-Forwarded-For', from)
      .send({ token: party.linkToken })
      .expect(200);
    const cookie = ([] as string[]).concat(session.headers['set-cookie'])[0].split(';')[0];
    const form = (
      await http()
        .get(`/v1/sites/${slug}/rsvp`)
        .set('Origin', SITE_ORIGIN)
        .set('Cookie', cookie)
        .expect(200)
    ).body as Form;
    const [celia, luiz] = form.guests;
    const body = (version: number, luizStatus: 'confirmed' | 'declined') => ({
      version,
      signedByGuestId: celia.id,
      guests: [
        { id: celia.id, status: 'confirmed' },
        { id: luiz.id, status: luizStatus },
      ],
    });
    const put = (payload: Record<string, unknown>) =>
      http()
        .put(`/v1/sites/${slug}/rsvp`)
        .set('Origin', SITE_ORIGIN)
        .set('Cookie', cookie)
        .set('X-Forwarded-For', from)
        .send(payload);
    return { ana, weddingId, partyId: party.id, body, put };
  }

  it('Central RN02 - a resposta sai logo e fica gravada, com a notificação da dona; o aviso pela fila falha sem segurar', async () => {
    const { ana, weddingId, partyId, body, put } = await scenario();
    const started = Date.now();

    await put(body(1, 'confirmed')).expect(200);

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await db.rsvpSubmission.count({ where: { partyId } })).toBe(1);
    expect(
      await db.notification.findFirst({
        where: { userId: ana.userId, weddingId, type: 'rsvp', readAt: null },
        select: { count: true },
      }),
    ).toEqual({ count: 1 });
  });

  it('RN10 - o teto vale sem o Redis: com 50 gravações hoje, a mudança recebe RSVP_LIMIT; sem mudança, passa', async () => {
    const { partyId, weddingId, body, put } = await scenario();
    await put(body(1, 'confirmed')).expect(200);
    await db.rsvpSubmission.deleteMany({ where: { partyId } });
    await db.rsvpSubmission.createMany({
      data: Array.from({ length: 50 }, () => ({
        id: uuidV7(),
        weddingId,
        partyId,
        actor: 'party' as const,
        confirmedCount: 0,
        declinedCount: 0,
      })),
    });

    const limited = await put(body(2, 'declined')).expect(429);
    expect(limited.body.error).toBe('RSVP_LIMIT');
    expect((await db.party.findUniqueOrThrow({ where: { id: partyId } })).version).toBe(2);
    expect(await db.rsvpSubmission.count({ where: { partyId } })).toBe(50);

    await put(body(2, 'confirmed')).expect(200);
    expect(await db.rsvpSubmission.count({ where: { partyId } })).toBe(50);
  });
});

describe('A fila notifications na API (Central RN02)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('Central RN02 - a conexão produtora não guarda o add para depois (sem fila offline)', () => {
    const queue = app.get<Queue>(getQueueToken(NOTIFICATIONS_QUEUE), { strict: false });
    expect(queue.opts.connection).toMatchObject({ enableOfflineQueue: false });
  });
});
