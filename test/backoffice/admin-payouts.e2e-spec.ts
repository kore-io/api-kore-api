import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ReleaseCommissions } from '../../src/modules/billing/application/release-commissions.use-case';
import { addMonths } from '../../src/modules/billing/domain/pricing';
import { LocalGatewayStore } from '../../src/modules/billing/infrastructure/backoffice/local-gateway/local-gateway.store';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import {
  FIELD_CIPHER,
  type FieldCipher,
} from '../../src/shared/crypto/application/field-cipher.port';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import { localDate } from '../../src/shared/time/local-date';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { waitForInbox } from '../support/mailpit';
import { publishByPayment } from '../support/payments';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser, staffUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error('A condição não chegou a tempo.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** A fila de Repasses do Admin (Backoffice - cobrança RN01 e RN09; Repasse RN05). */
describe('Backoffice: fila de Repasses (Backoffice - cobrança RN09; banco real)', () => {
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
  const post = (cookie: string, path: string, body: Record<string, unknown> = {}) =>
    http().post(`/v1/admin/payouts${path}`).set('Cookie', cookie).set('Origin', ORIGIN).send(body);
  const list = (cookie: string, tab: string, referrerId?: string) =>
    http()
      .get('/v1/admin/payouts')
      .query({ tab, ...(referrerId ? { referrerId } : {}) })
      .set('Cookie', cookie);

  /** Fabiana com os dados para receber e uma comissão disponível por casamento indicado. */
  async function fabiana({ weddings = 1 }: { weddings?: number } = {}) {
    const seeded = await seedReferrer({ db, kind: 'planner', name: 'Fabiana Soares' });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId: seeded.userId } });
    await db.referrer.update({
      where: { id: referrer.id },
      data: {
        taxIdType: 'cpf',
        taxIdEncrypted: 'cifrado',
        taxIdHash: `hash-${randomUUID()}`,
        taxIdHashVersion: 1,
      },
    });
    await db.referrerPixKey.create({
      data: {
        id: uuidV7(),
        referrerId: referrer.id,
        keyType: 'email',
        keyEncrypted: await app.get<FieldCipher>(FIELD_CIPHER).encrypt({
          plaintext: 'fabiana@soares.com.br',
          context: { table: 'referrer_pix_keys', column: 'key_encrypted' },
        }),
        keyHash: `hash-${randomUUID()}`,
        keyMasked: 'fab***@soares.com.br',
        status: 'active',
        confirmedAt: new Date(),
        activeFrom: new Date(),
      },
    });
    const commissions = [];
    for (let index = 0; index < weddings; index++) {
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
      commissions.push(await db.commission.findUniqueOrThrow({ where: { paymentId } }));
    }
    await worker.get(ReleaseCommissions).execute({
      now: new Date(Math.max(...commissions.map((c) => c.availableAt.getTime())) + 60_000),
      referrerId: referrer.id,
    });
    const cookie = await openSession({ app, userId: seeded.userId });
    const total = commissions.reduce((sum, c) => sum + c.amountCents, 0);
    const asked = await http()
      .post('/v1/me/referrer/payouts')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedAmountCents: total })
      .expect(201);
    return {
      ...seeded,
      referrerId: referrer.id,
      cookie,
      commissions,
      payoutId: asked.body.id as string,
      total,
    };
  }

  it('RN09 e RN01 - Solicitados com o indicador e a chave mascarada; o suporte não vê a fila', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const support = await staffUser({ app, role: 'support' });
    const { payoutId, referrerId, total } = await fabiana();
    const response = await list(admin.cookie, 'requested', referrerId).expect(200);
    expect(
      (response.body.items as { id: string }[]).find((row) => row.id === payoutId),
    ).toMatchObject({
      status: 'requested',
      referrer: { id: referrerId, kind: 'planner', name: 'Fabiana Soares' },
      amountCents: total,
      pixKeyMasked: 'fab***@soares.com.br',
      holdReason: null,
      releaseAmountCents: null,
    });
    expect((await list(support.cookie, 'requested').expect(403)).body.error).toBe(
      'ACTION_NOT_ALLOWED',
    );
  });

  it('RN09 e RN01 (B10-1) - Pagar pede sessão recente; com ela, o Pix sai pelo job e o repasse fica em processamento', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const { payoutId, referrerId } = await fabiana();
    await db.session.updateMany({
      where: { userId: admin.userId },
      data: { authenticatedAt: new Date(Date.now() - 60 * 60_000) },
    });
    expect((await post(admin.cookie, `/${payoutId}/pay`).expect(403)).body.error).toBe(
      'REAUTH_REQUIRED',
    );
    await db.session.updateMany({
      where: { userId: admin.userId },
      data: { authenticatedAt: new Date() },
    });

    expect((await post(admin.cookie, `/${payoutId}/pay`).expect(200)).body).toEqual({
      status: 'processing',
    });
    // O job manda o Pix (o gateway local o deixa em processamento até a confirmação).
    const { externalRef } = await db.payout.findUniqueOrThrow({ where: { id: payoutId } });
    await until(
      () => app.get(LocalGatewayStore).transferByReference({ externalReference: externalRef }),
      (value) => value !== null,
    );
    expect(await db.payout.findUniqueOrThrow({ where: { id: payoutId } })).toMatchObject({
      status: 'processing',
      paidByUserId: admin.userId,
    });
    const requested = await list(admin.cookie, 'requested', referrerId).expect(200);
    expect(
      (requested.body.items as { id: string; status: string }[]).find((row) => row.id === payoutId),
    ).toMatchObject({ status: 'processing', processingAt: expect.any(String) });
    // Pagar de novo não manda outro: só sai de Solicitado.
    expect((await post(admin.cookie, `/${payoutId}/pay`).expect(409)).body.error).toBe(
      'PAYOUT_STATUS_CONFLICT',
    );
    // Tentar de novo consulta o gateway: o Pix existe, então nada muda.
    expect((await post(admin.cookie, `/${payoutId}/retry`).expect(200)).body.status).toEqual(
      expect.any(String),
    );
  });

  it('RN09 - Recusar com motivo: as comissões voltam ao saldo, o pedido não conta para os 30 dias e sai o e-mail', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const person = await fabiana();
    await post(admin.cookie, `/${person.payoutId}/reject`, {
      reason: 'Chave Pix não confere.',
    }).expect(200);
    expect(await db.payout.findUniqueOrThrow({ where: { id: person.payoutId } })).toMatchObject({
      status: 'rejected',
      rejectReason: 'Chave Pix não confere.',
      rejectedAt: expect.any(Date),
    });
    expect(await db.commission.count({ where: { payoutId: person.payoutId } })).toBe(0);
    await db.applicationLog.findFirstOrThrow({
      where: { action: 'payout.rejected', entityId: person.payoutId, actorUserId: admin.userId },
    });
    const user = await db.user.findUniqueOrThrow({ where: { id: person.userId } });
    const [email] = await waitForInbox({ to: user.email });
    expect(email.Subject).toBe('Repasse recusado');
    expect(
      (
        await post(admin.cookie, `/${person.payoutId}/reject`, {
          reason: 'De novo, por engano.',
        }).expect(409)
      ).body.error,
    ).toBe('PAYOUT_STATUS_CONFLICT');
    // O recusado não conta para os 30 dias: ela pede de novo agora.
    await http()
      .post('/v1/me/referrer/payouts')
      .set('Cookie', person.cookie)
      .set('Origin', ORIGIN)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedAmountCents: person.total })
      .expect(201);
  });

  it('RN09 - Retido pela comissão estornada: o Liberar recalcula sem ela; abaixo do mínimo, 409 PAYOUT_BELOW_MINIMUM', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const two = await fabiana({ weddings: 2 });
    const [reversed, kept] = two.commissions;
    // O estorno da comissão retém o repasse (o trigger do 9b).
    await db.commission.update({
      where: { id: reversed.id },
      data: { status: 'reversed', reversedAt: new Date() },
    });
    const held = await list(admin.cookie, 'held', two.referrerId).expect(200);
    expect(
      (held.body.items as { id: string }[]).find((row) => row.id === two.payoutId),
    ).toMatchObject({
      status: 'held',
      holdReason: 'refund',
      heldCommissions: [
        expect.objectContaining({ coupleNames: 'Ana & Marcos', status: 'reversed' }),
      ],
      releaseAmountCents: kept.amountCents,
    });
    expect((await post(admin.cookie, `/${two.payoutId}/release`).expect(200)).body).toEqual({
      status: 'requested',
      amountCents: kept.amountCents,
    });
    expect(await db.payout.findUniqueOrThrow({ where: { id: two.payoutId } })).toMatchObject({
      status: 'requested',
      holdReason: null,
      amountCents: kept.amountCents,
    });
    expect(
      (await db.commission.findUniqueOrThrow({ where: { id: reversed.id } })).payoutId,
    ).toBeNull();
    await db.applicationLog.findFirstOrThrow({
      where: { action: 'payout.released', entityId: two.payoutId },
    });

    const one = await fabiana();
    await db.commission.update({
      where: { id: one.commissions[0].id },
      data: { status: 'reversed', reversedAt: new Date() },
    });
    const below = await post(admin.cookie, `/${one.payoutId}/release`).expect(409);
    expect(below.body).toMatchObject({ error: 'PAYOUT_BELOW_MINIMUM', amountCents: 0 });
  });
});
