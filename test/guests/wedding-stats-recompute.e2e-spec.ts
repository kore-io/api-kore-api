import { getQueueToken } from '@nestjs/bullmq';
import type { TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  WEDDING_STATS_RECOMPUTE_QUEUE,
  WEDDING_STATS_RECOMPUTE_SCHEDULER_ID,
  WeddingStatsRecomputeProcessor,
} from '../../src/modules/guests/infrastructure/wedding-stats-recompute.job';
import { recomputeWeddingStats } from '../../src/modules/guests/infrastructure/backoffice/wedding-stats-recompute';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestWorker } from '../support/create-test-worker';
import { seedWedding } from '../support/weddings';

/** Rotina noturna de recálculo do WeddingStats (Grupos RN16; decisão 186(3)). */
describe('Recálculo noturno dos números do casamento (worker)', () => {
  let worker: TestingModule;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    worker = await createTestWorker();
    db = worker.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await worker?.close();
  });

  it('RN16 - com o worker no ar, a rotina fica agendada todo dia, de madrugada', async () => {
    const queue = worker.get<Queue>(getQueueToken(WEDDING_STATS_RECOMPUTE_QUEUE));

    expect(await queue.getJobScheduler(WEDDING_STATS_RECOMPUTE_SCHEDULER_ID)).toMatchObject({
      pattern: '30 3 * * *',
      tz: 'America/Sao_Paulo',
    });
  });

  it('RN16 - a rotina noturna corrige uma divergência, contando vagas e só o que está ativo', async () => {
    const { id: ownerId } = await db.user.create({
      data: { email: `recalculo.${randomUUID()}@kore.local` },
    });
    const { weddingId } = await seedWedding({ db, ownerId });
    const party = await db.party.create({
      data: {
        weddingId,
        name: 'Família Moreira',
        linkToken: randomBytes(16).toString('base64url'),
      },
    });
    const trashed = await db.party.create({
      data: {
        weddingId,
        name: 'Amigos do vôlei',
        linkToken: randomBytes(16).toString('base64url'),
        deletedAt: new Date(),
      },
    });
    await db.guest.createMany({
      data: [
        { weddingId, partyId: party.id, name: 'Célia', ageGroup: 'adult', rsvpStatus: 'confirmed' },
        { weddingId, partyId: party.id, name: 'Pedro', ageGroup: 'child', rsvpStatus: 'confirmed' },
        { weddingId, partyId: party.id, name: 'Luiz', rsvpStatus: 'declined' },
        { weddingId, partyId: party.id, name: null, isPlusOne: true },
        { weddingId, partyId: party.id, name: 'Bruno', deletedAt: new Date() },
        { weddingId, partyId: trashed.id, name: 'Rita', deletedAt: new Date() },
      ],
    });
    // A linha diz outra coisa (ex.: uma escrita que falhou no meio).
    await db.weddingStats.update({ where: { weddingId }, data: { guestsTotal: 3, pending: 0 } });

    await worker.get(WeddingStatsRecomputeProcessor).process();

    const stats = await db.weddingStats.findUniqueOrThrow({ where: { weddingId } });
    expect(stats).toMatchObject({
      guestsTotal: 4,
      confirmed: 2,
      declined: 1,
      pending: 1,
      adultsConfirmed: 1,
      childrenConfirmed: 1,
      babiesConfirmed: 0,
      partiesPending: 1,
    });
    expect(Number(stats.rsvpPercent)).toBe(75);
    const [log] = await db.applicationLog.findMany({
      where: { action: 'wedding_stats.recomputed' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(log).toMatchObject({ actorKind: 'system' });
    expect((log.data as { corrected: number }).corrected).toBeGreaterThanOrEqual(1);
  });

  it('RN16 - o recálculo espera a escrita em andamento e não perde o incremento dela', async () => {
    const { id: ownerId } = await db.user.create({
      data: { email: `recalculo.${randomUUID()}@kore.local` },
    });
    const { weddingId } = await seedWedding({ db, ownerId });
    const party = await db.party.create({
      data: { weddingId, name: 'Tio Jorge', linkToken: randomBytes(16).toString('base64url') },
    });
    await db.guest.create({ data: { weddingId, partyId: party.id, name: 'Jorge Almeida' } });
    // A linha está divergente (o recálculo vai gravar) quando a escrita começa.
    await db.weddingStats.update({
      where: { weddingId },
      data: { guestsTotal: 5, pending: 5, partiesPending: 1 },
    });

    // Uma escrita como a da API: trava a linha, inclui um convidado, soma 1 e
    // demora a confirmar; o recálculo começa no meio dela.
    let releaseWriter: () => void = () => undefined;
    const writerHolds = new Promise<void>((resolve) => (releaseWriter = resolve));
    let writerLocked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => (writerLocked = resolve));
    const writer = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM wedding_stats WHERE wedding_id = ${weddingId}::uuid FOR UPDATE`;
        writerLocked();
        await tx.guest.create({ data: { weddingId, partyId: party.id, name: 'Rita Almeida' } });
        await tx.weddingStats.update({
          where: { weddingId },
          data: { guestsTotal: { increment: 1 }, pending: { increment: 1 } },
        });
        await writerHolds;
      },
      { timeout: 10_000 },
    );
    await lockTaken;
    // Só este casamento: a rotina inteira passaria por centenas de outros antes,
    // e a escrita já teria confirmado.
    const recompute = db.$transaction((tx) => recomputeWeddingStats({ db: tx, weddingId }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    releaseWriter();
    await Promise.all([writer, recompute]);

    expect(await db.weddingStats.findUniqueOrThrow({ where: { weddingId } })).toMatchObject({
      guestsTotal: 2,
      pending: 2,
      partiesPending: 1,
    });
  });
});
