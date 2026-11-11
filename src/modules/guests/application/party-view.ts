import type { PartyDetailsRow } from './ports/party-reader.port';
import type { PartyLinks } from './ports/party-links.port';

/** O grupo como o Painel e o Editar grupo leem (GET /parties/:partyId; RN14). */
export interface PartyView {
  id: string;
  name: string;
  contactGuestId: string | null;
  plusOneSlots: number;
  internalNote: string | null;
  tags: PartyDetailsRow['tags'];
  link: { url: string | null; regeneratedAt: Date | null };
  deliveryStatus: PartyDetailsRow['deliveryStatus'];
  guests: PartyDetailsRow['guests'];
  /** Envio, visualização e respostas: vazio até a Fase 4. */
  history: never[];
}

export function toPartyView({
  row,
  links,
}: {
  row: PartyDetailsRow;
  links: PartyLinks;
}): PartyView {
  return {
    id: row.id,
    name: row.name,
    contactGuestId: row.contactGuestId,
    plusOneSlots: row.plusOneSlots,
    internalNote: row.internalNote,
    tags: row.tags,
    link: {
      url: links.url({ slug: row.weddingSlug, token: row.linkToken }),
      regeneratedAt: row.linkRegeneratedAt,
    },
    deliveryStatus: row.deliveryStatus,
    guests: row.guests,
    history: [],
  };
}
