import { Inject, Injectable } from '@nestjs/common';
import { canCancel, isPendingAt } from '../domain/access-invitation';
import {
  InvitationNotFoundError,
  InvitationNotPendingError,
  WeddingActionForbiddenError,
} from '../domain/access.errors';
import {
  ACCESS_INVITATION_STORE,
  type AccessInvitationStore,
} from './ports/access-invitation-store.port';
import { WeddingAuthorization } from './wedding-authorization.service';

/** Cancela um convite pendente (RN05 de Convites); o link cai em Convite inválido. */
@Injectable()
export class CancelAccessInvitation {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(ACCESS_INVITATION_STORE) private readonly store: AccessInvitationStore,
  ) {}

  async execute({
    userId,
    weddingId,
    invitationId,
    now,
  }: {
    userId: string;
    weddingId: string;
    invitationId: string;
    now: Date;
  }): Promise<void> {
    const role = await this.authorization.require({ userId, weddingId, action: 'view' });
    await this.store.lockWedding({ weddingId });
    const invitation = await this.store.find({ weddingId, invitationId });
    if (!invitation) throw new InvitationNotFoundError();
    if (!canCancel({ invitedByUserId: invitation.invitedByUserId, userId, role }))
      throw new WeddingActionForbiddenError();
    if (!isPendingAt({ invitation, now })) throw new InvitationNotPendingError();
    await this.store.revoke({ invitationId, now });
    await this.store.touchActivity({ weddingId, now });
  }
}
