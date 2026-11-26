import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ReleaseCommissions } from '@/modules/billing/application/payouts/release-commissions.use-case';
import { BlockWedding } from '@/modules/billing/application/wedding-lifecycle/block-wedding.use-case';
import { addMonths } from '@/modules/billing/domain/payments/pricing';
import { FIELD_CIPHER, type FieldCipher } from '@/shared/crypto/application/field-cipher.port';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { uuidV7 } from '@/shared/kernel/ids/uuid-v7';
import { localDate } from '@/shared/kernel/time/local-date';
import { createTestApp } from '../support/harness/create-test-app';
import { createTestWorker } from '../support/harness/create-test-worker';
import { publishByPayment, randomCpf } from '../support/factories/payments';
import { seedReferrer } from '../support/factories/referrers';
import { openSession, signedInUser, staffUser } from '../support/harness/sessions';
import { seedWedding } from '../support/factories/weddings';

interface ReferrerRowBody {
  balances: Record<string, number>;
  payoutRequested?: boolean;
  [key: string]: unknown;
}

const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';

/** A leitura das Cerimonialistas (Backoffice - cobrança RN08 e RN01; decisão 69). */
describe('Backoffice: lista e detalhe das cerimonialistas (Backoffice - cobrança RN08; banco real)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;
  let admin: { userId: string; cookie: string };
  let support: { userId: string; cookie: string };
  const today = localDate({ at: new Date(), timezone: 'America/Sao_Paulo' });
  const eventDate = addMonths({ day: today, months: 4 });
  const endDate = addMonths({ day: eventDate, months: 3 });

  beforeAll(async () => {
    app = await createTestApp();
    worker = await createTestWorker();
    db = app.get(BackofficePrismaService);
    admin = await staffUser({ app, role: 'admin' });
    support = await staffUser({ app, role: 'support', name: 'Paulo Suporte' });
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const get = (cookie: string, path: string) =>
    http().get(`/v1/admin${path}`).set('Cookie', cookie).set('Origin', ORIGIN);

  /**
   * Juliana com o CPF e a chave Pix, numa cidade só dela (a lista do
   * kore_test é compartilhada), um casamento indicado por comissão e, se
   * `payout`, o repasse pedido com as comissões liberadas e o ajuste manual.
   */
  async function juliana({
    weddings = 1,
    payout = false,
    adjustmentCents = 0,
  }: { weddings?: number; payout?: boolean; adjustmentCents?: number } = {}) {
    const city = `Cidade ${randomUUID()}`;
    const cpf = randomCpf();
    const seeded = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId: seeded.userId } });
    const cipher = app.get<FieldCipher>(FIELD_CIPHER);
    await db.referrer.update({
      where: { id: referrer.id },
      data: {
        taxIdType: 'cpf',
        taxIdEncrypted: await cipher.encrypt({
          plaintext: cpf,
          context: { table: 'referrers', column: 'tax_id_encrypted' },
        }),
        taxIdHash: `hash-${randomUUID()}`,
        taxIdHashVersion: 1,
        planner: { update: { cities: [city, 'Valinhos'] } },
      },
    });
    await db.referrerPixKey.create({
      data: {
        id: uuidV7(),
        referrerId: referrer.id,
        keyType: 'email',
        keyEncrypted: await cipher.encrypt({
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
    const weddingIds: string[] = [];
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
      weddingIds.push(weddingId);
      const { paymentId } = await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate });
      commissions.push(await db.commission.findUniqueOrThrow({ where: { paymentId } }));
    }
    let adjustmentId: string | null = null;
    if (adjustmentCents !== 0)
      adjustmentId = (
        await db.commissionAdjustment.create({
          data: {
            id: uuidV7(),
            referrerId: referrer.id,
            amountCents: adjustmentCents,
            reason: 'manual',
            note: 'Correção do repasse de setembro',
            createdByUserId: admin.userId,
          },
        })
      ).id;
    let payoutId: string | null = null;
    if (payout) {
      await worker.get(ReleaseCommissions).execute({
        now: new Date(Math.max(...commissions.map((c) => c.availableAt.getTime())) + 60_000),
        referrerId: referrer.id,
      });
      const cookie = await openSession({ app, userId: seeded.userId });
      const asked = await http()
        .post('/v1/me/referrer/payouts')
        .set('Cookie', cookie)
        .set('Origin', ORIGIN)
        .set('Idempotency-Key', randomUUID())
        .send({
          expectedAmountCents:
            commissions.reduce((sum, c) => sum + c.amountCents, 0) + adjustmentCents,
        })
        .expect(201);
      payoutId = asked.body.id as string;
    }
    return {
      ...seeded,
      referrerId: referrer.id,
      city,
      cpf,
      commissions,
      weddingIds,
      adjustmentId,
      payoutId,
    };
  }

  const rowOf = async (cookie: string, city: string) => {
    const response = await get(cookie, `/referrers?city=${encodeURIComponent(city)}`).expect(200);
    expect(response.body.total).toBe(1);
    const [row] = (response.body as { items: ReferrerRowBody[] }).items;
    return row;
  };

  it('RN08 - a lista: nome, e-mail, cidades, casais trazidos, os saldos, o status e a tag Repasse pedido', async () => {
    const person = await juliana({ weddings: 2 });
    const total = person.commissions.reduce((sum, c) => sum + c.amountCents, 0);

    const row = await rowOf(admin.cookie, person.city.toUpperCase());
    expect(row).toEqual({
      id: person.referrerId,
      kind: 'planner',
      name: 'Juliana Prado',
      creditName: 'Juliana Prado',
      email: expect.stringContaining('@kore.local'),
      cities: [person.city, 'Valinhos'],
      status: 'active',
      couplesCount: 2,
      balances: { availableCents: 0, pendingCents: total, receivedCents: 0, inPayoutCents: 0 },
      payoutRequested: false,
    });
  });

  it('RN08 - "R$ 0,00 (R$ 158,04 em repasse)": o repasse pedido tira do Disponível e soma o ajuste; filtros de repasse e status', async () => {
    const person = await juliana({ payout: true, adjustmentCents: -500 });
    const total = person.commissions.reduce((sum, c) => sum + c.amountCents, 0) - 500;

    const row = await rowOf(admin.cookie, person.city);
    expect(row.balances).toEqual({
      availableCents: 0,
      pendingCents: 0,
      receivedCents: 0,
      inPayoutCents: total,
    });
    expect(row.payoutRequested).toBe(true);

    const city = encodeURIComponent(person.city);
    expect((await get(admin.cookie, `/referrers?city=${city}&hasPayout=true`)).body.total).toBe(1);
    expect((await get(admin.cookie, `/referrers?city=${city}&hasPayout=false`)).body.total).toBe(0);
    expect((await get(admin.cookie, `/referrers?city=${city}&status=active`)).body.total).toBe(1);
    expect((await get(admin.cookie, `/referrers?city=${city}&status=blocked`)).body.total).toBe(0);
  });

  it('RN08 (decisão 273(2)) - o repasse retido não é "Repasse pedido": sai da tag e do filtro, segue no "em repasse"', async () => {
    const person = await juliana({ payout: true });
    const city = encodeURIComponent(person.city);
    await db.payout.update({
      where: { id: person.payoutId! },
      data: { status: 'held', holdReason: 'referrer_blocked' },
    });

    const row = await rowOf(admin.cookie, person.city);
    expect(row.payoutRequested).toBe(false);
    expect(row.balances.inPayoutCents).toBe(
      person.commissions.reduce((sum, c) => sum + c.amountCents, 0),
    );
    expect((await get(admin.cookie, `/referrers?city=${city}&hasPayout=true`)).body.total).toBe(0);
    expect((await get(admin.cookie, `/referrers?city=${city}&hasPayout=false`)).body.total).toBe(1);
  });

  it('RN08 (decisão 273(1); Contrato de leitura A5) - a lista sai por nome, com acento no lugar certo, e não pela data de cadastro', async () => {
    const city = `Cidade ${randomUUID()}`;
    // Cadastradas fora da ordem do nome e da ordem inversa (a mais nova primeiro
    // daria bruno, Zélia, Álvaro).
    for (const name of ['Álvaro Souza', 'Zélia Prado', 'bruno Lima']) {
      const seeded = await seedReferrer({ db, kind: 'planner', name });
      await db.referrer.update({
        where: { userId: seeded.userId },
        data: { planner: { update: { cities: [city] } } },
      });
    }
    const response = await get(admin.cookie, `/referrers?city=${encodeURIComponent(city)}`).expect(
      200,
    );
    expect((response.body as { items: { name: string }[] }).items.map(({ name }) => name)).toEqual([
      'Álvaro Souza',
      'bruno Lima',
      'Zélia Prado',
    ]);
  });

  it('RN08 e Comissões do indicador RN02 - o repasse pago vai para o Já recebido, com o ajuste que entrou nele, e sai do "em repasse", igual no Backoffice e no app', async () => {
    const person = await juliana({ payout: true, adjustmentCents: -500 });
    const total = person.commissions.reduce((sum, c) => sum + c.amountCents, 0) - 500;
    const paidAt = new Date();
    await db.commission.updateMany({
      where: { payoutId: person.payoutId },
      data: { status: 'paid', paidAt },
    });
    await db.payout.update({
      where: { id: person.payoutId! },
      data: { status: 'paid', paidAt, gatewayTransferId: `tr-${randomUUID()}` },
    });

    const row = await rowOf(admin.cookie, person.city);
    expect(row.balances).toEqual({
      availableCents: 0,
      pendingCents: 0,
      receivedCents: total,
      inPayoutCents: 0,
    });
    expect(row.payoutRequested).toBe(false);

    // A tela Comissões da cerimonialista soma igual (o ajuste pago não fica "em repasse").
    const cookie = await openSession({ app, userId: person.userId });
    const mine = await http()
      .get('/v1/me/referrer/commissions')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .expect(200);
    // Os mesmos saldos; o app traz também as legendas (decisão 346(2)).
    expect(mine.body.balances).toEqual({
      ...row.balances,
      adjustmentsCents: expect.any(Number),
      paidPayouts: 1,
    });
  });

  it('RN01 e decisão 69 - o suporte lê a lista com os saldos, sem a tag e sem o filtro do repasse', async () => {
    const person = await juliana();
    const row = await rowOf(support.cookie, person.city);
    expect(row.balances.pendingCents).toBeGreaterThan(0);
    expect(row).not.toHaveProperty('payoutRequested');

    const refused = await get(
      support.cookie,
      `/referrers?city=${encodeURIComponent(person.city)}&hasPayout=true`,
    ).expect(403);
    expect(refused.body.error).toBe('ACTION_NOT_ALLOWED');
  });

  it('RN08 - o detalhe, aba Casamentos: o cabeçalho com o CPF mascarado, o percentual do padrão e a chave Pix; o log da leitura', async () => {
    const person = await juliana({ weddings: 2 });
    const response = await get(admin.cookie, `/referrers/${person.referrerId}`).expect(200);

    expect(response.body.tab).toBe('weddings');
    expect(response.body.referrer).toMatchObject({
      id: person.referrerId,
      name: 'Juliana Prado',
      status: 'active',
      ratePercent: 20,
      rateIsDefault: true,
      taxIdType: 'cpf',
      taxIdMasked: `***.${person.cpf.slice(3, 6)}.${person.cpf.slice(6, 9)}-**`,
      pixKeyMasked: 'jul***@prado.com.br',
      block: null,
      payoutRequested: false,
    });
    expect(JSON.stringify(response.body)).not.toContain(person.cpf);
    expect(response.body.weddings.total).toBe(2);
    expect((response.body.weddings.items as { id: string }[]).map((row) => row.id).sort()).toEqual(
      [...person.weddingIds].sort(),
    );
    expect(response.body.weddings.items[0]).toMatchObject({
      origin: 'planner',
      referrer: { id: person.referrerId },
    });

    const log = await db.applicationLog.findFirst({
      where: { action: 'admin.referrer_viewed', entityId: person.referrerId },
    });
    expect(log).toMatchObject({
      actorUserId: admin.userId,
      entityType: 'referrer',
      data: { role: 'admin', tab: 'weddings', page: 1 },
    });
  });

  it('RN08 - aba Comissões: o extrato com a comissão e a linha "Ajuste manual", do mais novo ao mais velho', async () => {
    const person = await juliana({ adjustmentCents: -1000 });
    const response = await get(
      admin.cookie,
      `/referrers/${person.referrerId}?tab=commissions`,
    ).expect(200);

    const [adjustment, commission] = response.body.statement.items;
    expect(response.body.statement.total).toBe(2);
    expect(adjustment).toMatchObject({
      kind: 'adjustment',
      id: person.adjustmentId,
      amountCents: -1000,
      adjustmentReason: 'manual',
      note: 'Correção do repasse de setembro',
      createdBy: { userId: admin.userId, name: 'Renata Lima' },
      weddingId: null,
      status: null,
    });
    expect(commission).toMatchObject({
      kind: 'commission',
      id: person.commissions[0].id,
      weddingId: person.weddingIds[0],
      paymentKind: 'publication',
      amountCents: person.commissions[0].amountCents,
      ratePercent: 20,
      status: 'pending',
      blockReason: null,
      adjustmentReason: null,
    });
    expect(commission.coupleNames).toContain('&');
  });

  it('RN08 e decisão 284(3) - aba Comissões: a comissão do casamento bloqueado sai Bloqueada com o motivo wedding_blocked ("Casamento bloqueado")', async () => {
    const person = await juliana();
    await app.get(BlockWedding).block({
      weddingId: person.weddingIds[0],
      byUserId: admin.userId,
      reason: 'Denúncia',
      now: new Date(),
    });
    const response = await get(
      admin.cookie,
      `/referrers/${person.referrerId}?tab=commissions`,
    ).expect(200);
    expect(response.body.statement.items).toEqual([
      expect.objectContaining({
        kind: 'commission',
        id: person.commissions[0].id,
        status: 'blocked',
        blockReason: 'wedding_blocked',
      }),
    ]);
  });

  it('RN08 e decisão 69 - aba Repasses só do Admin; o suporte não vê a chave Pix', async () => {
    const person = await juliana({ payout: true });
    const payouts = await get(admin.cookie, `/referrers/${person.referrerId}?tab=payouts`).expect(
      200,
    );
    expect(payouts.body.payouts.items).toEqual([
      expect.objectContaining({
        id: person.payoutId,
        status: 'requested',
        pixKeyMasked: 'jul***@prado.com.br',
        amountCents: person.commissions[0].amountCents,
      }),
    ]);

    const refused = await get(support.cookie, `/referrers/${person.referrerId}?tab=payouts`).expect(
      403,
    );
    expect(refused.body.error).toBe('ACTION_NOT_ALLOWED');

    const header = await get(support.cookie, `/referrers/${person.referrerId}?tab=commissions`);
    expect(header.status).toBe(200);
    expect(header.body.referrer).not.toHaveProperty('pixKeyMasked');
    expect(header.body.referrer).not.toHaveProperty('payoutRequested');
    expect(header.body.referrer.taxIdMasked).toMatch(/^\*\*\*\./);
    expect(header.body.statement.items).toHaveLength(1);
  });

  it('RN08 - a cerimonialista bloqueada: o status, o filtro e o bloqueio com quem e o motivo (log referrer.blocked)', async () => {
    const person = await juliana();
    await db.referrer.update({ where: { id: person.referrerId }, data: { status: 'blocked' } });
    await db.applicationLog.create({
      data: {
        id: uuidV7(),
        action: 'referrer.blocked',
        actorKind: 'admin',
        actorUserId: admin.userId,
        entityType: 'referrer',
        entityId: person.referrerId,
        data: { reason: 'Autoindicação confirmada' },
      },
    });

    const city = encodeURIComponent(person.city);
    const blocked = await get(admin.cookie, `/referrers?city=${city}&status=blocked`).expect(200);
    expect((blocked.body.items as { id: string }[]).map((row) => row.id)).toEqual([
      person.referrerId,
    ]);

    const detail = await get(admin.cookie, `/referrers/${person.referrerId}`).expect(200);
    expect(detail.body.referrer.status).toBe('blocked');
    expect(detail.body.referrer.block).toEqual({
      blockedAt: expect.any(String),
      blockedBy: { userId: admin.userId, name: 'Renata Lima' },
      reason: 'Autoindicação confirmada',
    });
  });

  it('RN08 - 404 REFERRER_NOT_FOUND sem o indicador ou num vendedor (fora do lançamento); 400 com tab ou kind fora da lista', async () => {
    expect((await get(admin.cookie, `/referrers/${uuidV7()}`).expect(404)).body.error).toBe(
      'REFERRER_NOT_FOUND',
    );
    const seller = await seedReferrer({ db, kind: 'seller', name: 'Wagner Queiroz' });
    const sellerReferrer = await db.referrer.findUniqueOrThrow({
      where: { userId: seller.userId },
    });
    expect(
      (await get(admin.cookie, `/referrers/${sellerReferrer.id}`).expect(404)).body.error,
    ).toBe('REFERRER_NOT_FOUND');
    await get(admin.cookie, `/referrers?kind=seller`).expect(400);
    await get(admin.cookie, `/referrers/${sellerReferrer.id}?tab=log`).expect(400);
  });

  it('RN01 - fora do staff: 403 STAFF_ONLY na lista e no detalhe', async () => {
    const person = await juliana({ weddings: 0 });
    const outsider = await signedInUser({ app });
    expect((await get(outsider.cookie, '/referrers').expect(403)).body.error).toBe('STAFF_ONLY');
    expect(
      (await get(outsider.cookie, `/referrers/${person.referrerId}`).expect(403)).body.error,
    ).toBe('STAFF_ONLY');
  });
});
