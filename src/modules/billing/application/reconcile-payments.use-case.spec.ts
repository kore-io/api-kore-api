import type { BackofficeTransaction } from '../../../shared/database/backoffice-transaction';
import {
  type GatewayCharge,
  GatewayUnavailableError,
  type PaymentGateway,
} from './ports/payment-gateway.port';
import type { PaymentLedger } from './ports/payment-ledger.port';
import type {
  PaymentReconciliationReader,
  ReconcilingPayment,
} from './ports/payment-reconciliation.reader.port';
import { ReconcilePayments } from './reconcile-payments.use-case';
import type { SyncPaymentWithGateway } from './sync-payment.use-case';

const now = new Date('2026-08-11T18:30:00Z');

function pending(id: string, overrides: Partial<ReconcilingPayment> = {}): ReconcilingPayment {
  return {
    id,
    weddingId: 'w1',
    kind: 'publication',
    method: 'pix',
    status: 'pending',
    // Vencido: criado há mais de 24 h, vencimento ontem.
    dueAt: new Date('2026-08-11T18:20:00Z'),
    createdAt: new Date('2026-08-10T18:20:00Z'),
    ...overrides,
  };
}

function charge(id: string, status: GatewayCharge['status']): GatewayCharge {
  return {
    gatewayPaymentId: `gw-${id}`,
    externalReference: id,
    status,
    chargedCents: status === 'confirmed' ? 33710 : null,
    feeCents: null,
    netCents: null,
    cardLast4: null,
    failureReason: null,
  };
}

function build({
  payments,
  gateway,
}: {
  payments: Partial<PaymentReconciliationReader>;
  gateway: Partial<PaymentGateway>;
}) {
  const sync = {
    execute: jest
      .fn()
      .mockImplementation(({ charge: c }: { charge: GatewayCharge }) =>
        Promise.resolve(c.status === 'confirmed' ? 'applied' : 'canceled'),
      ),
    cancelWithoutCharge: jest.fn().mockResolvedValue('canceled'),
  };
  const ledger = { openAlert: jest.fn().mockResolvedValue(undefined) };
  const transaction = { run: (work: () => Promise<unknown>) => work() };
  const useCase = new ReconcilePayments(
    {
      refundsNeverAttempted: jest.fn().mockResolvedValue([]),
      ...payments,
    } as PaymentReconciliationReader,
    gateway as PaymentGateway,
    ledger as unknown as PaymentLedger,
    transaction as unknown as BackofficeTransaction,
    sync as unknown as SyncPaymentWithGateway,
    { enqueue: jest.fn().mockResolvedValue(undefined) },
  );
  return { useCase, sync, ledger };
}

describe('ReconcilePayments (Publicar e pagar RN11)', () => {
  it('RN11 - a falha num pagamento não para a rodada: o seguinte é conferido', async () => {
    const getCharge = jest
      .fn()
      .mockRejectedValueOnce(new GatewayUnavailableError())
      .mockResolvedValueOnce(charge('p2', 'confirmed'));
    const { useCase, sync } = build({
      payments: {
        stalePending: jest.fn().mockResolvedValue([pending('p1'), pending('p2')]),
      },
      gateway: { getCharge },
    });
    const tally = await useCase.pending({ now });
    expect(tally).toEqual({ checked: 2, changed: 1, alerts: 0, errors: 1 });
    expect(sync.execute).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'p2', now }));
  });

  it('RN11 - Pix vencido que o gateway diz pago no cancelamento: a segunda consulta aplica, sem motivo de vencido perdido', async () => {
    const getCharge = jest
      .fn()
      .mockResolvedValueOnce(charge('p1', 'pending'))
      .mockResolvedValueOnce(charge('p1', 'confirmed'));
    const cancelCharge = jest.fn().mockResolvedValue({ result: 'already_paid' });
    const { useCase, sync } = build({
      payments: {
        stalePending: jest.fn().mockResolvedValue([pending('p1')]),
      },
      gateway: { getCharge, cancelCharge },
    });
    await useCase.pending({ now });
    expect(cancelCharge).toHaveBeenCalledWith({ gatewayPaymentId: 'gw-p1' });
    expect(sync.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'p1',
        charge: expect.objectContaining({ status: 'confirmed' }),
        cancelReason: 'pix_expired',
      }),
    );
  });

  it('RN11 - a cobrança some depois do cancelamento: nada muda nesta rodada', async () => {
    const getCharge = jest
      .fn()
      .mockResolvedValueOnce(charge('p1', 'overdue'))
      .mockResolvedValueOnce(null);
    const { useCase, sync } = build({
      payments: {
        stalePending: jest.fn().mockResolvedValue([pending('p1')]),
      },
      gateway: { getCharge, cancelCharge: jest.fn().mockResolvedValue({ result: 'canceled' }) },
    });
    const tally = await useCase.pending({ now });
    expect(tally).toMatchObject({ checked: 1, changed: 0, errors: 0 });
    expect(sync.execute).not.toHaveBeenCalled();
    expect(sync.cancelWithoutCharge).not.toHaveBeenCalled();
  });

  it('RN11 - o Pix ainda no prazo não é cancelado no gateway', async () => {
    const cancelCharge = jest.fn();
    const { useCase, sync } = build({
      payments: {
        stalePending: jest
          .fn()
          .mockResolvedValue([pending('p1', { dueAt: new Date('2026-08-12T18:20:00Z') })]),
      },
      gateway: { getCharge: jest.fn().mockResolvedValue(charge('p1', 'pending')), cancelCharge },
    });
    await useCase.pending({ now });
    expect(cancelCharge).not.toHaveBeenCalled();
    expect(sync.execute).toHaveBeenCalledWith(
      expect.not.objectContaining({ cancelReason: 'pix_expired' }),
    );
  });

  it('RN11 - sem cobrança no gateway: cancela o pendente sem o id do gateway', async () => {
    const { useCase, sync } = build({
      payments: {
        stalePending: jest.fn().mockResolvedValue([pending('p1', { method: 'card' })]),
      },
      gateway: { getCharge: jest.fn().mockResolvedValue(null) },
    });
    await useCase.pending({ now });
    expect(sync.cancelWithoutCharge).toHaveBeenCalledWith({ paymentId: 'p1', now });
  });
});
