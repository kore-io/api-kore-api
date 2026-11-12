import { Inject, Injectable } from '@nestjs/common';
import { firstName } from '../domain/access-invitation';
import { InvitationInvalidError, InvitationNotDeclinableError } from '../domain/access.errors';
import { invalidReason, type InvitationSnapshot } from '../domain/invitation-acceptance';
import {
  DECLINE_NOTICE_MAILER,
  type DeclineNoticeMailer,
} from './ports/decline-notice-mailer.port';
import {
  INVITATION_ACCEPTANCE_STORE,
  type InvitationAcceptanceStore,
} from './ports/invitation-acceptance-store.port';
import { INVITATION_TOKENS, type InvitationTokens } from './ports/invitation-tokens.port';
import { USER_ACCOUNT_NAMES, type UserAccountNames } from './ports/user-account-names.port';

/**
 * Recusa o convite sem login (RN11; decisão 136): o link é a credencial. O link
 * sem e-mail não tem Recusar e segue válido. O aviso (e-mail 5) vai a quem
 * convidou depois de a recusa estar gravada.
 */
@Injectable()
export class DeclineAccessInvitation {
  constructor(
    @Inject(INVITATION_ACCEPTANCE_STORE) private readonly store: InvitationAcceptanceStore,
    @Inject(INVITATION_TOKENS) private readonly tokens: InvitationTokens,
    @Inject(USER_ACCOUNT_NAMES) private readonly accountNames: UserAccountNames,
    @Inject(DECLINE_NOTICE_MAILER) private readonly mailer: DeclineNoticeMailer,
  ) {}

  async execute({ token, now }: { token: string; now: Date }): Promise<void> {
    const tokenHash = this.tokens.hash({ token });
    const invitation = await this.store.findByToken({ tokenHash });
    if (!invitation) throw new InvitationInvalidError({ reason: 'used' });
    const reason = invalidReason({ invitation, now });
    if (reason) throw new InvitationInvalidError({ reason });
    if (!invitation.email) throw new InvitationNotDeclinableError();
    if (!(await this.store.decline({ tokenHash })))
      throw new InvitationInvalidError({ reason: 'used' });

    const partners = invitation.wedding.partners.slice().sort((a, b) => a.slot - b.slot);
    const [partner1, partner2] = partners.map((partner) =>
      firstName({ name: partner.displayName }),
    );
    await this.mailer.send({
      notice: {
        kind: invitation.kind,
        to: invitation.inviter.email,
        inviterName: firstName({
          name: invitation.inviter.partnerName ?? invitation.inviter.name ?? '',
        }),
        declinedBy: await this.declinedBy({ invitation, email: invitation.email }),
        partnerNames: [partner1 ?? '', partner2 ?? ''],
        inviterIsOwner: invitation.kind !== 'couple',
      },
    });
  }

  /**
   * Voz & Microcopy, e-mail 5: no parceiro, o nome do noivo sem login; no casal,
   * o e-mail convidado; no cerimonialista, o primeiro nome da conta, se houver.
   */
  private async declinedBy({
    invitation,
    email,
  }: {
    invitation: InvitationSnapshot;
    email: string;
  }): Promise<string> {
    if (invitation.kind === 'couple') return email;
    if (invitation.kind === 'partner') {
      const invited = invitation.wedding.partners.find((partner) => partner.userId === null);
      return invited ? firstName({ name: invited.displayName }) : email;
    }
    const name = await this.accountNames.nameByEmail({ email });
    return name ? firstName({ name }) : email;
  }
}
