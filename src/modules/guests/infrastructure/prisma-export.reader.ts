import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type { ExportReader, ExportWedding } from '../application/ports/export-reader.port';
import type { ExportGuest, ExportWho } from '../domain/export';
import type { AgeGroup, RsvpStatus } from '../domain/party';
import { coupleNames } from '../../access/domain/invitation-acceptance';

/** Na transação da requisição, com a RLS ligada. */
@Injectable()
export class PrismaExportReader implements ExportReader {
  constructor(private readonly tenant: TenantTransaction) {}

  async wedding({ weddingId }: { weddingId: string }): Promise<ExportWedding | null> {
    const wedding = await this.tenant.client().wedding.findFirst({
      where: { id: weddingId },
      select: {
        slug: true,
        timezone: true,
        eventDate: true,
        city: true,
        state: true,
        partners: { select: { slot: true, displayName: true, title: true, userId: true } },
      },
    });
    if (!wedding?.slug) return null;
    return {
      slug: wedding.slug,
      timezone: wedding.timezone,
      coupleNames: coupleNames({
        partners: wedding.partners.map((partner) => ({ ...partner, slot: partner.slot as 1 | 2 })),
      }),
      eventDate: wedding.eventDate,
      city: wedding.city,
      state: wedding.state,
    };
  }

  async activeTagName({
    weddingId,
    tagId,
  }: {
    weddingId: string;
    tagId: string;
  }): Promise<string | null> {
    const tag = await this.tenant.client().tag.findFirst({
      where: { id: tagId, weddingId, deletedAt: null },
      select: { name: true },
    });
    return tag?.name ?? null;
  }

  async guests({
    weddingId,
    who,
    tagId,
  }: {
    weddingId: string;
    who: ExportWho;
    tagId?: string;
  }): Promise<ExportGuest[]> {
    const filter =
      who === 'confirmed'
        ? Prisma.sql`AND g.rsvp_status = 'confirmed'`
        : who === 'tag' && tagId
          ? Prisma.sql`AND (EXISTS (SELECT 1 FROM party_tags pt WHERE pt.party_id = p.id AND pt.tag_id = ${tagId}::uuid)
                       OR EXISTS (SELECT 1 FROM guest_tags gt WHERE gt.guest_id = g.id AND gt.tag_id = ${tagId}::uuid))`
          : Prisma.empty;
    // As tags do grupo primeiro, depois as do convidado, sem repetir (RN04).
    const rows = await this.tenant.client().$queryRaw<
      {
        name: string;
        party: string;
        age_group: AgeGroup | null;
        dietary_restriction: string | null;
        rsvp_status: RsvpStatus;
        phone: string | null;
        tags: string[] | null;
      }[]
    >`
      SELECT g.name, p.name AS party, g.age_group, g.dietary_restriction, g.rsvp_status, g.phone,
        (SELECT array_agg(name ORDER BY source, created_at) FROM (
           SELECT DISTINCT ON (t.id) t.name, s.source, s.created_at FROM (
             SELECT pt.tag_id, 0 AS source, pt.created_at FROM party_tags pt WHERE pt.party_id = p.id
             UNION ALL
             SELECT gt.tag_id, 1, gt.created_at FROM guest_tags gt WHERE gt.guest_id = g.id
           ) s JOIN tags t ON t.id = s.tag_id AND t.deleted_at IS NULL
           ORDER BY t.id, s.source, s.created_at
         ) tag_names) AS tags
      FROM guests g
      JOIN parties p ON p.id = g.party_id AND p.deleted_at IS NULL
      WHERE g.wedding_id = ${weddingId}::uuid AND g.deleted_at IS NULL AND g.name IS NOT NULL
        ${filter}
      ORDER BY lower(f_unaccent(p.name)), p.id, g.is_plus_one, g.joined_party_at, g.id`;
    return rows.map((row) => ({
      name: row.name,
      party: row.party,
      ageGroup: row.age_group,
      dietaryRestriction: row.dietary_restriction,
      rsvpStatus: row.rsvp_status,
      phone: row.phone,
      tags: row.tags ?? [],
    }));
  }
}
