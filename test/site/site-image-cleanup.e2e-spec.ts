import { getQueueToken } from '@nestjs/bullmq';
import type { TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { CleanSiteImages } from '../../src/modules/site/application/clean-site-images.use-case';
import {
  SITE_IMAGE_CLEANUP,
  type SiteImageCleanup,
} from '../../src/modules/site/application/ports/site-image-cleanup.port';
import { siteImageKeys } from '../../src/modules/site/domain/site-image';
import {
  SITE_IMAGE_CLEANUP_QUEUE,
  SITE_IMAGE_CLEANUP_SCHEDULER_ID,
} from '../../src/modules/site/infrastructure/site-image-cleanup.job';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../src/shared/storage/application/object-storage.port';
import { createTestWorker } from '../support/create-test-worker';
import { seedWedding } from '../support/weddings';

const HOUR_MS = 60 * 60 * 1000;

/** Limpeza diária das imagens do site (S4 RN08; worker, banco e MinIO reais). */
describe('Imagens do site: limpeza diária (worker)', () => {
  let worker: TestingModule;
  let db: BackofficePrismaService;
  let storage: ObjectStorage;
  let clean: CleanSiteImages;

  beforeAll(async () => {
    worker = await createTestWorker();
    db = worker.get(BackofficePrismaService);
    storage = worker.get(OBJECT_STORAGE);
    clean = worker.get(CleanSiteImages);
  });

  afterAll(async () => {
    await worker?.close();
  });

  async function wedding() {
    const { id: ownerId } = await db.user.create({
      data: { email: `limpeza.${randomUUID()}@kore.local` },
    });
    return (await seedWedding({ db, ownerId })).weddingId;
  }

  /** Uma imagem no estado pedido, com o arquivo de cada versão no armazenamento. */
  async function image({
    weddingId,
    status,
    updatedAt,
    unusedSince = null,
  }: {
    weddingId: string;
    status: 'uploading' | 'processing' | 'ready' | 'failed';
    updatedAt: Date;
    unusedSince?: Date | null;
  }): Promise<string> {
    const id = uuidV7();
    const keys = siteImageKeys({ imageId: id });
    const ready = status === 'ready';
    await db.siteImage.create({
      data: {
        id,
        weddingId,
        status,
        storageKey: keys.display,
        sizeBytes: 3,
        ...(ready
          ? {
              thumbKey: keys.thumb,
              ogKey: keys.og,
              width: 10,
              height: 10,
              readyAt: updatedAt,
              unusedSince,
            }
          : {}),
      },
    });
    await db.$executeRaw`UPDATE site_images SET updated_at = ${updatedAt} WHERE id = ${id}::uuid`;
    const body = Buffer.from('jpg');
    if (!ready)
      await storage.put({ bucket: 'private', key: keys.original, body, contentType: 'image/jpeg' });
    else
      for (const key of [keys.display, keys.thumb, keys.og])
        await storage.put({ bucket: 'public', key, body, contentType: 'image/jpeg' });
    return id;
  }

  async function files(imageId: string): Promise<number> {
    const keys = siteImageKeys({ imageId });
    const heads = await Promise.all([
      storage.head({ bucket: 'private', key: keys.original }),
      ...[keys.display, keys.thumb, keys.og].map((key) => storage.head({ bucket: 'public', key })),
    ]);
    return heads.filter(Boolean).length;
  }

  const exists = async (id: string) => (await db.siteImage.count({ where: { id } })) === 1;

  it('RN08 - com o worker no ar, a rotina fica agendada todo dia às 2h30', async () => {
    const queue = worker.get<Queue>(getQueueToken(SITE_IMAGE_CLEANUP_QUEUE));

    expect(await queue.getJobScheduler(SITE_IMAGE_CLEANUP_SCHEDULER_ID)).toMatchObject({
      pattern: '30 2 * * *',
      tz: 'America/Sao_Paulo',
    });
  });

  it('RN08 - apaga, com os arquivos, o envio abandonado, a recusada e a fora de uso há mais de 24 horas; o resto fica', async () => {
    const weddingId = await wedding();
    const now = new Date();
    const ago = (hours: number) => new Date(now.getTime() - hours * HOUR_MS);
    const gone = {
      uploading: await image({ weddingId, status: 'uploading', updatedAt: ago(2) }),
      processing: await image({ weddingId, status: 'processing', updatedAt: ago(2) }),
      failed: await image({ weddingId, status: 'failed', updatedAt: ago(0.1) }),
      // Removida e salva há 25 horas.
      removed: await image({
        weddingId,
        status: 'ready',
        updatedAt: ago(30),
        unusedSince: ago(25),
      }),
      // Enviada e nunca salva: unusedSince = readyAt, há 25 horas.
      neverSaved: await image({
        weddingId,
        status: 'ready',
        updatedAt: ago(25),
        unusedSince: ago(25),
      }),
    };
    const kept = {
      uploading: await image({ weddingId, status: 'uploading', updatedAt: ago(0.5) }),
      // Saiu de uso há 23 horas.
      recentlyUnused: await image({
        weddingId,
        status: 'ready',
        updatedAt: ago(30),
        unusedSince: ago(23),
      }),
      inUse: await image({ weddingId, status: 'ready', updatedAt: ago(500), unusedSince: null }),
    };

    const counts = await clean.execute({ now });

    for (const id of Object.values(gone)) {
      expect(await exists(id)).toBe(false);
      expect(await files(id)).toBe(0);
    }
    for (const id of Object.values(kept)) expect(await exists(id)).toBe(true);
    expect(await files(kept.inUse)).toBe(3);
    expect(counts).toMatchObject({ weddingsFailed: 0 });
    expect(counts.stale).toBeGreaterThanOrEqual(2);
    expect(counts.failed).toBeGreaterThanOrEqual(1);
    expect(counts.unused).toBeGreaterThanOrEqual(2);
    // As apagadas deixam de contar no limite de 40 (RN07).
    expect(await db.siteImage.count({ where: { weddingId, status: { not: 'failed' } } })).toBe(3);
    const log = await db.applicationLog.findFirstOrThrow({
      where: { action: 'site_images.cleaned', createdAt: { gte: now } },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).toMatchObject({ actorKind: 'system', weddingId: null });
    expect(log.data).toMatchObject({ now: now.toISOString() });
  });

  it('RN08 - a foto que voltou a ser usada antes da rodada não é apagada (reconferido na transação)', async () => {
    const weddingId = await wedding();
    const now = new Date();
    const id = await image({
      weddingId,
      status: 'ready',
      updatedAt: new Date(now.getTime() - 30 * HOUR_MS),
      unusedSince: new Date(now.getTime() - 25 * HOUR_MS),
    });
    // Entre a leitura dos candidatos e a transação do casamento, a Ana a põe como capa.
    const cleanup = worker.get<SiteImageCleanup>(SITE_IMAGE_CLEANUP);
    const list = cleanup.weddingsWithCandidates.bind(cleanup);
    const spy = jest
      .spyOn(cleanup, 'weddingsWithCandidates')
      .mockImplementationOnce(async (args) => {
        const weddings = await list(args);
        expect(weddings).toContain(weddingId);
        await db.siteImage.update({ where: { id }, data: { unusedSince: null } });
        return weddings;
      });

    await clean.execute({ now });

    expect(await exists(id)).toBe(true);
    expect(await files(id)).toBe(3);
    spy.mockRestore();
  });
});
