import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import type { AuthenticatedSession } from '../../access/domain/authenticated-session';
import { ProfileNotOwnedErrorBody } from '../../access/presentation/access-error.dto';
import { CurrentSession } from '../../access/presentation/current-session.decorator';
import { ContrastTooLowErrorBody } from '../../site/presentation/site-error.dto';
import {
  CreatePlannerTemplate,
  DeletePlannerTemplate,
  ListPlannerTemplates,
  UpdatePlannerTemplate,
} from '../application/planner-templates.use-cases';
import { TemplateNotFoundError } from '../domain/planner-template';
import { toPlannerHttpError } from './planner-http-errors';
import {
  CreatePlannerTemplateBody,
  PlannerTemplateResponse,
  PlannerTemplatesQuery,
  TemplateNotFoundErrorBody,
  TemplatesLimitErrorBody,
  UpdatePlannerTemplateBody,
} from './planner-templates.dto';

const templateId = new ParseUUIDPipe({
  exceptionFactory: () => toPlannerHttpError(new TemplateNotFoundError()),
});

/** Modelos do cerimonialista (Modelos RN01 a RN06): só os dela, pela RLS. */
@ApiTags('planner')
@Controller('me/planner-templates')
export class PlannerTemplatesController {
  constructor(
    private readonly listTemplates: ListPlannerTemplates,
    private readonly createTemplate: CreatePlannerTemplate,
    private readonly updateTemplate: UpdatePlannerTemplate,
    private readonly deleteTemplate: DeletePlannerTemplate,
  ) {}

  @Get()
  @ApiErrorResponses(...commonErrors({ validated: true, session: true }), ProfileNotOwnedErrorBody)
  async list(
    @CurrentSession() session: AuthenticatedSession,
    @Query() query: PlannerTemplatesQuery,
  ): Promise<PlannerTemplateResponse[]> {
    try {
      const templates = await this.listTemplates.execute({
        userId: session.userId,
        kind: query.kind ?? null,
        sectionType: query.sectionType ?? null,
      });
      return templates.map((template) => PlannerTemplateResponse.from({ template }));
    } catch (error) {
      throw toPlannerHttpError(error);
    }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ProfileNotOwnedErrorBody,
    ContrastTooLowErrorBody,
    TemplatesLimitErrorBody,
  )
  async create(
    @CurrentSession() session: AuthenticatedSession,
    @Body() body: CreatePlannerTemplateBody,
  ): Promise<PlannerTemplateResponse> {
    try {
      const template = await this.createTemplate.execute({
        userId: session.userId,
        kind: body.kind,
        sectionType: body.sectionType ?? null,
        name: body.name,
        content: body.content,
        now: new Date(),
      });
      return PlannerTemplateResponse.from({ template });
    } catch (error) {
      throw toPlannerHttpError(error);
    }
  }

  @Patch(':id')
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ProfileNotOwnedErrorBody,
    TemplateNotFoundErrorBody,
    ContrastTooLowErrorBody,
  )
  async update(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', templateId) id: string,
    @Body() body: UpdatePlannerTemplateBody,
  ): Promise<PlannerTemplateResponse> {
    try {
      const template = await this.updateTemplate.execute({
        userId: session.userId,
        id,
        name: body.name,
        content: body.content,
      });
      return PlannerTemplateResponse.from({ template });
    } catch (error) {
      throw toPlannerHttpError(error);
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiErrorResponses(
    ...commonErrors({ session: true, write: true }),
    ProfileNotOwnedErrorBody,
    TemplateNotFoundErrorBody,
  )
  async remove(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', templateId) id: string,
  ): Promise<void> {
    try {
      await this.deleteTemplate.execute({ userId: session.userId, id });
    } catch (error) {
      throw toPlannerHttpError(error);
    }
  }
}
