import type { TestingModule } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import { PlannerDigest } from '../../src/modules/notifications/application/planner-digest.use-case';
import {
  NOTIFICATION_EMAIL_STORE,
  type NotificationEmailStore,
} from '../../src/modules/notifications/application/ports/notification-email-store.port';
import {
  PLANNER_DIGEST_STORE,
  type PlannerDigestStore,
} from '../../src/modules/notifications/application/ports/planner-digest-store.port';
import type {
  PushResult,
  PushTarget,
} from '../../src/modules/notifications/application/ports/push-sender.port';
import { PUSH_STORE } from '../../src/modules/notifications/application/ports/push-store.port';
import { RsvpEmails } from '../../src/modules/notifications/application/rsvp-emails.use-cases';
import { RsvpPush } from '../../src/modules/notifications/application/rsvp-push.use-case';
import { AppConfigService } from '../../src/shared/config/app-config.service';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestWorker } from '../support/create-test-worker';
import { inbox, waitForInbox } from '../support/mailpit';
import { seedReferrer } from '../support/referrers';
import { seedWedding } from '../support/weddings';

const MAILPIT_API_URL = process.env.MAILPIT_API_URL ?? 'http://localhost:8025';
const DAY_MS = 86_400_000;

/**
 * O envio para a cerimonialista (Notificações da cerimonialista RN06 e RN07;
 * worker e Mailpit): o e-mail na hora e o push com os textos dela e a
 * preferência geral, o Resumo agrupado às 20h de São Paulo, e a reconferência
 * do vínculo na hora de mandar (D18).
 */
describe('Envio das notificações da cerimonialista (worker)', () => {
  let worker: TestingModule;
  let db: BackofficePrismaService;
  let emails: RsvpEmails;
  let digest: PlannerDigest;

  beforeAll(async () => {
    worker = await createTestWorker();
    db = worker.get(BackofficePrismaService);
    emails = worker.get(RsvpEmails);
    digest = worker.get(PlannerDigest);
  });

  afterAll(async () => {
    await worker?.close();
  });

  /**
   * Um dia futuro às 20h30 de São Paulo (23h30 UTC): longe do "hoje" da rotina
   * real de 15 minutos que roda no worker de teste.
   */
  const evening = (days: number) => {
    const date = new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
    return new Date(`${date}T23:30:00Z`);
  };
  const textOf = async (id: string) =>
    ((await (await fetch(`${MAILPIT_API_URL}/api/v1/message/${id}`)).json()) as { Text: string })
      .Text;

  async function planner() {
    const juliana = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const { email } = await db.user.findUniqueOrThrow({ where: { id: juliana.userId } });
    return { userId: juliana.userId, email };
  }

  /** Ana e Marcos, com a cerimonialista colaboradora, e uma resposta não lida para ela. */
  async function collaboration({ userId }: { userId: string }) {
    const { id: anaId } = await db.user.create({
      data: { email: `ana.${randomUUID()}@kore.local`, name: 'Ana Beatriz' },
    });
    const { weddingId } = await seedWedding({ db, ownerId: anaId, collaboratorIds: [userId] });
    const party = await db.party.create({
      data: {
        weddingId,
        name: 'Família Moreira',
        linkToken: randomBytes(16).toString('base64url'),
      },
    });
    const at = new Date(Date.now() - 60_000);
    await db.notification.create({
      data: {
        userId,
        weddingId,
        type: 'rsvp',
        groupKey: `rsvp:${weddingId}`,
        payload: [
          {
            partyId: party.id,
            name: 'Família Moreira',
            confirmed: 2,
            declined: 0,
            at: at.toISOString(),
          },
        ],
        updatedAt: at,
      },
    });
    return { anaId, weddingId };
  }

  const generalPreference = (
    userId: string,
    type: 'rsvp' | 'wedding_published',
    data: { email?: 'off' | 'immediate' | 'daily'; push?: boolean },
  ) => db.notificationPreference.create({ data: { userId, weddingId: null, type, ...data } });

  it('RN07 - na hora, pela preferência geral: o texto dela, sem o nome do grupo', async () => {
    const juliana = await planner();
    const { weddingId } = await collaboration(juliana);
    await generalPreference(juliana.userId, 'rsvp', { email: 'immediate' });

    expect(
      await emails.send({ userId: juliana.userId, weddingId, mode: 'immediate', now: new Date() }),
    ).toEqual({ kind: 'sent' });

    const [message] = await waitForInbox({ to: juliana.email });
    expect(message.Subject).toBe('1 grupo respondeu em Ana e Marcos');
    const text = await textOf(message.ID);
    expect(text).toContain('Olá, Juliana.');
    expect(text).toContain('Hoje, 1 grupo respondeu o convite de Ana e Marcos.');
    expect(text).toContain(`/cerimonialista/casamentos/${weddingId}`);
    expect(text).not.toContain('Família Moreira');
  });

  it('RN06 - a preferência do casamento não vale para ela; sem a geral, o padrão é o resumo', async () => {
    const juliana = await planner();
    const { weddingId } = await collaboration(juliana);
    await db.notificationPreference.create({
      data: { userId: juliana.userId, weddingId, type: 'rsvp', email: 'immediate' },
    });

    expect(
      await emails.send({ userId: juliana.userId, weddingId, mode: 'immediate', now: new Date() }),
    ).toEqual({ kind: 'skipped' });
  });

  it('D18 - removida antes do envio: o que estava na fila é descartado; o vendedor não recebe', async () => {
    const juliana = await planner();
    const { weddingId } = await collaboration(juliana);
    await generalPreference(juliana.userId, 'rsvp', { email: 'immediate', push: true });
    await db.membership.updateMany({
      where: { weddingId, userId: juliana.userId },
      data: { removedAt: new Date() },
    });

    expect(
      await emails.send({ userId: juliana.userId, weddingId, mode: 'immediate', now: new Date() }),
    ).toEqual({ kind: 'skipped' });
    expect(await inbox({ to: juliana.email })).toEqual([]);

    const lucas = await seedReferrer({ db, kind: 'seller', name: 'Lucas Andrade' });
    const seller = await collaboration({ userId: lucas.userId });
    await generalPreference(lucas.userId, 'rsvp', { email: 'immediate' });
    expect(
      await emails.send({
        userId: lucas.userId,
        weddingId: seller.weddingId,
        mode: 'immediate',
        now: new Date(),
      }),
    ).toEqual({ kind: 'skipped' });
  });

  it('RN07 - o push dela: o casal, sem o nome do grupo, e a central dela', async () => {
    const juliana = await planner();
    const { weddingId } = await collaboration(juliana);
    await generalPreference(juliana.userId, 'rsvp', { push: true });
    const session = await db.session.create({
      data: {
        userId: juliana.userId,
        tokenHash: randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + DAY_MS),
        lastSeenAt: new Date(),
        authenticatedAt: new Date(),
        authMethod: 'email',
      },
    });
    await db.pushSubscription.create({
      data: {
        userId: juliana.userId,
        sessionId: session.id,
        endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString('hex')}`,
        p256dh: 'p',
        auth: 'a',
      },
    });
    const calls: { target: PushTarget; payload: Record<string, unknown> }[] = [];
    const sender = {
      enabled: () => true,
      send: ({ target, payload }: { target: PushTarget; payload: string }) => {
        calls.push({ target, payload: JSON.parse(payload) as Record<string, unknown> });
        return Promise.resolve('sent' as PushResult);
      },
    };

    await new RsvpPush(worker.get(PUSH_STORE), sender, worker.get(AppConfigService)).send({
      userId: juliana.userId,
      weddingId,
      now: new Date(),
    });

    expect(calls.map((call) => call.payload)).toEqual([
      {
        title: 'Kore',
        body: 'Novas respostas em Ana e Marcos',
        tag: `rsvp:${weddingId}`,
        url: 'http://localhost:5173/cerimonialista/notificacoes',
      },
    ]);
  });

  it('RN07 - o Resumo agrupado às 20h de São Paulo: um e-mail com um bloco por casamento, uma vez por dia', async () => {
    const juliana = await planner();
    const collaborating = await collaboration(juliana);
    // Um casamento que veio pelo link dela, publicado, sem vínculo.
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId: juliana.userId } });
    const { id: biancaId } = await db.user.create({
      data: { email: `bianca.${randomUUID()}@kore.local` },
    });
    const referred = await seedWedding({ db, ownerId: biancaId });
    await db.wedding.update({
      where: { id: referred.weddingId },
      data: { referrerId: referrer.id, referralSource: 'referral_link' },
    });
    await db.notification.create({
      data: {
        userId: juliana.userId,
        weddingId: referred.weddingId,
        type: 'wedding_published',
        groupKey: `wedding_published:${referred.weddingId}`,
        payload: [{ partnerNames: ['Ana', 'Marcos'] }],
      },
    });
    const now = evening(3);

    expect(await digest.send({ userId: juliana.userId, now })).toBe(true);

    const [message] = await waitForInbox({ to: juliana.email });
    expect(message.Subject).toBe('Resumo do dia: novidades em 2 casamentos');
    const text = await textOf(message.ID);
    expect(text).toContain('Hoje, nos seus casamentos:');
    expect(text).toContain('1 grupo respondeu');
    expect(text).toContain('Site publicado');
    expect(text).not.toContain('Família Moreira');
    expect(
      (await db.notificationDigestState.findUniqueOrThrow({ where: { userId: juliana.userId } }))
        .lastDigestDate,
    ).toEqual(new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`));
    for (const weddingId of [collaborating.weddingId, referred.weddingId])
      expect(
        (
          await db.notificationEmailState.findUniqueOrThrow({
            where: { userId_weddingId: { userId: juliana.userId, weddingId } },
          })
        ).emailedThrough,
      ).not.toBeNull();

    // No mesmo dia, não sai outro.
    expect(await digest.send({ userId: juliana.userId, now })).toBe(false);
    expect(await inbox({ to: juliana.email })).toHaveLength(1);
  });

  it('RN07 e D18 - antes das 20h nada sai; a colaboração encerrada e o casamento de que é dona ficam fora', async () => {
    const juliana = await planner();
    const { weddingId } = await collaboration(juliana);
    // Antes das 20h de São Paulo (19h59 = 22h59 UTC), a rotina não manda.
    const date = new Date(Date.now() + 4 * DAY_MS).toISOString().slice(0, 10);
    expect(await digest.sweep({ now: new Date(`${date}T22:59:00Z`) })).toEqual({
      sent: 0,
      failed: 0,
    });
    expect(await inbox({ to: juliana.email })).toEqual([]);

    await db.membership.updateMany({
      where: { weddingId, userId: juliana.userId },
      data: { removedAt: new Date() },
    });
    const own = await seedWedding({ db, ownerId: juliana.userId });
    await db.notification.create({
      data: {
        userId: juliana.userId,
        weddingId: own.weddingId,
        type: 'rsvp',
        groupKey: `rsvp:${own.weddingId}`,
        payload: [
          {
            partyId: randomUUID(),
            name: 'Família Prado',
            confirmed: 1,
            declined: 0,
            at: new Date().toISOString(),
          },
        ],
      },
    });

    expect(await digest.send({ userId: juliana.userId, now: evening(5) })).toBe(false);
    expect(await inbox({ to: juliana.email })).toEqual([]);
  });

  it('RN07 - com a preferência geral fora do resumo, a resposta não entra', async () => {
    const juliana = await planner();
    await collaboration(juliana);
    await generalPreference(juliana.userId, 'rsvp', { email: 'off' });

    expect(await digest.send({ userId: juliana.userId, now: evening(6) })).toBe(false);
  });

  it('RN04 e D18 - a rotina de 15 minutos só varre quem ainda pode receber', async () => {
    const pairs = async () =>
      (await worker.get<NotificationEmailStore>(NOTIFICATION_EMAIL_STORE).candidates()).map(
        ({ userId, weddingId }) => `${userId}:${weddingId}`,
      );
    const digestUsers = () => worker.get<PlannerDigestStore>(PLANNER_DIGEST_STORE).candidates();

    // A cerimonialista em "Na hora" entra nas duas listas que lhe cabem só pela preferência.
    const immediate = await planner();
    const a = await collaboration(immediate);
    await generalPreference(immediate.userId, 'rsvp', { email: 'immediate' });
    // No padrão (Resumo diário): fora da rotina por casamento, dentro do agrupado.
    const daily = await planner();
    const b = await collaboration(daily);
    // Com o e-mail desligado: fora das duas.
    const off = await planner();
    const c = await collaboration(off);
    await generalPreference(off.userId, 'rsvp', { email: 'off' });
    // Removida: fora das duas.
    const removed = await planner();
    const d = await collaboration(removed);
    await generalPreference(removed.userId, 'rsvp', { email: 'immediate' });
    await db.membership.updateMany({
      where: { weddingId: d.weddingId, userId: removed.userId },
      data: { removedAt: new Date() },
    });
    // O vendedor: fora das duas.
    const lucas = await seedReferrer({ db, kind: 'seller', name: 'Lucas Andrade' });
    const e = await collaboration({ userId: lucas.userId });
    await generalPreference(lucas.userId, 'rsvp', { email: 'immediate' });
    // A dona com o e-mail do casamento desligado: fora; no padrão, dentro.
    const ownerOff = await db.notification.create({
      data: {
        userId: a.anaId,
        weddingId: a.weddingId,
        type: 'rsvp',
        groupKey: `rsvp:${a.weddingId}`,
        payload: [],
      },
    });
    await db.notification.create({
      data: {
        userId: b.anaId,
        weddingId: b.weddingId,
        type: 'rsvp',
        groupKey: `rsvp:${b.weddingId}`,
        payload: [],
      },
    });
    await db.notificationPreference.create({
      data: { userId: ownerOff.userId, weddingId: a.weddingId, type: 'rsvp', email: 'off' },
    });

    const found = await pairs();
    expect(found).toContain(`${immediate.userId}:${a.weddingId}`);
    expect(found).toContain(`${b.anaId}:${b.weddingId}`);
    for (const pair of [
      `${daily.userId}:${b.weddingId}`,
      `${off.userId}:${c.weddingId}`,
      `${removed.userId}:${d.weddingId}`,
      `${lucas.userId}:${e.weddingId}`,
      `${a.anaId}:${a.weddingId}`,
    ])
      expect(found).not.toContain(pair);

    const users = await digestUsers();
    expect(users).toContain(daily.userId);
    for (const userId of [immediate.userId, off.userId, removed.userId, lucas.userId])
      expect(users).not.toContain(userId);
  });
});
