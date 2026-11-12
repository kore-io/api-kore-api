import type { PlannerTemplateKind, TemplateSectionType } from '../../domain/planner-template';

export interface PlannerTemplate {
  id: string;
  kind: PlannerTemplateKind;
  sectionType: TemplateSectionType | null;
  name: string;
  locale: string;
  content: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Os modelos da cerimonialista na transação da requisição, com a RLS de
 * `planner_templates` por `current_planner_id()` (Modelos RN02; revisão C6-2):
 * o modelo de outra pessoa nem aparece.
 */
export interface PlannerTemplateStore {
  /** Serializa as criações da mesma pessoa até o fim da transação (o teto da RN04). */
  lock({ userId }: { userId: string }): Promise<void>;
  count(): Promise<number>;
  list({
    kind,
    sectionType,
  }: {
    kind: PlannerTemplateKind | null;
    sectionType: TemplateSectionType | null;
  }): Promise<PlannerTemplate[]>;
  find({ id }: { id: string }): Promise<PlannerTemplate | null>;
  create({
    template,
  }: {
    template: Omit<PlannerTemplate, 'createdAt' | 'updatedAt'>;
  }): Promise<PlannerTemplate>;
  update({
    id,
    changes,
  }: {
    id: string;
    changes: { name?: string; content?: Record<string, unknown> };
  }): Promise<PlannerTemplate>;
  /** false quando o modelo não existe para ela. */
  delete({ id }: { id: string }): Promise<boolean>;
}

export const PLANNER_TEMPLATE_STORE = Symbol('PlannerTemplateStore');
