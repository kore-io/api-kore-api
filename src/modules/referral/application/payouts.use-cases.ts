import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../shared/config/app-config.service';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import { ProfileNotOwnedError } from '../../access/domain/access.errors';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import {
  PayoutAmountChangedError,
  PayoutBelowMinimumError,
  PayoutDataMissingError,
  PayoutKeyReusedError,
  PayoutOpenError,
  PayoutsDisabledError,
  PayoutTooSoonError,
  PixKeyChangePendingError,
} from '../domain/referral.errors';
import { PAYOUT_DATA_STORE, type PayoutDataStore } from './ports/payout-data-store.port';
import { PAYOUT_STORE, type PayoutRow, type PayoutStore } from './ports/payout-store.port';

const TIMEZONE = 'America/Sao_Paulo';
const PAYOUT_INTERVAL_DAYS = 30;

/** 00h de São Paulo do dia AAAA-MM-DD (o fuso fixo, sem horário de verão desde 2019). */
const saoPauloMidnight = (day: string) => new Date(`${day}T03:00:00Z`);

/** Decisão 247(4): o dia do último pedido não recusado em São Paulo + 30, às 00h. */
export function nextRequestAt({ payouts }: { payouts: readonly PayoutRow[] }): Date | null {
  const last = payouts.find((payout) => payout.status !== 'rejected');
  if (!last) return null;
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(last.requestedAt);
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + PAYOUT_INTERVAL_DAYS);
  return saoPauloMidnight(next.toISOString().slice(0, 10));
}

export interface PayoutsView {
  payoutsEnabled: boolean;
  /** A partir de quando ela pode pedir de novo; nulo quando já pode. */
  nextRequestAt: Date | null;
  /** A troca da chave que ainda não vale ("quando a nova chave Pix valer, em 28 de set. às 14h"). */
  pixKeyActiveFrom: Date | null;
  minimumCents: number;
  items: PayoutRow[];
}

/**
 * O repasse da cerimonialista (Repasse e Dados para receber RN01, RN04 e RN09;
 * decisão 247): a lista e o pedido. O Pagar, o Recusar e o Liberar são do
 * Admin (PR 12); o Pix de saída, do PR 9c.
 */
@Injectable()
export class PayoutsUseCases {
  private readonly enabled: boolean;

  constructor(
    @Inject(PAYOUT_STORE) private readonly store: PayoutStore,
    @Inject(PAYOUT_DATA_STORE) private readonly payoutData: PayoutDataStore,
    @Inject(APPLICATION_LOG_WRITER) private readonly log: ApplicationLogWriter,
    config: AppConfigService,
  ) {
    this.enabled = config.get({ key: 'PAYOUTS_ENABLED' });
  }

  async list({ userId, now }: { userId: string; now: Date }): Promise<PayoutsView> {
    if (!(await this.store.isPlanner({ userId }))) throw new ProfileNotOwnedError();
    const [items, keys, minimumCents] = await Promise.all([
      this.store.list(),
      this.payoutData.listPixKeys({ now }),
      this.store.minimumCents(),
    ]);
    const next = nextRequestAt({ payouts: items });
    return {
      payoutsEnabled: this.enabled,
      nextRequestAt: next && next > now ? next : null,
      pixKeyActiveFrom: keys.find((key) => key.status === 'pending_activation')?.activeFrom ?? null,
      minimumCents,
      items,
    };
  }

  /** RN04: o pedido, com o valor que ela viu no Dialog (decisão 247(1)). */
  async request({
    userId,
    idempotencyKey,
    expectedAmountCents,
    now,
  }: {
    userId: string;
    idempotencyKey: string;
    expectedAmountCents: number;
    now: Date;
  }): Promise<{ payout: PayoutRow; created: boolean }> {
    if (!(await this.store.isPlanner({ userId }))) throw new ProfileNotOwnedError();
    if (!this.enabled) throw new PayoutsDisabledError();
    const id = uuidV7({ now: now.getTime() });
    const result = await this.store.request({
      id,
      idempotencyKey,
      expectedCents: expectedAmountCents,
      externalRef: `kore-payout-${id}`,
      now,
    });
    switch (result.result) {
      case 'no_referrer':
        throw new ProfileNotOwnedError();
      case 'key_reused':
        throw new PayoutKeyReusedError();
      case 'data_missing':
        throw new PayoutDataMissingError();
      case 'change_pending':
        throw new PixKeyChangePendingError(result.activeFrom);
      case 'payout_open':
        throw new PayoutOpenError(result.payoutId);
      case 'too_soon':
        throw new PayoutTooSoonError(result.nextRequestAt);
      case 'below_minimum':
        throw new PayoutBelowMinimumError(result.amountCents, await this.store.minimumCents());
      case 'amount_changed':
        throw new PayoutAmountChangedError(result.amountCents);
    }
    const payout = (await this.store.list()).find((row) => row.id === result.payoutId)!;
    if (result.result === 'created')
      await this.log.record({
        entry: {
          action: 'payout.requested',
          actorKind: 'user',
          actorUserId: userId,
          entityType: 'payout',
          entityId: payout.id,
          data: { amountCents: payout.amountCents },
        },
      });
    return { payout, created: result.result === 'created' };
  }
}
