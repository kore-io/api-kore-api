import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type {
  TrashedGuestRow,
  TrashedPartyRow,
  TrashedTagRow,
  TrashListRow,
  TrashStore,
} from '../application/ports/trash-store.port';

const GUEST_SELECT = {
  id: true,
  partyId: true,
  name: true,
  isPlusOne: true,
  rsvpStatus: true,
  ageGroup: true,
  phone: true,
  email: true,
  trashBatchId: true,
  deletedAt: true,
} as const;

type GuestRecord = Prisma.GuestGetPayload<{ select: typeof GUEST_SELECT }>;

function toTrashedGuest(guest: GuestRecord): TrashedGuestRow {
  return { ...guest, deletedAt: guest.deletedAt as Date };
}

function isNameTaken(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    JSON.stringify(error.meta ?? {}).includes('uq_tags_wedding_id_name_active')
  );
}

/** Na transação da requisição, com a RLS ligada. */
@Injectable()
export class PrismaTrashStore implements TrashStore {
  constructor(private readonly tenant: TenantTransaction) {}

  async weddingTimezone({ weddingId }: { weddingId: string }): Promise<string | null> {
    const wedding = await this.tenant.client().wedding.findFirst({
      where: { id: weddingId },
      select: { timezone: true },
    });
    return wedding?.timezone ?? null;
  }

  async trashParty({
    partyId,
    batchId,
    now,
  }: {
    partyId: string;
    batchId: string;
    now: Date;
  }): Promise<void> {
    const tx = this.tenant.client();
    // Quem já estava na lixeira, sozinho, fica com o dele (RN03).
    await tx.guest.updateMany({
      where: { partyId, deletedAt: null },
      data: { deletedAt: now, trashBatchId: batchId },
    });
    // A versão sobe (RSVP RN11): o formulário aberto não grava por cima.
    await tx.party.updateMany({
      where: { id: partyId },
      data: { deletedAt: now, version: { increment: 1 } },
    });
  }

  async trashGuest({ guestId, now }: { guestId: string; now: Date }): Promise<void> {
    await this.tenant.client().guest.updateMany({
      where: { id: guestId, deletedAt: null },
      data: { deletedAt: now },
    });
  }

  async trashTag({
    weddingId,
    tagId,
    now,
  }: {
    weddingId: string;
    tagId: string;
    now: Date;
  }): Promise<boolean> {
    const { count } = await this.tenant.client().tag.updateMany({
      where: { id: tagId, weddingId, deletedAt: null },
      data: { deletedAt: now },
    });
    return count > 0;
  }

  async list({ weddingId }: { weddingId: string }): Promise<TrashListRow[]> {
    const tx = this.tenant.client();
    const [parties, guests, tags] = await Promise.all([
      tx.$queryRaw<{ id: string; name: string; guests: number; deleted_at: Date }[]>`
        SELECT p.id, p.name, p.deleted_at,
          (SELECT count(*)::int FROM guests g
            WHERE g.party_id = p.id AND g.trash_batch_id IS NOT NULL AND g.name IS NOT NULL) AS guests
        FROM parties p
        WHERE p.wedding_id = ${weddingId}::uuid AND p.deleted_at IS NOT NULL`,
      // Quem foi junto com o grupo está dentro do item do grupo (RN08).
      tx.guest.findMany({
        where: { weddingId, deletedAt: { not: null }, trashBatchId: null },
        select: { id: true, name: true, deletedAt: true, party: { select: { name: true } } },
      }),
      this.trashedTags({ weddingId }),
    ]);
    return [
      ...parties.map((party) => ({
        type: 'party' as const,
        id: party.id,
        name: party.name,
        guests: party.guests,
        deletedAt: party.deleted_at,
      })),
      ...guests.map((guest) => ({
        type: 'guest' as const,
        id: guest.id,
        name: guest.name ?? '',
        partyName: guest.party.name,
        deletedAt: guest.deletedAt as Date,
      })),
      ...tags.map((tag) => ({ type: 'tag' as const, ...tag })),
    ].sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
  }

  async findTrashedParty({
    weddingId,
    partyId,
  }: {
    weddingId: string;
    partyId: string;
  }): Promise<TrashedPartyRow | null> {
    const party = await this.tenant.client().party.findFirst({
      where: { id: partyId, weddingId, deletedAt: { not: null } },
      select: {
        id: true,
        name: true,
        deletedAt: true,
        guests: { where: { trashBatchId: { not: null } }, select: GUEST_SELECT },
      },
    });
    if (!party) return null;
    return {
      id: party.id,
      name: party.name,
      deletedAt: party.deletedAt as Date,
      batch: party.guests.map(toTrashedGuest),
    };
  }

  async findTrashedGuest({
    weddingId,
    guestId,
  }: {
    weddingId: string;
    guestId: string;
  }): Promise<TrashedGuestRow | null> {
    const guest = await this.tenant.client().guest.findFirst({
      where: { id: guestId, weddingId, deletedAt: { not: null } },
      select: GUEST_SELECT,
    });
    return guest ? toTrashedGuest(guest) : null;
  }

  async findTrashedTag({
    weddingId,
    tagId,
  }: {
    weddingId: string;
    tagId: string;
  }): Promise<TrashedTagRow | null> {
    const [tag] = await this.trashedTags({ weddingId, tagId });
    return tag ?? null;
  }

  async activeTagNamed({
    weddingId,
    name,
  }: {
    weddingId: string;
    name: string;
  }): Promise<string | null> {
    const tag = await this.tenant.client().tag.findFirst({
      where: { weddingId, deletedAt: null, name: { equals: name, mode: 'insensitive' } },
      select: { name: true },
    });
    return tag?.name ?? null;
  }

  async restoreParty({
    partyId,
    guestIds,
  }: {
    partyId: string;
    guestIds: readonly string[];
  }): Promise<void> {
    const tx = this.tenant.client();
    await tx.party.updateMany({
      where: { id: partyId },
      data: { deletedAt: null, version: { increment: 1 } },
    });
    if (guestIds.length > 0)
      await tx.guest.updateMany({
        where: { id: { in: [...guestIds] } },
        data: { deletedAt: null, trashBatchId: null },
      });
  }

  async restoreGuest({
    guestId,
    asRegular,
  }: {
    guestId: string;
    asRegular: boolean;
  }): Promise<void> {
    await this.tenant.client().guest.updateMany({
      where: { id: guestId },
      data: { deletedAt: null, trashBatchId: null, ...(asRegular ? { isPlusOne: false } : {}) },
    });
  }

  async restoreTag({ tagId }: { tagId: string }): Promise<'restored' | 'name_taken'> {
    const tx = this.tenant.client();
    await tx.$executeRaw`SAVEPOINT tag_restore`;
    try {
      await tx.tag.updateMany({ where: { id: tagId }, data: { deletedAt: null } });
      await tx.$executeRaw`RELEASE SAVEPOINT tag_restore`;
      return 'restored';
    } catch (error) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT tag_restore`;
      if (isNameTaken(error)) return 'name_taken';
      throw error;
    }
  }

  /** As tags na lixeira, com a contagem pelos vínculos guardados (Tags RN05). */
  private trashedTags({
    weddingId,
    tagId,
  }: {
    weddingId: string;
    tagId?: string;
  }): Promise<TrashedTagRow[]> {
    const one = tagId ? Prisma.sql`AND t.id = ${tagId}::uuid` : Prisma.empty;
    return this.tenant.client().$queryRaw<TrashedTagRow[]>`
      SELECT t.id, t.name, t.deleted_at AS "deletedAt",
        (SELECT count(*)::int FROM guests g
           JOIN parties p ON p.id = g.party_id AND p.deleted_at IS NULL
          WHERE g.wedding_id = t.wedding_id AND g.deleted_at IS NULL AND g.name IS NOT NULL
            AND (EXISTS (SELECT 1 FROM guest_tags gt WHERE gt.guest_id = g.id AND gt.tag_id = t.id)
                 OR EXISTS (SELECT 1 FROM party_tags pt WHERE pt.party_id = g.party_id AND pt.tag_id = t.id))
        ) AS guests
      FROM tags t
      WHERE t.wedding_id = ${weddingId}::uuid AND t.deleted_at IS NOT NULL ${one}`;
  }
}
