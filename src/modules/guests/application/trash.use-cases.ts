import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import {
  AlreadyRespondedError,
  EmptyPlusOneError,
  GuestFieldsInvalidError,
  GuestNotFoundError,
  LastGuestError,
  PartyNotFoundError,
  TagLimitReachedError,
  TagNameTakenError,
  TagNotFoundError,
  TrashItemNotFoundError,
  type FieldIssue,
} from '../domain/guests.errors';
import { canBeContact, TAGS_PER_WEDDING_MAX } from '../domain/party';
import {
  contactAfter,
  deliveryStatusAfter,
  hasPending,
  isEmptySlot,
  type GroupMember,
} from '../domain/party-rules';
import { purgeAt } from '../domain/trash';
import { guestsDelta } from '../domain/wedding-stats';
import {
  GROUP_STORE,
  type GroupRow,
  type GroupStore,
  type PartyChanges,
} from './ports/group-store.port';
import { PARTY_STORE, type PartyStore } from './ports/party-store.port';
import { TAG_STORE, type TagStore } from './ports/tag-store.port';
import {
  TRASH_STORE,
  type TrashedGuestRow,
  type TrashListRow,
  type TrashStore,
} from './ports/trash-store.port';
import { sumDeltas } from './update-party.use-case';

/** Algum convidado do grupo (ou ele mesmo) já confirmou ou recusou (Lixeira RN07). */
function responded(members: readonly Pick<GroupMember, 'rsvpStatus'>[]): boolean {
  return members.some((member) => member.rsvpStatus !== 'pending');
}

interface LogContext {
  userId: string;
  weddingId: string;
  ip: string | null;
}

/**
 * O que as escritas da lixeira têm em comum: a autorização (manage_guests e,
 * para quem já respondeu, trash_responded), os locks na ordem das outras
 * escritas (números do casamento, depois grupos) e o log só com ids (RN11).
 */
@Injectable()
export class TrashSupport {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(PARTY_STORE) readonly parties: PartyStore,
    @Inject(GROUP_STORE) readonly groups: GroupStore,
    @Inject(TRASH_STORE) readonly trash: TrashStore,
    @Inject(APPLICATION_LOG_WRITER) private readonly log: ApplicationLogWriter,
  ) {}

  async begin({ userId, weddingId }: { userId: string; weddingId: string }): Promise<void> {
    await this.authorization.require({ userId, weddingId, action: 'manage_guests' });
    await this.parties.lockStats({ weddingId });
  }

  /** Quem pode tirar quem já respondeu: só o dono (184(15)). */
  canTrashResponded({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<boolean> {
    return this.authorization.can({ userId, weddingId, action: 'trash_responded' });
  }

  async record({
    context,
    action,
    entityType,
    entityId,
    data,
  }: {
    context: LogContext;
    action: string;
    entityType: string;
    entityId: string;
    data?: Record<string, unknown>;
  }): Promise<void> {
    await this.log.record({
      entry: {
        action,
        actorKind: 'user',
        actorUserId: context.userId,
        weddingId: context.weddingId,
        entityType,
        entityId,
        ...(data ? { data } : {}),
        ...(context.ip ? { ip: context.ip } : {}),
      },
    });
  }

  /** Manda o grupo e os convidados ativos dele para a lixeira (RN03) e acerta os números. */
  async trashGroup({
    context,
    group,
    now,
  }: {
    context: LogContext;
    group: GroupRow;
    now: Date;
  }): Promise<void> {
    const trashBatchId = uuidV7({ now: now.getTime() });
    await this.trash.trashParty({ partyId: group.id, batchId: trashBatchId, now });
    await this.parties.applyStats({
      weddingId: context.weddingId,
      delta: sumDeltas([
        guestsDelta({ guests: group.members, sign: -1 }),
        { partiesPending: hasPending({ members: group.members }) ? -1 : 0 },
      ]),
    });
    await this.record({
      context,
      action: 'party.deleted',
      entityType: 'party',
      entityId: group.id,
      data: { trashBatchId },
    });
  }
}

export interface TrashedPartyView {
  id: string;
  name: string;
  /** Os convidados com nome que foram com ele. */
  guests: number;
  deletedAt: Date;
  purgeAt: string;
}

/**
 * Mover o grupo para a lixeira (Lixeira RN01, RN03 e RN07), numa transação:
 * o grupo e todos os convidados e vagas ativos com o mesmo trashBatchId, os
 * números do casamento e party.deleted no log.
 */
@Injectable()
export class TrashParty {
  constructor(private readonly support: TrashSupport) {}

  async execute({
    userId,
    weddingId,
    partyId,
    ip,
    now,
  }: {
    userId: string;
    weddingId: string;
    partyId: string;
    ip: string | null;
    now: Date;
  }): Promise<TrashedPartyView> {
    const { support } = this;
    await support.begin({ userId, weddingId });
    await support.groups.lock({ weddingId, partyIds: [partyId] });
    const group = await support.groups.load({ weddingId, partyId });
    if (!group) throw new PartyNotFoundError();
    if (responded(group.members) && !(await support.canTrashResponded({ userId, weddingId })))
      throw new AlreadyRespondedError();

    await support.trashGroup({ context: { userId, weddingId, ip }, group, now });
    const timezone = await support.trash.weddingTimezone({ weddingId });
    return {
      id: group.id,
      name: group.name,
      guests: group.members.filter((member) => member.name !== null).length,
      deletedAt: now,
      purgeAt: purgeAt({ deletedAt: now, timezone }),
    };
  }
}

/**
 * Seleção múltipla, Mover para a lixeira (RN06): os grupos marcados numa
 * transação, cada um com o seu trashBatchId. Um id que não é de grupo ativo do
 * casamento recusa tudo; para o colaborador, quem já respondeu fica e volta em
 * skipped (RN07).
 */
@Injectable()
export class TrashParties {
  constructor(private readonly support: TrashSupport) {}

  async execute({
    userId,
    weddingId,
    partyIds,
    ip,
    now,
  }: {
    userId: string;
    weddingId: string;
    partyIds: readonly string[];
    ip: string | null;
    now: Date;
  }): Promise<{
    trashed: number;
    skipped: { id: string; name: string; reason: 'ALREADY_RESPONDED' }[];
  }> {
    const { support } = this;
    await support.begin({ userId, weddingId });
    const unique = [...new Set(partyIds)];
    await support.groups.lock({ weddingId, partyIds: unique });
    const groups = new Map<string, GroupRow>();
    for (const partyId of unique) {
      const group = await support.groups.load({ weddingId, partyId });
      if (group) groups.set(partyId, group);
    }
    const issues: FieldIssue[] = [];
    partyIds.forEach((partyId, index) => {
      if (!groups.has(partyId))
        issues.push({ path: `partyIds.${index}`, code: 'PARTY_NOT_FOUND', params: {} });
    });
    if (issues.length > 0) throw new GuestFieldsInvalidError({ issues });

    const owner = await support.canTrashResponded({ userId, weddingId });
    const skipped: { id: string; name: string; reason: 'ALREADY_RESPONDED' }[] = [];
    let trashed = 0;
    for (const group of groups.values()) {
      if (!owner && responded(group.members)) {
        skipped.push({ id: group.id, name: group.name, reason: 'ALREADY_RESPONDED' });
        continue;
      }
      await support.trashGroup({ context: { userId, weddingId, ip }, group, now });
      trashed += 1;
    }
    return { trashed, skipped };
  }
}

/**
 * Mover o convidado para a lixeira (Lixeira RN04 e RN07): o último com nome
 * não sai (Grupos RN08); vaga vazia não vai (diminui-se as vagas); o contato
 * passa ao próximo (RN06); o acompanhante com nome leva a vaga (186(9)); o
 * status de envio e os números são recalculados.
 */
@Injectable()
export class TrashGuest {
  constructor(private readonly support: TrashSupport) {}

  async execute({
    userId,
    weddingId,
    guestId,
    ip,
    now,
  }: {
    userId: string;
    weddingId: string;
    guestId: string;
    ip: string | null;
    now: Date;
  }): Promise<{ id: string; name: string; partyId: string; deletedAt: Date; purgeAt: string }> {
    const { support } = this;
    await support.begin({ userId, weddingId });
    const found = await support.groups.findGuest({ weddingId, guestId });
    if (!found) throw new GuestNotFoundError();
    await support.groups.lock({ weddingId, partyIds: [found.partyId] });
    const group = await support.groups.load({ weddingId, partyId: found.partyId });
    const guest = group?.members.find((member) => member.id === guestId);
    if (!group || !guest) throw new GuestNotFoundError();
    if (isEmptySlot(guest)) throw new EmptyPlusOneError();
    if (group.members.filter((member) => member.name !== null).length <= 1)
      throw new LastGuestError();
    if (responded([guest]) && !(await support.canTrashResponded({ userId, weddingId })))
      throw new AlreadyRespondedError();

    await support.trash.trashGuest({ guestId, now });
    const after = group.members.filter((member) => member.id !== guestId);
    const changes: PartyChanges = {};
    const contact = contactAfter({ currentContactId: group.contactGuestId, members: after });
    if (contact !== group.contactGuestId) changes.contactGuestId = contact;
    if (guest.isPlusOne) changes.plusOneSlots = group.plusOneSlots - 1;
    const delivery = deliveryStatusAfter({
      current: group.deliveryStatus,
      firstViewedAt: group.firstViewedAt,
      members: after,
    });
    if (delivery !== group.deliveryStatus) changes.deliveryStatus = delivery;
    await support.groups.updateParty({ partyId: group.id, changes });
    await support.parties.applyStats({
      weddingId,
      delta: sumDeltas([
        guestsDelta({ guests: [guest], sign: -1 }),
        {
          partiesPending:
            Number(hasPending({ members: after })) - Number(hasPending({ members: group.members })),
        },
      ]),
    });
    await support.record({
      context: { userId, weddingId, ip },
      action: 'guest.deleted',
      entityType: 'guest',
      entityId: guestId,
      data: { partyId: group.id },
    });
    const timezone = await support.trash.weddingTimezone({ weddingId });
    return {
      id: guestId,
      name: guest.name ?? '',
      partyId: group.id,
      deletedAt: now,
      purgeAt: purgeAt({ deletedAt: now, timezone }),
    };
  }
}

/**
 * Excluir a tag (Lixeira RN05): a tag sai das listas, dos filtros e do limite
 * de 10; os vínculos ficam guardados. Sem o limite de trash_responded (RN07).
 */
@Injectable()
export class TrashTag {
  constructor(
    private readonly support: TrashSupport,
    @Inject(TAG_STORE) private readonly tags: TagStore,
  ) {}

  async execute({
    userId,
    weddingId,
    tagId,
    ip,
    now,
  }: {
    userId: string;
    weddingId: string;
    tagId: string;
    ip: string | null;
    now: Date;
  }): Promise<{ id: string; name: string; guests: number; deletedAt: Date; purgeAt: string }> {
    const { support } = this;
    await support.begin({ userId, weddingId });
    const tag = await this.tags.findActive({ weddingId, tagId });
    if (!tag || !(await support.trash.trashTag({ weddingId, tagId, now })))
      throw new TagNotFoundError();
    await support.record({
      context: { userId, weddingId, ip },
      action: 'tag.deleted',
      entityType: 'tag',
      entityId: tagId,
    });
    const timezone = await support.trash.weddingTimezone({ weddingId });
    return {
      id: tag.id,
      name: tag.name,
      guests: tag.guests,
      deletedAt: now,
      purgeAt: purgeAt({ deletedAt: now, timezone }),
    };
  }
}

/** A tela Lixeira (RN08): todo item ainda não expurgado, do mais novo ao mais antigo. */
@Injectable()
export class ListTrash {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(TRASH_STORE) private readonly trash: TrashStore,
  ) {}

  async execute({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<(TrashListRow & { purgeAt: string })[]> {
    await this.authorization.require({ userId, weddingId, action: 'view' });
    const timezone = await this.trash.weddingTimezone({ weddingId });
    const rows = await this.trash.list({ weddingId });
    return rows.map((row) => ({
      ...row,
      purgeAt: purgeAt({ deletedAt: row.deletedAt, timezone }),
    }));
  }
}

export type RestoreResult = {
  type: 'party' | 'guest' | 'tag';
  id: string;
  name: string;
  restoredParty?: { id: string; name: string };
};

/**
 * Restaurar (Lixeira RN09), como estava: respostas, tags, vagas, observação e
 * link. O grupo traz os convidados do trashBatchId dele; o convidado de um
 * grupo na lixeira traz o grupo junto; a tag respeita o limite e o nome único.
 * Livre para todos que mexem na lista (RN07).
 */
@Injectable()
export class RestoreTrashItem {
  constructor(
    private readonly support: TrashSupport,
    @Inject(TAG_STORE) private readonly tags: TagStore,
  ) {}

  async execute({
    userId,
    weddingId,
    type,
    id,
    ip,
  }: {
    userId: string;
    weddingId: string;
    type: 'party' | 'guest' | 'tag';
    id: string;
    ip: string | null;
  }): Promise<RestoreResult> {
    const context = { userId, weddingId, ip };
    await this.support.begin({ userId, weddingId });
    if (type === 'tag') return this.restoreTag({ context, tagId: id });
    if (type === 'party') {
      await this.support.groups.lock({ weddingId, partyIds: [id] });
      const party = await this.restoreParty({ context, partyId: id });
      return { type, id, name: party.name };
    }
    return this.restoreGuest({ context, guestId: id });
  }

  private async restoreParty({
    context,
    partyId,
  }: {
    context: LogContext;
    partyId: string;
  }): Promise<{ id: string; name: string }> {
    const { support } = this;
    const party = await support.trash.findTrashedParty({ weddingId: context.weddingId, partyId });
    if (!party) throw new TrashItemNotFoundError();
    await support.trash.restoreParty({
      partyId,
      guestIds: party.batch.map((guest) => guest.id),
    });
    await support.parties.applyStats({
      weddingId: context.weddingId,
      delta: sumDeltas([
        guestsDelta({ guests: party.batch, sign: 1 }),
        { partiesPending: hasPending({ members: party.batch }) ? 1 : 0 },
      ]),
    });
    await support.record({
      context,
      action: 'party.restored',
      entityType: 'party',
      entityId: partyId,
    });
    return { id: party.id, name: party.name };
  }

  private async restoreGuest({
    context,
    guestId,
  }: {
    context: LogContext;
    guestId: string;
  }): Promise<RestoreResult> {
    const { support } = this;
    const { weddingId } = context;
    const guest = await support.trash.findTrashedGuest({ weddingId, guestId });
    // Quem foi junto com o grupo não é um item da lixeira: volta com o grupo (RN08).
    if (!guest || guest.trashBatchId !== null) throw new TrashItemNotFoundError();
    await support.groups.lock({ weddingId, partyIds: [guest.partyId] });

    let restoredParty: { id: string; name: string } | undefined;
    if (!(await support.groups.load({ weddingId, partyId: guest.partyId })))
      restoredParty = await this.restoreParty({ context, partyId: guest.partyId });
    const group = await support.groups.load({ weddingId, partyId: guest.partyId });
    if (!group) throw new TrashItemNotFoundError();

    // O acompanhante com nome volta como convidado comum, sem mudar as vagas.
    const asRegular = guest.isPlusOne;
    await support.trash.restoreGuest({ guestId, asRegular });
    const back = this.asMember({ guest, asRegular });
    const after = [...group.members, back];
    const changes: PartyChanges = {};
    // O contato só volta se o grupo estiver sem contato.
    if (group.contactGuestId === null && canBeContact(back)) changes.contactGuestId = guestId;
    const delivery = deliveryStatusAfter({
      current: group.deliveryStatus,
      firstViewedAt: group.firstViewedAt,
      members: after,
    });
    if (delivery !== group.deliveryStatus) changes.deliveryStatus = delivery;
    await support.groups.updateParty({ partyId: group.id, changes });
    await support.parties.applyStats({
      weddingId,
      delta: sumDeltas([
        guestsDelta({ guests: [guest], sign: 1 }),
        {
          partiesPending:
            Number(hasPending({ members: after })) - Number(hasPending({ members: group.members })),
        },
      ]),
    });
    await support.record({
      context,
      action: 'guest.restored',
      entityType: 'guest',
      entityId: guestId,
      data: { partyId: group.id },
    });
    return {
      type: 'guest',
      id: guestId,
      name: guest.name ?? '',
      ...(restoredParty ? { restoredParty } : {}),
    };
  }

  private async restoreTag({
    context,
    tagId,
  }: {
    context: LogContext;
    tagId: string;
  }): Promise<RestoreResult> {
    const { support } = this;
    const { weddingId } = context;
    await this.tags.lockWeddingTags({ weddingId });
    const tag = await support.trash.findTrashedTag({ weddingId, tagId });
    if (!tag) throw new TrashItemNotFoundError();
    if ((await this.tags.countActive({ weddingId })) >= TAGS_PER_WEDDING_MAX)
      throw new TagLimitReachedError();
    const conflictName = await support.trash.activeTagNamed({ weddingId, name: tag.name });
    if (conflictName) throw new TagNameTakenError({ conflictName });
    if ((await support.trash.restoreTag({ tagId })) === 'name_taken')
      throw new TagNameTakenError({ conflictName: tag.name });
    await support.record({ context, action: 'tag.restored', entityType: 'tag', entityId: tagId });
    return { type: 'tag', id: tagId, name: tag.name };
  }

  private asMember({
    guest,
    asRegular,
  }: {
    guest: TrashedGuestRow;
    asRegular: boolean;
  }): GroupMember {
    return {
      id: guest.id,
      name: guest.name,
      isPlusOne: asRegular ? false : guest.isPlusOne,
      rsvpStatus: guest.rsvpStatus,
      phone: guest.phone,
      email: guest.email,
    };
  }
}
