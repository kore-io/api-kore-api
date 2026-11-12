import { Injectable } from '@nestjs/common';
import { postgresErrorCode } from '../../../shared/database/postgres-error';
import { PrismaService } from '../../../shared/database/prisma.service';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type {
  AcceptRefusal,
  InvitationAcceptanceStore,
} from '../application/ports/invitation-acceptance-store.port';
import type { InvitationSnapshot } from '../domain/invitation-acceptance';
import { creditNameForSite } from '../domain/planner-profile';
import type { PartnerTitle } from '../domain/wedding-signup';

type Json = Record<string, unknown>;

const date = (value: unknown): Date | null => (value ? new Date(value as string) : null);

/** O jsonb da função access_invitation_by_token, com as datas como Date. */
function toSnapshot(raw: Json): InvitationSnapshot {
  const wedding = raw.wedding as Json;
  return {
    ...(raw as unknown as InvitationSnapshot),
    expiresAt: new Date(raw.expiresAt as string),
    acceptedAt: date(raw.acceptedAt),
    declinedAt: date(raw.declinedAt),
    revokedAt: date(raw.revokedAt),
    supersededAt: date(raw.supersededAt),
    wedding: {
      ...(wedding as unknown as InvitationSnapshot['wedding']),
      eventDate: wedding.eventDate ? new Date(`${wedding.eventDate as string}T00:00:00Z`) : null,
      activeOwners: Number(wedding.activeOwners),
      activeCollaborators: Number(wedding.activeCollaborators),
    },
    // Assinatura RN03 e RN04: o predicado do nome, no helper único.
    plannerCredit: creditNameForSite({ raw: (raw.plannerCredit as string | null) ?? null }),
  };
}

/** As barreiras da função accept_access_invitation, pelo SQLSTATE (migrations invitation_barrier_codes e self_referral). */
const REFUSALS: Record<string, AcceptRefusal> = {
  KA001: 'not_pending',
  KA002: 'owners_full',
  KA003: 'partner_taken',
  KA004: 'planner_already',
  KA005: 'self_referral',
};

/**
 * Pelas funções SECURITY DEFINER da migration invitation_acceptance (decisão
 * 172). Na rota pública (ler, recusar), pela conexão comum; no aceite, na
 * transação da requisição, onde as leituras e gravações da RLS já valem.
 */
@Injectable()
export class PrismaInvitationAcceptanceStore implements InvitationAcceptanceStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantTransaction,
  ) {}

  private db() {
    return this.tenant.optionalClient() ?? this.prisma;
  }

  async findByToken({ tokenHash }: { tokenHash: string }): Promise<InvitationSnapshot | null> {
    const [row] = await this.db().$queryRaw<[{ invitation: Json | null }]>`
      SELECT access_invitation_by_token(${tokenHash}) AS invitation`;
    return row.invitation ? toSnapshot(row.invitation) : null;
  }

  async activeRole({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<'owner' | 'collaborator' | null> {
    const membership = await this.tenant.client().membership.findFirst({
      where: { userId, weddingId, removedAt: null },
      select: { role: true },
    });
    return membership?.role ?? null;
  }

  async lockWedding({ weddingId }: { weddingId: string }): Promise<void> {
    await this.tenant.client()
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wedding:${weddingId}`}, 0))`;
  }

  async accept({
    tokenHash,
    membershipId,
    partnerSlot,
    partnerTitle,
    acceptedForEmail,
  }: {
    tokenHash: string;
    membershipId: string;
    partnerSlot: 1 | 2 | null;
    partnerTitle: PartnerTitle | null;
    acceptedForEmail: string | null;
  }): Promise<{ weddingId: string; attributed: boolean } | AcceptRefusal> {
    try {
      const [row] = await this.tenant.client().$queryRaw<
        [{ wedding_id: string; attributed: boolean }]
      >`
        SELECT * FROM accept_access_invitation(
          ${tokenHash}, ${membershipId}::uuid, ${partnerSlot}::smallint,
          ${partnerTitle}::partner_title, ${acceptedForEmail}::citext)`;
      return { weddingId: row.wedding_id, attributed: row.attributed };
    } catch (error) {
      const refusal = REFUSALS[postgresErrorCode({ error }) ?? ''];
      if (refusal) return refusal;
      throw error;
    }
  }

  async handOverToCouple({
    weddingId,
    sellerUserId,
    now,
  }: {
    weddingId: string;
    sellerUserId: string | null;
    now: Date;
  }): Promise<string> {
    const tx = this.tenant.client();
    await tx.wedding.updateMany({
      where: { id: weddingId, status: 'awaiting_couple' },
      data: { status: 'draft' },
    });
    if (sellerUserId) {
      await tx.membership.updateMany({
        where: { weddingId, userId: sellerUserId, removedAt: null },
        data: { removedAt: now },
      });
    }
    const wedding = await tx.wedding.findUniqueOrThrow({
      where: { id: weddingId },
      select: { status: true },
    });
    return wedding.status;
  }

  async decline({ tokenHash }: { tokenHash: string }): Promise<boolean> {
    const [row] = await this.db().$queryRaw<[{ declined: boolean | null }]>`
      SELECT decline_access_invitation(${tokenHash}) AS declined`;
    return row.declined === true;
  }
}
