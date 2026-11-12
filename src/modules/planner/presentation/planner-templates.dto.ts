import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsObject, IsOptional, IsString, Length } from 'class-validator';
import { trim } from '../../access/presentation/weddings.dto';
import type { PlannerTemplate } from '../application/ports/planner-template-store.port';
import {
  PLANNER_TEMPLATE_KINDS,
  TEMPLATE_NAME_MAX,
  TEMPLATE_SECTION_TYPES,
  type PlannerTemplateKind,
  type TemplateSectionType,
} from '../domain/planner-template';

const CONTENT_DOC =
  'Por tipo: section_content → { text }; faq → { questions: [{ question, answer }] }; ' +
  'appearance → { fontPairKey, starterPaletteKey?, primaryColor, accentColor, backgroundMode }.';

export class PlannerTemplatesQuery {
  @ApiProperty({ enum: PLANNER_TEMPLATE_KINDS, required: false })
  @IsOptional()
  @IsIn(PLANNER_TEMPLATE_KINDS)
  kind?: PlannerTemplateKind;

  @ApiProperty({ enum: TEMPLATE_SECTION_TYPES, required: false })
  @IsOptional()
  @IsIn(TEMPLATE_SECTION_TYPES)
  sectionType?: TemplateSectionType;
}

/** POST /v1/me/planner-templates (Modelos RN01 a RN04). Campo desconhecido é 400 (RN03). */
export class CreatePlannerTemplateBody {
  @ApiProperty({ enum: PLANNER_TEMPLATE_KINDS })
  @IsIn(PLANNER_TEMPLATE_KINDS)
  kind: PlannerTemplateKind;

  /** Só nos Textos (section_content), e obrigatório lá. */
  @ApiProperty({ enum: TEMPLATE_SECTION_TYPES, required: false })
  @IsOptional()
  @IsIn(TEMPLATE_SECTION_TYPES)
  sectionType?: TemplateSectionType;

  @ApiProperty({ example: 'Nossa história clássica' })
  @Transform(trim)
  @IsString()
  @Length(1, TEMPLATE_NAME_MAX)
  name: string;

  @ApiProperty({ type: 'object', additionalProperties: true, description: CONTENT_DOC })
  @IsObject()
  content: Record<string, unknown>;
}

/** PATCH /v1/me/planner-templates/{id}: o nome e o conteúdo; o tipo e a seção não mudam. */
export class UpdatePlannerTemplateBody {
  @ApiProperty({ required: false })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(1, TEMPLATE_NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: CONTENT_DOC })
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;
}

export class PlannerTemplateResponse {
  id: string;
  @ApiProperty({ enum: PLANNER_TEMPLATE_KINDS }) kind: PlannerTemplateKind;
  @ApiProperty({ enum: TEMPLATE_SECTION_TYPES, nullable: true })
  sectionType: TemplateSectionType | null;
  name: string;
  @ApiProperty({ example: 'pt-BR' }) locale: string;
  @ApiProperty({ type: 'object', additionalProperties: true, description: CONTENT_DOC })
  content: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;

  static from({ template }: { template: PlannerTemplate }): PlannerTemplateResponse {
    return {
      ...template,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    };
  }
}

export class TemplateNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['TEMPLATE_NOT_FOUND'] }) error: 'TEMPLATE_NOT_FOUND';
  @ApiProperty() message: string;
}

export class TemplatesLimitErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['TEMPLATES_LIMIT'] }) error: 'TEMPLATES_LIMIT';
  @ApiProperty() message: string;
}
