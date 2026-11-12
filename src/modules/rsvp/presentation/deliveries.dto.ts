import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsUUID } from 'class-validator';
import { DELIVERY_STATUSES, type DeliveryStatus } from '../../guests/domain/party';
import type { DeliveredParty, DeliveryQueue } from '../application/deliveries.use-cases';
import {
  DELIVERY_CHANNELS,
  DELIVERY_PARTIES_MAX,
  type DeliveryChannel,
} from '../domain/deliveries';
import { MESSAGE_KINDS, type MessageKind } from '../domain/message-templates';

/** `partyIds` na query: separados por vírgula ou repetidos. */
const toIdList = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? value.split(',').filter(Boolean)
    : Array.isArray(value)
      ? value.flatMap((item) => String(item).split(',')).filter(Boolean)
      : value;

/** A fila de envio (Envios RN07): o tipo e até 200 grupos. */
export class DeliveryQueueQuery {
  @ApiProperty({ enum: MESSAGE_KINDS }) @IsIn(MESSAGE_KINDS) kind: MessageKind;

  @ApiProperty({ type: String, description: 'Ids separados por vírgula, até 200.' })
  @Transform(toIdList)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(DELIVERY_PARTIES_MAX)
  @IsUUID('all', { each: true })
  partyIds: string[];
}

/** Marcar o envio (Envios RN07): os grupos, o tipo e o canal. O QR é só do convite. */
export class MarkDeliveriesBody {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(DELIVERY_PARTIES_MAX)
  @IsUUID('all', { each: true })
  partyIds: string[];

  @ApiProperty({ enum: MESSAGE_KINDS }) @IsIn(MESSAGE_KINDS) kind: MessageKind;

  @ApiProperty({ enum: DELIVERY_CHANNELS }) @IsIn(DELIVERY_CHANNELS) channel: DeliveryChannel;
}

class DeliveryContactResponse {
  guestId: string;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ type: String, nullable: true, example: '(19) 9****-3310' })
  phoneMasked: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'ce***@gmail.com' })
  emailMasked: string | null;
}

class DeliveryStateFields {
  id: string;
  @ApiProperty({ enum: DELIVERY_STATUSES }) deliveryStatus: DeliveryStatus;
  /** O 1º envio do convite; não muda nos reenvios. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) sentAt: string | null;
  @ApiProperty({ enum: DELIVERY_CHANNELS, nullable: true }) lastChannel: DeliveryChannel | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) saveTheDateSentAt:
    string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastReminderAt: string | null;
}

export class DeliveryQueueItemResponse extends DeliveryStateFields {
  name: string;
  /** O convidado de contato, mascarado; o inteiro vai só dentro das URLs (RN11). */
  @ApiProperty({ type: DeliveryContactResponse, nullable: true })
  contact: DeliveryContactResponse | null;
  /** `https://wa.me/<E.164 sem +>?text=…`; nulo sem telefone. */
  @ApiProperty({ type: String, nullable: true }) whatsappUrl: string | null;
  /** `mailto:<e-mail>?subject=…&body=…`; nulo sem e-mail. */
  @ApiProperty({ type: String, nullable: true }) mailtoUrl: string | null;
  /** A mensagem com os marcadores trocados, para Copiar mensagem e a prévia. */
  copyText: string;
}

export class DeliveryQueueResponse {
  @ApiProperty({ enum: MESSAGE_KINDS }) kind: MessageKind;
  /** O assunto do e-mail. */
  subject: string;
  @ApiProperty({ type: [DeliveryQueueItemResponse] }) items: DeliveryQueueItemResponse[];
  /** Pedidos que não entram: fora do lembrete, na lixeira ou de outro casamento (RN04). */
  @ApiProperty({ type: [String] }) skippedPartyIds: string[];

  static from({ queue }: { queue: DeliveryQueue }): DeliveryQueueResponse {
    return { ...queue, items: queue.items.map((item) => ({ ...item, ...dates(item) })) };
  }
}

export class DeliveredPartyResponse extends DeliveryStateFields {}

export class MarkDeliveriesResponse {
  @ApiProperty({ type: [DeliveredPartyResponse] }) parties: DeliveredPartyResponse[];

  static from({ parties }: { parties: DeliveredParty[] }): MarkDeliveriesResponse {
    return { parties: parties.map((party) => ({ ...party, ...dates(party) })) };
  }
}

function dates(party: DeliveredParty) {
  return {
    sentAt: party.sentAt?.toISOString() ?? null,
    saveTheDateSentAt: party.saveTheDateSentAt?.toISOString() ?? null,
    lastReminderAt: party.lastReminderAt?.toISOString() ?? null,
  };
}

/** Os envios não valem agora (Envios RN01). */
export class DeliveriesClosedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['DELIVERIES_CLOSED'] }) error: 'DELIVERIES_CLOSED';
  @ApiProperty() message: string;
  @ApiProperty({ enum: ['not_published', 'deadline_passed', 'post_event'] }) reason:
    'not_published' | 'deadline_passed' | 'post_event';
}

/** Um grupo pedido não existe neste casamento ou está na lixeira. */
export class DeliveryPartyNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['PARTY_NOT_FOUND'] }) error: 'PARTY_NOT_FOUND';
  @ApiProperty() message: string;
  @ApiProperty({ type: [String] }) partyIds: string[];
}

/** Grupo fora da fila do lembrete, ou o QR fora do convite (Envios RN03 e RN09). */
export class DeliveryNotAllowedErrorBody {
  static readonly status = 422;
  @ApiProperty({ enum: [422] }) statusCode: 422;
  @ApiProperty({ enum: ['PARTY_NOT_REMINDABLE', 'QR_ONLY_FOR_INVITE'] }) error:
    'PARTY_NOT_REMINDABLE' | 'QR_ONLY_FOR_INVITE';
  @ApiProperty() message: string;
  @ApiProperty({ type: [String] }) partyIds: string[];
}

/** O QR do convite impresso (Envios RN09): PNG com 1 grupo; PDF com um por página. */
export class QrCodesBody {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(DELIVERY_PARTIES_MAX)
  @IsUUID('all', { each: true })
  partyIds: string[];

  @ApiProperty({ enum: ['png', 'pdf'] }) @IsIn(['png', 'pdf']) format: 'png' | 'pdf';
}
