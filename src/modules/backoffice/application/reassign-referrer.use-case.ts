import { Inject, Injectable } from '@nestjs/common';
import { IpHasher } from '../../logs/infrastructure/ip-hasher';
import {
  AdminWeddingNotFoundError,
  AlreadyPaidError,
  ReassignPaymentPendingError,
  ReferrerNotActiveError,
  SelfReferralError,
} from '../domain/backoffice.errors';
import type { StaffMember } from '../domain/staff';
import {
  REFERRER_REASSIGNMENT,
  type ReferrerReassignment,
} from './ports/referrer-reassignment.port';

/** Reatribuir o indicador (Backoffice - acesso RN07): só o Admin (a rota recorta o papel). */
@Injectable()
export class ReassignReferrer {
  constructor(
    @Inject(REFERRER_REASSIGNMENT) private readonly store: ReferrerReassignment,
    private readonly ipHasher: IpHasher,
  ) {}

  async execute({
    staff,
    weddingId,
    referrerId,
    reason,
    ip,
    now,
  }: {
    staff: StaffMember;
    weddingId: string;
    referrerId: string | null;
    reason: string;
    ip: string | null;
    now: Date;
  }): Promise<'reassigned' | 'unchanged'> {
    const outcome = await this.store.reassign({
      weddingId,
      referrerId,
      byUserId: staff.userId,
      reason,
      ipHash: ip ? this.ipHasher.hash({ ip }) : null,
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
      case 'self_referral':
        throw new SelfReferralError();
      default:
        return outcome.result;
    }
  }
}
