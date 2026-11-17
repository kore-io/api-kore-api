import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { addMonths } from '@/modules/billing/domain/payments/pricing';
import { ActivatePixKeys } from '@/modules/referral/application/activate-pix-keys.use-case';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { uuidV7 } from '@/shared/kernel/ids/uuid-v7';
import { localDate } from '@/shared/kernel/time/local-date';
import { createTestApp } from '../support/harness/create-test-app';
import { createTestWorker } from '../support/harness/create-test-worker';
import { waitForInbox } from '../support/harness/mailpit';
import { publishByPayment, randomCnpj, randomCpf } from '../support/factories/payments';
import { seedReferrer } from '../support/factories/referrers';
import { openSession, signedInUser } from '../support/harness/sessions';
import { seedWedding } from '../support/factories/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const MAILPIT_API_URL = process.env.MAILPIT_API_URL ?? 'http://localhost:8025';
const HOUR = 60 * 60_000;

/**
 * Dados para receber (Repasse e Dados para receber RN02, RN03 e RN06 (b);
 * decisão 244): o CPF ou CNPJ e a chave Pix da pessoa indicadora.
 */
describe('Dados para receber: CPF ou CNPJ e chave Pix (Repasse RN02 e RN03; banco real)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;

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

  async function juliana() {
    const seeded = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId: seeded.userId } });
    const { email } = await db.user.findUniqueOrThrow({
      where: { id: seeded.userId },
      select: { email: true },
    });
    return {
      ...seeded,
      referrerId: referrer.id,
      email,
      cookie: await openSession({ app, userId: seeded.userId }),
    };
  }

  const setTaxId = (cookie: string, body: Record<string, string>) =>
    http().put('/v1/me/referrer/tax-id').set('Cookie', cookie).set('Origin', APP_ORIGIN).send(body);
  const requestKey = (cookie: string, body: Record<string, string>) =>
    http()
      .post('/v1/me/referrer/pix-keys')
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);
  const confirmKey = (cookie: string, token: string) =>
    http()
      .post('/v1/me/referrer/pix-keys/confirm')
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send({ token });
  const cancelKey = (cookie: string, id: string) =>
    http().delete(`/v1/me/referrer/pix-keys/${id}`).set('Cookie', cookie).set('Origin', APP_ORIGIN);

  /**
   * O token do link do `count`-ésimo e-mail com esse assunto (o mais novo), e o
   * assunto. Pelo assunto: a confirmação de uma troca, assíncrona, pode chegar
   * depois do link da troca seguinte e tomar o lugar dele na contagem geral.
   */
  async function linkFromEmail(to: string, subject: string, count = 1) {
    const [latest] = await waitForInbox({ to, subject, count });
    const response = await fetch(`${MAILPIT_API_URL}/api/v1/message/${latest.ID}`);
    const { Text } = (await response.json()) as { Text: string };
    const token = /confirmar\?token=([\w%-]+)/.exec(Text)?.[1];
    return { subject: latest.Subject, text: Text, token: token && decodeURIComponent(token) };
  }

  /** A primeira chave cadastrada e confirmada. */
  async function withActiveKey(person: Awaited<ReturnType<typeof juliana>>) {
    await requestKey(person.cookie, {
      keyType: 'email',
      key: 'juliana@pradoassessoria.com.br',
    }).expect(201);
    const { token } = await linkFromEmail(person.email, 'Confirme a sua chave Pix');
    await confirmKey(person.cookie, token!).expect(200);
  }

  it('RN02 - o CPF uma vez só, mascarado; repetido em outra conta, TAX_ID_IN_USE', async () => {
    const person = await juliana();
    const cpf = randomCpf();

    const saved = await setTaxId(person.cookie, { taxIdType: 'cpf', taxId: cpf }).expect(200);
    expect(saved.body).toEqual({
      taxIdType: 'cpf',
      taxIdMasked: `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`,
    });
    const me = await http().get('/v1/me/referrer').set('Cookie', person.cookie).expect(200);
    expect(me.body).toMatchObject({
      taxIdMasked: saved.body.taxIdMasked,
      pixKeyMasked: null,
      payoutDataComplete: false,
    });
    expect(JSON.stringify(me.body)).not.toContain(cpf);
    // O log (Mudanças no modelo de dados): referrer.tax_id_set, sem o número.
    const taxLog = await db.applicationLog.findFirstOrThrow({
      where: { action: 'referrer.tax_id_set', actorUserId: person.userId },
    });
    expect(taxLog).toMatchObject({ actorKind: 'user', data: { taxIdType: 'cpf' } });
    expect(JSON.stringify(taxLog)).not.toContain(cpf.slice(3, 9));

    expect(
      (await setTaxId(person.cookie, { taxIdType: 'cpf', taxId: randomCpf() }).expect(409)).body
        .error,
    ).toBe('TAX_ID_LOCKED');
    const other = await juliana();
    expect(
      (await setTaxId(other.cookie, { taxIdType: 'cpf', taxId: cpf }).expect(409)).body.error,
    ).toBe('TAX_ID_IN_USE');
    await setTaxId(other.cookie, { taxIdType: 'cpf', taxId: '529.982.247-24' }).expect(400);
    await setTaxId(other.cookie, { taxIdType: 'cnpj', taxId: randomCnpj() }).expect(200);

    const ana = await signedInUser({ app });
    expect(
      (await setTaxId(ana.cookie, { taxIdType: 'cpf', taxId: randomCpf() }).expect(403)).body.error,
    ).toBe('PROFILE_NOT_OWNED');
  });

  it('RN02 (B7-8; decisão 244(3)) - 5 por hora por usuário: a 6ª, 429 RATE_LIMITED', async () => {
    const person = await juliana();
    for (let attempt = 0; attempt < 5; attempt++)
      await setTaxId(person.cookie, { taxIdType: 'cpf', taxId: '529.982.247-24' }).expect(400);
    expect(
      (await setTaxId(person.cookie, { taxIdType: 'cpf', taxId: randomCpf() }).expect(429)).body
        .error,
    ).toBe('RATE_LIMITED');
  });

  it('RN02 e Comissões RN03 - cadastrar o CPF roda de novo a autoindicação nas comissões dela, com o log commission.blocked', async () => {
    const person = await juliana();
    const cpf = randomCpf();
    const ana = await signedInUser({ app });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    const today = localDate({ at: new Date(), timezone: 'America/Sao_Paulo' });
    const eventDate = addMonths({ day: today, months: 4 });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        eventDate: new Date(`${eventDate}T00:00:00Z`),
        referrerId: person.referrerId,
        referralSource: 'referral_link',
      },
    });
    // Juliana pagou o casamento com o próprio CPF antes de cadastrá-lo.
    const { paymentId } = await publishByPayment({
      app,
      cookie: ana.cookie,
      weddingId,
      endDate: addMonths({ day: eventDate, months: 3 }),
      payerTaxId: cpf,
    });
    expect(await db.commission.findUniqueOrThrow({ where: { paymentId } })).toMatchObject({
      status: 'pending',
    });

    await setTaxId(person.cookie, { taxIdType: 'cpf', taxId: cpf }).expect(200);

    const commission = await db.commission.findUniqueOrThrow({ where: { paymentId } });
    expect(commission).toMatchObject({ status: 'blocked', blockReason: 'self_referral' });
    // Comissões, log: a checagem do CPF grava o commission.blocked (sonda do DoD).
    const lines = await db.applicationLog.findMany({
      where: { entityType: 'commission', entityId: commission.id, action: 'commission.blocked' },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      actorKind: 'system',
      data: expect.objectContaining({ previousStatus: 'pending', blockReason: 'self_referral' }),
    });
    expect(JSON.stringify(lines[0])).not.toContain(cpf.replace(/\D/g, '').slice(3, 9));
  });

  it('RN03 - a primeira chave: sessão recente, link por e-mail, vale na confirmação', async () => {
    const person = await juliana();
    await db.session.updateMany({
      where: { userId: person.userId },
      data: { authenticatedAt: new Date(Date.now() - 2 * HOUR) },
    });
    expect(
      (
        await requestKey(person.cookie, { keyType: 'email', key: 'juliana@prado.com.br' }).expect(
          403,
        )
      ).body.error,
    ).toBe('REAUTH_REQUIRED');

    person.cookie = await openSession({ app, userId: person.userId });
    const requested = await requestKey(person.cookie, {
      keyType: 'email',
      key: 'Juliana@PradoAssessoria.com.br',
    }).expect(201);
    expect(requested.body).toMatchObject({ firstKey: true });
    expect(requested.body.emailMasked).toMatch(/^.{1,3}\*\*\*@kore\.local$/);

    const email = await linkFromEmail(person.email, 'Confirme a sua chave Pix');
    expect(email.subject).toBe('Confirme a sua chave Pix');
    expect(email.text).toContain('jul***@pradoassessoria.com.br');
    expect(email.text).not.toContain('juliana@pradoassessoria.com.br');
    expect(email.text).toContain('/dados-para-receber/confirmar?token=');

    const confirmed = await confirmKey(person.cookie, email.token!).expect(200);
    expect(confirmed.body.status).toBe('active');
    expect(Date.now() - new Date(confirmed.body.activeFrom).getTime()).toBeLessThan(60_000);
    // O log (Mudanças no modelo de dados): pix_key.changed, sem a chave.
    const keyLog = await db.applicationLog.findFirstOrThrow({
      where: { action: 'pix_key.changed', actorUserId: person.userId },
    });
    expect(keyLog).toMatchObject({
      actorKind: 'user',
      entityType: 'referrer_pix_key',
      data: { status: 'active', activeFrom: confirmed.body.activeFrom },
    });
    expect(JSON.stringify(keyLog).toLowerCase()).not.toContain('pradoassessoria');
    await confirmKey(person.cookie, email.token!).expect(404);

    await setTaxId(person.cookie, { taxIdType: 'cpf', taxId: randomCpf() }).expect(200);
    const me = await http().get('/v1/me/referrer').set('Cookie', person.cookie).expect(200);
    expect(me.body).toMatchObject({
      pixKeyMasked: 'jul***@pradoassessoria.com.br',
      payoutDataComplete: true,
    });
    const keys = await http()
      .get('/v1/me/referrer/pix-keys')
      .set('Cookie', person.cookie)
      .expect(200);
    expect(JSON.stringify(keys.body)).not.toMatch(/juliana@|keyEncrypted|confirmTokenHash/);
  });

  it('RN03 - o link vencido: PIX_KEY_LINK_EXPIRED', async () => {
    const person = await juliana();
    await requestKey(person.cookie, { keyType: 'random', key: uuidV7() }).expect(201);
    const { token } = await linkFromEmail(person.email, 'Confirme a sua chave Pix');
    await db.referrerPixKey.updateMany({
      where: { referrerId: person.referrerId, status: 'pending_confirmation' },
      data: { confirmExpiresAt: new Date(Date.now() - 1_000) },
    });
    expect((await confirmKey(person.cookie, token!).expect(410)).body.error).toBe(
      'PIX_KEY_LINK_EXPIRED',
    );
  });

  it('RN03 e RN06 (b) - a troca vale 48 h depois, retém o repasse e o Cancelar devolve', async () => {
    const person = await juliana();
    await withActiveKey(person);
    const active = await db.referrerPixKey.findFirstOrThrow({
      where: { referrerId: person.referrerId, status: 'active' },
    });
    const payout = await db.payout.create({
      data: {
        id: uuidV7(),
        referrerId: person.referrerId,
        amountCents: 15_804,
        pixKeyId: active.id,
        pixKeyMasked: active.keyMasked,
        externalRef: `payout-${uuidV7()}`,
        idempotencyKey: uuidV7(),
        requestedAt: new Date(),
      },
    });

    await requestKey(person.cookie, { keyType: 'phone', key: '(19) 99876-3310' }).expect(201);
    const email = await linkFromEmail(person.email, 'Confirme a troca da chave Pix');
    expect(email.subject).toBe('Confirme a troca da chave Pix');
    const confirmed = await confirmKey(person.cookie, email.token!).expect(200);
    expect(confirmed.body.status).toBe('pending_activation');
    const activeFrom = new Date(confirmed.body.activeFrom);
    expect(Math.abs(activeFrom.getTime() - Date.now() - 48 * HOUR)).toBeLessThan(60_000);
    expect((await linkFromEmail(person.email, 'Troca da chave Pix confirmada')).subject).toBe(
      'Troca da chave Pix confirmada',
    );
    expect(await db.payout.findUniqueOrThrow({ where: { id: payout.id } })).toMatchObject({
      status: 'held',
      holdReason: 'pix_key_change',
    });

    const pending = await requestKey(person.cookie, { keyType: 'random', key: uuidV7() }).expect(
      409,
    );
    expect(pending.body).toMatchObject({
      error: 'PIX_KEY_CHANGE_PENDING',
      activeFrom: confirmed.body.activeFrom,
    });

    await cancelKey(person.cookie, confirmed.body.id).expect(204);
    expect((await linkFromEmail(person.email, 'Troca da chave Pix cancelada')).subject).toBe(
      'Troca da chave Pix cancelada',
    );
    expect(await db.payout.findUniqueOrThrow({ where: { id: payout.id } })).toMatchObject({
      status: 'requested',
      holdReason: null,
    });
    const keys = await http()
      .get('/v1/me/referrer/pix-keys')
      .set('Cookie', person.cookie)
      .expect(200);
    expect(
      (keys.body.items as { status: string; keyMasked: string }[]).map(({ status, keyMasked }) => ({
        status,
        keyMasked,
      })),
    ).toEqual([
      { status: 'canceled', keyMasked: '(19) 9****-3310' },
      { status: 'active', keyMasked: 'jul***@pradoassessoria.com.br' },
    ]);
  });

  it('RN03 - vencidas as 48 h, a rotina ativa a nova chave e a antiga fica substituída', async () => {
    const person = await juliana();
    await withActiveKey(person);
    await requestKey(person.cookie, { keyType: 'phone', key: '(19) 99876-3310' }).expect(201);
    const { token } = await linkFromEmail(person.email, 'Confirme a troca da chave Pix');
    const confirmed = await confirmKey(person.cookie, token!).expect(200);

    await worker.get(ActivatePixKeys).execute({
      now: new Date(new Date(confirmed.body.activeFrom).getTime() + 60_000),
      referrerId: person.referrerId,
    });

    const keys = await db.referrerPixKey.findMany({
      where: { referrerId: person.referrerId },
      orderBy: { createdAt: 'asc' },
      select: { status: true, keyMasked: true },
    });
    expect(keys).toEqual([
      { status: 'replaced', keyMasked: 'jul***@pradoassessoria.com.br' },
      { status: 'active', keyMasked: '(19) 9****-3310' },
    ]);
  });

  it('RN06 (b) - vencidas as 48 h, o repasse retido pela troca volta sozinho a solicitado', async () => {
    const person = await juliana();
    await withActiveKey(person);
    const active = await db.referrerPixKey.findFirstOrThrow({
      where: { referrerId: person.referrerId, status: 'active' },
    });
    const payout = await db.payout.create({
      data: {
        id: uuidV7(),
        referrerId: person.referrerId,
        amountCents: 15_804,
        pixKeyId: active.id,
        pixKeyMasked: active.keyMasked,
        externalRef: `payout-${uuidV7()}`,
        idempotencyKey: uuidV7(),
        requestedAt: new Date(),
      },
    });
    await requestKey(person.cookie, { keyType: 'phone', key: '(19) 99876-3310' }).expect(201);
    const { token } = await linkFromEmail(person.email, 'Confirme a troca da chave Pix');
    const confirmed = await confirmKey(person.cookie, token!).expect(200);
    expect((await db.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe('held');

    await worker.get(ActivatePixKeys).execute({
      now: new Date(new Date(confirmed.body.activeFrom).getTime() + 60_000),
      referrerId: person.referrerId,
    });
    expect(await db.payout.findUniqueOrThrow({ where: { id: payout.id } })).toMatchObject({
      status: 'requested',
      holdReason: null,
    });
  });

  it('RN03 - o Cancelar da troca também pede sessão recente', async () => {
    const person = await juliana();
    await withActiveKey(person);
    await requestKey(person.cookie, { keyType: 'phone', key: '(19) 99876-3310' }).expect(201);
    const { token } = await linkFromEmail(person.email, 'Confirme a troca da chave Pix');
    const confirmed = await confirmKey(person.cookie, token!).expect(200);
    await db.session.updateMany({
      where: { userId: person.userId },
      data: { authenticatedAt: new Date(Date.now() - 2 * HOUR) },
    });
    expect((await cancelKey(person.cookie, confirmed.body.id).expect(403)).body.error).toBe(
      'REAUTH_REQUIRED',
    );
    expect(
      (await db.referrerPixKey.findUniqueOrThrow({ where: { id: confirmed.body.id } })).status,
    ).toBe('pending_activation');
  });

  it('RN02 e RN03 - o CPF e a chave ficam cifrados no banco, nunca o valor aberto', async () => {
    const person = await juliana();
    const cpf = randomCpf();
    await setTaxId(person.cookie, { taxIdType: 'cpf', taxId: cpf }).expect(200);
    await withActiveKey(person);
    const referrer = await db.referrer.findUniqueOrThrow({ where: { id: person.referrerId } });
    expect(referrer.taxIdEncrypted).toEqual(expect.any(String));
    expect(referrer.taxIdEncrypted).not.toContain(cpf);
    expect(referrer.taxIdHash).not.toContain(cpf);
    const key = await db.referrerPixKey.findFirstOrThrow({
      where: { referrerId: person.referrerId, status: 'active' },
    });
    expect(key.keyEncrypted.toLowerCase()).not.toContain('pradoassessoria');
    expect(key.keyHash.toLowerCase()).not.toContain('pradoassessoria');
  });

  it('isolamento - a chave de outra indicadora: confirmar com o token dela e cancelar pelo id dela dão 404, e nada muda', async () => {
    const owner = await juliana();
    await withActiveKey(owner);
    await requestKey(owner.cookie, { keyType: 'phone', key: '(19) 99876-3310' }).expect(201);
    const { token } = await linkFromEmail(owner.email, 'Confirme a troca da chave Pix');
    const intruder = await juliana();
    await confirmKey(intruder.cookie, token!).expect(404);
    const pending = await db.referrerPixKey.findFirstOrThrow({
      where: { referrerId: owner.referrerId, status: 'pending_confirmation' },
    });
    await cancelKey(intruder.cookie, pending.id).expect(404);
    expect((await db.referrerPixKey.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(
      'pending_confirmation',
    );
    // A dona ainda confirma com o mesmo token.
    expect((await confirmKey(owner.cookie, token!).expect(200)).body.status).toBe(
      'pending_activation',
    );
  });

  it('RN03 (decisão 244(5)) - a 3ª troca confirmada em 24 h abre o alerta pix_key_churn', async () => {
    const person = await juliana();
    await withActiveKey(person);
    for (let change = 0; change < 3; change++) {
      await requestKey(person.cookie, { keyType: 'random', key: uuidV7() }).expect(201);
      // Cada troca manda o seu link: o (change + 1)-ésimo com esse assunto.
      const { token } = await linkFromEmail(
        person.email,
        'Confirme a troca da chave Pix',
        change + 1,
      );
      const confirmed = await confirmKey(person.cookie, token!).expect(200);
      const open = await db.alert.count({
        where: { type: 'pix_key_churn', entityId: person.referrerId, status: 'open' },
      });
      expect(open).toBe(change === 2 ? 1 : 0);
      await cancelKey(person.cookie, confirmed.body.id).expect(204);
    }
  });
});
