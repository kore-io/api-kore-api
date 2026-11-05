import { Inject, Injectable } from '@nestjs/common';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import {
  PRODUCT_EVENT_RECORDER,
  type ProductEventRecorder,
} from '../../product-events/application/ports/product-event-recorder.port';
import {
  invitationExpiresAt,
  recipientsAllowed,
  roleGrantedBy,
  sendRefusal,
  type AccessInvitationKind,
} from '../domain/access-invitation';
import {
  InvalidInvitationRecipientsError,
  OwnersFullError,
  PlannerAlreadyError,
  WeddingActionForbiddenError,
} from '../domain/access.errors';
import type { WeddingAction } from '../domain/wedding-authorization';
import {
  ACCESS_INVITATION_STORE,
  type AccessInvitationStore,
  type NewAccessInvitation,
  type PendingInvitation,
} from './ports/access-invitation-store.port';
import { INVITATION_MAILER, type InvitationMailer } from './ports/invitation-mailer.port';
import { INVITATION_TOKENS, type InvitationTokens } from './ports/invitation-tokens.port';
import { WeddingAuthorization } from './wedding-authorization.service';

export interface SentInvitation {
  id: string;
  email: string | null;
  kind: AccessInvitationKind;
  expiresAt: Date;
  resent: boolean;
  /** Só no link sem e-mail (RN14): o token só existe nesta resposta. */
  url?: string;
}

const ACTION_BY_KIND: Record<AccessInvitationKind, WeddingAction> = {
  partner: 'invite_partner',
  planner: 'invite_planner',
  // O do casal não depende do papel, e sim de ser o indicador que criou (RN02).
  couple: 'view',
};

/**
 * Envia ou reenvia convites de acesso (RN01 a RN04 e RN14 de Convites).
 * Reenviar ao mesmo e-mail, Convidar outro e-mail (casal) e Gerar novo link
 * substituem o pendente anterior, cujo link deixa de valer. Roda na transação
 * da requisição; os e-mails e o evento saem depois de tudo gravado.
 */
@Injectable()
export class SendAccessInvitations {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(ACCESS_INVITATION_STORE) private readonly store: AccessInvitationStore,
    @Inject(INVITATION_TOKENS) private readonly tokens: InvitationTokens,
    @Inject(INVITATION_MAILER) private readonly mailer: InvitationMailer,
    @Inject(PRODUCT_EVENT_RECORDER) private readonly productEvents: ProductEventRecorder,
  ) {}

  async execute({
    userId,
    weddingId,
    kind,
    emails,
    message,
    now,
  }: {
    userId: string;
    weddingId: string;
    kind: AccessInvitationKind;
    emails: string[];
    message: string | null;
    now: Date;
  }): Promise<SentInvitation[]> {
    const recipients = emails.map((email) => email.toLowerCase());
    if (!recipientsAllowed({ kind, emails: recipients }))
      throw new InvalidInvitationRecipientsError();

    const role = await this.authorization.require({
      userId,
      weddingId,
      action: ACTION_BY_KIND[kind],
    });
    await this.store.lockWedding({ weddingId });
    const wedding = await this.store.loadWedding({ weddingId });
    const refusal = sendRefusal({ kind, senderId: userId, senderRole: role, wedding });
    if (refusal === 'owners_full') throw new OwnersFullError();
    if (refusal === 'planner_already') throw new PlannerAlreadyError();
    if (refusal) throw new WeddingActionForbiddenError();

    const pending = await this.store.listPending({ weddingId });
    const replaced = pending.filter((invitation) => replaces({ kind, recipients, invitation }));
    await this.store.supersede({ invitationIds: replaced.map(({ id }) => id), now });

    const expiresAt = invitationExpiresAt({ now });
    const targets: (string | null)[] = recipients.length ? recipients : [null];
    const created = targets.map((email) => {
      const { token, tokenHash } = this.tokens.generate();
      const invitation: NewAccessInvitation = {
        id: uuidV7({ now: now.getTime() }),
        weddingId,
        kind,
        email,
        role: roleGrantedBy({ kind }),
        tokenHash,
        invitedByUserId: userId,
        expiresAt,
      };
      const resent = replaced.some((previous) => previous.email === email);
      return { invitation, token, resent };
    });
    await this.store.insert({ invitations: created.map(({ invitation }) => invitation) });
    if (kind === 'couple' && wedding.status === 'draft')
      await this.store.markAwaitingCouple({ weddingId });
    await this.store.touchActivity({ weddingId, now });

    const inviter = await this.store.loadInviter({ weddingId, userId });
    for (const { invitation, token, resent } of created) {
      if (!invitation.email) continue;
      await this.mailer.send({
        email: { kind, to: invitation.email, token, resent, message, wedding, inviter },
      });
    }
    if (kind === 'couple' && !recipients.length && inviter.referrerKind === 'planner') {
      await this.productEvents.record({
        event: { name: 'cerim_link_gerado', weddingId },
        occurredAt: now,
      });
    }

    return created.map(({ invitation, token, resent }) => ({
      id: invitation.id,
      email: invitation.email,
      kind,
      expiresAt,
      resent,
      ...(invitation.email ? {} : { url: this.mailer.urlFor({ token }) }),
    }));
  }
}

/**
 * RN04: o mesmo e-mail tem um pendente só; no do casal, Convidar outro e-mail
 * substitui os convites por e-mail anteriores, e Gerar novo link, o link.
 */
function replaces({
  kind,
  recipients,
  invitation,
}: {
  kind: AccessInvitationKind;
  recipients: string[];
  invitation: PendingInvitation;
}): boolean {
  if (invitation.email && recipients.includes(invitation.email.toLowerCase())) return true;
  if (kind !== 'couple' || invitation.kind !== 'couple') return false;
  return recipients.length ? invitation.email !== null : invitation.email === null;
}
