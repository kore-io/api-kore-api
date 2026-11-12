import { Inject, Injectable } from '@nestjs/common';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import {
  PLANNER_PROFILES,
  type PlannerProfiles,
} from '../../access/application/ports/planner-profiles.port';
import {
  TEMPLATE_LOCALE,
  TEMPLATES_MAX,
  TemplateInvalidError,
  TemplateNotFoundError,
  TemplatesLimitError,
  type PlannerTemplateKind,
  type TemplateSectionType,
} from '../domain/planner-template';
import {
  PLANNER_TEMPLATE_STORE,
  type PlannerTemplate,
  type PlannerTemplateStore,
} from './ports/planner-template-store.port';
import { requirePlannerProfile } from './planner-gate';
import { validateTemplateContent } from './template-content.validation';

/** GET /v1/me/planner-templates: os dela, do mais novo para o mais antigo (RN06). */
@Injectable()
export class ListPlannerTemplates {
  constructor(
    @Inject(PLANNER_PROFILES) private readonly profiles: PlannerProfiles,
    @Inject(PLANNER_TEMPLATE_STORE) private readonly store: PlannerTemplateStore,
  ) {}

  async execute({
    userId,
    kind,
    sectionType,
  }: {
    userId: string;
    kind: PlannerTemplateKind | null;
    sectionType: TemplateSectionType | null;
  }): Promise<PlannerTemplate[]> {
    await requirePlannerProfile({ profiles: this.profiles, userId });
    return this.store.list({ kind, sectionType });
  }
}

/**
 * POST /v1/me/planner-templates (RN01 a RN05): só conteúdo digitado por ela,
 * sem nada do casamento (RN03); o `sectionType` só nos Textos; o teto técnico
 * de 500 sob o lock da pessoa (RN04).
 */
@Injectable()
export class CreatePlannerTemplate {
  constructor(
    @Inject(PLANNER_PROFILES) private readonly profiles: PlannerProfiles,
    @Inject(PLANNER_TEMPLATE_STORE) private readonly store: PlannerTemplateStore,
  ) {}

  async execute({
    userId,
    kind,
    sectionType,
    name,
    content,
    now,
  }: {
    userId: string;
    kind: PlannerTemplateKind;
    sectionType: TemplateSectionType | null;
    name: string;
    content: unknown;
    now: Date;
  }): Promise<PlannerTemplate> {
    await requirePlannerProfile({ profiles: this.profiles, userId });
    if (kind === 'section_content' && !sectionType)
      throw new TemplateInvalidError({
        issues: [{ path: 'sectionType', code: 'REQUIRED', params: {} }],
      });
    if (kind !== 'section_content' && sectionType)
      throw new TemplateInvalidError({
        issues: [{ path: 'sectionType', code: 'NOT_ALLOWED', params: {} }],
      });
    const checked = await validateTemplateContent({ kind, sectionType, content });
    if (!checked.ok) throw new TemplateInvalidError({ issues: checked.errors });

    await this.store.lock({ userId });
    if ((await this.store.count()) >= TEMPLATES_MAX) throw new TemplatesLimitError();
    return this.store.create({
      template: {
        id: uuidV7({ now: now.getTime() }),
        kind,
        sectionType: kind === 'section_content' ? sectionType : null,
        name,
        locale: TEMPLATE_LOCALE,
        content: checked.content,
      },
    });
  }
}

/** PATCH /v1/me/planner-templates/{id}: o nome e o conteúdo; o tipo e a seção não mudam. */
@Injectable()
export class UpdatePlannerTemplate {
  constructor(
    @Inject(PLANNER_PROFILES) private readonly profiles: PlannerProfiles,
    @Inject(PLANNER_TEMPLATE_STORE) private readonly store: PlannerTemplateStore,
  ) {}

  async execute({
    userId,
    id,
    name,
    content,
  }: {
    userId: string;
    id: string;
    name: string | undefined;
    content: unknown;
  }): Promise<PlannerTemplate> {
    await requirePlannerProfile({ profiles: this.profiles, userId });
    // De outra pessoa, a RLS esconde: 404, sem revelar que existe (RN02).
    const template = await this.store.find({ id });
    if (!template) throw new TemplateNotFoundError();
    const changes: { name?: string; content?: Record<string, unknown> } = {};
    if (name !== undefined) changes.name = name;
    if (content !== undefined) {
      const checked = await validateTemplateContent({
        kind: template.kind,
        sectionType: template.sectionType,
        content,
      });
      if (!checked.ok) throw new TemplateInvalidError({ issues: checked.errors });
      changes.content = checked.content;
    }
    return this.store.update({ id, changes });
  }
}

/** DELETE /v1/me/planner-templates/{id}: os sites em que já foi aplicado não mudam (RN06). */
@Injectable()
export class DeletePlannerTemplate {
  constructor(
    @Inject(PLANNER_PROFILES) private readonly profiles: PlannerProfiles,
    @Inject(PLANNER_TEMPLATE_STORE) private readonly store: PlannerTemplateStore,
  ) {}

  async execute({ userId, id }: { userId: string; id: string }): Promise<void> {
    await requirePlannerProfile({ profiles: this.profiles, userId });
    if (!(await this.store.delete({ id }))) throw new TemplateNotFoundError();
  }
}
