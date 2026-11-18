import type { INestApplication } from '@nestjs/common';
import { Logger, PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { Writable } from 'node:stream';
import { addMonths } from '@/modules/billing/domain/payments/pricing';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { localDate } from '@/shared/kernel/time/local-date';
import { buildLoggerParams } from '@/shared/observability/logger.options';
import { createTestApp } from '../support/harness/create-test-app';
import { devPaymentEvent, expectStatus, payForPublication } from '../support/factories/payments';
import { signedInUser } from '../support/harness/sessions';
import { seedWedding } from '../support/factories/weddings';

/**
 * Publicar e pagar RN02 (B2-13; DoD da F3): "um teste procura o CPF de exemplo
 * em todas essas saídas". O banco está em publish-and-pay.e2e-spec.ts e os spans
 * em allow-list-span-processor.spec.ts (a auto-instrumentação do OpenTelemetry
 * não engancha nos módulos que o Jest carrega). Aqui é o log de requisição pelo
 * pedido real: o pino com as opções do main (redação e serializers), num stream
 * do teste, e o nível no mais baixo.
 */
const CPF = '529.982.247-25';
const CPF_DIGITS = '52998224725';
const INVALID = '111.111.111-11';

describe('Publicar e pagar RN02 - o CPF de quem paga fora do log de requisição (pedido real; banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  const lines: string[] = [];

  beforeAll(async () => {
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString('utf8'));
        done();
      },
    });
    const params = buildLoggerParams({ appEnv: 'test', level: 'trace' });
    app = await createTestApp({
      override: (builder) =>
        builder
          .overrideProvider(PARAMS_PROVIDER_TOKEN)
          .useValue({ ...params, pinoHttp: [params.pinoHttp, stream] }),
    });
    // Como no main.ts: o Logger do Nest também escreve pelo pino.
    app.useLogger(app.get(Logger));
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('RN02 (B2-13) - pagar, confirmar e errar o CPF: nenhuma linha do log de requisição leva o CPF', async () => {
    const ana = await signedInUser({ app });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    const today = localDate({ at: new Date(), timezone: 'America/Sao_Paulo' });
    const eventDate = addMonths({ day: today, months: 4 });
    await db.wedding.update({
      where: { id: weddingId },
      data: { eventDate: new Date(`${eventDate}T00:00:00Z`) },
    });
    const endDate = addMonths({ day: eventDate, months: 3 });
    lines.length = 0;

    expectStatus(
      await payForPublication({ app, cookie: ana.cookie, weddingId, endDate, payerTaxId: INVALID }),
      400,
    );
    const created = expectStatus(
      await payForPublication({ app, cookie: ana.cookie, weddingId, endDate, payerTaxId: CPF }),
      201,
    );
    expectStatus(
      await devPaymentEvent({ app, paymentId: created.body.paymentId as string, event: 'confirm' }),
      200,
    );

    const entries = lines.map(
      (line) => JSON.parse(line) as { req?: { method?: string }; res?: { statusCode?: number } },
    );
    // A prova só vale se o pedido real passou pelo log: os dois POST do pagamento.
    const posts = entries.filter((entry) => entry.req?.method === 'POST');
    expect(posts.map((entry) => entry.res?.statusCode)).toEqual(expect.arrayContaining([400, 201]));
    const text = lines.join('\n');
    for (const value of [CPF, CPF_DIGITS, INVALID, INVALID.replace(/\D/g, '')])
      expect(text).not.toContain(value);
    expect(text).not.toContain(weddingId);
  });
});
