/** Os tipos de modelo (Modelos RN01): Textos, FAQ e Aparência. */
export const PLANNER_TEMPLATE_KINDS = ['section_content', 'faq', 'appearance'] as const;
export type PlannerTemplateKind = (typeof PLANNER_TEMPLATE_KINDS)[number];

/** As seções de Textos (RN01; revisão C6-8): o mesmo CHECK do banco. */
export const TEMPLATE_SECTION_TYPES = ['story', 'lodging', 'dress_code'] as const;
export type TemplateSectionType = (typeof TEMPLATE_SECTION_TYPES)[number];

/** RN04: nome livre, até 80. */
export const TEMPLATE_NAME_MAX = 80;
/** RN04: guarda técnica contra abuso, fora da tela (decisão 224(9); revisão C6-3). */
export const TEMPLATES_MAX = 500;
/** RN05: um idioma por modelo; até a F10, só português. */
export const TEMPLATE_LOCALE = 'pt-BR';

export class TemplateNotFoundError extends Error {
  override name = 'TemplateNotFoundError';
}

export class TemplatesLimitError extends Error {
  override name = 'TemplatesLimitError';
}

export class TemplateInvalidError extends Error {
  override name = 'TemplateInvalidError';
  readonly issues: readonly { path: string; code: string; params: Record<string, unknown> }[];

  constructor({
    issues,
  }: {
    issues: readonly { path: string; code: string; params: Record<string, unknown> }[];
  }) {
    super('Modelo inválido.');
    this.issues = issues;
  }
}
