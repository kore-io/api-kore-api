import { Inject, Injectable } from '@nestjs/common';
import { firstName, type AccessInvitationKind } from '../domain/access-invitation';
import { InvitationInvalidError, SelfReferralError } from '../domain/access.errors';
import {
  coupleNames,
  emailDiffers,
  invalidReason,
  isSelfReferral,
  type InvitationSnapshot,
} from '../domain/invitation-acceptance';
import { toReferral } from '../domain/referral';
import {
  INVITATION_ACCEPTANCE_STORE,
  type InvitationAcceptanceStore,
} from './ports/invitation-acceptance-store.port';
import { INVITATION_TOKENS, type InvitationTokens } from './ports/invitation-tokens.port';
import { USER_REPOSITORY, type UserRepository } from './ports/user-repository.port';

export type InviterRole = 'owner' | 'planner' | 'seller';

export interface AccessInvitationView {
  kind: AccessInvitationKind;
  email: string | null;
  invitedBy: { name: string; role: InviterRole };
  wedding: {
    names: string;
    eventDate: Date | null;
    city: string;
    state: string;
    /** Todo convite do casal: os dois nomes para "Quem é você?" (decisão 173). */
    partnerNames?: [string, string];
    /** Só no do parceiro: o noivo livre ainda não tem título (decisões 172 e 173). */
    partnerTitleNeeded?: boolean;
  };
  /** Só no do casal; nulo até a fase da Aparência (decisão 168, item 5). */
  sitePreview?: null;
  /** Só no do casal: o indicador válido e o desconto (RN09 de Cadastro). */
  referrer?: { name: string; discountPercent: number | null } | null;
  sessionEmailMismatch: boolean;
  /** Do cerimonialista, com sessão de conta sem nome: o aceite pede o nome (decisão 173). */
  needsName: boolean;
}

/** Quem convidou, como a tela mostra (decisão 168, item 6): só o nome. */
export function inviterOf({ invitation }: { invitation: InvitationSnapshot }): {
  name: string;
  role: InviterRole;
} {
  const { inviter } = invitation;
  if (inviter.partnerName) return { name: firstName({ name: inviter.partnerName }), role: 'owner' };
  if (inviter.referrerKind === 'planner')
    return { name: inviter.creditName ?? firstName({ name: inviter.name ?? '' }), role: 'planner' };
  if (inviter.referrerKind === 'seller')
    return { name: firstName({ name: inviter.name ?? '' }), role: 'seller' };
  return { name: firstName({ name: inviter.name ?? '' }), role: 'owner' };
}

/** Mostra o convite antes do aceite (RN06, RN07, RN12; GET /v1/access-invitations/{token}). */
@Injectable()
export class GetAccessInvitation {
  constructor(
    @Inject(INVITATION_ACCEPTANCE_STORE) private readonly store: InvitationAcceptanceStore,
    @Inject(INVITATION_TOKENS) private readonly tokens: InvitationTokens,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  async execute({
    token,
    sessionUserId,
    now,
  }: {
    token: string;
    sessionUserId: string | null;
    now: Date;
  }): Promise<AccessInvitationView> {
    const invitation = await this.store.findByToken({ tokenHash: this.tokens.hash({ token }) });
    // Token desconhecido: o mesmo 410 do usado, sem revelar nada (RN12).
    if (!invitation) throw new InvitationInvalidError({ reason: 'used' });
    const reason = invalidReason({ invitation, now });
    if (reason) throw new InvitationInvalidError({ reason });
    // Novo casamento RN05: com sessão, a prévia já acusa a autoindicação, e o
    // app mostra o Convite inválido antes de a pessoa tentar aceitar.
    if (sessionUserId && isSelfReferral({ invitation, userId: sessionUserId }))
      throw new SelfReferralError();

    const sessionUser = sessionUserId
      ? await this.users.findProfileById({ userId: sessionUserId })
      : null;
    const sessionEmail = sessionUser?.email ?? null;
    const { wedding } = invitation;
    const [partner1, partner2] = wedding.partners
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((partner) => partner.displayName);

    return {
      kind: invitation.kind,
      email: invitation.email,
      invitedBy: inviterOf({ invitation }),
      wedding: {
        names: coupleNames({ partners: wedding.partners }),
        eventDate: wedding.eventDate,
        city: wedding.city,
        state: wedding.state,
        ...(invitation.kind === 'couple' && partner1 && partner2
          ? { partnerNames: [partner1, partner2] }
          : {}),
        ...(invitation.kind === 'partner'
          ? {
              partnerTitleNeeded: wedding.partners.some(
                (partner) => partner.userId === null && partner.title === null,
              ),
            }
          : {}),
      },
      ...(invitation.kind === 'couple'
        ? {
            sitePreview: null,
            referrer: invitation.referrer
              ? (() => {
                  const referral = toReferral({
                    referrer: invitation.referrer,
                    referralDiscountPercent: invitation.referralDiscountPercent,
                  });
                  return referral
                    ? { name: referral.referrerName, discountPercent: referral.discountPercent }
                    : null;
                })()
              : null,
          }
        : {}),
      sessionEmailMismatch:
        sessionEmail !== null && emailDiffers({ invitationEmail: invitation.email, sessionEmail }),
      needsName: invitation.kind === 'planner' && sessionUser !== null && !sessionUser.name,
    };
  }
}
