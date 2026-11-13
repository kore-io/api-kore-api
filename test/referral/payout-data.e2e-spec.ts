import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { addMonths } from '../../src/modules/billing/domain/pricing';
import { ActivatePixKeys } from '../../src/modules/referral/application/activate-pix-keys.use-case';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import { localDate } from '../../src/shared/time/local-date';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { waitForInbox } from '../support/mailpit';
import { publishByPayment, randomCnpj, randomCpf } from '../support/payments';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

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

  /** O token do link do `count`-ésimo e-mail (o mais novo), e o assunto. */
  async function linkFromEmail(to: string, count: number) {
    const [latest] = await waitForInbox({ to, count });
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
    const { token } = await linkFromEmail(person.email, 1);
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

  it('RN02 e Comissões RN03 - cadastrar o CPF roda de novo a autoindicação nas comissões dela', async () => {
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

    expect(await db.commission.findUniqueOrThrow({ where: { paymentId } })).toMatchObject({
      status: 'blocked',
      blockReason: 'self_referral',
    });
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

    const email = await linkFromEmail(person.email, 1);
    expect(email.subject).toBe('Confirme a sua chave Pix');
    expect(email.text).toContain('jul***@pradoassessoria.com.br');
    expect(email.text).not.toContain('juliana@pradoassessoria.com.br');
    expect(email.text).toContain('/dados-para-receber/confirmar?token=');

    const confirmed = await confirmKey(person.cookie, email.token!).expect(200);
    expect(confirmed.body.status).toBe('active');
    expect(Date.now() - new Date(confirmed.body.activeFrom).getTime()).toBeLessThan(60_000);
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
    const { token } = await linkFromEmail(person.email, 1);
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
    const email = await linkFromEmail(person.email, 2);
    expect(email.subject).toBe('Confirme a troca da chave Pix');
    const confirmed = await confirmKey(person.cookie, email.token!).expect(200);
    expect(confirmed.body.status).toBe('pending_activation');
    const activeFrom = new Date(confirmed.body.activeFrom);
    expect(Math.abs(activeFrom.getTime() - Date.now() - 48 * HOUR)).toBeLessThan(60_000);
    expect((await linkFromEmail(person.email, 3)).subject).toBe('Troca da chave Pix confirmada');
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
    expect((await linkFromEmail(person.email, 4)).subject).toBe('Troca da chave Pix cancelada');
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
    const { token } = await linkFromEmail(person.email, 2);
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

  it('RN03 (decisão 244(5)) - a 3ª troca confirmada em 24 h abre o alerta pix_key_churn', async () => {
    const person = await juliana();
    await withActiveKey(person);
    for (let change = 0; change < 3; change++) {
      await requestKey(person.cookie, { keyType: 'random', key: uuidV7() }).expect(201);
      // O 1º e-mail é o da primeira chave; cada troca manda o link e a confirmação.
      const { token } = await linkFromEmail(person.email, 2 + change * 3);
      const confirmed = await confirmKey(person.cookie, token!).expect(200);
      const open = await db.alert.count({
        where: { type: 'pix_key_churn', entityId: person.referrerId, status: 'open' },
      });
      expect(open).toBe(change === 2 ? 1 : 0);
      await cancelKey(person.cookie, confirmed.body.id).expect(204);
    }
  });
});
