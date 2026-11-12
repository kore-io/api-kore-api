import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import { DEFAULT_TIMEZONE } from '../../../shared/time/local-date';
import type { StatsDelta } from '../../guests/domain/wedding-stats';
import type { RsvpGuest, RsvpGuestUpdate } from '../domain/rsvp';
import type { RsvpPartyRow, RsvpStore, RsvpWeddingRow } from '../application/ports/rsvp-store.port';

const PARTY_SELECT = {
  id: true,
  name: true,
  version: true,
  plusOneSlots: true,
  deliveryStatus: true,
  firstViewedAt: true,
} as const;

const day = (date: Date | null): string | null => (date ? date.toISOString().slice(0, 10) : null);

/**
 * Na transação corrente (a do grupo, no papel kore_party, ou a da prévia),
 * sempre pela RLS: as policies *_party_* limitam ao grupo do cookie.
 */
@Injectable()
export class PrismaRsvpStore implements RsvpStore {
  constructor(private readonly tenant: TenantTransaction) {}

  async lockStats({ weddingId }: { weddingId: string }): Promise<void> {
    await this.tenant.client()
      .$queryRaw`SELECT 1 FROM wedding_stats WHERE wedding_id = ${weddingId}::uuid FOR UPDATE`;
  }

  async lockParty({ partyId }: { partyId: string }): Promise<RsvpPartyRow | null> {
    const locked = await this.tenant.client().$queryRaw<{ id: string }[]>`
      SELECT id FROM parties WHERE id = ${partyId}::uuid AND deleted_at IS NULL FOR UPDATE`;
    return locked.length > 0 ? this.readParty({ partyId }) : null;
  }

  readParty({ partyId }: { partyId: string }): Promise<RsvpPartyRow | null> {
    return this.tenant.client().party.findFirst({
      where: { id: partyId, deletedAt: null },
      select: PARTY_SELECT,
    });
  }

  guests({ partyId }: { partyId: string }): Promise<RsvpGuest[]> {
    return this.tenant.client().guest.findMany({
      where: { partyId, deletedAt: null },
      orderBy: [{ isPlusOne: 'asc' }, { joinedPartyAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        isPlusOne: true,
        rsvpStatus: true,
        ageGroup: true,
        dietaryRestriction: true,
        songSuggestion: true,
        songSuggestedAt: true,
        respondedAt: true,
      },
    });
  }

  async wedding({ weddingId }: { weddingId: string }): Promise<RsvpWeddingRow | null> {
    const wedding = await this.tenant.client().wedding.findFirst({
      where: { id: weddingId },
      select: {
        status: true,
        timezone: true,
        rsvpDeadline: true,
        publishedAt: true,
        songQuestionEnabled: true,
        songQuestionText: true,
        contactWhatsapp: true,
        contactEmail: true,
      },
    });
    if (!wedding) return null;
    return {
      ...wedding,
      rsvpDeadline: day(wedding.rsvpDeadline),
      publishedAt: wedding.publishedAt?.toISOString() ?? null,
    };
  }

  async submissionsToday({
    partyId,
    timezone,
    now,
  }: {
    partyId: string;
    timezone: string | null;
    now: Date;
  }): Promise<number> {
    const zone = timezone ?? DEFAULT_TIMEZONE;
    const [{ count }] = await this.tenant.client().$queryRaw<[{ count: number }]>`
      SELECT count(*)::int AS count FROM rsvp_submissions
      WHERE party_id = ${partyId}::uuid AND actor = 'party'
        AND (created_at AT TIME ZONE ${zone})::date = (${now}::timestamptz AT TIME ZONE ${zone})::date`;
    return count;
  }

  async saveSubmission({
    weddingId,
    partyId,
    submissionId,
    signedByGuestId,
    counts,
    updates,
    now,
  }: {
    weddingId: string;
    partyId: string;
    submissionId: string;
    signedByGuestId: string;
    counts: { confirmed: number; declined: number };
    updates: readonly RsvpGuestUpdate[];
    now: Date;
  }): Promise<void> {
    const tx = this.tenant.client();
    // createMany: o papel do grupo insere sem precisar do RETURNING.
    await tx.rsvpSubmission.createMany({
      data: [
        {
          id: submissionId,
          createdAt: now,
          weddingId,
          partyId,
          actor: 'party',
          signedByGuestId,
          confirmedCount: counts.confirmed,
          declinedCount: counts.declined,
        },
      ],
    });
    for (const { after } of updates)
      // Numa instrução só: o CHECK da música exige a sugestão vazia fora do
      // confirmado na mesma escrita (Música RN04; R5-1).
      await tx.guest.updateMany({
        where: { id: after.id, partyId },
        data: {
          rsvpStatus: after.rsvpStatus,
          name: after.name,
          dietaryRestriction: after.dietaryRestriction,
          songSuggestion: after.songSuggestion,
          songSuggestedAt: after.songSuggestedAt,
          respondedAt: after.respondedAt,
        },
      });
    await tx.guestResponse.createMany({
      data: updates.map(({ after }, index) => ({
        // Na ordem do grupo, para o histórico.
        id: uuidV7({ now: now.getTime() + index }),
        createdAt: now,
        weddingId,
        guestId: after.id,
        partyId,
        submissionId,
        status: after.rsvpStatus,
        signedByGuestId,
        actor: 'party' as const,
      })),
    });
  }

  async applyStats({ weddingId, delta }: { weddingId: string; delta: StatsDelta }): Promise<void> {
    const data: Record<string, { increment: number }> = {};
    for (const [field, value] of Object.entries(delta) as [string, number | undefined][])
      if (value) data[field] = { increment: value };
    if (Object.keys(data).length === 0) return;
    await this.tenant.client().weddingStats.updateMany({ where: { weddingId }, data });
  }

  async markResponded({
    partyId,
    deliveryStatus,
    respondedAt,
    signedByGuestId,
  }: {
    partyId: string;
    deliveryStatus: RsvpPartyRow['deliveryStatus'];
    respondedAt: Date | null;
    signedByGuestId: string;
  }): Promise<void> {
    await this.tenant.client().party.updateMany({
      where: { id: partyId },
      data: {
        version: { increment: 1 },
        deliveryStatus,
        respondedAt,
        lastResponseActor: 'party',
        lastSignedByGuestId: signedByGuestId,
        lastResponseUserId: null,
      },
    });
  }

  async notify({
    submissionId,
    notificationIds,
  }: {
    submissionId: string;
    notificationIds: readonly string[];
  }): Promise<{ firstResponse: boolean; recipients: string[] }> {
    const [row] = await this.tenant.client().$queryRaw<
      [{ result: { firstResponse: boolean; recipients: string[] } }]
    >`SELECT notify_rsvp(${submissionId}::uuid, ${[...notificationIds]}::uuid[]) AS result`;
    return row.result;
  }
}
