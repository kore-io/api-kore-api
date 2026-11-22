import { Inject, Injectable } from '@nestjs/common';
import { canCancel, isPendingAt } from '@/modules/access/domain/invitations/access-invitation';
import {
  InvitationNotFoundError,
  InvitationNotPendingError,
  WeddingActionForbiddenError,
} from '@/modules/access/domain/access.errors';
import {
  ACCESS_INVITATION_STORE,
  type AccessInvitationStore,
} from '@/modules/access/application/ports/access-invitation-store.port';
import { WeddingAuthorization } from '@/modules/access/application/services/wedding-authorization.service';

/**
 * Cancela um convite pendente (RN05 de Convites); o link cai em Convite
 * inválido. Cancelado um convite de dono, sem outro pendente, "aguardando o
 * casal" volta a rascunho (decisão 297); o de colaboradora não mexe no status,
 * como na recusa (o link de dono vencido fica para a rotina, com cause expired).
 */
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
    if (invitation.role === 'owner') await this.store.revertAwaitingCouple({ weddingId, now });
    await this.store.touchActivity({ weddingId, now });
  }
}
