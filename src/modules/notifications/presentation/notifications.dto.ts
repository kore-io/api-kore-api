import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import {
  NOTIFICATION_TYPES,
  type EmailFrequency,
  type NotificationType,
} from '../application/ports/notification-store.port';

const EMAIL_FREQUENCIES = ['off', 'immediate', 'daily'] as const;

export class WeddingQuery {
  /** O casamento ativo. */
  @IsUUID() weddingId: string;
}

export class NotificationsQuery extends WeddingQuery {
  /** Filtro por tipo (Todas · Respostas). */
  @ApiProperty({ enum: NOTIFICATION_TYPES, required: false })
  @IsOptional()
  @IsIn(NOTIFICATION_TYPES)
  type?: NotificationType;

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

export class NotificationResponse {
  id: string;
  @ApiProperty({ enum: NOTIFICATION_TYPES }) type: NotificationType;
  /** Grupos distintos (1: "Família Moreira respondeu o convite"; mais: "{n} grupos responderam"). */
  count: number;
  /** Por grupo, sem restrição, música nem nome de convidado (Central RN04). */
  @ApiProperty({ type: [NotificationEntryResponse] }) payload: NotificationEntryResponse[];
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
  @ApiProperty({ enum: NOTIFICATION_TYPES }) type: NotificationType;
  /** Sempre ligada no casal. */
  inApp: boolean;
  @ApiProperty({ enum: EMAIL_FREQUENCIES }) email: EmailFrequency;
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
  @IsUUID() weddingId: string;
  @ApiProperty({ enum: NOTIFICATION_TYPES }) @IsIn(NOTIFICATION_TYPES) type: NotificationType;
  @ApiProperty({ enum: EMAIL_FREQUENCIES }) @IsIn(EMAIL_FREQUENCIES) email: EmailFrequency;
}

export class NotificationNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['NOTIFICATION_NOT_FOUND'] }) error: 'NOTIFICATION_NOT_FOUND';
  @ApiProperty() message: string;
}
