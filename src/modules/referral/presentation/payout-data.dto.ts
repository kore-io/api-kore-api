import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, ValidateBy, type ValidationArguments } from 'class-validator';
import {
  normalizePixKey,
  normalizeTaxId,
  type PixKeyType,
  type TaxIdType,
} from '../domain/payout-data';

const TAX_ID_TYPES = ['cpf', 'cnpj'] as const;
const PIX_KEY_TYPES = ['cpf', 'cnpj', 'email', 'phone', 'random'] as const;

/** O CPF ou o CNPJ conforme o `taxIdType`; a mensagem nunca leva o número (B2-13). */
function IsTaxIdOfType(): PropertyDecorator {
  return ValidateBy({
    name: 'isTaxIdOfType',
    validator: {
      validate: (value: unknown, args?: ValidationArguments) => {
        const type = (args?.object as { taxIdType?: unknown }).taxIdType;
        return (
          typeof value === 'string' &&
          (type === 'cpf' || type === 'cnpj') &&
          normalizeTaxId({ type, value }) !== null
        );
      },
      defaultMessage: () => 'taxId must be a valid CPF or CNPJ for taxIdType',
    },
  });
}

/** A chave no formato do tipo (DICT); a mensagem não leva a chave. */
function IsPixKeyOfType(): PropertyDecorator {
  return ValidateBy({
    name: 'isPixKeyOfType',
    validator: {
      validate: (value: unknown, args?: ValidationArguments) => {
        const type = (args?.object as { keyType?: unknown }).keyType;
        return (
          typeof value === 'string' &&
          (PIX_KEY_TYPES as readonly unknown[]).includes(type) &&
          normalizePixKey({ type: type as PixKeyType, value }) !== null
        );
      },
      defaultMessage: () => 'key must be a valid Pix key for keyType',
    },
  });
}

export class SetTaxIdBody {
  @ApiProperty({ enum: TAX_ID_TYPES }) @IsIn(TAX_ID_TYPES) taxIdType: TaxIdType;
  @ApiProperty({ example: '529.982.247-25' })
  @IsString()
  @MaxLength(20)
  @IsTaxIdOfType()
  taxId: string;
}

export class TaxIdResponse {
  @ApiProperty({ enum: TAX_ID_TYPES }) taxIdType: TaxIdType;
  /** "***.982.247-**" · "**.222.333/0001-**" (decisão 244(2)). */
  @ApiProperty({ example: '***.982.247-**' }) taxIdMasked: string;
}

export class RequestPixKeyBody {
  @ApiProperty({ enum: PIX_KEY_TYPES }) @IsIn(PIX_KEY_TYPES) keyType: PixKeyType;
  @ApiProperty({ example: 'juliana@pradoassessoria.com.br' })
  @IsString()
  @MaxLength(100)
  @IsPixKeyOfType()
  key: string;
}

export class PixKeyRequestedResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  /** A primeira chave vale na confirmação; a troca, 48 h depois. */
  firstKey: boolean;
  /** "Enviamos um link para jul***@pradoassessoria.com.br. Ele vale por 30 minutos." */
  @ApiProperty({ example: 'jul***@pradoassessoria.com.br' }) emailMasked: string;
  @ApiProperty({ format: 'date-time' }) confirmExpiresAt: string;
}

export class ConfirmPixKeyBody {
  @ApiProperty() @IsString() @MaxLength(200) token: string;
}

export class PixKeyConfirmedResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['active', 'pending_activation'] }) status: 'active' | 'pending_activation';
  /** A primeira, agora; a troca, 48 h depois ("vale às 14h de 28/09"). */
  @ApiProperty({ format: 'date-time' }) activeFrom: string;
}

const PIX_KEY_STATUSES = [
  'pending_confirmation',
  'pending_activation',
  'active',
  'replaced',
  'canceled',
] as const;

export class PixKeyResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: PIX_KEY_TYPES }) keyType: PixKeyType;
  /** Só a máscara: a chave nunca sai inteira. */
  @ApiProperty({ example: 'jul***@pradoassessoria.com.br' }) keyMasked: string;
  /** Histórico: Ativa · Substituída · Cancelada; e a troca em espera. */
  @ApiProperty({ enum: PIX_KEY_STATUSES }) status: (typeof PIX_KEY_STATUSES)[number];
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) confirmExpiresAt:
    string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) confirmedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) activeFrom: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) replacedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) canceledAt: string | null;
}

export class PixKeysResponse {
  /** Da mais nova para a mais antiga. */
  @ApiProperty({ type: [PixKeyResponse] }) items: PixKeyResponse[];
}

// Os corpos de erro (OpenAPI).
export class TaxIdLockedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['TAX_ID_LOCKED'] }) error: 'TAX_ID_LOCKED';
  @ApiProperty() message: string;
}

export class TaxIdInUseErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['TAX_ID_IN_USE'] }) error: 'TAX_ID_IN_USE';
  @ApiProperty() message: string;
}

export class PixKeyChangePendingErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['PIX_KEY_CHANGE_PENDING'] }) error: 'PIX_KEY_CHANGE_PENDING';
  @ApiProperty() message: string;
  /** Quando a troca vale ("em 28 de set. às 14h"). */
  @ApiProperty({ format: 'date-time' }) activeFrom: string;
}

export class PixKeyNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['PIX_KEY_NOT_FOUND'] }) error: 'PIX_KEY_NOT_FOUND';
  @ApiProperty() message: string;
}

export class PixKeyLinkExpiredErrorBody {
  static readonly status = 410;
  @ApiProperty({ enum: [410] }) statusCode: 410;
  @ApiProperty({ enum: ['PIX_KEY_LINK_EXPIRED'] }) error: 'PIX_KEY_LINK_EXPIRED';
  @ApiProperty() message: string;
}
