import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { addMonths } from '@/modules/billing/domain/payments/pricing';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { localDate } from '@/shared/kernel/time/local-date';
import { createTestApp } from '../support/harness/create-test-app';
import { createTestWorker } from '../support/harness/create-test-worker';
import { messageText, waitForInbox } from '../support/harness/mailpit';
import { publishByPayment } from '../support/factories/payments';
import { seedReferrer } from '../support/factories/referrers';
import { openSession, signedInUser, staffUser } from '../support/harness/sessions';
import { seedWedding } from '../support/factories/weddings';

const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';
const day = (value: string) => new Date(`${value}T00:00:00Z`);
const HOUR_MS = 60 * 60_000;

/**
 * Ajudar a recuperar o acesso (Backoffice - acesso RN09; decisão 253): a
 * troca do e-mail de acesso pelo staff, os limites, a trava e as 48 h.
 */
describe('Backoffice: trocar o e-mail de acesso (Backoffice - acesso RN09; decisão 253; banco real)', () => {
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
  const change = (cookie: string, weddingId: string, body: Record<string, unknown>) =>
    http()
      .put(`/v1/admin/weddings/${weddingId}/access-email`)
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({
        checks: { eventDateAndCity: true, partnerName: true },
        reason: 'Casal perdeu o acesso ao e-mail antigo.',
        ...body,
      });
  const unlock = (cookie: string, weddingId: string) =>
    http()
      .post(`/v1/admin/weddings/${weddingId}/access-email/unlock`)
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send({ reason: 'Casal confirmou os dados por telefone.' });
  const newEmail = () => `ana.nova.${randomUUID()}@gmail.com`;
  type Person = {
    userId: string;
    since: string;
    accessChangeLockedUntil: string | null;
    accessEmailAdminOnlyUntil: string | null;
  };
  /** O geral do detalhe: as Pessoas com acesso e o estado do Dialog (316(11)(b) e (f)). */
  const general = async (cookie: string, weddingId: string) =>
    (await http().get(`/v1/admin/weddings/${weddingId}`).set('Cookie', cookie).expect(200)).body
      .general as {
      people: Person[];
      accessEmailChange: { payerCheck: boolean; lockedUntil: string | null };
    };

  /** Ana publicou e pagou com o CPF que termina em 4725; Juliana colabora. */
  async function paidWedding() {
    const ana = await signedInUser({ app });
    const juliana = await signedInUser({ app, name: 'Juliana Prado' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    await db.wedding.update({ where: { id: weddingId }, data: { eventDate: day(eventDate) } });
    await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate });
    await db.authIdentity.create({
      data: { userId: ana.userId, provider: 'google', providerSubject: `g-${randomUUID()}` },
    });
    return { ana, juliana, weddingId };
  }

  it('RN09 - o suporte troca o e-mail de Ana: sessões e Google apagados, alerta, log e os dois e-mails', async () => {
    const support = await staffUser({ app, role: 'support' });
    const { ana, weddingId } = await paidWedding();
    const target = newEmail();

    expect(
      (
        await change(support.cookie, weddingId, {
          userId: ana.userId,
          newEmail: target,
          payerLast4: '4725',
        }).expect(200)
      ).body,
    ).toEqual({ status: 'changed' });
    const user = await db.user.findUniqueOrThrow({ where: { id: ana.userId } });
    expect(user.email).toBe(target);
    expect(user.accessEmailChangedAt).toEqual(expect.any(Date));
    await http().get('/v1/me').set('Cookie', ana.cookie).expect(401);
    expect(await db.authIdentity.count({ where: { userId: ana.userId } })).toBe(0);
    await db.alert.findFirstOrThrow({
      where: {
        type: 'access_email_changed',
        entityType: 'user',
        entityId: ana.userId,
        status: 'open',
      },
    });
    const log = await db.applicationLog.findFirstOrThrow({
      where: { action: 'user.access_email_changed', entityId: ana.userId },
    });
    expect(log).toMatchObject({ actorUserId: support.userId, ipHash: expect.any(String) });
    expect(JSON.stringify(log.data)).not.toContain(target);

    // Pelo assunto: a Ana também recebe o "Pagamento confirmado", assíncrono,
    // que pode chegar depois e tomar o lugar na ordem do Mailpit (o CI do #164).
    const [toNew] = await waitForInbox({
      to: target,
      subject: 'Seu novo e-mail de acesso ao Kore',
    });
    const [toOld] = await waitForInbox({
      to: ana.email,
      subject: 'O e-mail de acesso da sua conta mudou',
    });

    // Os corpos (RN09): o botão Entrar no Kore entra uma vez só com o endereço
    // novo; o aviso ao antigo traz o novo só mascarado.
    const newText = await messageText({ id: toNew.ID });
    const token = /Entrar no Kore: \S+token=([\w-]+)/.exec(newText)?.[1];
    expect(token).toEqual(expect.any(String));
    const verify = () =>
      http()
        .post('/v1/auth/login-challenges/verify')
        .set('X-Forwarded-For', '10.9.9.9')
        .send({ token });
    await verify().expect(200);
    await verify().expect(410);
    const oldText = await messageText({ id: toOld.ID });
    expect(oldText).toContain(
      `trocou o e-mail de acesso da sua conta para ${target.slice(0, 3)}***@gmail.com.`,
    );
    expect(oldText).not.toContain(target);
  });

  it('RN09 - sem pagamento, a terceira confirmação some: a troca vale sem os 4 dígitos', async () => {
    const support = await staffUser({ app, role: 'support' });
    const ana = await signedInUser({ app });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    const target = newEmail();
    // Decisão 316(11)(b) e (f): o Dialog sabe antes que não há 3ª conferência, e a
    // pessoa traz o "desde" (a data do vínculo).
    const before = await general(support.cookie, weddingId);
    expect(before.accessEmailChange).toEqual({ payerCheck: false, lockedUntil: null });
    const membership = await db.membership.findFirstOrThrow({
      where: { weddingId, userId: ana.userId },
    });
    expect(before.people).toEqual([
      expect.objectContaining({
        userId: ana.userId,
        since: membership.createdAt.toISOString(),
        accessEmailAdminOnlyUntil: null,
      }),
    ]);

    expect(
      (
        await change(support.cookie, weddingId, { userId: ana.userId, newEmail: target }).expect(
          200,
        )
      ).body,
    ).toEqual({ status: 'changed' });
    expect((await db.user.findUniqueOrThrow({ where: { id: ana.userId } })).email).toBe(target);
  });

  it('RN09 - nunca de quem tem platformRole: 403 ACTION_NOT_ALLOWED, sem mudar nada', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const owner = await staffUser({ app, role: 'support', name: 'Bruno Tavares' });
    const { weddingId } = await seedWedding({ db, ownerId: owner.userId });

    const refused = await change(admin.cookie, weddingId, {
      userId: owner.userId,
      newEmail: newEmail(),
    }).expect(403);
    expect(refused.body.error).toBe('ACTION_NOT_ALLOWED');
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.userId } })).email).toBe(
      owner.email,
    );
  });

  it('RN09 - as recusas: confirmação faltando, dígitos faltando ou errados, colaboradora, e-mail em uso', async () => {
    const support = await staffUser({ app, role: 'support' });
    const { ana, juliana, weddingId } = await paidWedding();
    const code = async (body: Record<string, unknown>, status: number) =>
      (await change(support.cookie, weddingId, body).expect(status)).body.error as string;

    expect(
      await code(
        {
          userId: ana.userId,
          newEmail: newEmail(),
          payerLast4: '4725',
          checks: { eventDateAndCity: true, partnerName: false },
        },
        422,
      ),
    ).toBe('CHECKS_REQUIRED');
    expect(await code({ userId: ana.userId, newEmail: newEmail() }, 422)).toBe('CHECKS_REQUIRED');
    expect(await code({ userId: ana.userId, newEmail: newEmail(), payerLast4: '0000' }, 422)).toBe(
      'CHECKS_FAILED',
    );
    expect((await db.user.findUniqueOrThrow({ where: { id: ana.userId } })).email).toBe(ana.email);
    expect(
      await code({ userId: juliana.userId, newEmail: newEmail(), payerLast4: '4725' }, 403),
    ).toBe('ACTION_NOT_ALLOWED');
    expect(
      await code({ userId: ana.userId, newEmail: juliana.email, payerLast4: '4725' }, 409),
    ).toBe('EMAIL_IN_USE');
  });

  it('decisão 253(1) - 3 conferências erradas travam o casamento (também para o Admin); o Admin libera uma vez em 24 h', async () => {
    const support = await staffUser({ app, role: 'support' });
    const admin = await staffUser({ app, role: 'admin' });
    const { ana, weddingId } = await paidWedding();
    for (let attempt = 0; attempt < 3; attempt++)
      await change(support.cookie, weddingId, {
        userId: ana.userId,
        newEmail: newEmail(),
        payerLast4: '1111',
      }).expect(422);
    const locked = await change(admin.cookie, weddingId, {
      userId: ana.userId,
      newEmail: newEmail(),
      payerLast4: '4725',
    }).expect(409);
    expect(locked.body).toMatchObject({
      error: 'ACCESS_EMAIL_LOCKED',
      availableAt: expect.any(String),
    });
    await db.alert.findFirstOrThrow({
      where: { type: 'access_email_locked', entityId: weddingId, status: 'open' },
    });
    // Decisão 316(11)(b): o detalhe mostra a trava antes do pedido, com a mesma data.
    expect((await general(support.cookie, weddingId)).accessEmailChange).toEqual({
      payerCheck: true,
      lockedUntil: locked.body.availableAt,
    });

    expect((await unlock(support.cookie, weddingId).expect(403)).body.error).toBe(
      'ACTION_NOT_ALLOWED',
    );
    await unlock(admin.cookie, weddingId).expect(200);
    await db.alert.findFirstOrThrow({
      where: { type: 'access_email_unlocked', entityId: weddingId },
    });
    expect((await general(admin.cookie, weddingId)).accessEmailChange.lockedUntil).toBeNull();
    expect((await unlock(admin.cookie, weddingId).expect(409)).body.error).toBe('UNLOCK_TOO_SOON');
    // A liberação não pula a conferência: com os dígitos certos, a troca vale.
    await change(admin.cookie, weddingId, {
      userId: ana.userId,
      newEmail: newEmail(),
      payerLast4: '4725',
    }).expect(200);
  });

  it('decisão 253(1) - 5 tentativas do atendente por dia, contando as recusadas: a 6ª é 429 com retryAt', async () => {
    const support = await staffUser({ app, role: 'support' });
    for (let wedding = 0; wedding < 3; wedding++) {
      const { ana, weddingId } = await paidWedding();
      for (let attempt = 0; attempt < 2 && wedding * 2 + attempt < 5; attempt++)
        await change(support.cookie, weddingId, {
          userId: ana.userId,
          newEmail: newEmail(),
          payerLast4: '1111',
        }).expect(422);
      if (wedding === 2) {
        const limited = await change(support.cookie, weddingId, {
          userId: ana.userId,
          newEmail: newEmail(),
          payerLast4: '4725',
        }).expect(429);
        expect(limited.body).toMatchObject({ error: 'RATE_LIMITED', retryAt: expect.any(String) });
      }
    }
  });

  it('decisão 253(1) - a 2ª troca no mesmo User em 7 dias só pelo Admin', async () => {
    const support = await staffUser({ app, role: 'support' });
    const admin = await staffUser({ app, role: 'admin' });
    const { ana, weddingId } = await paidWedding();
    await change(support.cookie, weddingId, {
      userId: ana.userId,
      newEmail: newEmail(),
      payerLast4: '4725',
    }).expect(200);
    expect(
      (
        await change(support.cookie, weddingId, {
          userId: ana.userId,
          newEmail: newEmail(),
          payerLast4: '4725',
        }).expect(403)
      ).body.error,
    ).toBe('ACTION_NOT_ALLOWED');
    await change(admin.cookie, weddingId, {
      userId: ana.userId,
      newEmail: newEmail(),
      payerLast4: '4725',
    }).expect(200);
  });

  it('decisão 253(2) - por 48 h, nem chave Pix nem remoção de membros: 409 RECENT_ACCESS_CHANGE com availableAt', async () => {
    const juliana = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const changedAt = new Date(Date.now() - 10 * HOUR_MS);
    await db.user.update({
      where: { id: juliana.userId },
      data: { accessEmailChangedAt: changedAt },
    });
    const julianaCookie = await openSession({ app, userId: juliana.userId });
    const pix = await http()
      .post('/v1/me/referrer/pix-keys')
      .set('Cookie', julianaCookie)
      .set('Origin', ORIGIN)
      .send({ keyType: 'email', key: 'juliana.pix@gmail.com' })
      .expect(409);
    expect(pix.body).toEqual({
      statusCode: 409,
      error: 'RECENT_ACCESS_CHANGE',
      message: expect.any(String),
      availableAt: new Date(changedAt.getTime() + 48 * HOUR_MS).toISOString(),
    });

    const { ana, juliana: collaborator, weddingId } = await paidWedding();
    await db.user.update({ where: { id: ana.userId }, data: { accessEmailChangedAt: changedAt } });
    const membership = await db.membership.findFirstOrThrow({
      where: { weddingId, userId: collaborator.userId },
    });
    const removal = await http()
      .delete(`/v1/weddings/${weddingId}/memberships/${membership.id}`)
      .set('Cookie', ana.cookie)
      .set('Origin', ORIGIN)
      .expect(409);
    // O contrato lista o 409 com o availableAt no DELETE (decisão 271(2)).
    expect(removal.body).toMatchObject({
      error: 'RECENT_ACCESS_CHANGE',
      availableAt: new Date(changedAt.getTime() + 48 * HOUR_MS).toISOString(),
    });
    // Depois das 48 h, vale.
    await db.user.update({
      where: { id: ana.userId },
      data: { accessEmailChangedAt: new Date(Date.now() - 49 * HOUR_MS) },
    });
    await http()
      .delete(`/v1/weddings/${weddingId}/memberships/${membership.id}`)
      .set('Cookie', ana.cookie)
      .set('Origin', ORIGIN)
      .expect(204);
  });

  it('decisão 253(1) - em paralelo, o limite do atendente vale: 6 trocas simultâneas dão 5 x 200 e 1 x 429', async () => {
    const support = await staffUser({ app, role: 'support' });
    const weddings = [];
    for (let index = 0; index < 6; index++) weddings.push(await paidWedding());
    const statuses = await Promise.all(
      weddings.map(
        async ({ ana, weddingId }) =>
          (
            await change(support.cookie, weddingId, {
              userId: ana.userId,
              newEmail: newEmail(),
              payerLast4: '4725',
            })
          ).status,
      ),
    );
    expect(statuses.sort()).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('RN09 - o corpo sem as confirmações é 400 com os erros, não 500', async () => {
    const support = await staffUser({ app, role: 'support' });
    const { ana, weddingId } = await paidWedding();
    const response = await http()
      .put(`/v1/admin/weddings/${weddingId}/access-email`)
      .set('Cookie', support.cookie)
      .set('Origin', ORIGIN)
      .send({
        userId: ana.userId,
        newEmail: newEmail(),
        payerLast4: '4725',
        reason: 'Casal perdeu o acesso ao e-mail antigo.',
      })
      .expect(400);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'checks' })]),
    );
  });

  it('decisão 253(1) e (2) - a 2ª troca pelo Admin atualiza o alerta aberto; a ficha mostra até quando a pessoa fica travada', async () => {
    const support = await staffUser({ app, role: 'support' });
    const admin = await staffUser({ app, role: 'admin' });
    const { ana, weddingId } = await paidWedding();
    await change(support.cookie, weddingId, {
      userId: ana.userId,
      newEmail: newEmail(),
      payerLast4: '4725',
    }).expect(200);
    await change(admin.cookie, weddingId, {
      userId: ana.userId,
      newEmail: newEmail(),
      payerLast4: '4725',
    }).expect(200);
    const alerts = await db.alert.findMany({
      where: { type: 'access_email_changed', entityId: ana.userId, status: 'open' },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].data).toMatchObject({ byRole: 'admin', repeatWithin7Days: true });

    const { people } = await general(admin.cookie, weddingId);
    const person = people.find((item) => item.userId === ana.userId);
    const changedAt = (await db.user.findUniqueOrThrow({ where: { id: ana.userId } }))
      .accessEmailChangedAt!;
    expect(person?.accessChangeLockedUntil).toBe(
      new Date(changedAt.getTime() + 48 * HOUR_MS).toISOString(),
    );
    // Decisão 316(11)(b): a 2ª troca em 7 dias é só do Admin, até aqui; a colaboradora, nada.
    expect(person?.accessEmailAdminOnlyUntil).toBe(
      new Date(changedAt.getTime() + 7 * 24 * HOUR_MS).toISOString(),
    );
    expect(people.find((item) => item.userId !== ana.userId)?.accessEmailAdminOnlyUntil).toBeNull();
  });
});
