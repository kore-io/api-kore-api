import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type { NewParty, PartyStore } from '../application/ports/party-store.port';
import type { StatsDelta } from '../domain/wedding-stats';

/**
 * Na transação da requisição, com a RLS ligada. Sem RETURNING nas inclusões
 * (createMany): a leitura do grupo novo vem depois, pelo leitor.
 */
@Injectable()
export class PrismaPartyStore implements PartyStore {
  constructor(private readonly tenant: TenantTransaction) {}

  async findActiveTagIds({
    weddingId,
    tagIds,
  }: {
    weddingId: string;
    tagIds: readonly string[];
  }): Promise<string[]> {
    if (tagIds.length === 0) return [];
    const tags = await this.tenant.client().tag.findMany({
      where: { weddingId, id: { in: [...tagIds] }, deletedAt: null },
      select: { id: true },
    });
    return tags.map((tag) => tag.id);
  }

  async create({ party }: { party: NewParty }): Promise<void> {
    const tx = this.tenant.client();
    // O contato aponta para um convidado que entra logo abaixo: a FK do contato
    // é DEFERRABLE e só confere no commit (migration guests).
    await tx.party.createMany({
      data: {
        id: party.id,
        weddingId: party.weddingId,
        name: party.name,
        internalNote: party.internalNote,
        linkToken: party.linkToken,
        contactGuestId: party.contactGuestId,
        plusOneSlots: party.guests.filter((guest) => guest.isPlusOne).length,
        createdAt: party.now,
      },
    });
    await tx.guest.createMany({
      data: party.guests.map((guest) => ({
        id: guest.id,
        weddingId: party.weddingId,
        partyId: party.id,
        name: guest.name,
        ageGroup: guest.ageGroup,
        phone: guest.phone,
        email: guest.email,
        isPlusOne: guest.isPlusOne,
        joinedPartyAt: party.now,
        createdAt: party.now,
      })),
    });
    if (party.tagIds.length > 0)
      await tx.partyTag.createMany({
        data: party.tagIds.map((tagId) => ({
          weddingId: party.weddingId,
          partyId: party.id,
          tagId,
        })),
      });
  }

  async regenerateLink({
    weddingId,
    partyId,
    linkToken,
    now,
  }: {
    weddingId: string;
    partyId: string;
    linkToken: string;
    now: Date;
  }): Promise<{ linkToken: string; regeneratedAt: Date } | null> {
    const { count } = await this.tenant.client().party.updateMany({
      where: { id: partyId, weddingId, deletedAt: null },
      data: { linkToken, linkVersion: { increment: 1 }, linkRegeneratedAt: now },
    });
    return count === 0 ? null : { linkToken, regeneratedAt: now };
  }

  async applyStats({ weddingId, delta }: { weddingId: string; delta: StatsDelta }): Promise<void> {
    const data: Record<string, { increment: number }> = {};
    for (const [field, value] of Object.entries(delta) as [string, number | undefined][])
      if (value) data[field] = { increment: value };
    if (Object.keys(data).length === 0) return;
    await this.tenant.client().weddingStats.updateMany({ where: { weddingId }, data });
  }
}
