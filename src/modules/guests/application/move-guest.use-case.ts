import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import {
  EmptyPlusOneError,
  GuestFieldsInvalidError,
  GuestNotFoundError,
  LastGuestError,
} from '../domain/guests.errors';
import {
  contactAfter,
  deliveryStatusAfter,
  hasPending,
  isEmptySlot,
  type GroupMember,
} from '../domain/party-rules';
import { canBeContact } from '../domain/party';
import {
  GROUP_STORE,
  type GroupRow,
  type GroupStore,
  type PartyChanges,
} from './ports/group-store.port';
import { PARTY_STORE, type PartyStore } from './ports/party-store.port';

/**
 * Mover de grupo (Grupos RN10), numa transação só: mantém a resposta e as tags
 * do convidado; ele entra no fim dos convidados com nome do destino (RN17); o
 * contato da origem segue a RN06, e no destino ele vira contato só se o grupo
 * estava sem contato e ele tem telefone ou e-mail; o acompanhante com nome
 * vira convidado comum no destino e a origem perde a vaga (186(9)); os status
 * de envio e os grupos pendentes são recalculados (RN16; 199(1)); quem já
 * respondeu vai para o log, só com ids (186(6)).
 */
@Injectable()
export class MoveGuest {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(GROUP_STORE) private readonly groups: GroupStore,
    @Inject(PARTY_STORE) private readonly parties: PartyStore,
    @Inject(APPLICATION_LOG_WRITER) private readonly log: ApplicationLogWriter,
  ) {}

  async execute({
    userId,
    weddingId,
    guestId,
    toPartyId,
    ip,
    now,
  }: {
    userId: string;
    weddingId: string;
    guestId: string;
    toPartyId: string;
    ip: string | null;
    now: Date;
  }): Promise<{ guestId: string; fromPartyId: string; toPartyId: string }> {
    await this.authorization.require({ userId, weddingId, action: 'manage_guests' });
    // Antes de qualquer leitura: a escrita e o recálculo noturno não se cruzam (RN16).
    await this.parties.lockStats({ weddingId });
    const found = await this.groups.findGuest({ weddingId, guestId });
    if (!found) throw new GuestNotFoundError();
    const fromPartyId = found.partyId;
    if (toPartyId === fromPartyId)
      throw new GuestFieldsInvalidError({
        issues: [{ path: 'partyId', code: 'SAME_PARTY', params: {} }],
      });

    await this.groups.lock({ weddingId, partyIds: [fromPartyId, toPartyId] });
    const [from, to] = await Promise.all([
      this.groups.load({ weddingId, partyId: fromPartyId }),
      this.groups.load({ weddingId, partyId: toPartyId }),
    ]);
    const guest = from?.members.find((member) => member.id === guestId);
    if (!from || !guest) throw new GuestNotFoundError();
    if (!to)
      throw new GuestFieldsInvalidError({
        issues: [{ path: 'partyId', code: 'PARTY_NOT_FOUND', params: {} }],
      });
    if (isEmptySlot(guest)) throw new EmptyPlusOneError();
    const namedInOrigin = from.members.filter((member) => member.name !== null);
    if (namedInOrigin.length <= 1) throw new LastGuestError();

    const moved: GroupMember = { ...guest, isPlusOne: false };
    const fromAfter = from.members.filter((member) => member.id !== guestId);
    const toAfter = [...to.members, moved];

    await this.groups.updateGuest({
      guestId,
      changes: { partyId: toPartyId, isPlusOne: false, joinedPartyAt: now },
    });
    await this.groups.updateParty({
      partyId: fromPartyId,
      changes: this.partyChanges({
        party: from,
        members: fromAfter,
        contact: contactAfter({ currentContactId: from.contactGuestId, members: fromAfter }),
        // O acompanhante com nome leva a vaga junto (186(9)).
        plusOneSlots: guest.isPlusOne ? from.plusOneSlots - 1 : undefined,
      }),
    });
    await this.groups.updateParty({
      partyId: toPartyId,
      changes: this.partyChanges({
        party: to,
        members: toAfter,
        contact: to.contactGuestId ?? (canBeContact(moved) ? guestId : null),
      }),
    });

    // Os totais não mudam; só os grupos pendentes, conforme os dois grupos
    // passam a ter ou deixam de ter pendente (RN16).
    const pendingDelta =
      Number(hasPending({ members: fromAfter })) -
      Number(hasPending({ members: from.members })) +
      Number(hasPending({ members: toAfter })) -
      Number(hasPending({ members: to.members }));
    await this.parties.applyStats({ weddingId, delta: { partiesPending: pendingDelta } });

    if (guest.rsvpStatus !== 'pending')
      await this.log.record({
        entry: {
          action: 'guest.moved',
          actorKind: 'user',
          actorUserId: userId,
          weddingId,
          entityType: 'guest',
          entityId: guestId,
          data: { fromPartyId, toPartyId },
          ...(ip ? { ip } : {}),
        },
      });
    return { guestId, fromPartyId, toPartyId };
  }

  private partyChanges({
    party,
    members,
    contact,
    plusOneSlots,
  }: {
    party: GroupRow;
    members: readonly GroupMember[];
    contact: string | null;
    plusOneSlots?: number;
  }): PartyChanges {
    // Os dois grupos mudaram: a versão sobe (RSVP RN11).
    const changes: PartyChanges = { bumpVersion: true };
    if (contact !== party.contactGuestId) changes.contactGuestId = contact;
    if (plusOneSlots !== undefined) changes.plusOneSlots = plusOneSlots;
    const delivery = deliveryStatusAfter({
      current: party.deliveryStatus,
      firstViewedAt: party.firstViewedAt,
      members,
    });
    if (delivery !== party.deliveryStatus) changes.deliveryStatus = delivery;
    return changes;
  }
}
