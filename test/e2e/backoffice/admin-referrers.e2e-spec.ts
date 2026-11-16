import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ReleaseCommissions } from '@/modules/billing/application/payouts/release-commissions.use-case';
import { addMonths } from '@/modules/billing/domain/pricing';
import { FIELD_CIPHER, type FieldCipher } from '@/shared/crypto/application/field-cipher.port';
import { TAX_ID_HASHER, type TaxIdHasher } from '@/shared/crypto/application/tax-id-hasher.port';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { uuidV7 } from '@/shared/ids/uuid-v7';
import { localDate } from '@/shared/time/local-date';
import { createTestApp } from '../support/harness/create-test-app';
import { createTestWorker } from '../support/harness/create-test-worker';
import { publishByPayment, randomCpf } from '../support/factories/payments';
import { seedReferrer } from '../support/factories/referrers';
import { openSession, signedInUser, staffUser } from '../support/harness/sessions';
import { seedWedding } from '../support/factories/weddings';

const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';

/** As ações do Admin na cerimonialista (Backoffice - cobrança RN08). */
describe('Backoffice: ações na cerimonialista (Backoffice - cobrança RN08; banco real)', () => {
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
  const post = (cookie: string, path: string, body: Record<string, unknown>) =>
    http().post(`/v1/admin${path}`).set('Cookie', cookie).set('Origin', ORIGIN).send(body);
  const put = (cookie: string, path: string, body: Record<string, unknown>) =>
    http().put(`/v1/admin${path}`).set('Cookie', cookie).set('Origin', ORIGIN).send(body);
  const stale = (userId: string) =>
    db.session.updateMany({
      where: { userId },
      data: { authenticatedAt: new Date(Date.now() - 60 * 60_000) },
    });

  /**
   * Juliana com os dados para receber, uma comissão por casamento indicado e,
   * se `payout`, o repasse pedido com elas disponíveis.
   */
  async function juliana({ weddings = 1, payout = false } = {}) {
    const seeded = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
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
          plaintext: 'juliana@prado.com.br',
          context: { table: 'referrer_pix_keys', column: 'key_encrypted' },
        }),
        keyHash: `hash-${randomUUID()}`,
        keyMasked: 'jul***@prado.com.br',
        status: 'active',
        confirmedAt: new Date(),
        activeFrom: new Date(),
      },
    });
    const commissions = [];
    for (let index = 0; index < weddings; index++) {
      const ana = await signedInUser({ app });
      const { weddingId } = await seedWedding({
        db,
        ownerId: ana.userId,
        collaboratorIds: [seeded.userId],
      });
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
    const cookie = await openSession({ app, userId: seeded.userId });
    let payoutId: string | null = null;
    if (payout) {
      await worker.get(ReleaseCommissions).execute({
        now: new Date(Math.max(...commissions.map((c) => c.availableAt.getTime())) + 60_000),
        referrerId: referrer.id,
      });
      const asked = await http()
        .post('/v1/me/referrer/payouts')
        .set('Cookie', cookie)
        .set('Origin', ORIGIN)
        .set('Idempotency-Key', randomUUID())
        .send({ expectedAmountCents: commissions.reduce((sum, c) => sum + c.amountCents, 0) })
        .expect(201);
      payoutId = asked.body.id as string;
    }
    return { ...seeded, referrerId: referrer.id, cookie, commissions, payoutId };
  }

  it('RN08 - bloquear: ela não entra mais, o link responde 404, os vínculos ficam, o repasse pedido fica retido e o log', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const support = await staffUser({ app, role: 'support' });
    const person = await juliana({ payout: true });
    const reason = { reason: 'Autoindicação confirmada' };
    expect(
      (await post(support.cookie, `/referrers/${person.referrerId}/block`, reason).expect(403)).body
        .error,
    ).toBe('ACTION_NOT_ALLOWED');

    const response = await post(
      admin.cookie,
      `/referrers/${person.referrerId}/block`,
      reason,
    ).expect(200);
    expect(response.body).toEqual({ status: 'blocked', heldPayoutIds: [person.payoutId] });
    await http().get('/v1/me').set('Cookie', person.cookie).expect(401);
    expect((await http().get(`/v1/referrals/${person.referralCode}`).expect(404)).body.error).toBe(
      'REFERRAL_NOT_FOUND',
    );
    expect(
      await db.membership.count({
        where: { userId: person.userId, role: 'collaborator', removedAt: null },
      }),
    ).toBe(1);
    expect(await db.payout.findUniqueOrThrow({ where: { id: person.payoutId! } })).toMatchObject({
      status: 'held',
      holdReason: 'referrer_blocked',
    });
    await db.applicationLog.findFirstOrThrow({
      where: { action: 'referrer.blocked', entityId: person.referrerId, actorUserId: admin.userId },
    });
    expect(
      (await post(admin.cookie, `/referrers/${person.referrerId}/block`, reason).expect(409)).body
        .error,
    ).toBe('ALREADY_BLOCKED');
  });

  it('RN08 - desbloquear não libera as comissões bloqueadas', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const person = await juliana();
    await post(admin.cookie, `/referrers/${person.referrerId}/block`, {
      reason: 'Conferência de cadastro',
    }).expect(200);
    const [commission] = person.commissions;
    await db.commission.update({
      where: { id: commission.id },
      data: { status: 'blocked', blockReason: 'referrer_blocked' },
    });
    expect(
      (
        await post(admin.cookie, `/referrers/${person.referrerId}/unblock`, {
          reason: 'Cadastro conferido',
        }).expect(200)
      ).body,
    ).toEqual({ status: 'active' });
    expect(await db.user.findUniqueOrThrow({ where: { id: person.userId } })).toMatchObject({
      status: 'active',
    });
    expect((await db.commission.findUniqueOrThrow({ where: { id: commission.id } })).status).toBe(
      'blocked',
    );
    await db.applicationLog.findFirstOrThrow({
      where: { action: 'referrer.unblocked', entityId: person.referrerId },
    });
  });

  it('RN08 (B10-4) - bloquear a comissão num repasse pedido retém o repasse; a paga não bloqueia; desbloquear pede sessão recente', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const person = await juliana({ payout: true });
    const [commission] = person.commissions;
    expect(
      (
        await post(admin.cookie, `/commissions/${commission.id}/block`, {
          reason: 'Casamento em análise',
        }).expect(200)
      ).body,
    ).toEqual({ status: 'blocked', heldPayoutId: person.payoutId });
    expect(await db.commission.findUniqueOrThrow({ where: { id: commission.id } })).toMatchObject({
      status: 'blocked',
      blockReason: 'admin',
    });
    expect(await db.payout.findUniqueOrThrow({ where: { id: person.payoutId! } })).toMatchObject({
      status: 'held',
      holdReason: 'commission_blocked',
    });

    await stale(admin.userId);
    expect(
      (
        await post(admin.cookie, `/commissions/${commission.id}/unblock`, {
          reason: 'Análise concluída',
        }).expect(403)
      ).body.error,
    ).toBe('REAUTH_REQUIRED');
    await db.session.updateMany({
      where: { userId: admin.userId },
      data: { authenticatedAt: new Date() },
    });
    expect(
      (
        await post(admin.cookie, `/commissions/${commission.id}/unblock`, {
          reason: 'Análise concluída',
        }).expect(200)
      ).body,
    ).toEqual({ status: 'pending' });
    // O roteiro liberou antes do prazo; o desbloqueio volta ao prazo (available_at no futuro).
    await db.applicationLog.findFirstOrThrow({
      where: { action: 'commission.unblocked', entityId: commission.id },
    });

    // Repasse B6-4: a comissão de um repasse em processamento segue o Pix.
    const sending = await juliana({ payout: true });
    await db.payout.update({
      where: { id: sending.payoutId! },
      data: { status: 'processing', processingAt: new Date() },
    });
    const inPix = await post(admin.cookie, `/commissions/${sending.commissions[0].id}/block`, {
      reason: 'Tentativa durante o Pix',
    }).expect(409);
    expect(inPix.body).toMatchObject({ error: 'COMMISSION_NOT_BLOCKABLE', status: 'available' });
    expect(
      (await db.commission.findUniqueOrThrow({ where: { id: sending.commissions[0].id } })).status,
    ).toBe('available');

    const paid = await juliana();
    await db.commission.update({
      where: { id: paid.commissions[0].id },
      data: { status: 'paid' },
    });
    const refused = await post(admin.cookie, `/commissions/${paid.commissions[0].id}/block`, {
      reason: 'Tentativa por engano',
    }).expect(409);
    expect(refused.body).toMatchObject({ error: 'COMMISSION_NOT_BLOCKABLE', status: 'paid' });
  });

  it('RN08 (B10-7) - ajustar: o desconto entra no extrato como Ajuste manual; o positivo pede sessão recente e, acima de R$ 500,00, abre o alerta', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const person = await juliana();
    const minus = await post(admin.cookie, `/referrers/${person.referrerId}/adjustments`, {
      amountCents: -1000,
      reason: 'Correção do repasse de setembro',
    }).expect(201);
    expect(
      await db.commissionAdjustment.findUniqueOrThrow({ where: { id: minus.body.id as string } }),
    ).toMatchObject({
      referrerId: person.referrerId,
      amountCents: -1000,
      reason: 'manual',
      createdByUserId: admin.userId,
    });
    await db.applicationLog.findFirstOrThrow({
      where: { action: 'commission.adjusted', entityId: person.referrerId },
    });
    const statement = await http()
      .get('/v1/me/referrer/commissions')
      .set('Cookie', person.cookie)
      .expect(200);
    expect(JSON.stringify(statement.body)).toContain('-1000');

    await stale(admin.userId);
    expect(
      (
        await post(admin.cookie, `/referrers/${person.referrerId}/adjustments`, {
          amountCents: 60_000,
          reason: 'Bônus de campanha aprovado',
        }).expect(403)
      ).body.error,
    ).toBe('REAUTH_REQUIRED');
    await db.session.updateMany({
      where: { userId: admin.userId },
      data: { authenticatedAt: new Date() },
    });
    const plus = await post(admin.cookie, `/referrers/${person.referrerId}/adjustments`, {
      amountCents: 60_000,
      reason: 'Bônus de campanha aprovado',
    }).expect(201);
    expect(
      await db.alert.count({
        where: { type: 'manual_adjustment', entityId: plus.body.id as string, status: 'open' },
      }),
    ).toBe(1);
  });

  it('RN08 (decisão 74; B6-7) - corrigir o CPF: sessão recente, a autoindicação de novo e o repasse retido; o de outro indicador dá 409 TAX_ID_IN_USE', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const person = await juliana({ payout: true });
    const cpf = randomCpf();
    const { hash } = app.get<TaxIdHasher>(TAX_ID_HASHER).digest({ taxId: cpf });
    // O pagamento foi feito com o CPF que agora se descobre ser o dela.
    await db.payment.update({
      where: { id: person.commissions[0].paymentId },
      data: { payerTaxIdHash: hash },
    });
    const body = { taxIdType: 'cpf', taxId: cpf, reason: 'Documento digitado errado' };
    await stale(admin.userId);
    expect(
      (await put(admin.cookie, `/referrers/${person.referrerId}/document`, body).expect(403)).body
        .error,
    ).toBe('REAUTH_REQUIRED');
    await db.session.updateMany({
      where: { userId: admin.userId },
      data: { authenticatedAt: new Date() },
    });
    const response = await put(
      admin.cookie,
      `/referrers/${person.referrerId}/document`,
      body,
    ).expect(200);
    expect(response.body).toEqual({ taxIdType: 'cpf', taxIdMasked: expect.stringMatching(/\*/) });
    expect(
      await db.commission.findUniqueOrThrow({ where: { id: person.commissions[0].id } }),
    ).toMatchObject({ status: 'blocked', blockReason: 'self_referral' });
    expect(await db.payout.findUniqueOrThrow({ where: { id: person.payoutId! } })).toMatchObject({
      status: 'held',
      holdReason: 'commission_blocked',
    });
    const log = await db.applicationLog.findFirstOrThrow({
      where: { action: 'referrer.tax_id_corrected', entityId: person.referrerId },
    });
    expect(JSON.stringify(log.data)).not.toContain(cpf.replace(/\D/g, ''));

    const other = await juliana();
    expect(
      (await put(admin.cookie, `/referrers/${other.referrerId}/document`, body).expect(409)).body
        .error,
    ).toBe('TAX_ID_IN_USE');
  });
});
