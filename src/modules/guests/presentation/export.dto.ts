import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  EXPORT_COLUMNS,
  EXPORT_FORMATS,
  EXPORT_WHO,
  type ExportColumn,
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
  /** xlsx (o PDF entra com a feature/67-exportacao-pdf). */
  @ApiProperty({ enum: EXPORT_FORMATS }) @IsIn(EXPORT_FORMATS) format: 'xlsx';

  @ApiProperty({ enum: EXPORT_WHO }) @IsIn(EXPORT_WHO) who: ExportWho;

  /** Id de uma tag ativa; obrigatório com who=tag. */
  @IsOptional() @IsUUID() tag?: string;

  /** Uma ou mais, separadas por vírgula; o arquivo segue a ordem da tela. */
  @ApiProperty({
    type: String,
    description: `Separadas por vírgula: ${EXPORT_COLUMNS.join(', ')}`,
    example: 'name,party,ageGroup,dietaryRestriction,rsvp',
  })
  @Transform(splitList)
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(EXPORT_COLUMNS, { each: true })
  columns: ExportColumn[];
}
