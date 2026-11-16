import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import {
  ADMIN_REFERRER_KINDS,
  ADMIN_REFERRER_STATUSES,
  type AdminReferrerKind,
  type AdminReferrerPayout,
  type AdminReferrerRow,
  type AdminReferrerStatementEntry,
  type AdminReferrerStatus,
} from '@/modules/backoffice/application/ports/admin-referrers.reader.port';
import type { Page } from '@/modules/backoffice/application/ports/admin-weddings.reader.port';
import {
  ADMIN_REFERRER_TABS,
  type AdminReferrerDetail,
  type AdminReferrerTab,
} from '@/modules/backoffice/application/admin-referrers.use-cases';
import { AdminWeddingRowResponse } from './admin-weddings.dto';

class PageQuery {
  /** A página, a partir de 1. */
  @ApiProperty({ required: false, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;
}

/** A lista de Cerimonialistas (Backoffice - cobrança RN08; Penpot 11). */
export class AdminReferrersQuery extends PageQuery {
  /** Só `planner` no lançamento (os vendedores ficam fora; decisão 230, D17). */
  @ApiProperty({ enum: ADMIN_REFERRER_KINDS, required: false, default: 'planner' })
  @IsOptional()
  @IsIn(ADMIN_REFERRER_KINDS)
  kind?: AdminReferrerKind;

  @ApiProperty({ enum: ADMIN_REFERRER_STATUSES, required: false })
  @IsOptional()
  @IsIn(ADMIN_REFERRER_STATUSES)
  status?: AdminReferrerStatus;

  /** Com (true) ou sem (false) um repasse solicitado ou retido; só o Admin (decisão 69). */
  @ApiProperty({ enum: ['true', 'false'], required: false })
  @IsOptional()
  @IsIn(['true', 'false'])
  hasPayout?: 'true' | 'false';

  /** Uma das cidades do perfil, sem diferenciar maiúsculas. */
  @ApiProperty({ required: false, example: 'Campinas' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  city?: string;
}

/** As abas do detalhe (RN08): Casamentos · Comissões · Repasses (só Admin). */
export class AdminReferrerQuery extends PageQuery {
  @ApiProperty({ enum: ADMIN_REFERRER_TABS, required: false, default: 'weddings' })
  @IsOptional()
  @IsIn(ADMIN_REFERRER_TABS)
  tab?: AdminReferrerTab;
}

class AdminReferrerBalancesResponse {
  /** Comissão disponível (com os ajustes fora de repasse). */
  @ApiProperty({ example: 0 }) availableCents: number;
  /** Aguardando liberação. */
  @ApiProperty({ example: 1740 }) pendingCents: number;
  /** Já recebido. */
  @ApiProperty({ example: 6742 }) receivedCents: number;
  /** "(R$ 158,04 em repasse)": num repasse solicitado, retido ou em processamento. */
  @ApiProperty({ example: 15804 }) inPayoutCents: number;
}

export class AdminReferrerRowResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ADMIN_REFERRER_KINDS }) kind: AdminReferrerKind;
  @ApiProperty({ example: 'Juliana Prado' }) name: string;
  @ApiProperty({ type: String, nullable: true, example: 'Prado Assessoria' })
  creditName: string | null;
  email: string;
  @ApiProperty({ type: [String], example: ['Campinas', 'Valinhos'] }) cities: string[];
  @ApiProperty({ enum: ADMIN_REFERRER_STATUSES }) status: AdminReferrerStatus;
  /** Casais trazidos (sem os casamentos apagados). */
  @ApiProperty({ example: 4 }) couplesCount: number;
  @ApiProperty({ type: AdminReferrerBalancesResponse }) balances: AdminReferrerBalancesResponse;
  /** A tag "Repasse pedido"; o servidor omite para o suporte (decisão 69). */
  @ApiProperty({ required: false }) payoutRequested?: boolean;

  static from({ row }: { row: AdminReferrerRow }): AdminReferrerRowResponse {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      creditName: row.creditName,
      email: row.email,
      cities: [...row.cities],
      status: row.status,
      couplesCount: row.couplesCount,
      balances: { ...row.balances },
      ...(row.payoutRequested !== undefined ? { payoutRequested: row.payoutRequested } : {}),
    };
  }
}

export class AdminReferrersResponse {
  @ApiProperty({ type: [AdminReferrerRowResponse] }) items: AdminReferrerRowResponse[];
  page: number;
  pageSize: number;
  total: number;

  static from({ page }: { page: Page<AdminReferrerRow> }): AdminReferrersResponse {
    return { ...page, items: page.items.map((row) => AdminReferrerRowResponse.from({ row })) };
  }
}

class AdminReferrerBlockedByResponse {
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
}

class AdminReferrerBlockResponse {
  @ApiProperty({ format: 'date-time' }) blockedAt: string;
  @ApiProperty({ type: AdminReferrerBlockedByResponse, nullable: true })
  blockedBy: AdminReferrerBlockedByResponse | null;
  @ApiProperty({ type: String, nullable: true }) reason: string | null;
}

class AdminReferrerHeaderResponse extends AdminReferrerRowResponse {
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  /** "20% · padrão das Configurações" (decisão 75). */
  @ApiProperty({ example: 20 }) ratePercent: number;
  /** A cerimonialista segue sempre o padrão das Configurações. */
  rateIsDefault: boolean;
  @ApiProperty({ enum: ['cpf', 'cnpj'], nullable: true }) taxIdType: 'cpf' | 'cnpj' | null;
  @ApiProperty({ type: String, nullable: true, example: '***.456.789-**' })
  taxIdMasked: string | null;
  /** A chave Pix vigente, mascarada; o servidor omite para o suporte (decisão 69). */
  @ApiProperty({ type: String, nullable: true, required: false, example: 'jul***@prado.com.br' })
  pixKeyMasked?: string | null;
  @ApiProperty({ type: AdminReferrerBlockResponse, nullable: true })
  block: AdminReferrerBlockResponse | null;
}

class AdminReferrerCreatedByResponse {
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
}

/**
 * Uma linha do extrato: `commission` (a comissão de um pagamento) ou
 * `adjustment` (o "Ajuste manual" e os ajustes do estorno da comissão paga).
 * Os campos de um tipo vêm nulos no outro.
 */
class AdminReferrerStatementEntryResponse {
  @ApiProperty({ enum: ['commission', 'adjustment'] }) kind: 'commission' | 'adjustment';
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  /** Positivo ou negativo (o ajuste). */
  @ApiProperty({ example: 7322 }) amountCents: number;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) payoutId: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) weddingId: string | null;
  /** "Ana & Marcos"; nulo com o casamento apagado ou no ajuste. */
  @ApiProperty({ type: String, nullable: true }) coupleNames: string | null;
  @ApiProperty({ enum: ['publication', 'extension'], nullable: true })
  paymentKind: 'publication' | 'extension' | null;
  /** O pago sem os juros do cartão. */
  @ApiProperty({ type: Number, nullable: true }) baseAmountCents: number | null;
  @ApiProperty({ type: Number, nullable: true }) ratePercent: number | null;
  @ApiProperty({
    enum: ['pending', 'available', 'paid', 'reversed', 'blocked', 'held'],
    nullable: true,
  })
  status: string | null;
  @ApiProperty({ enum: ['self_referral', 'referrer_blocked', 'admin'], nullable: true })
  blockReason: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) availableAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) paidAt: string | null;
  /** O motivo do ajuste: `manual` é o "Ajuste manual". */
  @ApiProperty({ enum: ['refund', 'chargeback', 'manual'], nullable: true })
  adjustmentReason: 'refund' | 'chargeback' | 'manual' | null;
  /** O motivo escrito pelo Admin. */
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) commissionId: string | null;
  @ApiProperty({ type: AdminReferrerCreatedByResponse, nullable: true })
  createdBy: AdminReferrerCreatedByResponse | null;

  static from({
    entry,
  }: {
    entry: AdminReferrerStatementEntry;
  }): AdminReferrerStatementEntryResponse {
    const common = {
      kind: entry.kind,
      id: entry.id,
      createdAt: entry.createdAt.toISOString(),
      amountCents: entry.amountCents,
      payoutId: entry.payoutId,
    };
    if (entry.kind === 'commission')
      return {
        ...common,
        weddingId: entry.weddingId,
        coupleNames: entry.coupleNames,
        paymentKind: entry.paymentKind,
        baseAmountCents: entry.baseAmountCents,
        ratePercent: entry.ratePercent,
        status: entry.status,
        blockReason: entry.blockReason,
        availableAt: entry.availableAt.toISOString(),
        paidAt: entry.paidAt?.toISOString() ?? null,
        adjustmentReason: null,
        note: null,
        commissionId: null,
        createdBy: null,
      };
    return {
      ...common,
      weddingId: null,
      coupleNames: null,
      paymentKind: null,
      baseAmountCents: null,
      ratePercent: null,
      status: null,
      blockReason: null,
      availableAt: null,
      paidAt: null,
      adjustmentReason: entry.reason,
      note: entry.note,
      commissionId: entry.commissionId,
      createdBy: entry.createdBy,
    };
  }
}

class AdminReferrerPayoutResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['requested', 'held', 'processing', 'paid', 'rejected'] })
  status: AdminReferrerPayout['status'];
  @ApiProperty({
    enum: ['refund', 'pix_key_change', 'referrer_blocked', 'dispute', 'commission_blocked'],
    nullable: true,
  })
  holdReason: string | null;
  @ApiProperty({ example: 15804 }) amountCents: number;
  @ApiProperty({ example: 'jul***@prado.com.br' }) pixKeyMasked: string;
  @ApiProperty({ format: 'date-time' }) requestedAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) processingAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) paidAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) rejectedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) rejectReason: string | null;
}

class AdminReferrerWeddingsPage {
  @ApiProperty({ type: [AdminWeddingRowResponse] }) items: AdminWeddingRowResponse[];
  page: number;
  pageSize: number;
  total: number;
}

class AdminReferrerStatementPage {
  @ApiProperty({ type: [AdminReferrerStatementEntryResponse] })
  items: AdminReferrerStatementEntryResponse[];
  page: number;
  pageSize: number;
  total: number;
}

class AdminReferrerPayoutsPage {
  @ApiProperty({ type: [AdminReferrerPayoutResponse] }) items: AdminReferrerPayoutResponse[];
  page: number;
  pageSize: number;
  total: number;
}

const iso = (value: Date | null) => value?.toISOString() ?? null;

/** O detalhe: o cabeçalho e a aba pedida (só uma das três vem). */
export class AdminReferrerDetailResponse {
  @ApiProperty({ enum: ADMIN_REFERRER_TABS }) tab: AdminReferrerTab;
  @ApiProperty({ type: AdminReferrerHeaderResponse }) referrer: AdminReferrerHeaderResponse;
  @ApiProperty({ type: AdminReferrerWeddingsPage, required: false })
  weddings?: AdminReferrerWeddingsPage;
  /** O extrato da aba Comissões. */
  @ApiProperty({ type: AdminReferrerStatementPage, required: false })
  statement?: AdminReferrerStatementPage;
  @ApiProperty({ type: AdminReferrerPayoutsPage, required: false })
  payouts?: AdminReferrerPayoutsPage;

  static from({ detail }: { detail: AdminReferrerDetail }): AdminReferrerDetailResponse {
    const { referrer } = detail;
    const header: AdminReferrerHeaderResponse = {
      ...AdminReferrerRowResponse.from({ row: referrer }),
      createdAt: referrer.createdAt.toISOString(),
      ratePercent: referrer.ratePercent,
      rateIsDefault: referrer.rateIsDefault,
      taxIdType: referrer.taxIdType,
      taxIdMasked: referrer.taxIdMasked,
      ...(referrer.pixKeyMasked !== undefined ? { pixKeyMasked: referrer.pixKeyMasked } : {}),
      block: referrer.block
        ? {
            blockedAt: referrer.block.blockedAt.toISOString(),
            blockedBy: referrer.block.blockedBy,
            reason: referrer.block.reason,
          }
        : null,
    };
    switch (detail.tab) {
      case 'weddings':
        return {
          tab: detail.tab,
          referrer: header,
          weddings: {
            ...detail.weddings,
            items: detail.weddings.items.map((row) => AdminWeddingRowResponse.from({ row })),
          },
        };
      case 'commissions':
        return {
          tab: detail.tab,
          referrer: header,
          statement: {
            ...detail.statement,
            items: detail.statement.items.map((entry) =>
              AdminReferrerStatementEntryResponse.from({ entry }),
            ),
          },
        };
      case 'payouts':
        return {
          tab: detail.tab,
          referrer: header,
          payouts: {
            ...detail.payouts,
            items: detail.payouts.items.map((payout) => ({
              ...payout,
              requestedAt: payout.requestedAt.toISOString(),
              processingAt: iso(payout.processingAt),
              paidAt: iso(payout.paidAt),
              rejectedAt: iso(payout.rejectedAt),
            })),
          },
        };
    }
  }
}
