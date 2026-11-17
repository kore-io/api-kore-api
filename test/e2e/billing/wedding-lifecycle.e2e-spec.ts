import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AdvanceWeddingLifecycle } from '@/modules/billing/application/wedding-lifecycle/advance-wedding-lifecycle.use-case';
import { addDays, addMonths } from '@/modules/billing/domain/payments/pricing';
import { formatShortDay } from '@/modules/billing/infrastructure/mail/templates/billing.email';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { localDate } from '@/shared/kernel/time/local-date';
import { createTestApp } from '../support/harness/create-test-app';
import { createTestWorker } from '../support/harness/create-test-worker';
import { waitForInbox } from '../support/harness/mailpit';
import { signedInUser } from '../support/harness/sessions';
import { seedWedding } from '../support/factories/weddings';

const SITE_ORIGIN = 'http://localhost:5174';
const day = (value: string) => new Date(`${value}T00:00:00Z`);
/** Meio-dia em São Paulo (UTC−3) do dia dado: o relógio injetado da rotina. */
const noonInSaoPaulo = (value: string) => new Date(`${value}T15:00:00Z`);

/**
 * A carência, o expirado e os avisos de saída do ar (Data de saída do ar RN01 a
 * RN03), pela rotina do worker com o relógio injetado e recortada ao casamento
 * do teste (o kore_test é compartilhado).
 */
describe('Carência, expirado e avisos (Data de saída do ar RN01 a RN03; banco real)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;
  let advance: AdvanceWeddingLifecycle;
  const today = localDate({ at: new Date(), timezone: 'America/Sao_Paulo' });
  // O casamento já passou e a data de saída do ar é daqui a um mês.
  const eventDate = addMonths({ day: today, months: -1 });
  const endDate = addMonths({ day: today, months: 1 });

  beforeAll(async () => {
    app = await createTestApp();
    worker = await createTestWorker();
    db = app.get(BackofficePrismaService);
    advance = worker.get(AdvanceWeddingLifecycle);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  async function published({
    source = 'payment',
    timezone = 'America/Sao_Paulo',
    state = 'SP',
  }: { source?: 'payment' | 'courtesy'; timezone?: string; state?: string } = {}) {
    const ana = await signedInUser({ app });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    const slug = `ana-e-marcos-${randomUUID().slice(0, 8)}`;
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        slug,
        status: 'post_event',
        publishedAt: new Date(),
        eventDate: day(eventDate),
        endDate: day(endDate),
        paidThrough: source === 'payment' ? day(endDate) : null,
        publicationSource: source,
        timezone,
        state,
      },
    });
    return { ana, weddingId, slug };
  }

  const run = (weddingId: string, at: string) =>
    advance.execute({ now: noonInSaoPaulo(at), weddingId });
  const wedding = (id: string) => db.wedding.findUniqueOrThrow({ where: { id } });
  const notices = (weddingId: string) =>
    db.billingNoticeLog.findMany({ where: { weddingId }, orderBy: { sentAt: 'asc' } });
  const billingItems = (weddingId: string) =>
    db.notification.findMany({
      where: { weddingId, type: 'billing' },
      orderBy: { createdAt: 'asc' },
    });

  it('RN03 - o aviso de antes sai uma vez; a mesma rodada de novo não repete', async () => {
    const { ana, weddingId } = await published();
    expect(await run(weddingId, addDays({ day: endDate, days: -8 }))).toMatchObject({ notices: 0 });

    expect(await run(weddingId, addDays({ day: endDate, days: -7 }))).toMatchObject({ notices: 1 });
    expect(await run(weddingId, addDays({ day: endDate, days: -7 }))).toMatchObject({ notices: 0 });
    expect((await notices(weddingId)).map((row) => row.notice)).toEqual(['end_date_in_7_days']);
    const [item] = await billingItems(weddingId);
    expect(item.payload).toEqual([
      expect.objectContaining({ kind: 'end_date_soon', endDate, daysLeft: 7 }),
    ]);
    const [email] = await waitForInbox({ to: ana.email });
    expect(email.Subject).toMatch(/^O site fica no ar até \d+ de [a-z]{3}\.$/);
  });

  it('RN03 (B4-2) - com a rotina parada, o aviso sai no dia seguinte com os dias reais', async () => {
    const { weddingId } = await published();
    await run(weddingId, addDays({ day: endDate, days: -6 }));
    const [item] = await billingItems(weddingId);
    expect(item.payload).toEqual([expect.objectContaining({ daysLeft: 6 })]);
  });

  it('RN01 e RN02 - no dia seguinte à endDate entra na carência até endDate + 7, com o aviso do 1º dia', async () => {
    const { ana, weddingId } = await published();
    expect(await run(weddingId, addDays({ day: endDate, days: 1 }))).toMatchObject({ grace: 1 });
    const grace = await wedding(weddingId);
    expect(grace.status).toBe('grace');
    expect(grace.graceUntil).toEqual(day(addDays({ day: endDate, days: 7 })));
    expect(await db.applicationLog.count({ where: { weddingId, action: 'wedding.grace' } })).toBe(
      1,
    );
    expect((await notices(weddingId)).map((row) => row.notice)).toContain('grace_day_1');
    // O e-mail do 1º dia sai pela fila (RN03).
    const graceSubject = `O site sai do ar depois de ${formatShortDay(addDays({ day: endDate, days: 7 }))}`;
    await waitForInbox({ to: ana.email, subject: graceSubject });

    await run(weddingId, addDays({ day: endDate, days: 5 }));
    expect((await notices(weddingId)).map((row) => row.notice)).toContain('grace_day_5');
    // E o do 5º dia, com o mesmo assunto.
    await waitForInbox({ to: ana.email, subject: graceSubject, count: 2 });
  });

  it('RN01, RN02 e RN08 - expira em graceUntil + 1, com o expurgo 6 meses depois, e o site responde 410', async () => {
    const { ana, weddingId, slug } = await published();
    await run(weddingId, addDays({ day: endDate, days: 1 }));
    expect(await run(weddingId, addDays({ day: endDate, days: 8 }))).toMatchObject({ expired: 1 });
    const expired = await wedding(weddingId);
    const expiredAt = addDays({ day: endDate, days: 8 });
    expect(expired.status).toBe('expired');
    expect(expired.expiredAt).toEqual(day(expiredAt));
    expect(expired.purgeAt).toEqual(day(addMonths({ day: expiredAt, months: 6 })));
    expect((await notices(weddingId)).map((row) => row.notice)).toContain('expired');
    // O log wedding.expired e o e-mail "O site saiu do ar" (RN02 e RN03).
    expect(await db.applicationLog.count({ where: { weddingId, action: 'wedding.expired' } })).toBe(
      1,
    );
    await waitForInbox({ to: ana.email, subject: 'O site saiu do ar' });
    const items = await billingItems(weddingId);
    expect(items.at(-1)?.payload).toEqual([
      expect.objectContaining({
        kind: 'expired',
        expiredAt,
        renewUntil: addMonths({ day: eventDate, months: 12 }),
      }),
    ]);
    await request(app.getHttpServer())
      .get(`/v1/sites/${slug}`)
      .set('Origin', SITE_ORIGIN)
      .expect(410);
  });

  it('RN01 e RN02 (B4-7) - a data de expirar não depende da hora da rotina: parada, expira com a data derivada', async () => {
    const { weddingId } = await published();
    // Nenhuma rodada até endDate + 11: carência e expirado na mesma rodada.
    expect(await run(weddingId, addDays({ day: endDate, days: 11 }))).toMatchObject({
      grace: 1,
      expired: 1,
    });
    expect((await wedding(weddingId)).expiredAt).toEqual(day(addDays({ day: endDate, days: 8 })));
  });

  it.each([
    ['bloqueado', { blockedAt: new Date() }],
    ['com exclusão agendada', { deletionScheduledFor: new Date(Date.now() + 7 * 86_400_000) }],
  ])('RN02 e RN03 (B4-5) - %s: o relógio corre, sem aviso', async (_label, data) => {
    const { weddingId } = await published();
    await db.wedding.update({ where: { id: weddingId }, data });
    await run(weddingId, addDays({ day: endDate, days: 1 }));
    expect((await wedding(weddingId)).status).toBe('grace');
    expect(await notices(weddingId)).toEqual([]);
    expect(await billingItems(weddingId)).toEqual([]);
  });

  it('RN01 - o publicado por Cortesia também vence', async () => {
    const { weddingId } = await published({ source: 'courtesy' });
    await run(weddingId, addDays({ day: endDate, days: 1 }));
    expect((await wedding(weddingId)).status).toBe('grace');
  });

  it('RN03 - mudar a data rearma os avisos', async () => {
    const { weddingId } = await published();
    await run(weddingId, addDays({ day: endDate, days: -7 }));
    const later = addMonths({ day: endDate, months: 3 });
    await db.wedding.update({
      where: { id: weddingId },
      data: { endDate: day(later), paidThrough: day(later) },
    });
    await run(weddingId, addDays({ day: later, days: -7 }));
    expect((await notices(weddingId)).map((row) => row.endDate)).toEqual([
      day(endDate),
      day(later),
    ]);
  });

  it('RN02 (B4-7) e RN11 - no Acre, a virada chega depois: às 00h30 de São Paulo o site ainda não entrou na carência', async () => {
    const { weddingId } = await published({ timezone: 'America/Rio_Branco', state: 'AC' });
    // 00h30 em São Paulo do dia seguinte à endDate = 22h30 da endDate no Acre.
    const next = addDays({ day: endDate, days: 1 });
    await advance.execute({ now: new Date(`${next}T03:30:00Z`), weddingId });
    expect((await wedding(weddingId)).status).toBe('post_event');
    // Na rodada seguinte, já é o dia seguinte também no Acre.
    await advance.execute({ now: new Date(`${next}T06:30:00Z`), weddingId });
    expect((await wedding(weddingId)).status).toBe('grace');
  });

  it('RN02 (B4-7) e RN11 - em Manaus, a virada chega 1 h depois: às 00h30 de São Paulo o site ainda não entrou na carência', async () => {
    const { weddingId } = await published({ timezone: 'America/Manaus', state: 'AM' });
    // 00h30 em São Paulo do dia seguinte à endDate = 23h30 da endDate em Manaus.
    const next = addDays({ day: endDate, days: 1 });
    await advance.execute({ now: new Date(`${next}T03:30:00Z`), weddingId });
    expect((await wedding(weddingId)).status).toBe('post_event');
    // 01h30 em São Paulo = 00h30 em Manaus: já é o dia seguinte lá.
    await advance.execute({ now: new Date(`${next}T04:30:00Z`), weddingId });
    expect((await wedding(weddingId)).status).toBe('grace');
  });

  it('RN02 e Casos de borda - o publicado com o casamento e a saída já passados vai direto para a carência (casamento em 14/11, saída em 15/11)', async () => {
    const { weddingId } = await published();
    const eventDay = addDays({ day: today, days: -3 });
    const endDay = addDays({ day: today, days: -2 });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        status: 'published',
        eventDate: day(eventDay),
        endDate: day(endDay),
        paidThrough: day(endDay),
      },
    });
    await run(weddingId, today);
    const grace = await wedding(weddingId);
    expect(grace.status).toBe('grace');
    expect(grace.graceUntil).toEqual(day(addDays({ day: endDay, days: 7 })));
    expect(await db.applicationLog.count({ where: { weddingId, action: 'wedding.grace' } })).toBe(
      1,
    );
  });
});
