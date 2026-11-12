import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  MESSAGE_BODY_MAX,
  MESSAGE_KINDS,
  MESSAGE_SUBJECT_MAX,
  type MessageKind,
} from '../domain/message-templates';

const trimOrNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || null : value;

/**
 * Grava a mensagem (Envios RN06) ou, com `reset: true`, volta ao padrão. O
 * corpo vai como o casal escreveu (sem HTML; a troca dos marcadores é do
 * servidor, no envio). O assunto é só do e-mail: uma linha, até 120; vazio vale o padrão.
 */
export class SaveMessageTemplateBody {
  @ApiProperty({ required: false, enum: [true] })
  @IsOptional()
  @Equals(true)
  reset?: true;

  @ApiProperty({ required: false, maxLength: MESSAGE_BODY_MAX })
  @ValidateIf((body: SaveMessageTemplateBody) => body.reset !== true)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_BODY_MAX)
  body?: string;

  /** Sem quebra de linha. */
  @ApiProperty({ type: String, nullable: true, required: false, maxLength: MESSAGE_SUBJECT_MAX })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(MESSAGE_SUBJECT_MAX)
  @Matches(/^[^\r\n]*$/)
  subject?: string | null;
}

export class MessageTemplateResponse {
  @ApiProperty({ enum: MESSAGE_KINDS }) kind: MessageKind;
  /** O assunto do e-mail (o padrão quando o casal não escreveu um). */
  subject: string;
  body: string;
  /** Sem mensagem guardada: é a padrão. */
  isDefault: boolean;
}

export class MessageTemplatesResponse {
  /** As três: convite, save the date e lembrete. */
  @ApiProperty({ type: [MessageTemplateResponse] }) items: MessageTemplateResponse[];
}

/** "A mensagem precisa ter o {link}, senão o grupo não consegue responder." (RN06). */
export class LinkPlaceholderMissingErrorBody {
  static readonly status = 422;
  @ApiProperty({ enum: [422] }) statusCode: 422;
  @ApiProperty({ enum: ['LINK_PLACEHOLDER_MISSING'] }) error: 'LINK_PLACEHOLDER_MISSING';
  @ApiProperty() message: string;
}
