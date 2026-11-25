import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { OptionalNotNull } from '@/shared/http/optional-not-null';
import {
  CENTER_NOTIFICATION_TYPES,
  PLANNER_NOTIFICATION_TYPES,
  type CenterNotificationType,
  type EmailFrequency,
  type PlannerNotificationType,
} from '@/modules/notifications/application/ports/notification-store.port';

const EMAIL_FREQUENCIES = ['off', 'immediate', 'daily'] as const;

export const NOTIFICATION_SCOPES = ['planner'] as const;

/**
 * O casamento ativo, ou `scope=planner` (Notificações da cerimonialista RN05):
 * a central dela, com todos os casamentos e sem `weddingId`. Sem `scope`, o
 * `weddingId` é obrigatório (revisão C8-5).
 */
export class WeddingQuery {
  @ApiProperty({ required: false, format: 'uuid' })
  @ValidateIf((query: WeddingQuery) => query.scope === undefined || query.weddingId !== undefined)
  @IsUUID()
  weddingId?: string;

  @ApiProperty({ enum: NOTIFICATION_SCOPES, required: false })
  @IsOptional()
  @IsIn(NOTIFICATION_SCOPES)
  scope?: 'planner';
}

/** Sem `weddingId`, a preferência geral da cerimonialista (Notificações da cerimonialista RN06). */
export class PreferencesQuery {
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  weddingId?: string;
}

export class NotificationsQuery extends WeddingQuery {
  /** Filtro por tipo (casal: Respostas e Cobrança; cerimonialista: os 3 dela). */
  @ApiProperty({ enum: CENTER_NOTIFICATION_TYPES, required: false })
  @IsOptional()
  @IsIn(CENTER_NOTIFICATION_TYPES)
  type?: CenterNotificationType;

  /** O `nextCursor` da página anterior. */
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
}

class NotificationEntryResponse {
  partyId: string;
  /** O nome do grupo. */
  name: string;
  confirmed: number;
  declined: number;
  @ApiProperty({ format: 'date-time' }) at: string;
}

/** wedding_published e membership_removed (revisão C8-3): só o casal. */
export class CoupleEntryResponse {
  /** Os primeiros nomes do casal; o app junta. */
  @ApiProperty({ type: [String], example: ['Ana', 'Marcos'] }) partnerNames: [string, string];
}

/**
 * commission (Comissões do indicador RN09): "R$ 67,42 de comissão de Ana e
 * Marcos disponível para repasse"; o app monta o texto (decisões 275 e 316(13)).
 */
export class CommissionEntryResponse {
  @ApiProperty({ format: 'uuid' }) commissionId: string;
  @ApiProperty({ example: 6742 }) amountCents: number;
  @ApiProperty({ type: [String], example: ['Ana', 'Marcos'] }) partnerNames: [string, string];
  /** Quando a comissão ficou disponível. */
  @ApiProperty({ format: 'date-time' }) at: string;
}

/**
 * referrer_reassigned (Backoffice - acesso RN07; decisão 80): `lost` ao
 * indicador antigo e `gained` ao novo, sem o nome do outro.
 */
export class ReferrerReassignedEntryResponse {
  @ApiProperty({ type: [String], example: ['Ana', 'Marcos'] }) partnerNames: [string, string];
  @ApiProperty({ enum: ['lost', 'gained'] }) direction: 'lost' | 'gained';
}

/** O item da cobrança (Publicar e pagar RN13): o app monta o título e o detalhe. */
export class BillingEntryResponse {
  /** O pagamento confirmado (Publicar e pagar RN13) ou o reembolso concluído (Pagamentos e arrependimento RN07). */
  @ApiProperty({
    enum: [
      'payment_confirmed',
      'refund_completed',
      'end_date_soon',
      'grace',
      'expired',
      'purge_soon',
      'courtesy',
    ],
  })
  kind:
    | 'payment_confirmed'
    | 'refund_completed'
    | 'end_date_soon'
    | 'grace'
    | 'expired'
    | 'purge_soon'
    | 'courtesy';
  /** Só nos avisos de pagamento. */
  @ApiProperty({ format: 'uuid', required: false }) paymentId?: string;
  /** Os avisos de saída do ar (Data de saída do ar RN03): os dias até a endDate. */
  @ApiProperty({ required: false, example: 7 }) daysLeft?: number;
  /** Carência: o 1º ou o 5º dia, e o último dia no ar. */
  @ApiProperty({ required: false, enum: [1, 5] }) day?: 1 | 5;
  @ApiProperty({ required: false, example: '2027-02-21' }) graceUntil?: string;
  /** Expirado: desde quando e até quando dá para renovar. */
  @ApiProperty({ required: false, example: '2027-02-22' }) expiredAt?: string;
  /**
   * Expirado: até quando dá para renovar (12 meses depois do casamento); nulo
   * sem data possível dentro do limite, o expirado sem renovação (Data de saída
   * do ar RN03; decisão 338(2)).
   */
  @ApiProperty({ required: false, nullable: true, example: '2027-11-14' }) renewUntil?:
    string | null;
  /**
   * Expirado, versão B (Data de saída do ar RN03; decisão 293(7)): o
   * paidThrough quando é depois do expiredAt ("Vocês já pagaram até 14 de
   * fev.: voltem o site ao ar, sem custo"); nulo ou ausente na versão A.
   */
  @ApiProperty({ required: false, nullable: true, example: '2027-02-14' }) paidThrough?:
    string | null;
  /**
   * O dia em que os dados são apagados, AAAA-MM-DD (Retenção e expurgo RN02):
   * no purge_soon e no expired ("Os dados ficam guardados até…", decisão
   * 336(3)). No expired, nulo quando o casamento não tem e ausente nas
   * notificações gravadas antes do campo.
   */
  @ApiProperty({ required: false, nullable: true, example: '2027-08-22' }) purgeAt?: string | null;
  /**
   * A data de saída do ar, AAAA-MM-DD: a paga no payment_confirmed e a nova na
   * courtesy (a Cortesia do Admin; Backoffice - cobrança RN06).
   */
  @ApiProperty({ required: false }) endDate?: string;
  @ApiProperty({ required: false, example: 33710 }) amountCents?: number;
  @ApiProperty({ required: false, enum: ['pix', 'card'] }) method?: 'pix' | 'card';
  @ApiProperty({ required: false }) installments?: number;
  @ApiProperty({ type: String, nullable: true, required: false, example: '4821' })
  cardLast4?: string | null;
  @ApiProperty({ format: 'date-time' }) at: string;
}

@ApiExtraModels(
  NotificationEntryResponse,
  CoupleEntryResponse,
  CommissionEntryResponse,
  ReferrerReassignedEntryResponse,
  BillingEntryResponse,
)
export class NotificationResponse {
  id: string;
  @ApiProperty({ enum: CENTER_NOTIFICATION_TYPES }) type: CenterNotificationType;
  /** A central da cerimonialista junta vários casamentos (revisão C8-5). */
  weddingId: string;
  /** Os primeiros nomes do casal; o app junta. */
  @ApiProperty({ type: [String], example: ['Ana', 'Marcos'] }) partnerNames: [string, string];
  /** Grupos distintos (1: "Família Moreira respondeu o convite"; mais: "{n} grupos responderam"). */
  count: number;
  /**
   * O formato de cada item depende do `type` (decisões 275 e 316(13)):
   * - rsvp: `NotificationEntryResponse`, por grupo, sem restrição, música nem
   *   nome de convidado (Central RN04);
   * - wedding_published e membership_removed: `CoupleEntryResponse` (C8-3);
   * - commission: `CommissionEntryResponse` (Comissões do indicador RN09);
   * - referrer_reassigned: `ReferrerReassignedEntryResponse` (Backoffice - acesso RN07);
   * - billing: `BillingEntryResponse`, um item por aviso, com o valor só no
   *   detalhe (Publicar e pagar RN13).
   */
  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(NotificationEntryResponse) },
        { $ref: getSchemaPath(CoupleEntryResponse) },
        { $ref: getSchemaPath(CommissionEntryResponse) },
        { $ref: getSchemaPath(ReferrerReassignedEntryResponse) },
        { $ref: getSchemaPath(BillingEntryResponse) },
      ],
    },
  })
  payload: (
    | NotificationEntryResponse
    | CoupleEntryResponse
    | CommissionEntryResponse
    | ReferrerReassignedEntryResponse
    | BillingEntryResponse
  )[];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) readAt: string | null;
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
}

export class NotificationsResponse {
  /** Mais novas primeiro (pelo `updatedAt`), 20 por vez. */
  @ApiProperty({ type: [NotificationResponse] }) items: NotificationResponse[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class UnreadCountResponse {
  unreadCount: number;
}

export class PreferenceResponse {
  @ApiProperty({ enum: CENTER_NOTIFICATION_TYPES }) type: CenterNotificationType;
  /** Sempre ligada no casal. */
  inApp: boolean;
  /** `always`: Cobrança e pagamentos, sempre por e-mail e sem seletor (decisão 236). */
  @ApiProperty({ enum: [...EMAIL_FREQUENCIES, 'always'] }) email: EmailFrequency | 'always';
  /** O app mostra o seletor de e-mail só quando é editável (decisão 236). */
  emailEditable: boolean;
  /** Vai a false só quando sai a última assinatura da pessoa (RN07; 217(8)). */
  push: boolean;
}

class PushStateResponse {
  /** Este aparelho tem assinatura de push. */
  subscribed: boolean;
  /** A chave pública VAPID; nula com o push desligado no ambiente. */
  @ApiProperty({ type: String, nullable: true }) vapidPublicKey: string | null;
}

export class PreferencesResponse {
  @ApiProperty({ type: [PreferenceResponse] }) items: PreferenceResponse[];
  @ApiProperty({ type: PushStateResponse }) push: PushStateResponse;
}

/** O e-mail de um tipo (Central RN07); o push muda pela assinatura do aparelho. */
export class SavePreferenceBody {
  /** Sem `weddingId`, a preferência geral da cerimonialista (RN06). */
  @ApiProperty({ required: false, format: 'uuid' })
  @OptionalNotNull()
  @IsUUID()
  weddingId?: string;

  @ApiProperty({ enum: PLANNER_NOTIFICATION_TYPES })
  @IsIn(PLANNER_NOTIFICATION_TYPES)
  type: PlannerNotificationType;
  @ApiProperty({ enum: EMAIL_FREQUENCIES }) @IsIn(EMAIL_FREQUENCIES) email: EmailFrequency;
}

export class NotificationNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['NOTIFICATION_NOT_FOUND'] }) error: 'NOTIFICATION_NOT_FOUND';
  @ApiProperty() message: string;
}

class PushKeysBody {
  @IsString() @MaxLength(200) p256dh: string;
  @IsString() @MaxLength(100) auth: string;
}

/** A assinatura do aparelho (E-mail e push RN07). O endpoint é conferido contra a lista dos serviços de push. */
export class PushSubscriptionBody {
  @IsString() @MaxLength(1000) endpoint: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PushKeysBody)
  keys: PushKeysBody;
}

export class PushUnsubscribeBody {
  @IsString() @MaxLength(1000) endpoint: string;
}

/** O endpoint fora dos serviços de push aceitos (https, sem IP e sem porta fora da 443). */
export class PushEndpointNotAllowedErrorBody {
  static readonly status = 400;
  @ApiProperty({ enum: [400] }) statusCode: 400;
  @ApiProperty({ enum: ['PUSH_ENDPOINT_NOT_ALLOWED'] }) error: 'PUSH_ENDPOINT_NOT_ALLOWED';
  @ApiProperty() message: string;
}
