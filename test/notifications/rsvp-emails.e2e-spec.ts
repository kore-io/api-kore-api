import { getQueueToken } from '@nestjs/bullmq';
import type { TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { randomBytes, randomUUID } from 'node:crypto';
import { RsvpEmails } from '../../src/modules/notifications/application/rsvp-emails.use-cases';
import {
  NOTIFICATIONS_QUEUE,
  NOTIFICATIONS_SWEEP_SCHEDULER_ID,
} from '../../src/modules/notifications/infrastructure/notifications-queue';
import {
  NOTIFICATION_EMAIL_STORE,
  type NotificationEmailStore,
} from '../../src/modules/notifications/application/ports/notification-email-store.port';
import { APPLICATION_LOG_WRITER } from '../../src/modules/logs/application/ports/application-log-writer.port';
import { AppConfigService } from '../../src/shared/config/app-config.service';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestWorker } from '../support/create-test-worker';
import { inbox, waitForInbox } from '../support/mailpit';
import { seedWedding } from '../support/weddings';

const MAILPIT_API_URL = process.env.MAILPIT_API_URL ?? 'http://localhost:8025';
const MINUTE = 60_000;

/** Um fuso onde agora ainda não são 19h: a rotina real de 15 minutos não manda o resumo no meio do teste. */
function quietTimezone(): string {
  for (const zone of ['America/Sao_Paulo', 'Asia/Tokyo', 'Europe/London', 'Pacific/Auckland']) {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(new Date()),
    );
    if (hour < 19) return zone;
  }
  return 'America/Sao_Paulo';
}

/** O instante em que, no fuso, é hoje (no fuso) às hh:mm. */
function todayAt({
  timezone,
  hour,
  minute,
}: {
  timezone: string;
  hour: number;
  minute: number;
}): Date {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const offset = now.getTime() - local.getTime();
  const target = new Date(local);
  target.setHours(hour, minute, 0, 0);
  return new Date(target.getTime() + offset);
}

/** Os e-mails das respostas (E-mail e push RN01 a RN06 e RN09; worker e Mailpit). */
describe('E-mails das respostas (worker)', () => {
  let worker: TestingModule;
  let db: BackofficePrismaService;
  let emails: RsvpEmails;

  beforeAll(async () => {
    worker = await createTestWorker();
    db = worker.get(BackofficePrismaService);
    emails = worker.get(RsvpEmails);
  });

  afterAll(async () => {
    await worker?.close();
  });

  async function scenario({
    frequency,
    timezone = quietTimezone(),
  }: {
    frequency?: 'off' | 'immediate' | 'daily';
    timezone?: string;
  }) {
    const email = `ana.${randomUUID()}@kore.local`;
    const { id: userId } = await db.user.create({ data: { email, name: 'Ana Beatriz Moreira' } });
    const { weddingId } = await seedWedding({ db, ownerId: userId });
    await db.wedding.update({ where: { id: weddingId }, data: { timezone } });
    if (frequency)
      await db.notificationPreference.create({
        data: { userId, weddingId, type: 'rsvp', email: frequency },
      });
    const party = async (name: string) =>
      db.party.create({
        data: { weddingId, name, linkToken: randomBytes(16).toString('base64url') },
      });
    const moreira = await party('Família Moreira');
    const duarte = await party('Família Duarte');
    const entry = (partyId: string, name: string, at: Date, confirmed = 3, declined = 0) => ({
      partyId,
      name,
      confirmed,
      declined,
      at: at.toISOString(),
    });
    const notify = async (entries: ReturnType<typeof entry>[]) => {
      const updatedAt = new Date(Math.max(...entries.map((item) => Date.parse(item.at))));
      const existing = await db.notification.findFirst({
        where: { userId, weddingId, readAt: null },
      });
      if (existing)
        return db.notification.update({
          where: { id: existing.id },
          data: { payload: entries, count: entries.length, updatedAt },
        });
      return db.notification.create({
        data: {
          userId,
          weddingId,
          type: 'rsvp',
          groupKey: `rsvp:${weddingId}`,
          payload: entries,
          count: entries.length,
          updatedAt,
        },
      });
    };
    return { email, userId, weddingId, timezone, moreira, duarte, entry, notify };
  }
  const state = (userId: string, weddingId: string) =>
    db.notificationEmailState.findUnique({ where: { userId_weddingId: { userId, weddingId } } });
  const textOf = async (id: string) =>
    ((await (await fetch(`${MAILPIT_API_URL}/api/v1/message/${id}`)).json()) as { Text: string })
      .Text;

  it('RN04 - a rotina de 15 minutos fica agendada', async () => {
    const queue = worker.get<Queue>(getQueueToken(NOTIFICATIONS_QUEUE));
    expect(await queue.getJobScheduler(NOTIFICATIONS_SWEEP_SCHEDULER_ID)).toMatchObject({
      pattern: '*/15 * * * *',
    });
  });

  it('RN02 e RN03 - "Na hora": um e-mail com o que chegou; no intervalo de 15 minutos, espera; depois, só o que é novo', async () => {
    const { email, userId, weddingId, moreira, duarte, entry, notify } = await scenario({
      frequency: 'immediate',
    });
    const now = new Date();
    await notify([entry(moreira.id, 'Família Moreira', new Date(now.getTime() - MINUTE))]);
    await db.weddingStats.update({
      where: { weddingId },
      data: { confirmed: 96, declined: 18, pending: 28 },
    });

    expect(await emails.immediateAt({ userId, weddingId, now })).toEqual(now);
    expect(await emails.send({ userId, weddingId, mode: 'immediate', now })).toEqual({
      kind: 'sent',
    });
    const [first] = await waitForInbox({ to: email });
    expect(first.Subject).toBe('Família Moreira respondeu o convite');
    const text = await textOf(first.ID);
    expect(text).toContain('Olá, Ana.');
    expect(text).toContain('Família Moreira: 3 confirmados');
    expect(text).toContain(
      'No total, o casamento tem 96 confirmados, 18 recusados e 28 pendentes.',
    );
    expect(text).toContain('/app/configuracoes/notificacoes');
    expect(await state(userId, weddingId)).toMatchObject({ lastImmediateAt: now });

    // A Família Duarte responde 2 minutos depois: espera os 15 minutos do último.
    const later = new Date(now.getTime() + 2 * MINUTE);
    await notify([
      entry(moreira.id, 'Família Moreira', new Date(now.getTime() - MINUTE)),
      entry(duarte.id, 'Família Duarte', later, 2, 1),
    ]);
    expect(await emails.immediateAt({ userId, weddingId, now: later })).toEqual(
      new Date(now.getTime() + 15 * MINUTE),
    );
    expect(await emails.send({ userId, weddingId, mode: 'immediate', now: later })).toEqual({
      kind: 'later',
      at: new Date(now.getTime() + 15 * MINUTE),
    });

    const after = new Date(now.getTime() + 16 * MINUTE);
    await emails.send({ userId, weddingId, mode: 'immediate', now: after });
    const messages = await waitForInbox({ to: email, count: 2 });
    // Pelo assunto: dois e-mails no mesmo segundo vêm do Mailpit em qualquer ordem.
    expect(messages.map((message) => message.Subject).sort()).toEqual([
      'Família Duarte respondeu o convite',
      'Família Moreira respondeu o convite',
    ]);
    const second = messages.find((message) => message.Subject.startsWith('Família Duarte'));
    expect(await textOf(second!.ID)).not.toContain('Família Moreira');
  });

  it('RN04 - o Resumo diário: antes das 20h no fuso, nada; depois, um só no dia, mesmo rodando de novo', async () => {
    const { email, userId, weddingId, timezone, moreira, duarte, entry, notify } = await scenario(
      {},
    );
    const at = todayAt({ timezone, hour: 12, minute: 0 });
    await notify([
      entry(moreira.id, 'Família Moreira', at),
      entry(duarte.id, 'Família Duarte', new Date(at.getTime() + MINUTE), 2, 1),
    ]);

    const before = todayAt({ timezone, hour: 19, minute: 59 });
    expect(await emails.send({ userId, weddingId, mode: 'digest', now: before })).toEqual({
      kind: 'skipped',
    });
    const evening = todayAt({ timezone, hour: 20, minute: 10 });
    expect(await emails.send({ userId, weddingId, mode: 'digest', now: evening })).toEqual({
      kind: 'sent',
    });
    const [digest] = await waitForInbox({ to: email });
    expect(digest.Subject).toBe('Resumo do dia: 2 grupos responderam');
    expect(await textOf(digest.ID)).toContain('Hoje, 2 grupos responderam o convite:');

    await notify([
      entry(moreira.id, 'Família Moreira', at),
      entry(duarte.id, 'Família Duarte', new Date(at.getTime() + MINUTE), 2, 1),
      entry(moreira.id, 'Família Moreira', new Date(evening.getTime() + MINUTE), 4, 0),
    ]);
    expect(
      await emails.send({
        userId,
        weddingId,
        mode: 'digest',
        now: new Date(evening.getTime() + 15 * MINUTE),
      }),
    ).toEqual({ kind: 'skipped' });
    expect(await inbox({ to: email })).toHaveLength(1);
  });

  it('RN05 e RN09 - e-mail desligado e quem perdeu o vínculo não recebem', async () => {
    const off = await scenario({ frequency: 'off' });
    await off.notify([off.entry(off.moreira.id, 'Família Moreira', new Date())]);
    expect(
      await emails.send({
        userId: off.userId,
        weddingId: off.weddingId,
        mode: 'immediate',
        now: new Date(),
      }),
    ).toEqual({ kind: 'skipped' });

    const removed = await scenario({ frequency: 'immediate' });
    await removed.notify([removed.entry(removed.moreira.id, 'Família Moreira', new Date())]);
    await db.membership.updateMany({
      where: { weddingId: removed.weddingId },
      data: { removedAt: new Date() },
    });
    expect(
      await emails.send({
        userId: removed.userId,
        weddingId: removed.weddingId,
        mode: 'immediate',
        now: new Date(),
      }),
    ).toEqual({ kind: 'skipped' });
    expect(await inbox({ to: off.email })).toHaveLength(0);
    expect(await inbox({ to: removed.email })).toHaveLength(0);
  });

  it('RN06 - o envio recusado não avança o cursor e grava notification.email_failed; o próximo leva o que faltou', async () => {
    const { userId, weddingId, moreira, entry, notify } = await scenario({});
    await notify([entry(moreira.id, 'Família Moreira', new Date(Date.now() - 20 * MINUTE))]);
    // O sweep recortado ao casamento deste teste: o kore_test é compartilhado e
    // cresce, e varrer todos os candidatos estourava o tempo do caso.
    const store = worker.get<NotificationEmailStore>(NOTIFICATION_EMAIL_STORE);
    const scoped: NotificationEmailStore = Object.assign(
      Object.create(store) as NotificationEmailStore,
      {
        candidates: () => Promise.resolve([{ userId, weddingId }]),
      },
    );
    const failing = new RsvpEmails(
      scoped,
      { send: () => Promise.reject(new Error('SMTP fora')) },
      worker.get(APPLICATION_LOG_WRITER),
      worker.get(AppConfigService),
    );
    await db.notificationPreference.create({
      data: { userId, weddingId, type: 'rsvp', email: 'immediate' },
    });

    const result = await failing.sweep({ now: new Date() });

    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect((await state(userId, weddingId))?.emailedThrough ?? null).toBeNull();
    expect(
      await db.applicationLog.count({
        where: { weddingId, action: 'notification.email_failed', entityId: userId },
      }),
    ).toBeGreaterThanOrEqual(1);
    // A rede de segurança manda o "Na hora" que esperou mais de 15 minutos.
    expect(await emails.send({ userId, weddingId, mode: 'catch_up', now: new Date() })).toEqual({
      kind: 'sent',
    });
  });

  it('RN03 - o aviso da API vira um e-mail "Na hora" pela fila', async () => {
    const { email, userId, weddingId, moreira, entry, notify } = await scenario({
      frequency: 'immediate',
    });
    await notify([entry(moreira.id, 'Família Moreira', new Date())]);
    const queue = worker.get<Queue>(getQueueToken(NOTIFICATIONS_QUEUE));

    await queue.add('notified', { weddingId, userIds: [userId] });

    const [message] = await waitForInbox({ to: email });
    expect(message.Subject).toBe('Família Moreira respondeu o convite');
  });
});
