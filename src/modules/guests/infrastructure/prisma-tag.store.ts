import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type { TagRow, TagStore } from '../application/ports/tag-store.port';
import type { TagColor } from '../domain/party';

/** O nome repetido entre as tags ativas bate no índice único parcial (migration guests). */
function isNameTaken(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    JSON.stringify(error.meta ?? {}).includes('uq_tags_wedding_id_name_active')
  );
}

/** Na transação da requisição, com a RLS ligada. */
@Injectable()
export class PrismaTagStore implements TagStore {
  constructor(private readonly tenant: TenantTransaction) {}

  async lockWeddingTags({ weddingId }: { weddingId: string }): Promise<void> {
    // Lock consultivo pelo casamento: não segura a linha do weddings, que toda
    // requisição atualiza (lastActivityAt).
    await this.tenant.client()
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wedding-tags:${weddingId}`}, 0))`;
  }

  countActive({ weddingId }: { weddingId: string }): Promise<number> {
    return this.tenant.client().tag.count({ where: { weddingId, deletedAt: null } });
  }

  listActive({ weddingId }: { weddingId: string }): Promise<TagRow[]> {
    return this.query({ weddingId });
  }

  async findActive({
    weddingId,
    tagId,
  }: {
    weddingId: string;
    tagId: string;
  }): Promise<TagRow | null> {
    const [tag] = await this.query({ weddingId, tagId });
    return tag ?? null;
  }

  async create({
    id,
    weddingId,
    name,
    color,
  }: {
    id: string;
    weddingId: string;
    name: string;
    color: TagColor | null;
  }): Promise<'created' | 'name_taken'> {
    // Um SAVEPOINT: o conflito do índice não pode abortar a transação da requisição.
    const tx = this.tenant.client();
    await tx.$executeRaw`SAVEPOINT tag_create`;
    try {
      await tx.tag.createMany({ data: { id, weddingId, name, color } });
      await tx.$executeRaw`RELEASE SAVEPOINT tag_create`;
      return 'created';
    } catch (error) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT tag_create`;
      if (isNameTaken(error)) return 'name_taken';
      throw error;
    }
  }

  async update({
    weddingId,
    tagId,
    name,
    color,
  }: {
    weddingId: string;
    tagId: string;
    name?: string;
    color?: TagColor | null;
  }): Promise<'updated' | 'not_found' | 'name_taken'> {
    const tx = this.tenant.client();
    await tx.$executeRaw`SAVEPOINT tag_update`;
    try {
      const { count } = await tx.tag.updateMany({
        where: { id: tagId, weddingId, deletedAt: null },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(color !== undefined ? { color } : {}),
        },
      });
      await tx.$executeRaw`RELEASE SAVEPOINT tag_update`;
      return count === 0 ? 'not_found' : 'updated';
    } catch (error) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT tag_update`;
      if (isNameTaken(error)) return 'name_taken';
      throw error;
    }
  }

  async findActivePartyIds({
    weddingId,
    partyIds,
  }: {
    weddingId: string;
    partyIds: readonly string[];
  }): Promise<string[]> {
    const parties = await this.tenant.client().party.findMany({
      where: { weddingId, id: { in: [...partyIds] }, deletedAt: null },
      select: { id: true },
    });
    return parties.map((party) => party.id);
  }

  async applyToParties({
    weddingId,
    tagId,
    partyIds,
  }: {
    weddingId: string;
    tagId: string;
    partyIds: readonly string[];
  }): Promise<void> {
    await this.tenant.client().partyTag.createMany({
      data: partyIds.map((partyId) => ({ weddingId, partyId, tagId })),
      skipDuplicates: true,
    });
  }

  /**
   * As tags com a contagem da RN05: convidados ativos (de grupo ativo) com a
   * tag ou num grupo com a tag, cada pessoa uma vez; a vaga vazia (sem nome,
   * em qualquer resposta) não conta.
   */
  private query({ weddingId, tagId }: { weddingId: string; tagId?: string }): Promise<TagRow[]> {
    const one = tagId ? Prisma.sql`AND t.id = ${tagId}::uuid` : Prisma.empty;
    return this.tenant.client().$queryRaw<TagRow[]>`
      SELECT t.id, t.name, t.color::text AS color,
        (SELECT count(*)::int FROM guests g
           JOIN parties p ON p.id = g.party_id AND p.deleted_at IS NULL
          WHERE g.wedding_id = t.wedding_id AND g.deleted_at IS NULL AND g.name IS NOT NULL
            AND (EXISTS (SELECT 1 FROM guest_tags gt WHERE gt.guest_id = g.id AND gt.tag_id = t.id)
                 OR EXISTS (SELECT 1 FROM party_tags pt WHERE pt.party_id = g.party_id AND pt.tag_id = t.id))
        ) AS guests
      FROM tags t
      WHERE t.wedding_id = ${weddingId}::uuid AND t.deleted_at IS NULL ${one}
      ORDER BY lower(f_unaccent(t.name)), t.id`;
  }
}
