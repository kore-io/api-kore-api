import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type {
  PlannerTemplate,
  PlannerTemplateStore,
} from '../application/ports/planner-template-store.port';
import type { PlannerTemplateKind, TemplateSectionType } from '../domain/planner-template';

const SELECT = {
  id: true,
  kind: true,
  sectionType: true,
  name: true,
  locale: true,
  content: true,
  createdAt: true,
  updatedAt: true,
} as const;

type Row = Prisma.PlannerTemplateGetPayload<{ select: typeof SELECT }>;

const toTemplate = (row: Row): PlannerTemplate => ({
  ...row,
  sectionType: row.sectionType as TemplateSectionType | null,
  content: row.content as Record<string, unknown>,
});

/** Na transação da requisição: a RLS mostra só os modelos dela. */
@Injectable()
export class PrismaPlannerTemplateStore implements PlannerTemplateStore {
  constructor(private readonly tenant: TenantTransaction) {}

  async lock({ userId }: { userId: string }): Promise<void> {
    await this.tenant.client()
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`planner-templates:${userId}`}, 0))`;
  }

  count(): Promise<number> {
    return this.tenant.client().plannerTemplate.count();
  }

  async list({
    kind,
    sectionType,
  }: {
    kind: PlannerTemplateKind | null;
    sectionType: TemplateSectionType | null;
  }): Promise<PlannerTemplate[]> {
    const rows = await this.tenant.client().plannerTemplate.findMany({
      where: { ...(kind ? { kind } : {}), ...(sectionType ? { sectionType } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: SELECT,
    });
    return rows.map(toTemplate);
  }

  async find({ id }: { id: string }): Promise<PlannerTemplate | null> {
    const row = await this.tenant
      .client()
      .plannerTemplate.findFirst({ where: { id }, select: SELECT });
    return row ? toTemplate(row) : null;
  }

  async create({
    template,
  }: {
    template: Omit<PlannerTemplate, 'createdAt' | 'updatedAt'>;
  }): Promise<PlannerTemplate> {
    const tx = this.tenant.client();
    // O Planner da sessão, pela mesma função da RLS: o pedido não escolhe.
    const [{ planner_id: plannerId }] = await tx.$queryRaw<[{ planner_id: string | null }]>`
      SELECT current_planner_id() AS planner_id`;
    if (!plannerId) throw new Error('Sem Planner ativo na transação do modelo.');
    const row = await tx.plannerTemplate.create({
      data: {
        id: template.id,
        plannerId,
        kind: template.kind,
        sectionType: template.sectionType,
        name: template.name,
        locale: template.locale,
        content: template.content as Prisma.InputJsonValue,
      },
      select: SELECT,
    });
    return toTemplate(row);
  }

  async update({
    id,
    changes,
  }: {
    id: string;
    changes: { name?: string; content?: Record<string, unknown> };
  }): Promise<PlannerTemplate> {
    const row = await this.tenant.client().plannerTemplate.update({
      where: { id },
      data: {
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.content !== undefined
          ? { content: changes.content as Prisma.InputJsonValue }
          : {}),
      },
      select: SELECT,
    });
    return toTemplate(row);
  }

  async delete({ id }: { id: string }): Promise<boolean> {
    const { count } = await this.tenant.client().plannerTemplate.deleteMany({ where: { id } });
    return count === 1;
  }
}
