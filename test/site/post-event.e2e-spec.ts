import { getQueueToken } from '@nestjs/bullmq';
import type { TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { MoveToPostEvent } from '../../src/modules/site/application/move-to-post-event.use-case';
import {
  POST_EVENT_QUEUE,
  POST_EVENT_SCHEDULER_ID,
} from '../../src/modules/site/infrastructure/post-event.job';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestWorker } from '../support/create-test-worker';
import { seedWedding } from '../support/weddings';

/** A passagem ao pós-evento (Publicação RN08; decisão 216, D4; worker). */
describe('Pós-evento (worker)', () => {
  let worker: TestingModule;
  let db: BackofficePrismaService;
  let move: MoveToPostEvent;

  beforeAll(async () => {
    worker = await createTestWorker();
    db = worker.get(BackofficePrismaService);
    move = worker.get(MoveToPostEvent);
  });

  afterAll(async () => {
    await worker?.close();
  });

  /** Um casamento publicado em 14/11/2026, no fuso pedido. */
  async function published({ timezone = 'America/Sao_Paulo', status = 'published' } = {}) {
    const { id: ownerId } = await db.user.create({
      data: { email: `pos.${randomUUID()}@kore.local` },
    });
    const { weddingId } = await seedWedding({ db, ownerId });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        status: status as 'published',
        timezone,
        eventDate: new Date('2026-11-14T00:00:00Z'),
        endDate: new Date('2027-02-14T00:00:00Z'),
        publishedAt: new Date('2026-09-01T12:00:00Z'),
        publicationSource: 'courtesy',
      },
    });
    return weddingId;
  }
  const status = async (id: string) =>
    (await db.wedding.findUniqueOrThrow({ where: { id } })).status;
  const logs = (weddingId: string) =>
    db.applicationLog.count({ where: { weddingId, action: 'wedding.post_event' } });

  it('RN08 - com o worker no ar, a rotina fica agendada todo dia de madrugada', async () => {
    const queue = worker.get<Queue>(getQueueToken(POST_EVENT_QUEUE));

    expect(await queue.getJobScheduler(POST_EVENT_SCHEDULER_ID)).toMatchObject({
      pattern: '15 3 * * *',
      tz: 'America/Sao_Paulo',
    });
  });

  it('RN08 - no dia seguinte ao casamento, no fuso dele, o casamento fica em pós-evento; rodar de novo não muda nada', async () => {
    const weddingId = await published();

    // 14/11 às 23h50 em São Paulo: ainda é o dia do casamento.
    await move.execute({ now: new Date('2026-11-15T02:50:00Z') });
    expect(await status(weddingId)).toBe('published');

    // 15/11 às 00h10 em São Paulo.
    await move.execute({ now: new Date('2026-11-15T03:10:00Z') });
    expect(await status(weddingId)).toBe('post_event');
    expect(await logs(weddingId)).toBe(1);

    await move.execute({ now: new Date('2026-11-15T03:20:00Z') });
    expect(await status(weddingId)).toBe('post_event');
    expect(await logs(weddingId)).toBe(1);
  });

  it('RN08 - vale o fuso do casamento, não o do cron: no Acre ainda é o dia do casamento', async () => {
    const acre = await published({ timezone: 'America/Rio_Branco' });
    const saoPaulo = await published();

    // 15/11 às 01h em São Paulo = 14/11 às 23h no Acre.
    await move.execute({ now: new Date('2026-11-15T04:00:00Z') });

    expect(await status(saoPaulo)).toBe('post_event');
    expect(await status(acre)).toBe('published');
  });

  it('RN08 - só o publicado muda: rascunho com a data passada fica como está', async () => {
    const draft = await published({ status: 'draft' });

    await move.execute({ now: new Date('2026-12-01T12:00:00Z') });

    expect(await status(draft)).toBe('draft');
    expect(await logs(draft)).toBe(0);
  });
});
