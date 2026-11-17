import { Inject, Injectable } from '@nestjs/common';
import {
  PLANNER_PROFILES,
  type PlannerProfiles,
} from '@/modules/access/application/ports/planner-profiles.port';
import {
  commissionBalances,
  commissionPaymentLines,
  commissionsByWedding,
  type CommissionBalances,
  type CommissionPaymentLine,
  type WeddingCommissions,
} from '@/modules/planner/domain/commissions';
import { requirePlannerProfile } from './planner-gate';
import {
  REFERRER_COMMISSIONS_READER,
  type ReferrerCommissionsReader,
} from './ports/referrer-commissions-reader.port';

/** As linhas por página da tela Comissões (Contrato de API: `page`). */
export const COMMISSIONS_PAGE_SIZE = 50;

export type CommissionsTab = 'payment' | 'wedding';

export type ReferrerCommissionsView = {
  balances: CommissionBalances;
  page: number;
  pageSize: number;
  total: number;
} & (
  | { view: 'payment'; items: CommissionPaymentLine[] }
  | { view: 'wedding'; items: WeddingCommissions[] }
);

/**
 * GET /v1/me/referrer/commissions?view=payment|wedding&page= (Comissões do
 * indicador RN02, RN07 e RN10; Contrato de API, decisão 275): os saldos e uma
 * aba por vez, paginada. Por pagamento, as comissões e os ajustes juntos, o
 * mais novo primeiro; por casamento, a soma por casal. A API devolve o
 * percentual e o motivo do bloqueio (a tela não os mostra, decisão 230, D3).
 */
@Injectable()
export class ListReferrerCommissions {
  constructor(
    @Inject(PLANNER_PROFILES) private readonly profiles: PlannerProfiles,
    @Inject(REFERRER_COMMISSIONS_READER) private readonly reader: ReferrerCommissionsReader,
  ) {}

  async execute({
    userId,
    view = 'payment',
    page = 1,
  }: {
    userId: string;
    view?: CommissionsTab;
    page?: number;
  }): Promise<ReferrerCommissionsView> {
    await requirePlannerProfile({ profiles: this.profiles, userId });
    const rows = await this.reader.list();
    const adjustments = await this.reader.adjustments();
    const balances = commissionBalances(rows, adjustments);
    const slice = <T>(all: T[]) => ({
      page,
      pageSize: COMMISSIONS_PAGE_SIZE,
      total: all.length,
      items: all.slice((page - 1) * COMMISSIONS_PAGE_SIZE, page * COMMISSIONS_PAGE_SIZE),
    });
    if (view === 'wedding') return { balances, view, ...slice(commissionsByWedding(rows)) };
    return { balances, view, ...slice(commissionPaymentLines({ rows, adjustments })) };
  }
}
