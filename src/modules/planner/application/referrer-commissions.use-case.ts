import { Inject, Injectable } from '@nestjs/common';
import {
  PLANNER_PROFILES,
  type PlannerProfiles,
} from '../../access/application/ports/planner-profiles.port';
import {
  commissionBalances,
  commissionsByWedding,
  type CommissionBalances,
  type CommissionRow,
  type WeddingCommissions,
} from '../domain/commissions';
import { requirePlannerProfile } from './planner-gate';
import {
  REFERRER_COMMISSIONS_READER,
  type ReferrerCommissionsReader,
} from './ports/referrer-commissions-reader.port';

export interface ReferrerCommissionsView {
  balances: CommissionBalances;
  /** Aba Por pagamento: a mais nova primeiro. */
  items: CommissionRow[];
  /** Aba Por casamento. */
  byWedding: WeddingCommissions[];
}

/**
 * GET /v1/me/referrer/commissions (Comissões do indicador RN02, RN07 e RN10):
 * os saldos, as comissões por pagamento e por casamento. A API devolve o
 * percentual (a tela não o mostra, decisão 230, D3); o id do casamento só sai
 * quando a linha abre (ela colabora nele), como no Link de indicação.
 */
@Injectable()
export class ListReferrerCommissions {
  constructor(
    @Inject(PLANNER_PROFILES) private readonly profiles: PlannerProfiles,
    @Inject(REFERRER_COMMISSIONS_READER) private readonly reader: ReferrerCommissionsReader,
  ) {}

  async execute({ userId }: { userId: string }): Promise<ReferrerCommissionsView> {
    await requirePlannerProfile({ profiles: this.profiles, userId });
    const rows = await this.reader.list();
    return {
      balances: commissionBalances(rows, await this.reader.adjustments()),
      items: rows,
      byWedding: commissionsByWedding(rows),
    };
  }
}
