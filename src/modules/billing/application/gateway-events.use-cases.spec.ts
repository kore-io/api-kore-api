import type { GatewayEventQueue } from './ports/gateway-event.queue.port';
import type { GatewayEventStore, StoredGatewayEvent } from './ports/gateway-event.store.port';
import type {
  GatewayWebhookEvent,
  PaymentGateway,
  WebhookVerification,
} from './ports/payment-gateway.port';
import { ProcessGatewayEvent } from './process-gateway-event.use-case';
import type { SyncPaymentWithGateway } from './sync-payment.use-case';
import { ReceiveGatewayWebhook } from './receive-gateway-webhook.use-case';
import { RequeueGatewayEvents } from './requeue-gateway-events.use-case';

const now = new Date('2026-08-10T18:20:00Z');
const event: GatewayWebhookEvent = {
  gatewayEventId: 'evt_1',
  type: 'charge.confirmed',
  externalReference: 'pay-1',
  gatewayPaymentId: 'pay_local_1',
  chargedCents: 33710,
  feeCents: 199,
  netCents: 33511,
};

function gatewayReturning(verification: WebhookVerification): PaymentGateway {
  return { name: 'local', verifyWebhook: () => verification } as unknown as PaymentGateway;
}

function storeMock(overrides: Partial<GatewayEventStore> = {}): jest.Mocked<GatewayEventStore> {
  return {
    record: jest.fn().mockResolvedValue({ id: 'e1', created: true, processedAt: null }),
    byId: jest.fn(),
    unprocessed: jest.fn().mockResolvedValue([]),
    paymentIdFor: jest.fn().mockResolvedValue('pay-1'),
    markProcessed: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as jest.Mocked<GatewayEventStore>;
}

const input = { gateway: 'local', headers: {}, rawBody: Buffer.from('{}'), now };

describe('ReceiveGatewayWebhook (Publicar e pagar RN09)', () => {
  it('RN09 - assinatura inválida: nada é gravado nem vai à fila', async () => {
    const store = storeMock();
    const queue = { enqueue: jest.fn() };
    const receive = new ReceiveGatewayWebhook(
      gatewayReturning({ kind: 'invalid_signature' }),
      store,
      queue,
    );
    expect(await receive.execute(input)).toEqual({ kind: 'invalid_signature' });
    expect(store.record).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('RN14 - outro gateway na rota: 404, sem conferir nada', async () => {
    const store = storeMock();
    const receive = new ReceiveGatewayWebhook(gatewayReturning({ kind: 'event', event }), store, {
      enqueue: jest.fn(),
    });
    expect(await receive.execute({ ...input, gateway: 'asaas' })).toEqual({
      kind: 'unknown_gateway',
    });
    expect(store.record).not.toHaveBeenCalled();
  });

  it('RN09 - grava o evento e só então põe na fila, com o id do evento', async () => {
    const order: string[] = [];
    const store = storeMock({
      record: jest.fn().mockImplementation(() => {
        order.push('gravou');
        return Promise.resolve({ id: 'e1', created: true, processedAt: null });
      }),
    });
    const queue: GatewayEventQueue = {
      enqueue: jest.fn().mockImplementation(() => {
        order.push('fila');
        return Promise.resolve();
      }),
    };
    const receive = new ReceiveGatewayWebhook(
      gatewayReturning({ kind: 'event', event }),
      store,
      queue,
    );
    expect(await receive.execute(input)).toEqual({
      kind: 'recorded',
      eventId: 'e1',
      duplicate: false,
    });
    expect(order).toEqual(['gravou', 'fila']);
    expect(queue.enqueue).toHaveBeenCalledWith({
      eventId: 'e1',
      gateway: 'local',
      gatewayEventId: 'evt_1',
    });
  });

  it('RN09 - o banco falhou: o erro sobe (5xx) e nada vai à fila', async () => {
    const queue = { enqueue: jest.fn() };
    const receive = new ReceiveGatewayWebhook(
      gatewayReturning({ kind: 'event', event }),
      storeMock({ record: jest.fn().mockRejectedValue(new Error('db')) }),
      queue,
    );
    await expect(receive.execute(input)).rejects.toThrow('db');
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('B2-5 - a fila falhou depois de gravar: responde gravado, e a rotina repõe', async () => {
    const receive = new ReceiveGatewayWebhook(
      gatewayReturning({ kind: 'event', event }),
      storeMock(),
      {
        enqueue: jest.fn().mockRejectedValue(new Error('redis')),
      },
    );
    expect(await receive.execute(input)).toMatchObject({ kind: 'recorded' });
  });

  it('B2-5 - o evento repetido não processado volta à fila; o já processado, não', async () => {
    const queue = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const pending = new ReceiveGatewayWebhook(
      gatewayReturning({ kind: 'event', event }),
      storeMock({
        record: jest.fn().mockResolvedValue({ id: 'e1', created: false, processedAt: null }),
      }),
      queue,
    );
    expect(await pending.execute(input)).toEqual({
      kind: 'recorded',
      eventId: 'e1',
      duplicate: true,
    });
    expect(queue.enqueue).toHaveBeenCalledTimes(1);

    const done = new ReceiveGatewayWebhook(
      gatewayReturning({ kind: 'event', event }),
      storeMock({
        record: jest.fn().mockResolvedValue({ id: 'e1', created: false, processedAt: now }),
      }),
      queue,
    );
    await done.execute(input);
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });
});

describe('ProcessGatewayEvent (Publicar e pagar RN09)', () => {
  const stored: StoredGatewayEvent = {
    id: 'e1',
    gateway: 'local',
    gatewayEventId: 'evt_1',
    event,
    processedAt: null,
  };
  const charge = {
    gatewayPaymentId: 'pay_local_1',
    externalReference: 'pay-1',
    status: 'confirmed' as const,
    chargedCents: 33710,
    feeCents: 199,
    netCents: 33511,
    cardLast4: '4242',
    failureReason: null,
  };
  const setup = (store: jest.Mocked<GatewayEventStore>, found = true) => {
    const gateway = {
      getCharge: jest.fn().mockResolvedValue(found ? charge : null),
    } as unknown as PaymentGateway;
    const sync = { execute: jest.fn().mockResolvedValue('applied') };
    return {
      gateway,
      sync,
      process: new ProcessGatewayEvent(store, gateway, sync as unknown as SyncPaymentWithGateway),
    };
  };

  it('B2-1 e B2-6 - acha o pagamento pela referência, consulta a cobrança e aplica o que a consulta diz', async () => {
    const store = storeMock({ byId: jest.fn().mockResolvedValue(stored) });
    const { gateway, sync, process } = setup(store);
    const result = await process.execute({ eventId: 'e1', now });
    expect(store.paymentIdFor).toHaveBeenCalledWith({
      externalReference: 'pay-1',
      gatewayPaymentId: 'pay_local_1',
    });
    expect(gateway.getCharge).toHaveBeenCalledWith({ externalReference: 'pay-1' });
    expect(sync.execute).toHaveBeenCalledWith({ paymentId: 'pay-1', charge, now });
    expect(store.markProcessed).toHaveBeenCalledWith({
      id: 'e1',
      paymentId: 'pay-1',
      result: 'applied',
      now,
    });
    expect(result).toEqual({ kind: 'processed', paymentId: 'pay-1', result: 'applied' });
  });

  it('RN09 - o evento já processado não é processado de novo', async () => {
    const store = storeMock({ byId: jest.fn().mockResolvedValue({ ...stored, processedAt: now }) });
    const { sync, process } = setup(store);
    expect(await process.execute({ eventId: 'e1', now })).toEqual({ kind: 'already_processed' });
    expect(sync.execute).not.toHaveBeenCalled();
    expect(store.markProcessed).not.toHaveBeenCalled();
  });

  it('RN11 - cobrança sem Payment: processado como no_payment, sem consultar', async () => {
    const store = storeMock({
      byId: jest.fn().mockResolvedValue(stored),
      paymentIdFor: jest.fn().mockResolvedValue(null),
    });
    const { gateway, process } = setup(store);
    expect(await process.execute({ eventId: 'e1', now })).toMatchObject({ result: 'no_payment' });
    expect(gateway.getCharge).not.toHaveBeenCalled();
  });

  it('RN09 - a consulta não acha a cobrança: nada muda', async () => {
    const store = storeMock({ byId: jest.fn().mockResolvedValue(stored) });
    const { sync, process } = setup(store, false);
    expect(await process.execute({ eventId: 'e1', now })).toMatchObject({
      result: 'charge_not_found',
    });
    expect(sync.execute).not.toHaveBeenCalled();
  });

  it('RN09 - a consulta falhou: o erro sobe e o evento fica sem processedAt', async () => {
    const store = storeMock({ byId: jest.fn().mockResolvedValue(stored) });
    const gateway = {
      getCharge: jest.fn().mockRejectedValue(new Error('timeout')),
    } as unknown as PaymentGateway;
    const process = new ProcessGatewayEvent(store, gateway, {
      execute: jest.fn(),
    } as unknown as SyncPaymentWithGateway);
    await expect(process.execute({ eventId: 'e1', now })).rejects.toThrow('timeout');
    expect(store.markProcessed).not.toHaveBeenCalled();
  });
});

describe('RequeueGatewayEvents (Publicar e pagar RN09; B2-5)', () => {
  it('B2-5 - repõe na fila os gravados há mais de 1 minuto e não processados', async () => {
    const store = storeMock({
      unprocessed: jest
        .fn()
        .mockResolvedValue([{ id: 'e1', gateway: 'local', gatewayEventId: 'evt_1' }]),
    });
    const queue = { enqueue: jest.fn().mockResolvedValue(undefined) };
    expect(await new RequeueGatewayEvents(store, queue).execute({ now })).toEqual({ requeued: 1 });
    expect(store.unprocessed).toHaveBeenCalledWith({
      receivedBefore: new Date(now.getTime() - 60_000),
      limit: 500,
    });
    expect(queue.enqueue).toHaveBeenCalledWith({
      eventId: 'e1',
      gateway: 'local',
      gatewayEventId: 'evt_1',
    });
  });
});
