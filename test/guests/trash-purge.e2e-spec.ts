import { getQueueToken } from '@nestjs/bullmq';
import type { TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  TRASH_PURGE_QUEUE,
  TRASH_PURGE_SCHEDULER_ID,
  TrashPurgeProcessor,
} from '../../src/modules/guests/infrastructure/trash-purge.job';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestWorker } from '../support/create-test-worker';
import { seedWedding } from '../support/weddings';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Expurgo diário da lixeira (Lixeira RN10 e RN11; worker). */
describe('Expurgo da lixeira (worker)', () => {
  let worker: TestingModule;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    worker = await createTestWorker();
    db = worker.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await worker?.close();
  });

  const token = () => randomBytes(16).toString('base64url');
  const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

  async function wedding() {
    const { id: ownerId } = await db.user.create({
      data: { email: `expurgo.${randomUUID()}@kore.local` },
    });
    return (await seedWedding({ db, ownerId })).weddingId;
  }

  it('RN10 - com o worker no ar, a rotina fica agendada todo dia, antes do recálculo', async () => {
    const queue = worker.get<Queue>(getQueueToken(TRASH_PURGE_QUEUE));

    expect(await queue.getJobScheduler(TRASH_PURGE_SCHEDULER_ID)).toMatchObject({
      pattern: '0 3 * * *',
      tz: 'America/Sao_Paulo',
    });
  });

  it('RN10 e RN11 - apaga de vez o que passou do purgeAt, com o que pende dele; o que ainda está no prazo fica', async () => {
    const weddingId = await wedding();
    // Grupo expurgado, com um convidado do lote e um que foi sozinho antes.
    const old = await db.party.create({
      data: { weddingId, name: 'Amigos do vôlei', linkToken: token(), deletedAt: daysAgo(40) },
    });
    await db.guest.createMany({
      data: [
        {
          weddingId,
          partyId: old.id,
          name: 'Rita',
          deletedAt: daysAgo(40),
          trashBatchId: randomUUID(),
        },
        { weddingId, partyId: old.id, name: 'Caio', deletedAt: daysAgo(45) },
      ],
    });
    // Grupo ativo, com um convidado sozinho fora do prazo e outro dentro.
    const rocha = await db.party.create({
      data: { weddingId, name: 'Família Rocha', linkToken: token() },
    });
    const [antonio, bruno, marcia] = await Promise.all(
      [
        { name: 'Antônio Rocha' },
        { name: 'Bruno Lima', deletedAt: daysAgo(35) },
        { name: 'Márcia Rocha', deletedAt: daysAgo(10) },
      ].map((guest) => db.guest.create({ data: { weddingId, partyId: rocha.id, ...guest } })),
    );
    const vizinhos = await db.tag.create({
      data: { weddingId, name: 'Vizinhos', deletedAt: daysAgo(31) },
    });
    await db.partyTag.create({ data: { weddingId, partyId: rocha.id, tagId: vizinhos.id } });
    const igreja = await db.tag.create({
      data: { weddingId, name: 'Igreja', deletedAt: daysAgo(2) },
    });

    const counts = await worker.get(TrashPurgeProcessor).process();

    expect(await db.party.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await db.guest.count({ where: { partyId: old.id } })).toBe(0);
    expect(await db.guest.findUnique({ where: { id: bruno.id } })).toBeNull();
    expect(await db.guest.findUnique({ where: { id: antonio.id } })).not.toBeNull();
    expect(await db.guest.findUnique({ where: { id: marcia.id } })).not.toBeNull();
    expect(await db.tag.findUnique({ where: { id: vizinhos.id } })).toBeNull();
    expect(await db.partyTag.count({ where: { tagId: vizinhos.id } })).toBe(0);
    expect(await db.tag.findUnique({ where: { id: igreja.id } })).not.toBeNull();
    expect(counts.parties).toBeGreaterThanOrEqual(1);
    expect(counts.guests).toBeGreaterThanOrEqual(3);
    const [log] = await db.applicationLog.findMany({
      where: { action: 'guests.purged' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(log).toMatchObject({ actorKind: 'system', data: expect.objectContaining(counts) });
  });

  it('RN10 - a data é a do fuso do casamento: no dia purgeAt ainda fica; no seguinte, sai', async () => {
    const weddingId = await wedding();
    const partyId = (await db.party.create({ data: { weddingId, name: 'A', linkToken: token() } }))
      .id;
    // 30 dias atrás é o dia purgeAt (ainda restaura); 31, o dia seguinte.
    const stays = await db.guest.create({
      data: { weddingId, partyId, name: 'Fica', deletedAt: daysAgo(30) },
    });
    const goes = await db.guest.create({
      data: { weddingId, partyId, name: 'Sai', deletedAt: daysAgo(31) },
    });

    await worker.get(TrashPurgeProcessor).process();

    expect(await db.guest.findUnique({ where: { id: stays.id } })).not.toBeNull();
    expect(await db.guest.findUnique({ where: { id: goes.id } })).toBeNull();
  });
});
