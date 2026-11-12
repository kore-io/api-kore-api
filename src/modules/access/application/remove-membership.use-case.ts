import { Inject, Injectable } from '@nestjs/common';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import {
  CannotRemoveOwnerError,
  LastOwnerError,
  MembershipNotFoundError,
  WeddingActionForbiddenError,
  WeddingHasNoOwnerError,
} from '../domain/access.errors';
import { removalRefusal } from '../domain/membership-removal';
import {
  WEDDING_MEMBERS_STORE,
  type WeddingMembersStore,
} from './ports/wedding-members-store.port';
import { WeddingAuthorization } from './wedding-authorization.service';

/**
 * Encerra um vínculo e corta o acesso na hora (RN06, RN07 e RN10 de Papéis). O
 * registro no log da aplicação vai na mesma transação da remoção: os dois valem
 * juntos ou nenhum (decisão 179). O aviso ao casal quando o cerimonialista sai
 * fica para Notificações (decisão 177, item 9).
 */
@Injectable()
export class RemoveMembership {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(WEDDING_MEMBERS_STORE) private readonly store: WeddingMembersStore,
    @Inject(APPLICATION_LOG_WRITER) private readonly log: ApplicationLogWriter,
  ) {}

  async execute({
    userId,
    weddingId,
    membershipId,
    ip,
    now,
  }: {
    userId: string;
    weddingId: string;
    membershipId: string;
    ip: string | null;
    now: Date;
  }): Promise<void> {
    const requesterRole = await this.authorization.require({ userId, weddingId, action: 'view' });
    await this.store.lockWedding({ weddingId });
    const members = await this.store.listActive({ weddingId });
    const target = members.find((member) => member.id === membershipId);
    if (!target) throw new MembershipNotFoundError();

    const refusal = removalRefusal({
      requesterId: userId,
      requesterRole,
      target,
      activeOwners: members.filter((member) => member.role === 'owner').length,
    });
    if (refusal === 'last_owner') throw new LastOwnerError();
    if (refusal === 'cannot_remove_owner') throw new CannotRemoveOwnerError();
    if (refusal === 'wedding_has_no_owner') throw new WeddingHasNoOwnerError();
    if (refusal) throw new WeddingActionForbiddenError();

    await this.store.remove({ membershipId, removedByUserId: userId, now });
    const leaving = target.userId === userId;
    if (leaving && target.role === 'owner') await this.store.releasePartnerLogin({ weddingId });
    // Notificações da cerimonialista RN04: o dono removeu a colaboradora; quando
    // ela sai por conta própria, nada.
    if (!leaving && target.role === 'collaborator')
      await this.store.notifyRemoved({
        membershipId,
        notificationId: uuidV7({ now: now.getTime() }),
      });

    await this.log.record({
      entry: {
        action: leaving ? 'membership.left' : 'membership.removed',
        actorKind: 'user',
        actorUserId: userId,
        weddingId,
        entityType: 'membership',
        entityId: membershipId,
        data: { membershipId, role: target.role },
        ...(ip ? { ip } : {}),
      },
    });
  }
}
