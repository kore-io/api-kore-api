import { Inject, Injectable } from '@nestjs/common';
import { AFTER_COMMIT, type AfterCommit } from '../../../shared/database/after-commit.port';
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
  COLLABORATION_NOTICE_MAILER,
  type CollaborationNoticeMailer,
} from './ports/collaboration-notice-mailer.port';
import {
  WEDDING_MEMBERS_STORE,
  type WeddingMembersStore,
} from './ports/wedding-members-store.port';
import { WeddingAuthorization } from './wedding-authorization.service';

/**
 * Encerra um vínculo e corta o acesso na hora (RN06, RN07 e RN10 de Papéis). O
 * registro no log da aplicação vai na mesma transação da remoção: os dois valem
 * juntos ou nenhum (decisão 179). Quando a cerimonialista sai por conta
 * própria, as pessoas donas recebem um e-mail depois do commit (Papéis RN06;
 * Notificações da cerimonialista RN09; D19).
 */
@Injectable()
export class RemoveMembership {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(WEDDING_MEMBERS_STORE) private readonly store: WeddingMembersStore,
    @Inject(APPLICATION_LOG_WRITER) private readonly log: ApplicationLogWriter,
    @Inject(COLLABORATION_NOTICE_MAILER) private readonly mailer: CollaborationNoticeMailer,
    @Inject(AFTER_COMMIT) private readonly afterCommit: AfterCommit,
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

    const leaving = target.userId === userId;
    // Lido antes da remoção: depois, a RLS já não mostra o casamento a ela.
    // Só a cerimonialista com Planner; o vendedor não sai por conta própria.
    const notices =
      leaving && target.role === 'collaborator'
        ? await this.store.plannerLeftNotices({ weddingId, userId })
        : [];
    await this.store.remove({ membershipId, removedByUserId: userId, now });
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
    if (notices.length > 0)
      this.afterCommit.schedule(async () => {
        for (const notice of notices) await this.mailer.plannerLeft({ notice });
      });
  }
}
