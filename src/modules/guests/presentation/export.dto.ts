import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  EXPORT_COLUMNS,
  EXPORT_FORMATS,
  EXPORT_WHO,
  type ExportColumn,
  type ExportFormat,
  type ExportWho,
} from '../domain/export';

/** "name,party,rsvp" vira a lista; espaços nas pontas saem. */
const splitList = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : value;

export class ExportGuestsQuery {
  /** xlsx ou pdf (RN01). */
  @ApiProperty({ enum: EXPORT_FORMATS }) @IsIn(EXPORT_FORMATS) format: ExportFormat;

  @ApiProperty({ enum: EXPORT_WHO }) @IsIn(EXPORT_WHO) who: ExportWho;

  /** Id de uma tag ativa; obrigatório com who=tag. */
  @IsOptional() @IsUUID() tag?: string;

  /**
   * Uma ou mais, separadas por vírgula; o arquivo segue a ordem da tela. No
   * OpenAPI, o parâmetro é declarado na rota (EXPORT_COLUMNS_QUERY): aqui ele
   * vira lista, e o plugin o publicaria como string com `items`.
   */
  @ApiHideProperty()
  @Transform(splitList)
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(EXPORT_COLUMNS, { each: true })
  columns: ExportColumn[];
}

/** O `columns` no OpenAPI: uma string, com as colunas separadas por vírgula. */
export const EXPORT_COLUMNS_QUERY = {
  name: 'columns',
  required: true,
  description: `Uma ou mais, separadas por vírgula: ${EXPORT_COLUMNS.join(', ')}.`,
  schema: {
    type: 'string' as const,
    pattern: `^(${EXPORT_COLUMNS.join('|')})(,(${EXPORT_COLUMNS.join('|')}))*$`,
    example: 'name,party,ageGroup,dietaryRestriction,rsvp',
  },
};
