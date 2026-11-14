import { Inject, Injectable, Logger } from '@nestjs/common';
import { SendAccessEmailChanged } from '../../access/application/send-access-email-changed.use-case';
import { IpHasher } from '../../logs/infrastructure/ip-hasher';
import { maskEmail } from '../domain/access-email-change';
import {
  AccessChangeRateLimitedError,
  AccessEmailLockedError,
  AdminOnlyError,
  AdminWeddingNotFoundError,
  ChecksFailedError,
  ChecksRequiredError,
  EmailInUseError,
  NotAnOwnerError,
  NotLockedError,
  UnlockTooSoonError,
} from '../domain/backoffice.errors';
import type { StaffMember } from '../domain/staff';
import { ACCESS_EMAIL_CHANGES, type AccessEmailChanges } from './ports/access-email-changes.port';

const logger = new Logger('ChangeAccessEmail');

/**
 * Ajudar a recuperar o acesso (Backoffice - acesso RN09; decisões 231 e 253):
 * Admin e suporte, com as 3 confirmações (as duas caixas e os 4 dígitos que o
 * servidor confere), os limites da 253 e, depois do commit, o link ao
 * endereço novo e o aviso ao antigo.
 */
@Injectable()
export class ChangeAccessEmail {
  constructor(
    @Inject(ACCESS_EMAIL_CHANGES) private readonly changes: AccessEmailChanges,
    private readonly notices: SendAccessEmailChanged,
    private readonly ipHasher: IpHasher,
  ) {}

  async execute({
    staff,
    weddingId,
    userId,
    newEmail,
    checks,
    payerLast4,
    reason,
    ip,
    now,
  }: {
    staff: StaffMember;
    weddingId: string;
    userId: string;
    newEmail: string;
    checks: { eventDateAndCity: boolean; partnerName: boolean };
    payerLast4: string | null;
    reason: string;
    ip: string | null;
    now: Date;
  }): Promise<void> {
    if (!checks.eventDateAndCity || !checks.partnerName) throw new ChecksRequiredError();
    const outcome = await this.changes.change({
      staff,
      weddingId,
      userId,
      newEmail: newEmail.trim().toLowerCase(),
      payerLast4,
      reason,
      ipHash: ip ? this.ipHasher.hash({ ip }) : null,
      now,
    });
    switch (outcome.result) {
      case 'changed':
        break;
      case 'not_found':
        throw new AdminWeddingNotFoundError();
      case 'not_allowed':
        throw new NotAnOwnerError();
      case 'admin_only':
        throw new AdminOnlyError();
      case 'rate_limited':
        throw new AccessChangeRateLimitedError(outcome.retryAt);
      case 'locked':
        throw new AccessEmailLockedError(outcome.availableAt);
      case 'checks_required':
        throw new ChecksRequiredError();
      case 'checks_failed':
        throw new ChecksFailedError();
      case 'email_in_use':
        throw new EmailInUseError();
    }
    try {
      await this.notices.execute({
        oldEmail: outcome.oldEmail,
        newEmail: outcome.newEmail,
        newEmailMasked: maskEmail(outcome.newEmail),
        now,
      });
    } catch (error) {
      // A troca já valeu: a pessoa entra pelo código no e-mail novo.
      logger.warn(`Avisos da troca de acesso não saíram: ${(error as Error).name}`);
    }
  }

  /** Liberar a trava do casamento (decisão 253(1)): só o Admin, com motivo. */
  async unlock({
    staff,
    weddingId,
    reason,
    ip,
    now,
  }: {
    staff: StaffMember;
    weddingId: string;
    reason: string;
    ip: string | null;
    now: Date;
  }): Promise<void> {
    const outcome = await this.changes.unlock({
      staff,
      weddingId,
      reason,
      ipHash: ip ? this.ipHasher.hash({ ip }) : null,
      now,
    });
    if (outcome.result === 'not_found') throw new AdminWeddingNotFoundError();
    if (outcome.result === 'not_locked') throw new NotLockedError();
    if (outcome.result === 'too_soon') throw new UnlockTooSoonError(outcome.availableAt);
  }
}
