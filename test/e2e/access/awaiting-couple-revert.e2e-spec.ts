import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { RevertExpiredCoupleInvitations } from '@/modules/access/application/weddings/revert-expired-couple-invitations.use-case';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { PrismaService } from '@/shared/database/prisma.service';
import { createTestApp } from '../support/harness/create-test-app';
import { createTestWorker } from '../support/harness/create-test-worker';
import { seedInvitation } from '../support/factories/invitations';
import { seedReferrer } from '../support/factories/referrers';
import { openSession } from '../support/harness/sessions';
import { seedReferrerWedding } from '../support/factories/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const DAY_MS = 86_400_000;

/**
 * Decisão 297 (Convites de acesso; Meus casamentos e alertas RN08): "aguardando
 * o casal" é o casamento com convite. Sem convite de dono pendente (cancelado,
 * recusado ou vencido), ele volta a rascunho, com o log
 * wedding.awaiting_couple_reverted. O kore_test é compartilhado: a rotina roda
 * recortada ao casamento do teste.
 */
describe('Aguardando o casal volta a rascunho sem convite (decisão 297; banco real)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;
  let routine: RevertExpiredCoupleInvitations;

  beforeAll(async () => {
    app = await createTestApp();
    worker = await createTestWorker();
    db = app.get(BackofficePrismaService);
    routine = worker.get(RevertExpiredCoupleInvitations);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  const email = (name: string) => `${name}.${randomUUID()}@kore.local`;
  const send = (cookie: string, weddingId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/v1/weddings/${weddingId}/access-invitations`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);
  const cancel = (cookie: string, weddingId: string, id: string) =>
    request(app.getHttpServer())
      .delete(`/v1/weddings/${weddingId}/access-invitations/${id}`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN);
  const decline = (token: string) =>
    request(app.getHttpServer())
      .post(`/v1/access-invitations/${token}/decline`)
      .set('Origin', APP_ORIGIN);
  const status = async (weddingId: string) =>
    (await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).status;
  const reverts = (weddingId: string) =>
    db.applicationLog.findMany({
      where: { weddingId, action: 'wedding.awaiting_couple_reverted' },
    });

  /** O casamento que a Juliana criou, ainda sem convite (rascunho). */
  async function plannerWedding() {
    const { userId } = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const cookie = await openSession({ app, userId });
    const { weddingId } = await seedReferrerWedding({
      db,
      referrerUserId: userId,
      referrerKind: 'planner',
    });
    return { userId, cookie, weddingId };
  }

  it('decisão 297 - cancelar o último convite do casal volta a rascunho, com o log da cerimonialista; com outro pendente, segue aguardando', async () => {
    const { userId, cookie, weddingId } = await plannerWedding();
    const sent = await send(cookie, weddingId, {
      kind: 'couple',
      emails: [email('fernanda'), email('joao')],
    }).expect(201);
    expect(await status(weddingId)).toBe('awaiting_couple');
    const [first, second] = sent.body.invitations as { id: string }[];

    await cancel(cookie, weddingId, first.id).expect(204);
    expect(await status(weddingId)).toBe('awaiting_couple');
    expect(await reverts(weddingId)).toEqual([]);

    await cancel(cookie, weddingId, second.id).expect(204);
    expect(await status(weddingId)).toBe('draft');
    expect(await reverts(weddingId)).toEqual([
      expect.objectContaining({
        actorKind: 'user',
        actorUserId: userId,
        entityType: 'wedding',
        entityId: weddingId,
        data: { cause: 'revoked' },
      }),
    ]);

    // Convidar de novo leva outra vez a aguardando (RN08).
    await send(cookie, weddingId, { kind: 'couple' }).expect(201);
    expect(await status(weddingId)).toBe('awaiting_couple');
  });

  it('decisão 297 - cancelar o link do casal (o único convite) também volta a rascunho', async () => {
    const { cookie, weddingId } = await plannerWedding();
    const sent = await send(cookie, weddingId, { kind: 'couple' }).expect(201);
    await cancel(cookie, weddingId, sent.body.invitations[0].id as string).expect(204);
    expect(await status(weddingId)).toBe('draft');
  });

  it('decisão 297 - a recusa do último convite do casal volta a rascunho (log system); com outro pendente, não', async () => {
    const { userId, weddingId } = await plannerWedding();
    await db.wedding.update({ where: { id: weddingId }, data: { status: 'awaiting_couple' } });
    const fernanda = await seedInvitation({
      db,
      weddingId,
      kind: 'couple',
      email: email('fernanda'),
      invitedByUserId: userId,
    });
    const joao = await seedInvitation({
      db,
      weddingId,
      kind: 'couple',
      email: email('joao'),
      invitedByUserId: userId,
    });

    await decline(fernanda.token).expect(204);
    expect(await status(weddingId)).toBe('awaiting_couple');

    await decline(joao.token).expect(204);
    expect(await status(weddingId)).toBe('draft');
    expect(await reverts(weddingId)).toEqual([
      expect.objectContaining({
        actorKind: 'system',
        actorUserId: null,
        data: { cause: 'declined' },
      }),
    ]);
  });

  it('decisão 297 - na rotina diária, o link vencido que era o último convite volta a rascunho; o no prazo, não; o convite da cerimonialista (colaboradora) não conta', async () => {
    const { userId, weddingId } = await plannerWedding();
    await db.wedding.update({ where: { id: weddingId }, data: { status: 'awaiting_couple' } });
    const expiresAt = new Date(Date.now() + 2 * DAY_MS);
    await seedInvitation({
      db,
      weddingId,
      kind: 'couple',
      email: null,
      invitedByUserId: userId,
      expiresAt,
    });
    // Um convite de colaboradora pendente e no prazo não segura o "aguardando".
    await seedInvitation({
      db,
      weddingId,
      kind: 'planner',
      email: email('outra'),
      invitedByUserId: userId,
      expiresAt: new Date(Date.now() + 30 * DAY_MS),
    });

    expect(await routine.execute({ now: new Date(), weddingId })).toEqual({ reverted: 0 });
    expect(await status(weddingId)).toBe('awaiting_couple');

    const later = new Date(expiresAt.getTime() + 1);
    expect(await routine.execute({ now: later, weddingId })).toEqual({ reverted: 1 });
    expect(await status(weddingId)).toBe('draft');
    expect(await reverts(weddingId)).toEqual([
      expect.objectContaining({
        actorKind: 'system',
        actorUserId: null,
        data: { cause: 'expired' },
      }),
    ]);
    // De novo, nada muda.
    expect(await routine.execute({ now: later, weddingId })).toEqual({ reverted: 0 });
    expect(await reverts(weddingId)).toHaveLength(1);
  });

  it('decisão 297 - a função não mexe no rascunho nem no casamento com convite do casal pendente', async () => {
    const { userId, weddingId } = await plannerWedding();
    const revert = async () =>
      (
        await db.$queryRaw<{ reverted: boolean }[]>`
          SELECT revert_awaiting_couple(${weddingId}::uuid, 'expired', now()) AS reverted`
      )[0].reverted;
    expect(await revert()).toBe(false);
    expect(await status(weddingId)).toBe('draft');

    await db.wedding.update({ where: { id: weddingId }, data: { status: 'awaiting_couple' } });
    await seedInvitation({ db, weddingId, kind: 'couple', email: null, invitedByUserId: userId });
    expect(await revert()).toBe(false);
    expect(await status(weddingId)).toBe('awaiting_couple');
  });

  it('decisão 297 (sugestão do Crivo) - pela API (kore_app), um p_now adiantado não vence o link no prazo; pela rotina, o relógio injetado vale', async () => {
    const { userId, weddingId } = await plannerWedding();
    await db.wedding.update({ where: { id: weddingId }, data: { status: 'awaiting_couple' } });
    await seedInvitation({
      db,
      weddingId,
      kind: 'couple',
      email: null,
      invitedByUserId: userId,
      expiresAt: new Date(Date.now() + 2 * DAY_MS),
    });
    const ahead = new Date(Date.now() + 10 * DAY_MS);

    const [api] = await app.get(PrismaService).$queryRaw<{ reverted: boolean }[]>`
      SELECT revert_awaiting_couple(${weddingId}::uuid, 'revoked', ${ahead}::timestamptz) AS reverted`;
    expect(api.reverted).toBe(false);
    expect(await status(weddingId)).toBe('awaiting_couple');

    const [routineRow] = await db.$queryRaw<{ reverted: boolean }[]>`
      SELECT revert_awaiting_couple(${weddingId}::uuid, 'expired', ${ahead}::timestamptz) AS reverted`;
    expect(routineRow.reverted).toBe(true);
    expect(await status(weddingId)).toBe('draft');
  });

  it('decisão 297 (sugestão do Crivo) - cancelar o convite de colaboradora não volta a rascunho, mesmo com o link do casal vencido; a rotina volta, com cause expired', async () => {
    const { userId, cookie, weddingId } = await plannerWedding();
    await db.wedding.update({ where: { id: weddingId }, data: { status: 'awaiting_couple' } });
    const expiresAt = new Date(Date.now() - 60_000);
    await seedInvitation({
      db,
      weddingId,
      kind: 'couple',
      email: null,
      invitedByUserId: userId,
      expiresAt,
    });
    const planner = await seedInvitation({
      db,
      weddingId,
      kind: 'planner',
      email: email('outra'),
      invitedByUserId: userId,
      expiresAt: new Date(Date.now() + 30 * DAY_MS),
    });

    await cancel(cookie, weddingId, planner.invitationId).expect(204);
    expect(await status(weddingId)).toBe('awaiting_couple');
    expect(await reverts(weddingId)).toEqual([]);

    expect(await routine.execute({ now: new Date(), weddingId })).toEqual({ reverted: 1 });
    expect(await reverts(weddingId)).toEqual([
      expect.objectContaining({ actorKind: 'system', data: { cause: 'expired' } }),
    ]);
  });
});
