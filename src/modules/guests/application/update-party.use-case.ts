import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import {
  GuestFieldsInvalidError,
  PartyNotFoundError,
  PlusOnesInUseError,
  type FieldIssue,
} from '../domain/guests.errors';
import { canBeContact, type AgeGroup } from '../domain/party';
import { contactAfter, deliveryStatusAfter, hasPending, isEmptySlot } from '../domain/party-rules';
import { parsePhone } from '../domain/phone';
import { guestsDelta, type StatsDelta } from '../domain/wedding-stats';
import { toPartyView, type PartyView } from './party-view';
import {
  GROUP_STORE,
  type GroupMemberRow,
  type GroupStore,
  type GuestChanges,
  type PartyChanges,
} from './ports/group-store.port';
import { PARTY_LINKS, type PartyLinks } from './ports/party-links.port';
import { PARTY_READER, type PartyReader } from './ports/party-reader.port';
import { PARTY_STORE, type NewGuest, type PartyStore } from './ports/party-store.port';

/** Um convidado do Editar grupo: com id edita só o que vem; sem id, é novo. */
export interface UpdatePartyGuestInput {
  id?: string;
  /** null não é aceito (o nome é obrigatório). */
  name?: string | null;
  ageGroup?: AgeGroup | null;
  phone?: string | null;
  email?: string | null;
  /** A lista completa das tags do convidado (substitui; Tags RN07). */
  tagIds?: string[];
}

const GUEST_FIELDS = ['name', 'ageGroup', 'phone', 'email'] as const;

/**
 * Editar grupo (Grupos RN09), numa transação só: os campos do grupo, os
 * convidados editados e os novos (+ Adicionar convidado), o contato (RN06), as
 * vagas (RN07), as tags e os números do casamento (RN16). Não tira convidado:
 * tirar é Mover para a lixeira. Sem versão: vale a última gravação (186(12)).
 * Editar quem já respondeu grava guest.updated só com os nomes dos campos
 * (186(6)).
 */
@Injectable()
export class UpdateParty {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(GROUP_STORE) private readonly groups: GroupStore,
    @Inject(PARTY_STORE) private readonly parties: PartyStore,
    @Inject(PARTY_READER) private readonly reader: PartyReader,
    @Inject(PARTY_LINKS) private readonly links: PartyLinks,
    @Inject(APPLICATION_LOG_WRITER) private readonly log: ApplicationLogWriter,
  ) {}

  async execute({
    userId,
    weddingId,
    partyId,
    name,
    internalNote,
    guests = [],
    contactGuestId,
    plusOneSlots,
    tagIds,
    ip,
    now,
  }: {
    userId: string;
    weddingId: string;
    partyId: string;
    name?: string;
    internalNote?: string | null;
    guests?: readonly UpdatePartyGuestInput[];
    contactGuestId?: string;
    plusOneSlots?: number;
    tagIds?: readonly string[];
    ip: string | null;
    now: Date;
  }): Promise<PartyView> {
    await this.authorization.require({ userId, weddingId, action: 'manage_guests' });
    await this.groups.lock({ weddingId, partyIds: [partyId] });
    const group = await this.groups.load({ weddingId, partyId });
    if (!group) throw new PartyNotFoundError();

    const issues: FieldIssue[] = [];
    const byId = new Map(group.members.map((member) => [member.id, member]));

    // Os convidados com id: só os com nome deste grupo (a vaga não se edita aqui).
    const edits: { member: GroupMemberRow; changes: GuestChanges; tagIds?: string[] }[] = [];
    const additions: { input: UpdatePartyGuestInput; index: number }[] = [];
    guests.forEach((input, index) => {
      if (input.name === null || (input.id === undefined && input.name === undefined))
        issues.push({ path: `guests.${index}.name`, code: 'IS_NOT_EMPTY', params: {} });
      const phone = this.phoneOf({ input, index, issues });
      if (input.id === undefined) {
        additions.push({ input: { ...input, phone }, index });
        return;
      }
      const member = byId.get(input.id);
      if (!member || member.isPlusOne) {
        issues.push({ path: `guests.${index}.id`, code: 'GUEST_NOT_IN_PARTY', params: {} });
        return;
      }
      const changes: GuestChanges = {};
      if (input.name) changes.name = input.name;
      if (input.ageGroup !== undefined) changes.ageGroup = input.ageGroup;
      if (input.phone !== undefined) changes.phone = phone;
      if (input.email !== undefined) changes.email = input.email;
      edits.push({ member, changes, tagIds: input.tagIds });
    });

    // Tags pedidas: do grupo e de cada convidado, ativas no casamento.
    const askedTags = [...(tagIds ?? []), ...guests.flatMap((guest) => guest.tagIds ?? [])];
    const activeTags = new Set(
      await this.parties.findActiveTagIds({ weddingId, tagIds: [...new Set(askedTags)] }),
    );
    (tagIds ?? []).forEach((tagId, index) => {
      if (!activeTags.has(tagId))
        issues.push({ path: `tagIds.${index}`, code: 'TAG_NOT_FOUND', params: {} });
    });
    guests.forEach((guest, guestIndex) =>
      (guest.tagIds ?? []).forEach((tagId, index) => {
        if (!activeTags.has(tagId))
          issues.push({
            path: `guests.${guestIndex}.tagIds.${index}`,
            code: 'TAG_NOT_FOUND',
            params: {},
          });
      }),
    );

    // O grupo como fica, na ordem do grupo: os editados no lugar, os novos no
    // fim dos convidados com nome (RN17), as vagas depois.
    const edited = new Map(edits.map((edit) => [edit.member.id, edit.changes]));
    const base = now.getTime();
    const added: NewGuest[] = additions.map(({ input }, index) => ({
      id: uuidV7({ now: base + index }),
      name: input.name ?? '',
      ageGroup: input.ageGroup ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      isPlusOne: false,
    }));
    const named = group.members
      .filter((member) => !member.isPlusOne || member.name !== null)
      .map((member) => ({ ...member, ...edited.get(member.id) }));
    const slots = group.members.filter((member) => isEmptySlot(member));

    // Vagas (RN07): aumentar cria vagas pendentes; diminuir apaga só as vazias
    // pendentes; abaixo das preenchidas ou respondidas, recusa.
    const plusOnes = group.members.filter((member) => member.isPlusOne);
    const removableSlots = plusOnes.filter(
      (member) => isEmptySlot(member) && member.rsvpStatus === 'pending',
    );
    const inUse = plusOnes.length - removableSlots.length;
    let newSlots: NewGuest[] = [];
    let removedSlots: GroupMemberRow[] = [];
    if (plusOneSlots !== undefined && plusOneSlots !== plusOnes.length) {
      if (plusOneSlots < inUse) throw new PlusOnesInUseError({ inUse });
      if (plusOneSlots > plusOnes.length)
        newSlots = Array.from({ length: plusOneSlots - plusOnes.length }, (_, index) => ({
          id: uuidV7({ now: base + added.length + index }),
          name: null,
          ageGroup: null,
          phone: null,
          email: null,
          isPlusOne: true,
        }));
      // As vagas mais novas saem primeiro.
      else removedSlots = removableSlots.slice(plusOneSlots - plusOnes.length);
    }

    const removed = new Set(removedSlots.map((slot) => slot.id));
    const after = [
      ...named,
      ...added.map((guest) => ({ ...guest, rsvpStatus: 'pending' as const })),
      ...slots.filter((slot) => !removed.has(slot.id)),
      ...newSlots.map((guest) => ({ ...guest, rsvpStatus: 'pending' as const })),
    ];

    // Contato (RN06): o escolhido precisa ser do grupo e ter telefone ou
    // e-mail; sem escolha, o atual continua se ainda pode, senão o próximo.
    let contact: string | null;
    if (contactGuestId !== undefined) {
      const chosen = named.find((member) => member.id === contactGuestId);
      if (!chosen)
        issues.push({ path: 'contactGuestId', code: 'CONTACT_NOT_IN_PARTY', params: {} });
      else if (!canBeContact(chosen))
        issues.push({
          path: 'contactGuestId',
          code: 'CONTACT_WITHOUT_PHONE_OR_EMAIL',
          params: {},
        });
      contact = contactGuestId;
    } else contact = contactAfter({ currentContactId: group.contactGuestId, members: after });

    if (issues.length > 0) throw new GuestFieldsInvalidError({ issues });

    // Gravação.
    for (const edit of edits) {
      await this.groups.updateGuest({ guestId: edit.member.id, changes: edit.changes });
      if (edit.tagIds)
        await this.groups.replaceGuestTags({
          weddingId,
          guestId: edit.member.id,
          tagIds: edit.tagIds,
        });
    }
    await this.groups.addGuests({ weddingId, partyId, guests: [...added, ...newSlots], now });
    for (const [index, { input }] of additions.entries())
      if (input.tagIds?.length)
        await this.groups.replaceGuestTags({
          weddingId,
          guestId: added[index].id,
          tagIds: input.tagIds,
        });
    await this.groups.deleteEmptySlots({ guestIds: removedSlots.map((slot) => slot.id) });
    if (tagIds)
      await this.groups.replacePartyTags({ weddingId, partyId, tagIds: [...new Set(tagIds)] });

    const partyChanges: PartyChanges = {};
    if (name !== undefined) partyChanges.name = name;
    if (internalNote !== undefined) partyChanges.internalNote = internalNote;
    if (contact !== group.contactGuestId) partyChanges.contactGuestId = contact;
    if (plusOneSlots !== undefined && plusOneSlots !== plusOnes.length)
      partyChanges.plusOneSlots = plusOneSlots;
    const delivery = deliveryStatusAfter({
      current: group.deliveryStatus,
      firstViewedAt: group.firstViewedAt,
      members: after,
    });
    if (delivery !== group.deliveryStatus) partyChanges.deliveryStatus = delivery;
    await this.groups.updateParty({ partyId, changes: partyChanges });

    await this.parties.applyStats({
      weddingId,
      delta: this.statsDelta({
        group,
        edits,
        entering: [...added, ...newSlots],
        removedSlots,
        after,
      }),
    });

    // Quem já respondeu: o log leva só os nomes dos campos e os ids (186(6)).
    for (const edit of edits) {
      if (edit.member.rsvpStatus === 'pending') continue;
      const fields: string[] = GUEST_FIELDS.filter(
        (field) => field in edit.changes && edit.changes[field] !== edit.member[field],
      );
      if (edit.tagIds && !sameSet(edit.tagIds, edit.member.tagIds)) fields.push('tags');
      if (fields.length === 0) continue;
      await this.log.record({
        entry: {
          action: 'guest.updated',
          actorKind: 'user',
          actorUserId: userId,
          weddingId,
          entityType: 'guest',
          entityId: edit.member.id,
          data: { partyId, fields },
          ...(ip ? { ip } : {}),
        },
      });
    }

    const row = await this.reader.findActive({ weddingId, partyId });
    if (!row) throw new PartyNotFoundError();
    return toPartyView({ row, links: this.links });
  }

  /** O telefone pelo parser único (RN04): undefined não muda, null apaga. */
  private phoneOf({
    input,
    index,
    issues,
  }: {
    input: UpdatePartyGuestInput;
    index: number;
    issues: FieldIssue[];
  }): string | null | undefined {
    if (input.phone === undefined || input.phone === null) return input.phone;
    const parsed = parsePhone({ raw: input.phone });
    if (parsed.ok) return parsed.e164;
    issues.push({ path: `guests.${index}.phone`, code: parsed.code, params: parsed.params });
    return undefined;
  }

  /**
   * RN16: entram os novos e as vagas novas (pendentes), saem as vagas vazias
   * apagadas; a faixa etária de um confirmado move a contagem; o grupo conta
   * como pendente se passou a ter ou deixou de ter pendente.
   */
  private statsDelta({
    group,
    edits,
    entering,
    removedSlots,
    after,
  }: {
    group: { members: GroupMemberRow[] };
    edits: { member: GroupMemberRow; changes: GuestChanges }[];
    entering: readonly NewGuest[];
    removedSlots: readonly GroupMemberRow[];
    after: readonly { rsvpStatus: GroupMemberRow['rsvpStatus'] }[];
  }): StatsDelta {
    const parts: StatsDelta[] = [
      guestsDelta({
        guests: entering.map((guest) => ({ rsvpStatus: 'pending', ageGroup: guest.ageGroup })),
        sign: 1,
      }),
      guestsDelta({ guests: removedSlots, sign: -1 }),
    ];
    for (const { member, changes } of edits) {
      if (member.rsvpStatus !== 'confirmed' || changes.ageGroup === undefined) continue;
      if (changes.ageGroup === member.ageGroup) continue;
      parts.push(guestsDelta({ guests: [member], sign: -1 }));
      parts.push(guestsDelta({ guests: [{ ...member, ageGroup: changes.ageGroup }], sign: 1 }));
    }
    const before = hasPending({ members: group.members });
    const now = after.some((member) => member.rsvpStatus === 'pending');
    parts.push({ partiesPending: Number(now) - Number(before) });
    return sumDeltas(parts);
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((value) => right.has(value));
}

export function sumDeltas(deltas: readonly StatsDelta[]): StatsDelta {
  const total: Record<string, number> = {};
  for (const delta of deltas)
    for (const [field, value] of Object.entries(delta) as [string, number | undefined][])
      total[field] = (total[field] ?? 0) + (value ?? 0);
  return total;
}
