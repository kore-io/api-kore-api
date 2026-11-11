import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import {
  GuestFieldsInvalidError,
  PartyNotFoundError,
  type FieldIssue,
} from '../domain/guests.errors';
import { canBeContact, defaultContactIndex, type AgeGroup } from '../domain/party';
import { parsePhone } from '../domain/phone';
import { guestsDelta } from '../domain/wedding-stats';
import { toPartyView, type PartyView } from './party-view';
import { PARTY_LINKS, type PartyLinks } from './ports/party-links.port';
import { PARTY_READER, type PartyReader } from './ports/party-reader.port';
import { PARTY_STORE, type NewGuest, type PartyStore } from './ports/party-store.port';

export interface CreatePartyGuestInput {
  /** Já sem espaços nas pontas (DTO). */
  name: string;
  ageGroup?: AgeGroup;
  phone?: string;
  /** Já em minúsculas (DTO). */
  email?: string;
}

/**
 * Novo grupo (Grupos RN03), numa transação só: os convidados na ordem do
 * pedido (RN17), as vagas como convidados sem nome no fim (RN07), o contato
 * (RN06), as tags, o link (RN11) e os números do casamento (RN16).
 */
@Injectable()
export class CreateParty {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(PARTY_STORE) private readonly store: PartyStore,
    @Inject(PARTY_READER) private readonly reader: PartyReader,
    @Inject(PARTY_LINKS) private readonly links: PartyLinks,
  ) {}

  async execute({
    userId,
    weddingId,
    name,
    guests,
    contactIndex,
    plusOneSlots = 0,
    tagIds = [],
    internalNote,
    now,
  }: {
    userId: string;
    weddingId: string;
    name: string;
    guests: readonly CreatePartyGuestInput[];
    contactIndex?: number;
    plusOneSlots?: number;
    tagIds?: readonly string[];
    internalNote?: string;
    now: Date;
  }): Promise<PartyView> {
    await this.authorization.require({ userId, weddingId, action: 'manage_guests' });

    const issues: FieldIssue[] = [];
    const phones = guests.map((guest, index) => {
      if (!guest.phone) return null;
      const parsed = parsePhone({ raw: guest.phone });
      if (parsed.ok) return parsed.e164;
      issues.push({ path: `guests.${index}.phone`, code: parsed.code, params: parsed.params });
      return null;
    });

    const contacts = guests.map((guest, index) => ({ phone: phones[index], email: guest.email }));
    let contact: number | null;
    if (contactIndex === undefined) contact = defaultContactIndex({ guests: contacts });
    else if (contactIndex >= guests.length) {
      issues.push({ path: 'contactIndex', code: 'CONTACT_NOT_IN_PARTY', params: {} });
      contact = null;
    } else if (!canBeContact(contacts[contactIndex])) {
      issues.push({ path: 'contactIndex', code: 'CONTACT_WITHOUT_PHONE_OR_EMAIL', params: {} });
      contact = null;
    } else contact = contactIndex;

    const uniqueTagIds = [...new Set(tagIds)];
    const activeTagIds = new Set(
      await this.store.findActiveTagIds({ weddingId, tagIds: uniqueTagIds }),
    );
    tagIds.forEach((tagId, index) => {
      if (!activeTagIds.has(tagId))
        issues.push({ path: `tagIds.${index}`, code: 'TAG_NOT_FOUND', params: {} });
    });

    if (issues.length > 0) throw new GuestFieldsInvalidError({ issues });

    // Os ids seguem a ordem do pedido: no empate do joinedPartyAt, a ordem do
    // grupo é pelo id (RN17), e o uuid v7 leva o instante.
    const base = now.getTime();
    const named: NewGuest[] = guests.map((guest, index) => ({
      id: uuidV7({ now: base + index }),
      name: guest.name,
      ageGroup: guest.ageGroup ?? null,
      phone: phones[index],
      email: guest.email ?? null,
      isPlusOne: false,
    }));
    const slots: NewGuest[] = Array.from({ length: plusOneSlots }, (_, index) => ({
      id: uuidV7({ now: base + guests.length + index }),
      name: null,
      ageGroup: null,
      phone: null,
      email: null,
      isPlusOne: true,
    }));

    const partyId = uuidV7({ now: base });
    await this.store.create({
      party: {
        id: partyId,
        weddingId,
        name,
        internalNote: internalNote ?? null,
        linkToken: this.links.newToken(),
        contactGuestId: contact === null ? null : named[contact].id,
        guests: [...named, ...slots],
        tagIds: uniqueTagIds,
        now,
      },
    });
    // Todo convidado novo nasce pendente, então o grupo novo é um pendente a mais.
    await this.store.applyStats({
      weddingId,
      delta: {
        ...guestsDelta({
          guests: [...named, ...slots].map(() => ({ rsvpStatus: 'pending', ageGroup: null })),
          sign: 1,
        }),
        partiesPending: 1,
      },
    });

    const row = await this.reader.findActive({ weddingId, partyId });
    if (!row) throw new PartyNotFoundError();
    return toPartyView({ row, links: this.links });
  }
}
