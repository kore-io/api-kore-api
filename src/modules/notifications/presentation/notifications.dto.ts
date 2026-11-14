import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { OptionalNotNull } from '../../../shared/http/optional-not-null';
import {
  CENTER_NOTIFICATION_TYPES,
  PLANNER_NOTIFICATION_TYPES,
  type CenterNotificationType,
  type EmailFrequency,
  type PlannerNotificationType,
} from '../application/ports/notification-store.port';

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
    ],
  })
  kind:
    'payment_confirmed' | 'refund_completed' | 'end_date_soon' | 'grace' | 'expired' | 'purge_soon';
  /** Só nos avisos de pagamento. */
  @ApiProperty({ format: 'uuid', required: false }) paymentId?: string;
  /** Os avisos de saída do ar (Data de saída do ar RN03): os dias até a endDate. */
  @ApiProperty({ required: false, example: 7 }) daysLeft?: number;
  /** Carência: o 1º ou o 5º dia, e o último dia no ar. */
  @ApiProperty({ required: false, enum: [1, 5] }) day?: 1 | 5;
  @ApiProperty({ required: false, example: '2027-02-21' }) graceUntil?: string;
  /** Expirado: desde quando e até quando dá para renovar. */
  @ApiProperty({ required: false, example: '2027-02-22' }) expiredAt?: string;
  @ApiProperty({ required: false, nullable: true, example: '2027-11-14' }) renewUntil?:
    string | null;
  /** purge_soon (Retenção e expurgo RN02): o dia em que os dados são apagados, AAAA-MM-DD. */
  @ApiProperty({ required: false, example: '2027-08-22' }) purgeAt?: string;
  /** A data de saída do ar paga, AAAA-MM-DD (só no payment_confirmed). */
  @ApiProperty({ required: false }) endDate?: string;
  @ApiProperty({ required: false, example: 33710 }) amountCents?: number;
  @ApiProperty({ required: false, enum: ['pix', 'card'] }) method?: 'pix' | 'card';
  @ApiProperty({ required: false }) installments?: number;
  @ApiProperty({ type: String, nullable: true, required: false, example: '4821' })
  cardLast4?: string | null;
  @ApiProperty({ format: 'date-time' }) at: string;
}

@ApiExtraModels(NotificationEntryResponse, BillingEntryResponse)
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
   * rsvp: por grupo, sem restrição, música nem nome de convidado (Central RN04).
   * wedding_published e membership_removed: [{ partnerNames }] (revisão C8-3).
   * billing: um item por pagamento, com o valor só no detalhe (RN13).
   */
  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(NotificationEntryResponse) },
        { $ref: getSchemaPath(BillingEntryResponse) },
      ],
    },
  })
  payload: (NotificationEntryResponse | BillingEntryResponse)[];
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
