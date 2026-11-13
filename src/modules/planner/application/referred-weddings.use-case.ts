import { Inject, Injectable } from '@nestjs/common';
import {
  PLANNER_PROFILES,
  type PlannerProfiles,
} from '../../access/application/ports/planner-profiles.port';
import type { MyWeddingStatus } from '../domain/my-weddings';
import {
  REFERRED_WEDDINGS_READER,
  type ReferredWeddingsReader,
} from './ports/referred-weddings-reader.port';
import { requirePlannerProfile } from './planner-gate';
import { commissionsByWedding } from '../domain/commissions';
import {
  REFERRER_COMMISSIONS_READER,
  type ReferrerCommissionsReader,
} from './ports/referrer-commissions-reader.port';

export interface ReferredWeddingView {
  /** Nulo quando a linha não é clicável: a API não expõe o id de um casamento em que ela não entra (RN05). */
  weddingId: string | null;
  partnerNames: [string, string];
  status: MyWeddingStatus;
  createdAt: Date;
  clickable: boolean;
  /**
   * A coluna Comissão (Comissões do indicador RN08): a soma por estado; sem
   * pagamento, nula ("—"). Estornada, Bloqueada e Retida não entram.
   */
  commission: { availableCents: number; pendingCents: number } | null;
}

/**
 * Casais que vieram pelo seu link (GET /v1/me/referrer/weddings; Link de
 * indicação RN03 a RN05): só nomes e status, do mais recente para o mais
 * antigo. Sem convidados, contatos, endereço nem data (decisões 15 e 116). A
 * coluna Comissão volta na F3 (Comissões do indicador RN08).
 */
@Injectable()
export class ListReferredWeddings {
  constructor(
    @Inject(PLANNER_PROFILES) private readonly profiles: PlannerProfiles,
    @Inject(REFERRED_WEDDINGS_READER) private readonly reader: ReferredWeddingsReader,
    @Inject(REFERRER_COMMISSIONS_READER) private readonly commissions: ReferrerCommissionsReader,
  ) {}

  async execute({ userId }: { userId: string }): Promise<ReferredWeddingView[]> {
    await requirePlannerProfile({ profiles: this.profiles, userId });
    const commissionRows = await this.commissions.list();
    const byWedding = new Map(
      commissionsByWedding(commissionRows).map((entry) => [entry.weddingId, entry]),
    );
    const paidWeddings = new Set(commissionRows.map((row) => row.weddingId));
    return (await this.reader.list()).map((row) => ({
      weddingId: row.clickable ? row.weddingId : null,
      partnerNames: row.partnerNames,
      status: row.status,
      createdAt: row.createdAt,
      clickable: row.clickable,
      commission: paidWeddings.has(row.weddingId)
        ? {
            availableCents: byWedding.get(row.weddingId)?.availableCents ?? 0,
            pendingCents: byWedding.get(row.weddingId)?.pendingCents ?? 0,
          }
        : null,
    }));
  }
}
