import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { OptionalNotNull } from '../../../shared/http/optional-not-null';
import { TAG_COLORS, TAG_NAME_MAX, type TagColor } from '../domain/party';

/** Nome sem espaços nas pontas (RN02). */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Seleção múltipla: até 200 grupos por pedido (contrato do apply). */
const APPLY_MAX = 200;

export class CreateTagBody {
  @ApiProperty({ maxLength: TAG_NAME_MAX, example: 'Vizinhos' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(TAG_NAME_MAX)
  name: string;

  /** Nome de token de uma cor de tag do Design System (decisões 191(1) e 192(4)); nulo, sem cor. */
  @ApiProperty({ enum: TAG_COLORS, nullable: true, required: false, type: String })
  @IsOptional()
  @IsIn(TAG_COLORS)
  color?: TagColor | null;
}

export class UpdateTagBody {
  @ApiProperty({ maxLength: TAG_NAME_MAX, required: false })
  /** Ausente não muda; null não é aceito (o nome é obrigatório). */
  @OptionalNotNull()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(TAG_NAME_MAX)
  name?: string;

  /** null tira a cor. */
  @ApiProperty({ enum: TAG_COLORS, nullable: true, required: false, type: String })
  @IsOptional()
  @IsIn(TAG_COLORS)
  color?: TagColor | null;
}

export class ApplyTagBody {
  @ApiProperty({ type: [String], minItems: 1, maxItems: APPLY_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(APPLY_MAX)
  @IsUUID('all', { each: true })
  partyIds: string[];
}

export class TagResponse {
  id: string;
  name: string;
  @ApiProperty({ enum: TAG_COLORS, nullable: true, type: String }) color: TagColor | null;
  /** Convidados com a tag ou num grupo com a tag, cada um uma vez, sem vagas vazias (RN05). */
  guests: number;
}

export class TagListResponse {
  /** O máximo de tags ativas: o contador da tela é "data.length de limit". */
  limit: number;
  /** Em ordem de nome. */
  @ApiProperty({ type: [TagResponse] }) data: TagResponse[];
}

export class ApplyTagResponse {
  /** Quantos grupos ficam com a tag (os que já tinham entram na conta). */
  parties: number;
}
