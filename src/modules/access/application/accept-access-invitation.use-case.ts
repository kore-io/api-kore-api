import { Inject, Injectable } from '@nestjs/common';
import { AFTER_COMMIT, type AfterCommit } from '../../../shared/database/after-commit.port';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import {
  PRODUCT_EVENT_RECORDER,
  type ProductEventRecorder,
} from '../../product-events/application/ports/product-event-recorder.port';
import {
  AcceptanceDetailsMissingError,
  AlreadyMemberError,
  AlreadyOwnerError,
  EmailMismatchError,
  InvitationInvalidError,
  OwnersFullError,
  PlannerAlreadyError,
  SellerCannotBePlannerError,
  SessionExpiredError,
} from '../domain/access.errors';
import { emailDiffers, invalidReason, partnerChoice } from '../domain/invitation-acceptance';
import type { MembershipRole } from '../domain/wedding-authorization';
import { cleanText, type PartnerTitle } from '../domain/wedding-signup';
import {
  INVITATION_ACCEPTANCE_STORE,
  type InvitationAcceptanceStore,
} from './ports/invitation-acceptance-store.port';
import { INVITATION_TOKENS, type InvitationTokens } from './ports/invitation-tokens.port';
import { PLANNER_PROFILES, type PlannerProfiles } from './ports/planner-profiles.port';
import { USER_ACCOUNT_NAMES, type UserAccountNames } from './ports/user-account-names.port';
import { SESSION_REPOSITORY, type SessionRepository } from './ports/session-repository.port';
import { USER_REPOSITORY, type UserRepository } from './ports/user-repository.port';
import { WEDDING_SIGNUP_STORE, type WeddingSignupStore } from './ports/wedding-signup-store.port';

export interface InvitationAcceptance {
  confirmOtherAccount: boolean;
  /** "Quem é você?" no do casal; o título também no do parceiro sem título (decisão 172). */
  partnerIndex: 1 | 2 | null;
  myTitle: PartnerTitle | null;
  /** Só no do cerimonialista, quando a conta ainda não tem nome (decisão 168, item 4). */
  name: string | null;
}

export interface AcceptedInvitation {
  weddingId: string;
  role: MembershipRole;
  weddingStatus: string;
  attributedToMe: boolean;
}

/**
 * Aceita o convite com a conta da sessão (RN07 a RN10, RN14 de Convites;
 * decisões 168 e 172). Roda na transação da requisição: as regras são checadas
 * sob lock da pessoa e do casamento, e a função do banco grava o aceite com as
 * suas barreiras. O evento casal_aceitou sai depois do commit (decisão 170).
 */
@Injectable()
export class AcceptAccessInvitation {
  constructor(
    @Inject(INVITATION_ACCEPTANCE_STORE) private readonly store: InvitationAcceptanceStore,
    @Inject(WEDDING_SIGNUP_STORE) private readonly owners: WeddingSignupStore,
    @Inject(INVITATION_TOKENS) private readonly tokens: InvitationTokens,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(USER_ACCOUNT_NAMES) private readonly accountNames: UserAccountNames,
    @Inject(PLANNER_PROFILES) private readonly plannerProfiles: PlannerProfiles,
    @Inject(PRODUCT_EVENT_RECORDER) private readonly productEvents: ProductEventRecorder,
    @Inject(AFTER_COMMIT) private readonly afterCommit: AfterCommit,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
  ) {}

  async execute({
    token,
    userId,
    sessionId,
    acceptance,
    now,
  }: {
    token: string;
    userId: string;
    sessionId: string;
    acceptance: InvitationAcceptance;
    now: Date;
  }): Promise<AcceptedInvitation> {
    const tokenHash = this.tokens.hash({ token });
    const user = await this.users.findProfileById({ userId });
    if (!user) throw new SessionExpiredError();

    await this.owners.lockOwner({ userId });
    const found = await this.store.findByToken({ tokenHash });
    if (!found) throw new InvitationInvalidError({ reason: 'used' });
    await this.store.lockWedding({ weddingId: found.weddingId });
    // Relido sob o lock do casamento: dois aceites juntos veem o mesmo estado.
    const invitation = (await this.store.findByToken({ tokenHash })) ?? found;
    const reason = invalidReason({ invitation, now });
    if (reason) throw new InvitationInvalidError({ reason });

    const mismatch = emailDiffers({ invitationEmail: invitation.email, sessionEmail: user.email });
    if (mismatch && !acceptance.confirmOtherAccount) throw new EmailMismatchError();

    const { weddingId, wedding } = invitation;
    // Decisão 172(3) revista: quem já tem vínculo neste casamento, dono ou não.
    if (await this.store.activeRole({ userId, weddingId })) throw new AlreadyMemberError();

    if (invitation.role === 'owner') {
      const ownedWeddingId = await this.owners.findActiveOwnedWeddingId({ userId });
      if (ownedWeddingId) throw new AlreadyOwnerError({ weddingId: ownedWeddingId });
      if (wedding.activeOwners >= 2) throw new OwnersFullError();
    } else if (wedding.activeCollaborators > 0) {
      throw new PlannerAlreadyError();
    }

    const choice = partnerChoice({
      kind: invitation.kind,
      partners: wedding.partners,
      partnerIndex: acceptance.partnerIndex,
      myTitle: acceptance.myTitle,
    });
    if (choice === 'missing')
      throw new AcceptanceDetailsMissingError({
        field: invitation.kind === 'couple' ? 'partnerIndex, myTitle' : 'myTitle',
      });
    if (choice === 'taken') throw new OwnersFullError();

    if (invitation.kind === 'planner')
      await this.ensurePlannerProfile({ userId, user, acceptance, now });

    const result = await this.store.accept({
      tokenHash,
      membershipId: uuidV7({ now: now.getTime() }),
      partnerSlot: choice?.slot ?? null,
      partnerTitle: choice?.title ?? null,
      acceptedForEmail: mismatch ? user.email : null,
    });
    if (result === 'not_pending') throw new InvitationInvalidError({ reason: 'used' });
    if (result === 'owners_full' || result === 'partner_taken') throw new OwnersFullError();
    if (result === 'planner_already') throw new PlannerAlreadyError();

    // Decisão 178: quem vira dono passa ao perfil de casal nesta sessão, como no cadastro (171).
    if (invitation.role === 'owner')
      await this.sessions.setActiveProfile({ sessionId, userId, profile: 'couple' });

    let weddingStatus = wedding.status;
    if (invitation.kind === 'couple' && wedding.activeOwners === 0) {
      weddingStatus = await this.store.handOverToCouple({
        weddingId,
        sellerUserId:
          wedding.referralSource === 'created_by_seller' ? wedding.createdByUserId : null,
        now,
      });
      this.afterCommit.schedule(() =>
        this.productEvents.record({ event: { name: 'casal_aceitou', weddingId }, occurredAt: now }),
      );
    }

    return {
      weddingId,
      role: invitation.role,
      weddingStatus,
      attributedToMe: result.attributed,
    };
  }

  /** RN10: quem aceita sem perfil de cerimonialista ganha o mínimo (só o nome). */
  private async ensurePlannerProfile({
    userId,
    user,
    acceptance,
    now,
  }: {
    userId: string;
    user: { name: string | null };
    acceptance: InvitationAcceptance;
    now: Date;
  }): Promise<void> {
    const referrerKind = await this.plannerProfiles.referrerKind({ userId });
    if (referrerKind === 'planner') return;
    if (referrerKind === 'seller') throw new SellerCannotBePlannerError();
    const name = user.name ?? (acceptance.name ? cleanText({ value: acceptance.name }) : null);
    if (!name) throw new AcceptanceDetailsMissingError({ field: 'name' });
    if (!user.name) await this.accountNames.setName({ userId, name });
    await this.plannerProfiles.createMinimal({ userId, name, now });
  }
}
