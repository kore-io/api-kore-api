import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { ReleaseCommissions } from '../../src/modules/billing/application/release-commissions.use-case';
import { addMonths } from '../../src/modules/billing/domain/pricing';
import { CommissionEmails } from '../../src/modules/notifications/application/commission-emails.use-case';
import { COMMISSION_EMAIL_STORE } from '../../src/modules/notifications/application/ports/commission-email-store.port';
import type { CommissionEmailStore } from '../../src/modules/notifications/application/ports/commission-email-store.port';
import { PUSH_STORE } from '../../src/modules/notifications/application/ports/push-store.port';
import type { PushTarget } from '../../src/modules/notifications/application/ports/push-sender.port';
import { RsvpPush } from '../../src/modules/notifications/application/rsvp-push.use-case';
import { AppConfigService } from '../../src/shared/config/app-config.service';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { localDate } from '../../src/shared/time/local-date';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { inbox, waitForInbox } from '../support/mailpit';
import { publishByPayment } from '../support/payments';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const MAILPIT_API_URL = process.env.MAILPIT_API_URL ?? 'http://localhost:8025';

/**
 * Os avisos da comissão disponível (Comissões do indicador RN09; decisão 242):
 * o item na central da cerimonialista, o push sem valor e o e-mail "Você tem
 * comissão disponível" pela preferência geral (Na hora, Resumo diário, Desligado).
 */
describe('Comissão disponível: central, push e e-mail (Comissões RN09; decisão 242; banco real)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;
  const today = localDate({ at: new Date(), timezone: 'America/Sao_Paulo' });
  const eventDate = addMonths({ day: today, months: 4 });
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

  /**
   * Juliana indicou Ana pelo link (sem colaborar no casamento), Ana pagou e a
   * rodada liberou a comissão. `email`: a preferência geral `commission`.
   */
  async function released({ email }: { email?: 'off' | 'immediate' | 'daily' } = {}) {
    const juliana = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId: juliana.userId } });
    const { email: address } = await db.user.findUniqueOrThrow({
      where: { id: juliana.userId },
      select: { email: true },
    });
    if (email)
      await db.notificationPreference.create({
        data: { userId: juliana.userId, weddingId: null, type: 'commission', email },
      });
    const ana = await signedInUser({ app });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        eventDate: new Date(`${eventDate}T00:00:00Z`),
        referrerId: referrer.id,
        referralSource: 'referral_link',
      },
    });
    const { paymentId } = await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate });
    const commission = await db.commission.findUniqueOrThrow({ where: { paymentId } });
    const now = new Date(commission.availableAt.getTime() + 60_000);
    await worker.get(ReleaseCommissions).execute({ now, referrerId: referrer.id });
    return { ...juliana, address, weddingId, commission, now };
  }

  async function text(id: string): Promise<string> {
    const response = await fetch(`${MAILPIT_API_URL}/api/v1/message/${id}`);
    return ((await response.json()) as { Text: string }).Text;
  }

  it('RN09 - o item na central dela (sem colaborar), com o filtro Comissão', async () => {
    const juliana = await released();
    const cookie = await openSession({ app, userId: juliana.userId });

    const all = await http()
      .get('/v1/me/notifications')
      .query({ scope: 'planner' })
      .set('Cookie', cookie)
      .expect(200);
    // A publicação também avisa quem indicou (Notificações da cerimonialista RN03).
    expect((all.body.items as { type: string }[]).map((item) => item.type).sort()).toEqual([
      'commission',
      'wedding_published',
    ]);
    const filtered = await http()
      .get('/v1/me/notifications')
      .query({ scope: 'planner', type: 'commission' })
      .set('Cookie', cookie)
      .expect(200);
    expect(filtered.body.items).toEqual([
      expect.objectContaining({
        type: 'commission',
        weddingId: juliana.weddingId,
        partnerNames: ['Ana', 'Marcos'],
        payload: [
          expect.objectContaining({
            commissionId: juliana.commission.id,
            amountCents: juliana.commission.amountCents,
          }),
        ],
      }),
    ]);
  });

  it('decisão 242 - Na hora: um e-mail na rodada da liberação, sem valor', async () => {
    const juliana = await released({ email: 'immediate' });

    const [mail] = await waitForInbox({ to: juliana.address });
    expect(mail.Subject).toBe('Você tem comissão disponível');
    const body = await text(mail.ID);
    expect(body).toContain('Olá, Juliana!');
    expect(body).toContain('Uma comissão ficou disponível. Veja o valor e peça o repasse no Kore.');
    expect(body).toContain('/cerimonialista/comissoes');
    expect(body).not.toMatch(/R\$/);
    // O mesmo cursor: o Resumo diário não repete o que já foi na hora.
    expect(
      await worker.get(CommissionEmails).send({ userId: juliana.userId, mode: 'immediate' }),
    ).toBe(false);
  });

  it('decisão 242 - Resumo diário (o padrão): um e-mail às 20h e não de novo; Desligado, nenhum', async () => {
    const juliana = await released();
    const store = worker.get<CommissionEmailStore>(COMMISSION_EMAIL_STORE);
    const emails = worker.get(CommissionEmails);

    // O "Na hora" da rodada não manda em Resumo diário.
    expect(await emails.send({ userId: juliana.userId, mode: 'immediate' })).toBe(false);
    expect(await store.dailyCandidates()).toContain(juliana.userId);
    expect(await emails.send({ userId: juliana.userId, mode: 'daily' })).toBe(true);
    const [mail] = await waitForInbox({ to: juliana.address });
    expect(mail.Subject).toBe('Você tem comissão disponível');
    expect(await store.dailyCandidates()).not.toContain(juliana.userId);
    expect(await emails.send({ userId: juliana.userId, mode: 'daily' })).toBe(false);

    const off = await released({ email: 'off' });
    expect(await store.dailyCandidates()).not.toContain(off.userId);
    expect(await emails.send({ userId: off.userId, mode: 'daily' })).toBe(false);
    expect(await inbox({ to: off.address })).toHaveLength(0);
  });

  it('RN09 - o push sem valor, que abre Comissões', async () => {
    const juliana = await released();
    await db.notificationPreference.create({
      data: { userId: juliana.userId, weddingId: null, type: 'commission', push: true },
    });
    const session = await db.session.create({
      data: {
        userId: juliana.userId,
        tokenHash: randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 86_400_000),
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
    const push = new RsvpPush(
      worker.get(PUSH_STORE),
      {
        enabled: () => true,
        send: ({ target, payload }) => {
          calls.push({ target, payload: JSON.parse(payload) as Record<string, unknown> });
          return Promise.resolve('sent' as const);
        },
      },
      worker.get(AppConfigService),
    );

    await push.send({
      userId: juliana.userId,
      weddingId: juliana.weddingId,
      type: 'commission',
      now: new Date(),
    });

    expect(calls.map((call) => call.payload)).toEqual([
      {
        title: 'Kore',
        body: 'Comissão de Ana e Marcos disponível para repasse',
        tag: `commission:${juliana.commission.id}`,
        url: expect.stringMatching(/\/cerimonialista\/comissoes$/),
      },
    ]);
  });
});
