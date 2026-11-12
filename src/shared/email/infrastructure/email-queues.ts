import type { JobsOptions } from 'bullmq';
import type { EmailPriority } from '../application/email-outbox.port';

export const LOGIN_EMAIL_QUEUE = 'emails-login';
export const DEFAULT_EMAIL_QUEUE = 'emails';

export const EMAIL_QUEUE_BY_PRIORITY: Record<EmailPriority, string> = {
  login: LOGIN_EMAIL_QUEUE,
  default: DEFAULT_EMAIL_QUEUE,
};

export const DELIVER_EMAIL_JOB = 'deliver';

/**
 * O job carrega o e-mail pronto, inclusive o código de login: sai do Redis
 * assim que é enviado ou desiste (removeOnComplete e removeOnFail).
 */
export const EMAIL_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: true,
  removeOnFail: true,
};
