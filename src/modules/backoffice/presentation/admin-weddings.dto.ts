import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  MinLength,
  MaxLength,
  ValidateIf,
  IsBoolean,
  IsEmail,
  ValidateNested,
} from 'class-validator';
import { DATE_ONLY } from '../../access/presentation/weddings.dto';
import {
  ADMIN_WEDDING_FILTERS,
  RSVP_FILTERS,
  type AdminWeddingFilter,
  type AdminWeddingGeneral,
  type AdminWeddingGuest,
  type AdminWeddingLogEntry,
  type AdminWeddingNumbers,
  type AdminWeddingRow,
  type AdminWeddingTombstone,
  type Page,
  type RsvpFilter,
} from '../application/ports/admin-weddings.reader.port';
import { REQUEST_CHANNELS, type RequestChannel } from '../application/ports/guest-erasure.port';
import {
  ADMIN_WEDDING_TABS,
  type AdminWeddingDetail,
  type AdminWeddingTab,
} from '../application/admin-weddings.use-cases';

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

/** A lista de Casamentos (Backoffice - acesso RN05; decisão 251). */
export class AdminWeddingsQuery extends PageQuery {
  /** O Bloqueado vale por cima do status; o Aguardando pagamento é o rascunho com Pix pendente. */
  @ApiProperty({ enum: ADMIN_WEDDING_FILTERS, required: false })
  @IsOptional()
  @IsIn(ADMIN_WEDDING_FILTERS)
  status?: AdminWeddingFilter;

  @ApiProperty({ required: false, example: '2027-01-01' })
  @IsOptional()
  @Matches(DATE_ONLY)
  eventFrom?: string;

  @ApiProperty({ required: false, example: '2027-12-31' })
  @IsOptional()
  @Matches(DATE_ONLY)
  eventTo?: string;

  /** Abaixo de 50% · A partir de 50%; sem convidados, só em Todos. */
  @ApiProperty({ enum: RSVP_FILTERS, required: false })
  @IsOptional()
  @IsIn(RSVP_FILTERS)
  rsvp?: RsvpFilter;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  referrerId?: string;
}

/** As abas do detalhe (RN06); a Cobrança é do Backoffice de cobrança. */
export class AdminWeddingQuery extends PageQuery {
  @ApiProperty({ enum: ADMIN_WEDDING_TABS, required: false, default: 'general' })
  @IsOptional()
  @IsIn(ADMIN_WEDDING_TABS)
  tab?: AdminWeddingTab;
}

/** Bloquear e desbloquear (RN05): o motivo, com 10 caracteres ou mais, fica no log. */
export class AdminReasonBody {
  @ApiProperty({ minLength: 10, maxLength: 500, example: 'Denúncia de conteúdo impróprio.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

class AdminReferrerResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['planner', 'seller'] }) kind: 'planner' | 'seller';
  name: string;
}

export class AdminWeddingRowResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Ana & Marcos' }) coupleNames: string;
  @ApiProperty({ type: String, nullable: true }) slug: string | null;
  @ApiProperty({ type: String, nullable: true, example: '2027-03-20' }) eventDate: string | null;
  /** O status guardado. */
  status: string;
  /** O que a lista mostra: Bloqueado e Aguardando pagamento por cima do status (decisão 251). */
  @ApiProperty({ enum: ADMIN_WEDDING_FILTERS }) displayStatus: AdminWeddingFilter;
  blocked: boolean;
  /** Quem trouxe: Casal (sem indicador) · Cerimonialista · Vendedor (decisão 251(2)). */
  @ApiProperty({ enum: ['couple', 'planner', 'seller'] }) origin: 'couple' | 'planner' | 'seller';
  @ApiProperty({ type: String, nullable: true }) referralSource: string | null;
  @ApiProperty({ type: AdminReferrerResponse, nullable: true })
  referrer: AdminReferrerResponse | null;
  /** 0 a 100; nulo sem convidados ("—"). */
  @ApiProperty({ type: Number, nullable: true, example: 62.5 }) rsvpPercent: number | null;
  @ApiProperty({ type: String, nullable: true, example: '2027-06-20' }) endDate: string | null;

  static from({ row }: { row: AdminWeddingRow }): AdminWeddingRowResponse {
    return { ...row };
  }
}

export class AdminWeddingsResponse {
  @ApiProperty({ type: [AdminWeddingRowResponse] }) items: AdminWeddingRowResponse[];
  page: number;
  pageSize: number;
  total: number;

  static from({ page }: { page: Page<AdminWeddingRow> }): AdminWeddingsResponse {
    return { ...page, items: page.items.map((row) => AdminWeddingRowResponse.from({ row })) };
  }
}

class AdminPersonResponse {
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  email: string;
  @ApiProperty({ enum: ['owner', 'collaborator'] }) role: 'owner' | 'collaborator';
}

class AdminPendingPaymentResponse {
  @ApiProperty({ format: 'uuid' }) paymentId: string;
  /** "Pix de R$ 308,10 gerado em 25/09…" ou o cartão em análise. */
  @ApiProperty({ enum: ['pix', 'card'] }) method: 'pix' | 'card';
  amountCents: number;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

class AdminBlockResponse {
  @ApiProperty({ format: 'date-time' }) blockedAt: string;
  @ApiProperty({ type: String, nullable: true }) blockedByName: string | null;
  @ApiProperty({ type: String, nullable: true }) reason: string | null;
}

/** A aba Geral (RN06), ou a lápide do casamento expurgado. */
export class AdminWeddingGeneralResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({
    enum: ['awaiting_couple', 'draft', 'published', 'post_event', 'grace', 'expired', 'purged'],
  })
  status: string;
  /** Só na lápide: "Casamento apagado em 23/08/2027. Ficam só os pagamentos e as comissões." */
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) purgedAt: string | null;
  @ApiProperty({ required: false, example: 'Ana & Marcos' }) coupleNames?: string;
  @ApiProperty({ type: String, nullable: true, required: false }) slug?: string | null;
  @ApiProperty({ type: String, nullable: true, required: false }) eventDate?: string | null;
  @ApiProperty({ enum: ADMIN_WEDDING_FILTERS, required: false }) displayStatus?: AdminWeddingFilter;
  @ApiProperty({ required: false }) blocked?: boolean;
  @ApiProperty({ enum: ['couple', 'planner', 'seller'], required: false }) origin?:
    'couple' | 'planner' | 'seller';
  @ApiProperty({ type: String, nullable: true }) referralSource: string | null;
  @ApiProperty({ type: AdminReferrerResponse, nullable: true })
  referrer: AdminReferrerResponse | null;
  @ApiProperty({ type: Number, nullable: true, required: false }) rsvpPercent?: number | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: [AdminPersonResponse], required: false }) people?: AdminPersonResponse[];
  /** Publicação · Saída do ar · Carência até · Expurgo previsto. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true, required: false })
  publishedAt?: string | null;
  @ApiProperty({ type: String, nullable: true, required: false }) endDate?: string | null;
  @ApiProperty({ type: String, nullable: true, required: false }) graceUntil?: string | null;
  @ApiProperty({ type: String, nullable: true, required: false }) purgeAt?: string | null;
  @ApiProperty({ type: String, nullable: true, required: false }) deletionScheduledFor?:
    string | null;
  /** O Pix pendente: só para o Admin (RN02); para o suporte, sempre nulo. */
  @ApiProperty({ type: AdminPendingPaymentResponse, nullable: true, required: false })
  pendingPayment?: AdminPendingPaymentResponse | null;
  @ApiProperty({ type: AdminBlockResponse, nullable: true, required: false })
  block?: AdminBlockResponse | null;

  static from({
    general,
  }: {
    general: AdminWeddingGeneral | AdminWeddingTombstone;
  }): AdminWeddingGeneralResponse {
    if (general.status === 'purged') {
      const tombstone = general as AdminWeddingTombstone;
      return {
        id: tombstone.id,
        status: 'purged',
        purgedAt: tombstone.purgedAt?.toISOString() ?? null,
        referralSource: tombstone.referralSource,
        referrer: tombstone.referrer,
        createdAt: tombstone.createdAt.toISOString(),
      };
    }
    const wedding = general as AdminWeddingGeneral;
    return {
      id: wedding.id,
      status: wedding.status,
      purgedAt: null,
      coupleNames: wedding.coupleNames,
      slug: wedding.slug,
      eventDate: wedding.eventDate,
      displayStatus: wedding.displayStatus,
      blocked: wedding.blocked,
      origin: wedding.origin,
      referralSource: wedding.referralSource,
      referrer: wedding.referrer,
      rsvpPercent: wedding.rsvpPercent,
      createdAt: wedding.createdAt.toISOString(),
      people: wedding.people,
      publishedAt: wedding.publishedAt?.toISOString() ?? null,
      endDate: wedding.endDate,
      graceUntil: wedding.graceUntil,
      purgeAt: wedding.purgeAt,
      deletionScheduledFor: wedding.deletionScheduledFor,
      pendingPayment: wedding.pendingPayment
        ? { ...wedding.pendingPayment, createdAt: wedding.pendingPayment.createdAt.toISOString() }
        : null,
      block: wedding.block
        ? {
            blockedAt: wedding.block.blockedAt.toISOString(),
            blockedByName: wedding.block.blockedBy?.name ?? null,
            reason: wedding.block.reason,
          }
        : null,
    };
  }
}

class AdminWeddingNumbersResponse {
  guestsTotal: number;
  confirmed: number;
  declined: number;
  pending: number;
  adultsConfirmed: number;
  childrenConfirmed: number;
  babiesConfirmed: number;
  partiesPending: number;
  @ApiProperty({ type: Number, nullable: true }) rsvpPercent: number | null;
}

class AdminWeddingGuestResponse {
  @ApiProperty({ format: 'uuid' }) guestId: string;
  @ApiProperty({ format: 'uuid' }) partyId: string;
  partyName: string;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  inTrash: boolean;
}

class AdminWeddingGuestsResponse {
  @ApiProperty({ type: [AdminWeddingGuestResponse] }) items: AdminWeddingGuestResponse[];
  page: number;
  pageSize: number;
  total: number;
}

class AdminWeddingLogEntryResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  action: string;
  @ApiProperty({ enum: ['user', 'party', 'admin', 'system'] }) actorKind: string;
  @ApiProperty({ type: String, nullable: true }) actorUserId: string | null;
  @ApiProperty({ type: String, nullable: true }) entityType: string | null;
  @ApiProperty({ type: String, nullable: true }) entityId: string | null;
  /** Os dados da ação; para o suporte, sem os valores em centavos (RN02). */
  @ApiProperty({ type: Object, nullable: true }) data: unknown;
  /** O hash do IP, curto; nunca o IP. */
  @ApiProperty({ type: String, nullable: true }) ipHashShort: string | null;
}

class AdminWeddingLogResponse {
  @ApiProperty({ type: [AdminWeddingLogEntryResponse] }) items: AdminWeddingLogEntryResponse[];
  page: number;
  pageSize: number;
  total: number;
}

/** O detalhe por aba (`?tab=`): só a aba pedida vem preenchida. */
export class AdminWeddingDetailResponse {
  @ApiProperty({ enum: ADMIN_WEDDING_TABS }) tab: AdminWeddingTab;
  @ApiProperty({ type: AdminWeddingGeneralResponse, required: false })
  general?: AdminWeddingGeneralResponse;
  @ApiProperty({ type: AdminWeddingNumbersResponse, required: false })
  numbers?: AdminWeddingNumbers;
  @ApiProperty({ type: AdminWeddingGuestsResponse, required: false })
  guests?: Page<AdminWeddingGuest>;
  @ApiProperty({ type: AdminWeddingLogResponse, required: false }) log?: AdminWeddingLogResponse;

  static from({ detail }: { detail: AdminWeddingDetail }): AdminWeddingDetailResponse {
    switch (detail.tab) {
      case 'general':
        return {
          tab: 'general',
          general: AdminWeddingGeneralResponse.from({ general: detail.general }),
        };
      case 'numbers':
        return { tab: 'numbers', numbers: detail.numbers };
      case 'guests':
        return { tab: 'guests', guests: detail.guests };
      case 'log':
        return {
          tab: 'log',
          log: {
            ...detail.log,
            items: detail.log.items.map((item: AdminWeddingLogEntry) => ({
              ...item,
              createdAt: item.createdAt.toISOString(),
            })),
          },
        };
    }
  }
}

export class AdminBlockStateResponse {
  blocked: boolean;
}

/** Reatribuir o indicador (RN07): outro indicador ativo, ou `null` (Sem indicador), e o motivo. */
export class ReassignReferrerBody extends AdminReasonBody {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  @ValidateIf((_body: unknown, value: unknown) => value !== null)
  @IsUUID()
  referrerId: string | null;
}

export class ReassignReferrerResponse {
  /** `unchanged` quando o indicador escolhido já é o do casamento. */
  @ApiProperty({ enum: ['reassigned', 'unchanged'] }) status: 'reassigned' | 'unchanged';
}

/** Remover os dados a pedido do titular (RN10): "Como o pedido chegou" (decisão 256(2)). */
export class EraseGuestBody {
  @ApiProperty({ enum: REQUEST_CHANNELS })
  @IsIn(REQUEST_CHANNELS)
  requestChannel: RequestChannel;
}

export class GuestErasedResponse {
  @ApiProperty({ enum: ['erased'] }) status: 'erased';
}

class AccessEmailChecksBody {
  /** A data e a cidade do casamento conferidas com o casal. */
  @ApiProperty() @IsBoolean() eventDateAndCity: boolean;
  /** O nome da outra pessoa do casal. */
  @ApiProperty() @IsBoolean() partnerName: boolean;
}

/** Trocar o e-mail de acesso (RN09): as confirmações, os 4 dígitos que o casal informou e o motivo. */
export class ChangeAccessEmailBody extends AdminReasonBody {
  @ApiProperty({ format: 'uuid' }) @IsUUID() userId: string;

  @ApiProperty({ example: 'ana.nova@gmail.com' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  @MaxLength(254)
  newEmail: string;

  @ApiProperty({ type: AccessEmailChecksBody })
  @ValidateNested()
  @Type(() => AccessEmailChecksBody)
  checks: AccessEmailChecksBody;

  /** Sem pagamento, não há CPF para conferir: vai sem o campo. */
  @ApiProperty({ required: false, example: '4725' })
  @IsOptional()
  @Matches(/^\d{4}$/)
  payerLast4?: string;
}

export class AccessEmailChangedResponse {
  @ApiProperty({ enum: ['changed'] }) status: 'changed';
}

export class AccessEmailUnlockedResponse {
  @ApiProperty({ enum: ['unlocked'] }) status: 'unlocked';
}
