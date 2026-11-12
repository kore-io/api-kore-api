import type { RsvpIssue } from './rsvp';

/** Sem o cookie do grupo, ou ele não vale mais (401 PARTY_SESSION_INVALID; RSVP RN11). */
export class PartySessionInvalidError extends Error {
  override name = 'PartySessionInvalidError';
}

/** O PUT com o cookie da prévia (403 PREVIEW_READ_ONLY; RSVP RN01). */
export class PreviewReadOnlyError extends Error {
  override name = 'PreviewReadOnlyError';
}

/** Validação do envio que depende do grupo (400 com errors[]; RSVP RN04 a RN06, R2-5). */
export class RsvpInvalidError extends Error {
  override name = 'RsvpInvalidError';
  readonly issues: readonly RsvpIssue[];

  constructor({ issues }: { issues: readonly RsvpIssue[] }) {
    super();
    this.issues = issues;
  }
}

/** A versão do grupo mudou (409 RSVP_CHANGED, com as respostas atuais; RN07 e RN11). */
export class RsvpChangedError<T = unknown> extends Error {
  override name = 'RsvpChangedError';
  readonly current: T;

  constructor({ current }: { current: T }) {
    super();
    this.current = current;
  }
}

/** Depois do prazo ou no pós-evento (409 RSVP_CLOSED; RN08). */
export class RsvpClosedError extends Error {
  override name = 'RsvpClosedError';
  readonly reason: 'deadline_passed' | 'post_event';

  constructor({ reason }: { reason: 'deadline_passed' | 'post_event' }) {
    super();
    this.reason = reason;
  }
}

/** Limite por IP e grupo (429 RSVP_RATE_LIMITED; RN10). */
export class RsvpRateLimitedError extends Error {
  override name = 'RsvpRateLimitedError';
}

/** Teto de gravações do grupo no dia (429 RSVP_LIMIT; RN10). */
export class RsvpLimitError extends Error {
  override name = 'RsvpLimitError';
}
