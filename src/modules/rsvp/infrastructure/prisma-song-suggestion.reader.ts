import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type {
  SongSuggestionReader,
  SongSuggestionRow,
  SongWedding,
} from '../application/ports/song-suggestion-reader.port';

/** Na transação da requisição, com a RLS ligada; usa o índice parcial da lista de músicas. */
@Injectable()
export class PrismaSongSuggestionReader implements SongSuggestionReader {
  constructor(private readonly tenant: TenantTransaction) {}

  wedding({ weddingId }: { weddingId: string }): Promise<SongWedding | null> {
    return this.tenant.client().wedding.findFirst({
      where: { id: weddingId },
      select: { songQuestionEnabled: true, slug: true, timezone: true },
    });
  }

  async list({
    weddingId,
    after,
    limit,
  }: {
    weddingId: string;
    after: { suggestedAt: Date; guestId: string } | null;
    limit: number | null;
  }): Promise<SongSuggestionRow[]> {
    const cursor = after
      ? Prisma.sql`AND (g.song_suggested_at, g.id) > (${after.suggestedAt}, ${after.guestId}::uuid)`
      : Prisma.empty;
    const take = limit === null ? Prisma.empty : Prisma.sql`LIMIT ${limit}`;
    return this.tenant.client().$queryRaw<SongSuggestionRow[]>`
      SELECT g.id AS "guestId", g.song_suggestion AS song, g.name AS "guestName",
             p.name AS "partyName", g.song_suggested_at AS "suggestedAt"
      FROM guests g
      JOIN parties p ON p.id = g.party_id AND p.deleted_at IS NULL
      WHERE g.wedding_id = ${weddingId}::uuid AND g.deleted_at IS NULL
        AND g.song_suggestion IS NOT NULL AND g.rsvp_status = 'confirmed' ${cursor}
      ORDER BY g.song_suggested_at, g.id
      ${take}`;
  }

  async count({ weddingId }: { weddingId: string }): Promise<number> {
    const [{ count }] = await this.tenant.client().$queryRaw<[{ count: number }]>`
      SELECT count(*)::int AS count
      FROM guests g
      JOIN parties p ON p.id = g.party_id AND p.deleted_at IS NULL
      WHERE g.wedding_id = ${weddingId}::uuid AND g.deleted_at IS NULL
        AND g.song_suggestion IS NOT NULL AND g.rsvp_status = 'confirmed'`;
    return count;
  }
}
