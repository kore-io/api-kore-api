import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  PRODUCT_EVENT_RECORDER,
  type ProductEventRecorder,
} from '../../src/modules/product-events/application/ports/product-event-recorder.port';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { createTestApp } from '../support/create-test-app';

describe('Eventos de produto (decisões 135 e 138, banco real)', () => {
  let app: INestApplication;
  let backoffice: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    backoffice = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const recorder = () => app.get<ProductEventRecorder>(PRODUCT_EVENT_RECORDER);

  it('dada uma conta criada, quando registra, então grava conta_criada com a origem e o método, sem casamento', async () => {
    const occurredAt = new Date();

    await recorder().record({
      event: { name: 'conta_criada', props: { origem: 'referral', metodo: 'google' } },
      occurredAt,
    });

    const [event] = await backoffice.productEvent.findMany({
      where: { name: 'conta_criada', occurredAt },
    });
    expect(event).toMatchObject({
      weddingRef: null,
      props: { origem: 'referral', metodo: 'google' },
    });
  });

  it('dado um evento de casamento, quando registra, então guarda só o casamento pseudonimizado', async () => {
    const weddingId = randomUUID();
    const occurredAt = new Date();

    await recorder().record({ event: { name: 'casal_aceitou', weddingId }, occurredAt });
    await recorder().record({ event: { name: 'cerim_link_gerado', weddingId }, occurredAt });

    const events = await backoffice.productEvent.findMany({ where: { occurredAt } });
    expect(events).toHaveLength(2);
    expect(new Set(events.map((event) => event.weddingRef)).size).toBe(1);
    expect(JSON.stringify(events)).not.toContain(weddingId);
  });

  it('dado um nome fora da lista do Parecer, quando grava direto no banco, então o banco recusa', async () => {
    await expect(
      backoffice.$executeRaw`INSERT INTO product_events (id, name, occurred_at)
        VALUES (${randomUUID()}::uuid, 'evento_inventado', now())`,
    ).rejects.toThrow(/product_event_name/);
  });

  it.each([
    ['ler', (prisma: PrismaService) => prisma.$queryRaw`SELECT * FROM product_events LIMIT 1`],
    [
      'alterar',
      (prisma: PrismaService) => prisma.$executeRaw`UPDATE product_events SET props = null`,
    ],
    ['apagar', (prisma: PrismaService) => prisma.$executeRaw`DELETE FROM product_events`],
  ])('dada a API, quando tenta %s os eventos, então o banco nega (só inserção)', async (_, run) => {
    await expect(run(app.get(PrismaService))).rejects.toThrow(/permission denied/);
  });
});
