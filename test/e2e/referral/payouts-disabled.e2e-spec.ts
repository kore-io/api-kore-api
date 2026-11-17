import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { AppConfigService } from '@/shared/config/app-config.service';
import type { Env } from '@/shared/config/env.schema';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { uuidV7 } from '@/shared/kernel/ids/uuid-v7';
import { createTestApp } from '../support/harness/create-test-app';
import { seedReferrer } from '../support/factories/referrers';
import { openSession, staffUser } from '../support/harness/sessions';

const ORIGIN = 'http://localhost:5173';

/** A configuração do teste, com a PAYOUTS_ENABLED desligada. */
class PayoutsOffConfig extends AppConfigService {
  override get<K extends keyof Env>({ key }: { key: K }): Env[K] {
    return (key === 'PAYOUTS_ENABLED' ? false : super.get({ key })) as Env[K];
  }
}

/**
 * Com a PAYOUTS_ENABLED desligada (Repasse RN01; Backoffice - cobrança RN09):
 * o pedido da cerimonialista e o Pagar do Admin respondem 409
 * PAYOUTS_DISABLED pela rota. Uma API própria, com a variável desligada.
 */
describe('Repasse com a PAYOUTS_ENABLED desligada (Repasse RN01; banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  beforeAll(async () => {
    app = await createTestApp({
      override: (builder) =>
        builder.overrideProvider(AppConfigService).useFactory({
          factory: (config: ConfigService<Env, true>) => new PayoutsOffConfig(config),
          inject: [ConfigService],
        }),
    });
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('RN01 - o pedido de repasse e o Pagar: 409 PAYOUTS_DISABLED, sem repasse nem Pix', async () => {
    const seeded = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId: seeded.userId } });
    const cookie = await openSession({ app, userId: seeded.userId });
    const asked = await request(app.getHttpServer())
      .post('/v1/me/referrer/payouts')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedAmountCents: 5_000 })
      .expect(409);
    expect(asked.body.error).toBe('PAYOUTS_DISABLED');
    expect(await db.payout.count({ where: { referrerId: referrer.id } })).toBe(0);

    const key = await db.referrerPixKey.create({
      data: {
        id: uuidV7(),
        referrerId: referrer.id,
        keyType: 'email',
        keyEncrypted: 'cifrado',
        keyHash: `hash-${randomUUID()}`,
        keyMasked: 'jul***@prado.com.br',
        status: 'active',
        confirmedAt: new Date(),
        activeFrom: new Date(),
      },
    });
    const payout = await db.payout.create({
      data: {
        id: uuidV7(),
        referrerId: referrer.id,
        amountCents: 5_000,
        pixKeyId: key.id,
        pixKeyMasked: key.keyMasked,
        externalRef: `payout-${uuidV7()}`,
        idempotencyKey: uuidV7(),
        requestedAt: new Date(),
      },
    });
    const admin = await staffUser({ app, role: 'admin' });
    const paid = await request(app.getHttpServer())
      .post(`/v1/admin/payouts/${payout.id}/pay`)
      .set('Cookie', admin.cookie)
      .set('Origin', ORIGIN)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(409);
    expect(paid.body.error).toBe('PAYOUTS_DISABLED');
    expect((await db.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe(
      'requested',
    );
  });
});
