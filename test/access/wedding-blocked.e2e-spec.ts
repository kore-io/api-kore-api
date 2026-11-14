import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { BlockWedding } from '../../src/modules/billing/application/block-wedding.use-case';
import { addMonths } from '../../src/modules/billing/domain/pricing';
import { LocalGatewayStore } from '../../src/modules/billing/infrastructure/backoffice/local-gateway/local-gateway.store';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { localDate } from '../../src/shared/time/local-date';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { expectStatus, payForExtension, publishByPayment } from '../support/payments';
import { signedInUser } from '../support/sessions';
import { seedInvitation } from '../support/invitations';
import { seedWedding } from '../support/weddings';

const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';
const SITE_ORIGIN = 'http://localhost:5174';
const day = (value: string) => new Date(`${value}T00:00:00Z`);

/** As escritas liberadas no bloqueio (RN03), na mesma lista do guard. */
const ALLOWED = new Set([
  'post /v1/weddings/{weddingId}/site-previews',
  // Sair do casamento passa; remover outra pessoa é recusado no caso de uso.
  'delete /v1/weddings/{weddingId}/memberships/{id}',
  // Excluir o casamento: idempotente com a exclusão agendada; o caso de uso recusa
  // o bloqueado com 403 WEDDING_BLOCKED (sem corpo, aqui seria 400 da validação).
  'post /v1/weddings/{weddingId}/deletion',
]);

/**
 * Casamento bloqueado (RN01 a RN08): o guard das escritas, as exceções, o /me,
 * bloquear e desbloquear, e o Pix pendente cancelado depois do commit.
 */
describe('Casamento bloqueado (Casamento bloqueado RN01 a RN08; banco real)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;
  let blocks: BlockWedding;
  const today = localDate({ at: new Date(), timezone: 'America/Sao_Paulo' });
  const eventDate = addMonths({ day: today, months: 2 });
  const endDate = addMonths({ day: eventDate, months: 3 });

  beforeAll(async () => {
    app = await createTestApp();
    worker = await createTestWorker();
    db = app.get(BackofficePrismaService);
    blocks = app.get(BlockWedding);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  const http = () => request(app.getHttpServer());

  /** Ana publicou; Juliana colabora; o suporte bloqueou. */
  async function blocked({ block = true }: { block?: boolean } = {}) {
    const ana = await signedInUser({ app });
    const juliana = await signedInUser({ app, name: 'Juliana Prado' });
    const support = await signedInUser({ app, name: 'Suporte Kore' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    await db.wedding.update({ where: { id: weddingId }, data: { eventDate: day(eventDate) } });
    await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate });
    const wedding = await db.wedding.findUniqueOrThrow({ where: { id: weddingId } });
    if (block)
      expect(
        await blocks.block({
          weddingId,
          byUserId: support.userId,
          reason: 'Denúncia de conteúdo',
          now: new Date(),
        }),
      ).toBe('blocked');
    return { ana, juliana, support, weddingId, slug: wedding.slug! };
  }

  const createParty = (cookie: string, weddingId: string) =>
    http()
      .post(`/v1/weddings/${weddingId}/parties`)
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ name: 'Família Moreira', guests: [{ name: 'Célia Moreira', ageGroup: 'adult' }] });

  it('RN02 (B8-1) - nenhuma rota de escrita com weddingId escapa: todas recusam com WEDDING_BLOCKED, salvo as exceções da RN03', async () => {
    const { ana, weddingId } = await blocked();
    const document = JSON.parse(readFileSync(resolve('openapi.json'), 'utf8')) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const writes = Object.entries(document.paths).flatMap(([path, item]) =>
      (['post', 'put', 'patch', 'delete'] as const)
        .filter((method) => path.includes('{weddingId}') && item[method])
        .map((method) => ({ method, path })),
    );
    expect(writes.length).toBeGreaterThan(20);
    const escaped: string[] = [];
    for (const { method, path } of writes) {
      if (ALLOWED.has(`${method} ${path}`)) continue;
      const url = path.replace('{weddingId}', weddingId).replace(/\{[^}]+\}/g, () => randomUUID());
      // Sem corpo: o guard roda antes da validação.
      const response = await http()[method](url).set('Cookie', ana.cookie).set('Origin', ORIGIN);
      if (response.status !== 403 || response.body.error !== 'WEDDING_BLOCKED')
        escaped.push(`${method} ${path} → ${response.status} ${response.body.error ?? ''}`);
    }
    expect(escaped).toEqual([]);
  });

  it('RN02 e RN03 - o casal e a colaboradora leem e exportam, mas não escrevem', async () => {
    const { ana, juliana, support, weddingId } = await blocked({ block: false });
    // Um grupo para o Exportar ter o que exportar; depois, o bloqueio.
    await createParty(ana.cookie, weddingId).expect(201);
    await blocks.block({ weddingId, byUserId: support.userId, reason: 'Teste', now: new Date() });
    for (const cookie of [ana.cookie, juliana.cookie]) {
      await http().get(`/v1/weddings/${weddingId}/parties`).set('Cookie', cookie).expect(200);
      await http()
        .get(`/v1/weddings/${weddingId}/guests/export`)
        .query({ format: 'xlsx', who: 'all', columns: 'party,name' })
        .set('Cookie', cookie)
        .expect(200);
      const refused = await createParty(cookie, weddingId).expect(403);
      expect(refused.body).toEqual({
        statusCode: 403,
        error: 'WEDDING_BLOCKED',
        message: expect.any(String),
      });
    }
  });

  it('RN03 - a colaboradora sai do casamento; o dono não remove ninguém', async () => {
    const { ana, juliana, weddingId } = await blocked();
    const membership = await db.membership.findFirstOrThrow({
      where: { weddingId, userId: juliana.userId },
    });
    const removal = await http()
      .delete(`/v1/weddings/${weddingId}/memberships/${membership.id}`)
      .set('Cookie', ana.cookie)
      .set('Origin', ORIGIN)
      .expect(403);
    expect(removal.body.error).toBe('WEDDING_BLOCKED');
    await http()
      .delete(`/v1/weddings/${weddingId}/memberships/${membership.id}`)
      .set('Cookie', juliana.cookie)
      .set('Origin', ORIGIN)
      .expect(204);
  });

  it('RN02 (Retenção RN05) - exclusão agendada: 409 WEDDING_DELETION_SCHEDULED; com o bloqueio, vale o 403', async () => {
    const { ana, weddingId } = await blocked({ block: false });
    await db.wedding.update({
      where: { id: weddingId },
      data: { deletionScheduledFor: day(addMonths({ day: today, months: 1 })) },
    });
    expect((await createParty(ana.cookie, weddingId).expect(409)).body.error).toBe(
      'WEDDING_DELETION_SCHEDULED',
    );
    await db.wedding.update({ where: { id: weddingId }, data: { blockedAt: new Date() } });
    expect((await createParty(ana.cookie, weddingId).expect(403)).body.error).toBe(
      'WEDDING_BLOCKED',
    );
  });

  it('RN02 - quem não tem vínculo recebe 404, sem saber do bloqueio', async () => {
    const { weddingId } = await blocked();
    const stranger = await signedInUser({ app });
    expect((await createParty(stranger.cookie, weddingId).expect(404)).body.error).toBe(
      'WEDDING_NOT_FOUND',
    );
  });

  it('RN05 e RN07 - o site responde 423 sem cache, e o /me traz lifecycle.blocked', async () => {
    const { ana, slug, weddingId } = await blocked();
    const site = await http().get(`/v1/sites/${slug}`).set('Origin', SITE_ORIGIN).expect(423);
    expect(site.headers['cache-control']).toBe('no-store');
    const me = await http().get('/v1/me').set('Cookie', ana.cookie).expect(200);
    const membership = (
      me.body.memberships as { weddingId: string; lifecycle: { blocked: boolean } }[]
    ).find((item) => item.weddingId === weddingId);
    expect(membership?.lifecycle.blocked).toBe(true);
  });

  it('RN01, RN06 e RN08 - bloquear grava o motivo no log, cancela o Pix pendente depois do commit e não avisa; desbloquear devolve a escrita', async () => {
    const { ana, support, weddingId } = await blocked({ block: false });
    const pix = expectStatus(
      await payForExtension({
        app,
        cookie: ana.cookie,
        weddingId,
        endDate: addMonths({ day: endDate, months: 2 }),
        method: 'pix',
      }),
      201,
    );
    const pixId = pix.body.paymentId as string;
    const before = await db.notification.count({ where: { weddingId } });

    expect(
      await blocks.block({
        weddingId,
        byUserId: support.userId,
        reason: 'Denúncia',
        now: new Date(),
      }),
    ).toBe('blocked');
    const wedding = await db.wedding.findUniqueOrThrow({ where: { id: weddingId } });
    expect(wedding.status).toBe('published');
    expect(wedding.blockedByUserId).toBe(support.userId);
    const log = await db.applicationLog.findFirstOrThrow({
      where: { weddingId, action: 'wedding.blocked' },
    });
    expect(log).toMatchObject({ actorUserId: support.userId, data: { reason: 'Denúncia' } });

    // O cancelamento sai por job (worker), depois do commit.
    const deadline = Date.now() + 10_000;
    let status = (await db.payment.findUniqueOrThrow({ where: { id: pixId } })).status;
    while (status === 'pending' && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 100));
      status = (await db.payment.findUniqueOrThrow({ where: { id: pixId } })).status;
    }
    expect(status).toBe('canceled');
    expect(
      await app.get(LocalGatewayStore).chargeByReference({ externalReference: pixId }),
    ).toMatchObject({ status: 'canceled' });
    expect(await db.notification.count({ where: { weddingId } })).toBe(before);

    expect(
      await blocks.block({
        weddingId,
        byUserId: support.userId,
        reason: 'De novo',
        now: new Date(),
      }),
    ).toBe('already_blocked');
    expect(
      await blocks.unblock({ weddingId, byUserId: support.userId, reason: null, now: new Date() }),
    ).toBe('unblocked');
    await createParty(ana.cookie, weddingId).expect(201);
    expect(
      await db.applicationLog.count({ where: { weddingId, action: 'wedding.unblocked' } }),
    ).toBe(1);
  });

  it('RN02 (dúvida do Crivo no PR 7) - aceitar o convite de acesso de um casamento bloqueado: 403, sem vínculo', async () => {
    const { ana, weddingId } = await blocked();
    const marcos = await signedInUser({ app, name: 'Marcos' });
    const email = (await db.user.findUniqueOrThrow({ where: { id: marcos.userId } })).email;
    const { token } = await seedInvitation({
      db,
      weddingId,
      kind: 'partner',
      email,
      invitedByUserId: ana.userId,
    });
    const refused = await http()
      .post(`/v1/access-invitations/${token}/accept`)
      .set('Cookie', marcos.cookie)
      .set('Origin', ORIGIN)
      .send({ myTitle: 'groom' })
      .expect(403);
    expect(refused.body.error).toBe('WEDDING_BLOCKED');
    expect(await db.membership.count({ where: { weddingId, userId: marcos.userId } })).toBe(0);
  });
});
