import { Injectable } from '@nestjs/common';
import {
  PartySiteNotLiveError,
  PartyTransactionRevokedError,
  TenantTransaction,
} from '../../../shared/database/tenant-transaction';
import type { PartyVisits } from '../application/ports/party-visits.port';

/** Pela transação do grupo (RSVP RN13), sob as policies *_party_*. */
@Injectable()
export class PrismaPartyVisits implements PartyVisits {
  constructor(private readonly tenant: TenantTransaction) {}

  async markViewed({
    weddingId,
    partyId,
    linkVersion,
  }: {
    weddingId: string;
    partyId: string;
    linkVersion: number;
  }): Promise<void> {
    try {
      await this.tenant.runAsParty({
        weddingId,
        partyId,
        linkVersion,
        work: async ({ status }) => {
          // Só num site publicado (RN02): o pós-evento não marca visita.
          if (status !== 'published') return;
          // Só uma linha: a do grupo do cookie (policy parties_party_update).
          await this.tenant.client().$executeRaw`
            UPDATE parties
            SET first_viewed_at = coalesce(first_viewed_at, now()),
                delivery_status = CASE WHEN delivery_status IN ('not_sent', 'sent')
                                       THEN 'viewed'::party_delivery_status
                                       ELSE delivery_status END
            WHERE id = ${partyId}::uuid`;
        },
      });
    } catch (error) {
      // O grupo deixou de valer depois da leitura do token: nada a gravar.
      if (error instanceof PartyTransactionRevokedError || error instanceof PartySiteNotLiveError)
        return;
      throw error;
    }
  }
}
