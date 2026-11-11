import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { PartyNotFoundError } from '../domain/guests.errors';
import { toPartyView, type PartyView } from './party-view';
import { PARTY_LINKS, type PartyLinks } from './ports/party-links.port';
import { PARTY_READER, type PartyReader } from './ports/party-reader.port';

/** Painel do grupo e Editar grupo (Grupos RN14): qualquer vínculo lê (RN02). */
@Injectable()
export class GetParty {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(PARTY_READER) private readonly reader: PartyReader,
    @Inject(PARTY_LINKS) private readonly links: PartyLinks,
  ) {}

  async execute({
    userId,
    weddingId,
    partyId,
  }: {
    userId: string;
    weddingId: string;
    partyId: string;
  }): Promise<PartyView> {
    await this.authorization.require({ userId, weddingId, action: 'view' });
    const row = await this.reader.findActive({ weddingId, partyId });
    if (!row) throw new PartyNotFoundError();
    return toPartyView({ row, links: this.links });
  }
}
