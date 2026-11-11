import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { GUEST_NAME_MAX, PARTY_NAME_MAX } from '../domain/party';
import { IMPORT_GUESTS_MAX } from '../domain/paste-list';

/** O texto colado, até 100.000 caracteres (contrato da prévia). */
const PASTE_TEXT_MAX = 100_000;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const trimEach = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? (value as unknown[]).map((item) => (typeof item === 'string' ? item.trim() : item))
    : value;

export class PastePreviewBody {
  @ApiProperty({ maxLength: PASTE_TEXT_MAX, example: 'Família Moreira: Jorge, Célia, Pedro' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASTE_TEXT_MAX)
  text: string;
}

const PASTE_WARNINGS = ['PARTY_NAME_EXISTS', 'DUPLICATE_REMOVED', 'TOO_LONG', 'PLUS_OUT_OF_RANGE'];

export class PastedGuestResponse {
  /** Nulo: a pessoa sem nome que o app pede ("Nome da 2ª pessoa"). */
  @ApiProperty({ type: String, nullable: true }) name: string | null;
}

export class PastedGroupResponse {
  line: number;
  /** A linha original, para o cartão "Qual é o nome de cada pessoa deste grupo?". */
  source: string;
  /** Nulo na linha só com "+ N": o app preenche com a 1ª pessoa antes de enviar. */
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ type: [PastedGuestResponse] }) guests: PastedGuestResponse[];
  @ApiProperty({ type: 'array', items: { type: 'string', enum: PASTE_WARNINGS } })
  warnings: string[];
  /**
   * Quantos nomes repetidos saíram do grupo ("Jorge, jorge, JORGE" dá 2); o app
   * os soma ao removedInPreview (RN14; decisão 210(4)).
   */
  @ApiProperty({ type: 'integer', minimum: 0 }) duplicatesRemoved: number;
}

export class PastePreviewResponse {
  parties: number;
  /** Com as pessoas sem nome. */
  guests: number;
  missingNames: number;
  @ApiProperty({ type: [PastedGroupResponse] }) groups: PastedGroupResponse[];
  /** Linhas que viraram grupo sem ninguém e saíram (o app soma 1 por linha ao removedInPreview). */
  @ApiProperty({ type: [Number] }) droppedLines: number[];
}

export class PastedGroupBody {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(PARTY_NAME_MAX) name: string;

  @ApiProperty({ type: [String] })
  @Transform(trimEach)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(IMPORT_GUESTS_MAX)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(GUEST_NAME_MAX, { each: true })
  guests: string[];
}

export class PasteImportBody {
  @ApiProperty({ type: [PastedGroupBody], minItems: 1, maxItems: IMPORT_GUESTS_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(IMPORT_GUESTS_MAX)
  @ValidateNested({ each: true })
  @Type(() => PastedGroupBody)
  groups: PastedGroupBody[];

  /**
   * As pessoas removidas, as duplicadas tiradas e 1 por grupo que saiu (o
   * linhas_erro). O teto é o do texto colado: não sai mais que um item por
   * caractere, e o evento não fica distorcido (sugestão do Crivo).
   */
  @ApiProperty({ minimum: 0, maximum: PASTE_TEXT_MAX })
  @IsInt()
  @Min(0)
  @Max(PASTE_TEXT_MAX)
  removedInPreview: number;
}

export class ImportResultResponse {
  parties: number;
  guests: number;
}

/** O arquivo da planilha (multipart, campo file, até 5 MB). */
export class SpreadsheetUploadBody {
  @ApiProperty({ type: 'string', format: 'binary' }) file: unknown;
}

const SKIPPED_CODES = [
  'NAME_MISSING',
  'PARTY_MISSING',
  'PHONE_TOO_SHORT',
  'PHONE_TOO_LONG',
  'PHONE_INVALID',
  'EMAIL_INVALID',
  'AGE_GROUP_INVALID',
  'TOO_LONG',
  'DUPLICATE',
];
const ROW_FIELDS = ['party', 'name', 'phone', 'email', 'ageGroup', 'dietaryRestriction', 'tags'];

export class DuplicateOfResponse {
  row: number;
  party: string;
}

/** Uma falha de uma linha (uma linha com várias falhas aparece uma vez por falha). */
export class SkippedRowResponse {
  /** O número da linha na planilha (a dos títulos é a 1). */
  row: number;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ enum: ['error', 'duplicate'] }) kind: 'error' | 'duplicate';
  @ApiProperty({ enum: SKIPPED_CODES }) code: string;
  @ApiProperty({ enum: ROW_FIELDS, required: false }) field?: string;
  @ApiProperty({ type: 'object', additionalProperties: true, example: { n: 8 } })
  params: Record<string, unknown>;
  @ApiProperty({ type: DuplicateOfResponse, required: false }) duplicateOf?: DuplicateOfResponse;
}

export class ImportWarningResponse {
  @ApiProperty({ enum: ['PARTY_NAME_EXISTS', 'TAG_LIMIT'] }) code:
    'PARTY_NAME_EXISTS' | 'TAG_LIMIT';
  /** Em PARTY_NAME_EXISTS. */
  @ApiProperty({ required: false }) party?: string;
  /** Em TAG_LIMIT. */
  @ApiProperty({ required: false }) tag?: string;
  @ApiProperty({ type: [Number], required: false }) rows?: number[];
}

export class SpreadsheetCountsResponse {
  valid: number;
  /** Linhas com erro (não falhas). */
  errors: number;
  duplicates: number;
}

export class SpreadsheetPreviewResponse {
  fileName: string;
  parties: number;
  guests: number;
  counts: SpreadsheetCountsResponse;
  @ApiProperty({ type: [SkippedRowResponse] }) skipped: SkippedRowResponse[];
  @ApiProperty({ type: [ImportWarningResponse] }) warnings: ImportWarningResponse[];
}

export class SpreadsheetImportResponse {
  parties: number;
  guests: number;
  /** Linhas que ficaram de fora, com erro ou duplicadas. */
  skipped: number;
  @ApiProperty({ type: [String] }) tagsCreated: string[];
}
