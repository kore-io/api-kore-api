import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../shared/config/app-config.service';
import {
  FIELD_CIPHER,
  type FieldCipher,
} from '../../../shared/crypto/application/field-cipher.port';
import {
  PLANNER_PROFILES,
  type PlannerProfiles,
} from '../../access/application/ports/planner-profiles.port';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { coupleLinkCipherContext } from '../../access/domain/access-invitation';
import { WeddingNotFoundError } from '../../access/domain/access.errors';
import { INVITATION_PATH } from '../../access/infrastructure/outbox-invitation-mailer';
import {
  compareWeddings,
  hasInvitationsNotSentAlert,
  hasPendingResponsesAlert,
  isInvitationsAlertCandidate,
  originOf,
  summaryOf,
  type CollaborationRow,
  type MyWeddingStatus,
  type WeddingOrigin,
} from '../domain/my-weddings';
import {
  PLANNER_WEDDINGS_READER,
  type PendingCoupleInvitation,
  type PlannerWeddingsReader,
} from './ports/planner-weddings-reader.port';
import { requirePlannerProfile } from './planner-gate';
import { commissionBalances } from '../domain/commissions';
import {
  REFERRER_COMMISSIONS_READER,
  type ReferrerCommissionsReader,
} from './ports/referrer-commissions-reader.port';

export interface MyWeddingItem {
  weddingId: string;
  partnerNames: [string, string];
  eventDate: string | null;
  city: string;
  state: string;
  status: MyWeddingStatus;
  rsvpPercent: number;
  guestsTotal: number;
  origin: WeddingOrigin;
  createdByMe: boolean;
  /** Rascunho com a publicação aguardando pagamento (Comissões RN08): o filtro e o selo. */
  awaitingPayment: boolean;
}

export interface MyWeddingsView {
  summary: {
    active: number;
    awaitingCouple: number;
    /** Aguardando pagamento (Comissões RN08). */
    awaitingPayment: number;
    /** Comissão disponível, em centavos (Comissões RN08; decisão 36). */
    commissionAvailableCents: number;
  };
  alerts: {
    pendingResponses: { weddingId: string; partnerNames: [string, string]; rsvpDeadline: string }[];
    invitationsNotSent: { weddingId: string; partnerNames: [string, string]; eventDate: string }[];
  };
  weddings: MyWeddingItem[];
}

export type CoupleInvitationView =
  | { type: 'email'; id: string; email: string; sentAt: Date; expiresAt: Date }
  | {
      type: 'link';
      id: string;
      expiresAt: Date;
      state: 'active' | 'expired';
      /** Só a quem gerou o link e só enquanto ele vale (RN09, N1(b)). */
      url: string | null;
    };

export interface MyWeddingDetail extends MyWeddingItem {
  slug: string | null;
  stats: { guestsTotal: number; confirmed: number; declined: number; pending: number };
  hasOwner: boolean;
  canEditIdentity: boolean;
  /** Só quando ela criou o casamento (revisão C2-8): o convite do parceiro não é dela. */
  coupleInvitations: CoupleInvitationView[];
}

function itemOf({
  row,
  userId,
  awaitingPayment = false,
}: {
  row: CollaborationRow;
  userId: string;
  awaitingPayment?: boolean;
}): MyWeddingItem {
  return {
    weddingId: row.weddingId,
    partnerNames: row.partnerNames,
    eventDate: row.eventDate,
    city: row.city,
    state: row.state,
    status: row.status,
    rsvpPercent: row.stats.rsvpPercent,
    guestsTotal: row.stats.guestsTotal,
    origin: originOf({ row, userId }),
    createdByMe: row.createdByUserId === userId,
    awaitingPayment,
  };
}

/**
 * Meus casamentos (GET /v1/me/weddings; RN01 a RN07): o resumo, os dois
 * alertas e a lista inteira, já ordenada. Ler o painel não é atividade
 * (revisão C2-8): nada aqui grava no casamento.
 */
@Injectable()
export class ListMyWeddings {
  constructor(
    @Inject(PLANNER_PROFILES) private readonly profiles: PlannerProfiles,
    @Inject(PLANNER_WEDDINGS_READER) private readonly reader: PlannerWeddingsReader,
    @Inject(REFERRER_COMMISSIONS_READER) private readonly commissions: ReferrerCommissionsReader,
  ) {}

  async execute({ userId, now }: { userId: string; now: Date }): Promise<MyWeddingsView> {
    await requirePlannerProfile({ profiles: this.profiles, userId });
    const rows = (await this.reader.listCollaborations({ userId })).sort(compareWeddings);

    const candidates = rows.filter((row) => isInvitationsAlertCandidate({ row, now }));
    const counts = await this.reader.deliveryCounts({
      weddingIds: candidates.map(({ weddingId }) => weddingId),
    });
    const awaiting = await this.reader.awaitingPayment({
      weddingIds: rows.map(({ weddingId }) => weddingId),
    });
    const { availableCents } = commissionBalances(
      await this.commissions.list(),
      await this.commissions.adjustments(),
    );
    return {
      summary: {
        ...summaryOf({ rows }),
        awaitingPayment: awaiting.size,
        commissionAvailableCents: availableCents,
      },
      alerts: {
        // RN07: o prazo ou a data mais próxima primeiro.
        pendingResponses: rows
          .filter((row) => hasPendingResponsesAlert({ row, now }))
          .map((row) => ({
            weddingId: row.weddingId,
            partnerNames: row.partnerNames,
            rsvpDeadline: row.rsvpDeadline ?? '',
          }))
          .sort((a, b) => a.rsvpDeadline.localeCompare(b.rsvpDeadline)),
        invitationsNotSent: candidates
          .filter((row) => {
            const found = counts.get(row.weddingId);
            return found !== undefined && hasInvitationsNotSentAlert({ counts: found });
          })
          .map((row) => ({
            weddingId: row.weddingId,
            partnerNames: row.partnerNames,
            eventDate: row.eventDate ?? '',
          })),
      },
      weddings: rows.map((row) =>
        itemOf({ row, userId, awaitingPayment: awaiting.has(row.weddingId) }),
      ),
    };
  }
}

/**
 * O detalhe do casamento (GET /v1/me/weddings/{id}; RN08 e RN09): os números,
 * se tem dono, se ela muda a identidade e, quando ela criou, o convite do casal
 * pendente, com o link decifrado só para quem o gerou e enquanto vale.
 */
@Injectable()
export class GetMyWedding {
  constructor(
    private readonly config: AppConfigService,
    private readonly authorization: WeddingAuthorization,
    @Inject(PLANNER_PROFILES) private readonly profiles: PlannerProfiles,
    @Inject(PLANNER_WEDDINGS_READER) private readonly reader: PlannerWeddingsReader,
    @Inject(FIELD_CIPHER) private readonly cipher: FieldCipher,
  ) {}

  async execute({
    userId,
    weddingId,
    now,
  }: {
    userId: string;
    weddingId: string;
    now: Date;
  }): Promise<MyWeddingDetail> {
    await requirePlannerProfile({ profiles: this.profiles, userId });
    const detail = await this.reader.collaboration({ userId, weddingId });
    // Sem vínculo de colaboradora (outra assessoria, quem saiu, o casamento de
    // que ela é dona): 404, sem revelar que o casamento existe (RN01).
    if (!detail) throw new WeddingNotFoundError();
    const awaiting = await this.reader.awaitingPayment({ weddingIds: [detail.weddingId] });
    const item = itemOf({ row: detail, userId, awaitingPayment: awaiting.has(detail.weddingId) });
    const coupleInvitations = item.createdByMe
      ? await Promise.all(
          detail.pendingCoupleInvitations.map((invitation) =>
            this.invitationView({ invitation, userId, weddingId, now }),
          ),
        )
      : [];
    return {
      ...item,
      slug: detail.slug,
      stats: {
        guestsTotal: detail.stats.guestsTotal,
        confirmed: detail.stats.confirmed,
        declined: detail.stats.declined,
        pending: detail.stats.pending,
      },
      hasOwner: detail.hasOwner,
      canEditIdentity: await this.authorization.canManageSiteIdentity({ userId, weddingId }),
      coupleInvitations,
    };
  }

  private async invitationView({
    invitation,
    userId,
    weddingId,
    now,
  }: {
    invitation: PendingCoupleInvitation;
    userId: string;
    weddingId: string;
    now: Date;
  }): Promise<CoupleInvitationView> {
    if (invitation.email)
      return {
        type: 'email',
        id: invitation.id,
        email: invitation.email,
        sentAt: invitation.createdAt,
        expiresAt: invitation.expiresAt,
      };
    const active = invitation.expiresAt > now;
    const readable =
      active && invitation.invitedByUserId === userId && invitation.tokenEncrypted !== null;
    const token = readable
      ? await this.cipher.decrypt({
          ciphertext: invitation.tokenEncrypted ?? '',
          context: coupleLinkCipherContext({ weddingId }),
        })
      : null;
    return {
      type: 'link',
      id: invitation.id,
      expiresAt: invitation.expiresAt,
      state: active ? 'active' : 'expired',
      url: token
        ? new URL(
            `${INVITATION_PATH}/${encodeURIComponent(token)}`,
            this.config.get({ key: 'APP_URL' }),
          ).toString()
        : null,
    };
  }
}
