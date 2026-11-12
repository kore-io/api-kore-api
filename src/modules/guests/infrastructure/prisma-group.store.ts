import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type {
  GroupMemberRow,
  GroupRow,
  GroupStore,
  GuestChanges,
  PartyChanges,
} from '../application/ports/group-store.port';
import type { NewGuest } from '../application/ports/party-store.port';

const MEMBER_SELECT = {
  id: true,
  partyId: true,
  name: true,
  isPlusOne: true,
  rsvpStatus: true,
  ageGroup: true,
  phone: true,
  email: true,
  tags: {
    where: { tag: { deletedAt: null } },
    select: { tagId: true },
    orderBy: { createdAt: 'asc' },
  },
} as const;

type MemberRecord = Prisma.GuestGetPayload<{ select: typeof MEMBER_SELECT }>;

function toMember({ tags, ...guest }: MemberRecord): GroupMemberRow {
  return { ...guest, tagIds: tags.map((tag) => tag.tagId) };
}

/** Na transação da requisição, com a RLS ligada. */
@Injectable()
export class PrismaGroupStore implements GroupStore {
  constructor(private readonly tenant: TenantTransaction) {}

  async lock({
    weddingId,
    partyIds,
  }: {
    weddingId: string;
    partyIds: readonly string[];
  }): Promise<void> {
    const ids = [...new Set(partyIds)].sort();
    await this.tenant.client().$queryRaw`
      SELECT id FROM parties
      WHERE wedding_id = ${weddingId}::uuid AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY id FOR UPDATE`;
  }

  async load({
    weddingId,
    partyId,
  }: {
    weddingId: string;
    partyId: string;
  }): Promise<GroupRow | null> {
    const party = await this.tenant.client().party.findFirst({
      where: { id: partyId, weddingId, deletedAt: null },
      select: {
        id: true,
        name: true,
        internalNote: true,
        contactGuestId: true,
        plusOneSlots: true,
        deliveryStatus: true,
        firstViewedAt: true,
        guests: {
          where: { deletedAt: null },
          orderBy: [{ isPlusOne: 'asc' }, { joinedPartyAt: 'asc' }, { id: 'asc' }],
          select: MEMBER_SELECT,
        },
      },
    });
    if (!party) return null;
    const { guests, ...rest } = party;
    return { ...rest, members: guests.map(toMember) };
  }

  async findGuest({
    weddingId,
    guestId,
  }: {
    weddingId: string;
    guestId: string;
  }): Promise<GroupMemberRow | null> {
    const guest = await this.tenant.client().guest.findFirst({
      where: { id: guestId, weddingId, deletedAt: null },
      select: MEMBER_SELECT,
    });
    return guest ? toMember(guest) : null;
  }

  async updateParty({
    partyId,
    changes,
  }: {
    partyId: string;
    changes: PartyChanges;
  }): Promise<void> {
    const { bumpVersion, ...fields } = changes;
    if (Object.keys(fields).length === 0 && !bumpVersion) return;
    await this.tenant.client().party.updateMany({
      where: { id: partyId },
      data: { ...fields, ...(bumpVersion ? { version: { increment: 1 } } : {}) },
    });
  }

  async updateGuest({
    guestId,
    changes,
  }: {
    guestId: string;
    changes: GuestChanges;
  }): Promise<void> {
    if (Object.keys(changes).length === 0) return;
    await this.tenant.client().guest.updateMany({ where: { id: guestId }, data: changes });
  }

  async addGuests({
    weddingId,
    partyId,
    guests,
    now,
  }: {
    weddingId: string;
    partyId: string;
    guests: readonly NewGuest[];
    now: Date;
  }): Promise<void> {
    if (guests.length === 0) return;
    await this.tenant.client().guest.createMany({
      data: guests.map((guest) => ({
        ...guest,
        weddingId,
        partyId,
        joinedPartyAt: now,
        createdAt: now,
      })),
    });
  }

  async deleteEmptySlots({ guestIds }: { guestIds: readonly string[] }): Promise<void> {
    if (guestIds.length === 0) return;
    await this.tenant.client().guest.deleteMany({
      where: { id: { in: [...guestIds] }, isPlusOne: true, name: null, rsvpStatus: 'pending' },
    });
  }

  async replacePartyTags({
    weddingId,
    partyId,
    tagIds,
  }: {
    weddingId: string;
    partyId: string;
    tagIds: readonly string[];
  }): Promise<void> {
    const tx = this.tenant.client();
    // Só os vínculos com tags ativas: os de uma tag na lixeira ficam guardados
    // para a restauração dela (Lixeira RN05).
    await tx.partyTag.deleteMany({ where: { partyId, tag: { deletedAt: null } } });
    if (tagIds.length > 0)
      await tx.partyTag.createMany({
        data: tagIds.map((tagId) => ({ weddingId, partyId, tagId })),
        skipDuplicates: true,
      });
  }

  async replaceGuestTags({
    weddingId,
    guestId,
    tagIds,
  }: {
    weddingId: string;
    guestId: string;
    tagIds: readonly string[];
  }): Promise<void> {
    const tx = this.tenant.client();
    await tx.guestTag.deleteMany({ where: { guestId, tag: { deletedAt: null } } });
    if (tagIds.length > 0)
      await tx.guestTag.createMany({
        data: tagIds.map((tagId) => ({ weddingId, guestId, tagId })),
        skipDuplicates: true,
      });
  }
}
