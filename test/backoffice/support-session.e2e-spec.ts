import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { addMonths } from '../../src/modules/billing/domain/pricing';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { localDate } from '../../src/shared/time/local-date';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { publishByPayment } from '../support/payments';
import { seedReferrer } from '../support/referrers';
import { signedInUser, staffUser } from '../support/sessions';
import { seedReferrerWedding, seedWedding } from '../support/weddings';

const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';
const MINUTE_MS = 60_000;
const day = (value: string) => new Date(`${value}T00:00:00Z`);

/**
 * Ver como o casal (Backoffice - acesso RN08; B9-1 e B9-5): só leitura pelo
 * guard e pelo banco (kore_support), o fim sozinho e o log por requisição.
 */
describe('Backoffice: Ver como o casal (Backoffice - acesso RN08; banco real)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;
  const today = localDate({ at: new Date(), timezone: 'America/Sao_Paulo' });
  const eventDate = addMonths({ day: today, months: 2 });
  const endDate = addMonths({ day: eventDate, months: 3 });

  beforeAll(async () => {
    app = await createTestApp();
    worker = await createTestWorker();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const start = (cookie: string, weddingId: string) =>
    http()
      .post(`/v1/admin/weddings/${weddingId}/support-sessions`)
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ reason: 'Casal não acha os convidados.' });

  /** "Ana & Marcos" publicado, com um grupo. */
  async function couple() {
    const ana = await signedInUser({ app });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    await db.wedding.update({ where: { id: weddingId }, data: { eventDate: day(eventDate) } });
    await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate });
    await http()
      .post(`/v1/weddings/${weddingId}/parties`)
      .set('Cookie', ana.cookie)
      .set('Origin', ORIGIN)
      .send({ name: 'Família Moreira', guests: [{ name: 'Célia Moreira', ageGroup: 'adult' }] })
      .expect(201);
    return { ana, weddingId };
  }

  async function viewing() {
    const support = await staffUser({ app, role: 'support', name: 'Bruno Tavares' });
    const { ana, weddingId } = await couple();
    const started = await start(support.cookie, weddingId).expect(201);
    return { support, ana, weddingId, supportSessionId: started.body.supportSessionId as string };
  }

  it('RN08 - começa com o motivo; o /me traz a faixa; as telas do casal leem como a colaboradora', async () => {
    const { support, weddingId, supportSessionId } = await viewing();
    const me = await http().get('/v1/me').set('Cookie', support.cookie).expect(200);
    expect(me.body.supportSession).toEqual({
      weddingId,
      coupleNames: 'Ana & Marcos',
      startedAt: expect.any(String),
      expiresAt: expect.any(String),
    });
    const parties = await http()
      .get(`/v1/weddings/${weddingId}/parties`)
      .set('Cookie', support.cookie)
      .expect(200);
    expect(JSON.stringify(parties.body)).toContain('Família Moreira');
    await db.applicationLog.findFirstOrThrow({
      where: { action: 'support_session.started', supportSessionId },
    });
    const lines = await db.applicationLog.findMany({
      where: { action: 'support_session.request', supportSessionId },
    });
    expect(lines.map((line) => line.data)).toContainEqual({
      method: 'GET',
      route: '/v1/weddings/:weddingId/parties',
    });
  });

  it('RN08 - toda leitura do casamento passa (sem 500 e sem 404), e toda escrita é 403 SUPPORT_READ_ONLY', async () => {
    const { support, weddingId } = await viewing();
    const document = JSON.parse(readFileSync(resolve('openapi.json'), 'utf8')) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const routes = Object.entries(document.paths).flatMap(([path, item]) =>
      (['get', 'post', 'put', 'patch', 'delete'] as const)
        .filter((method) => path.includes('{weddingId}') && item[method])
        .map((method) => ({ method, path })),
    );
    const broken: string[] = [];
    for (const { method, path } of routes) {
      const url = path.replace('{weddingId}', weddingId).replace(/\{[^}]+\}/g, () => randomUUID());
      const response = await http()
        [method](url)
        .set('Cookie', support.cookie)
        .set('Origin', ORIGIN);
      const error = response.body?.error as string | undefined;
      if (method !== 'get') {
        if (response.status !== 403 || error !== 'SUPPORT_READ_ONLY')
          broken.push(`${method} ${path} → ${response.status} ${error ?? ''}`);
      } else if (response.status >= 500 || error === 'WEDDING_NOT_FOUND') {
        broken.push(`${method} ${path} → ${response.status} ${error ?? ''}`);
      }
    }
    expect(broken).toEqual([]);
    // O Exportar leva os dados para fora.
    const exported = await http()
      .get(`/v1/weddings/${weddingId}/guests/export`)
      .query({ format: 'xlsx', who: 'all', columns: 'party,name' })
      .set('Cookie', support.cookie)
      .expect(403);
    expect(exported.body.error).toBe('SUPPORT_READ_ONLY');
  });

  it('RN08 - outro casamento é 403 ACTION_NOT_ALLOWED; a central do dono também fica fora', async () => {
    const { support } = await viewing();
    const other = await couple();
    expect(
      (
        await http()
          .get(`/v1/weddings/${other.weddingId}/parties`)
          .set('Cookie', support.cookie)
          .expect(403)
      ).body.error,
    ).toBe('ACTION_NOT_ALLOWED');
    expect(
      (
        await http()
          .get('/v1/me/notifications')
          .query({ weddingId: other.weddingId })
          .set('Cookie', support.cookie)
          .expect(403)
      ).body.error,
    ).toBe('ACTION_NOT_ALLOWED');
  });

  it('RN08 (B9-1) - o banco garante: o kore_support não grava e não lê outro casamento', async () => {
    const { weddingId } = await viewing();
    const other = await couple();
    const prisma = app.get(PrismaService);
    const asSupport = <T>(
      work: (tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0]) => Promise<T>,
    ) =>
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.wedding_id', ${weddingId}, true)`;
        await tx.$executeRaw`SET LOCAL ROLE kore_support`;
        return work(tx);
      });
    const party = await db.party.findFirstOrThrow({ where: { weddingId } });
    await expect(
      asSupport(
        (tx) =>
          tx.$executeRaw`INSERT INTO guests (id, wedding_id, party_id, name, updated_at)
          VALUES (${randomUUID()}::uuid, ${weddingId}::uuid, ${party.id}::uuid, 'Intruso', now())`,
      ),
    ).rejects.toThrow(/permission denied/);
    const mine = await asSupport((tx) => tx.guest.count({ where: { weddingId } }));
    const theirs = await asSupport((tx) =>
      tx.guest.count({ where: { weddingId: other.weddingId } }),
    );
    expect([mine > 0, theirs]).toEqual([true, 0]);
  });

  it('RN08 - termina sozinha com 30 minutos sem requisição e no teto de 2 horas', async () => {
    const idle = await viewing();
    await db.supportSession.update({
      where: { id: idle.supportSessionId },
      data: { lastSeenAt: new Date(Date.now() - 31 * MINUTE_MS) },
    });
    const ended = await http()
      .get(`/v1/weddings/${idle.weddingId}/parties`)
      .set('Cookie', idle.support.cookie)
      .expect(403);
    expect(ended.body).toMatchObject({ error: 'SUPPORT_SESSION_ENDED', reason: 'idle' });
    expect(
      await db.supportSession.findUniqueOrThrow({ where: { id: idle.supportSessionId } }),
    ).toMatchObject({
      endReason: 'idle',
      endedAt: expect.any(Date),
    });
    expect(
      (await http().get('/v1/me').set('Cookie', idle.support.cookie).expect(200)).body
        .supportSession,
    ).toBeNull();

    const long = await viewing();
    await db.supportSession.update({
      where: { id: long.supportSessionId },
      data: { startedAt: new Date(Date.now() - 121 * MINUTE_MS) },
    });
    const capped = await http()
      .get(`/v1/weddings/${long.weddingId}/parties`)
      .set('Cookie', long.support.cookie)
      .expect(403);
    expect(capped.body).toMatchObject({ error: 'SUPPORT_SESSION_ENDED', reason: 'max_duration' });
  });

  it('RN08 - Sair encerra; o logout do staff também; sem dono, 409 NO_OWNER', async () => {
    const { support, supportSessionId } = await viewing();
    await http()
      .post(`/v1/admin/support-sessions/${supportSessionId}/end`)
      .set('Cookie', support.cookie)
      .set('Origin', ORIGIN)
      .expect(200);
    expect(
      await db.supportSession.findUniqueOrThrow({ where: { id: supportSessionId } }),
    ).toMatchObject({
      endReason: 'exit',
    });
    await db.applicationLog.findFirstOrThrow({
      where: { action: 'support_session.ended', supportSessionId },
    });
    await http()
      .post(`/v1/admin/support-sessions/${supportSessionId}/end`)
      .set('Cookie', support.cookie)
      .set('Origin', ORIGIN)
      .expect(404);

    const second = await viewing();
    await http()
      .post('/v1/auth/logout')
      .set('Cookie', second.support.cookie)
      .set('Origin', ORIGIN)
      .expect(204);
    expect(
      await db.supportSession.findUniqueOrThrow({ where: { id: second.supportSessionId } }),
    ).toMatchObject({
      endReason: 'logout',
    });

    const juliana = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const { weddingId: ownerless } = await seedReferrerWedding({
      db,
      referrerUserId: juliana.userId,
      status: 'awaiting_couple',
    });
    const fresh = await staffUser({ app, role: 'support' });
    expect((await start(fresh.cookie, ownerless).expect(409)).body.error).toBe('NO_OWNER');
  });
});
