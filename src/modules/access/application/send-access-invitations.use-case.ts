import { Inject, Injectable } from '@nestjs/common';
import {
  FIELD_CIPHER,
  type FieldCipher,
} from '../../../shared/crypto/application/field-cipher.port';
import { AFTER_COMMIT, type AfterCommit } from '../../../shared/database/after-commit.port';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import {
  PRODUCT_EVENT_RECORDER,
  type ProductEventRecorder,
} from '../../product-events/application/ports/product-event-recorder.port';
import {
  coupleInvitationsFull,
  coupleLinkCipherContext,
  invitationExpiresAt,
  recipientsAllowed,
  roleGrantedBy,
  sendRefusal,
  type AccessInvitationKind,
} from '../domain/access-invitation';
import {
  CoupleInvitationsFullError,
  InvalidInvitationRecipientsError,
  OwnersFullError,
  PlannerAlreadyError,
  SelfInvitationError,
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
import { USER_REPOSITORY, type UserRepository } from './ports/user-repository.port';
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
 * Reenviar a um e-mail e Gerar novo link substituem o pendente daquele e-mail
 * ou o link, cujo link deixa de valer; "Convidar outro e-mail" é cancelar o
 * antigo e enviar o novo (decisão 170). Roda na transação da requisição; os
 * e-mails e o evento saem só depois do commit (decisão 170).
 */
@Injectable()
export class SendAccessInvitations {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(ACCESS_INVITATION_STORE) private readonly store: AccessInvitationStore,
    @Inject(INVITATION_TOKENS) private readonly tokens: InvitationTokens,
    @Inject(INVITATION_MAILER) private readonly mailer: InvitationMailer,
    @Inject(PRODUCT_EVENT_RECORDER) private readonly productEvents: ProductEventRecorder,
    @Inject(AFTER_COMMIT) private readonly afterCommit: AfterCommit,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(FIELD_CIPHER) private readonly cipher: FieldCipher,
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
    // Novo casamento RN05: o convite do casal não vai para o e-mail de quem convida.
    if (kind === 'couple' && recipients.length) {
      const sender = await this.users.findProfileById({ userId });
      if (sender && recipients.includes(sender.email.toLowerCase()))
        throw new SelfInvitationError();
    }

    const pending = await this.store.listPending({ weddingId });
    const replaced = pending.filter((invitation) => replaces({ kind, recipients, invitation }));
    if (kind === 'couple' && recipients.length) {
      const remainingActive = pending.filter(
        (invitation) =>
          invitation.kind === 'couple' &&
          invitation.email !== null &&
          invitation.expiresAt > now &&
          !replaced.includes(invitation),
      ).length;
      if (coupleInvitationsFull({ remainingActive, adding: recipients.length }))
        throw new CoupleInvitationsFullError();
    }
    await this.store.supersede({ invitationIds: replaced.map(({ id }) => id), now });

    const expiresAt = invitationExpiresAt({ now });
    const targets: (string | null)[] = recipients.length ? recipients : [null];
    const created: { invitation: NewAccessInvitation; token: string; resent: boolean }[] = [];
    for (const email of targets) {
      const { token, tokenHash } = this.tokens.generate();
      // Meus casamentos RN09 (N1(b)): o link do casal sem e-mail guarda o token
      // cifrado, para o detalhe mostrar o mesmo link. O hash segue validando o aceite.
      const tokenEncrypted =
        kind === 'couple' && email === null
          ? await this.cipher.encrypt({
              plaintext: token,
              context: coupleLinkCipherContext({ weddingId }),
            })
          : null;
      const invitation: NewAccessInvitation = {
        id: uuidV7({ now: now.getTime() }),
        weddingId,
        kind,
        email,
        role: roleGrantedBy({ kind }),
        tokenHash,
        invitedByUserId: userId,
        expiresAt,
        tokenEncrypted,
      };
      const resent = replaced.some((previous) => previous.email === email);
      created.push({ invitation, token, resent });
    }
    await this.store.insert({ invitations: created.map(({ invitation }) => invitation) });
    if (kind === 'couple' && wedding.status === 'draft')
      await this.store.markAwaitingCouple({ weddingId });
    await this.store.touchActivity({ weddingId, now });

    const inviter = await this.store.loadInviter({ weddingId, userId });
    for (const { invitation, token, resent } of created) {
      const to = invitation.email;
      if (!to) continue;
      this.afterCommit.schedule(() =>
        this.mailer.send({ email: { kind, to, token, resent, message, wedding, inviter } }),
      );
    }
    if (kind === 'couple' && !recipients.length && inviter.referrerKind === 'planner') {
      this.afterCommit.schedule(() =>
        this.productEvents.record({
          event: { name: 'cerim_link_gerado', weddingId },
          occurredAt: now,
        }),
      );
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
 * RN04 (decisão 170): o envio substitui só o pendente de cada e-mail listado;
 * sem e-mail (RN14), o link do casal pendente.
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
  if (invitation.email) return recipients.includes(invitation.email.toLowerCase());
  return kind === 'couple' && !recipients.length && invitation.kind === 'couple';
}
