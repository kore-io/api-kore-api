import { Inject, Injectable } from '@nestjs/common';
import {
  AdminWeddingNotFoundError,
  AlreadyPaidError,
  ReassignPaymentPendingError,
  ReferrerNotActiveError,
} from '../domain/backoffice.errors';
import type { StaffMember } from '../domain/staff';
import {
  REFERRER_REASSIGNMENT,
  type ReferrerReassignment,
} from './ports/referrer-reassignment.port';

/** Reatribuir o indicador (Backoffice - acesso RN07): só o Admin (a rota recorta o papel). */
@Injectable()
export class ReassignReferrer {
  constructor(@Inject(REFERRER_REASSIGNMENT) private readonly store: ReferrerReassignment) {}

  async execute({
    staff,
    weddingId,
    referrerId,
    reason,
    now,
  }: {
    staff: StaffMember;
    weddingId: string;
    referrerId: string | null;
    reason: string;
    now: Date;
  }): Promise<'reassigned' | 'unchanged'> {
    const outcome = await this.store.reassign({
      weddingId,
      referrerId,
      byUserId: staff.userId,
      reason,
      now,
    });
    switch (outcome.result) {
      case 'not_found':
        throw new AdminWeddingNotFoundError();
      case 'already_paid':
        throw new AlreadyPaidError(outcome.paidAt);
      case 'payment_pending':
        throw new ReassignPaymentPendingError();
      case 'referrer_not_active':
        throw new ReferrerNotActiveError();
      default:
        return outcome.result;
    }
  }
}
