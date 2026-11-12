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

/** Prazo no passado (422 DEADLINE_IN_PAST; Prazo RN01). */
export class DeadlineInPastError extends Error {
  override name = 'DeadlineInPastError';
}

/** Prazo depois da data do casamento (422 DEADLINE_AFTER_EVENT; Prazo RN01). */
export class DeadlineAfterEventError extends Error {
  override name = 'DeadlineAfterEventError';
  readonly eventDate: string;

  constructor({ eventDate }: { eventDate: string }) {
    super();
    this.eventDate = eventDate;
  }
}

/** O convidado não existe neste casamento ou está na lixeira (404 GUEST_NOT_FOUND). */
export class ResponseGuestNotFoundError extends Error {
  override name = 'ResponseGuestNotFoundError';
}

/** A mensagem do convite ou do lembrete sem o {link} (422 LINK_PLACEHOLDER_MISSING; Envios RN06). */
export class LinkPlaceholderMissingError extends Error {
  override name = 'LinkPlaceholderMissingError';
}

/** Os envios não valem agora (409 DELIVERIES_CLOSED; Envios RN01), com o motivo. */
export class DeliveriesClosedError extends Error {
  override name = 'DeliveriesClosedError';
  readonly reason: 'not_published' | 'deadline_passed' | 'post_event';

  constructor({ reason }: { reason: 'not_published' | 'deadline_passed' | 'post_event' }) {
    super();
    this.reason = reason;
  }
}

/** Um grupo pedido não existe neste casamento ou está na lixeira (404 PARTY_NOT_FOUND). */
export class DeliveryPartyNotFoundError extends Error {
  override name = 'DeliveryPartyNotFoundError';
  readonly partyIds: readonly string[];

  constructor({ partyIds }: { partyIds: readonly string[] }) {
    super();
    this.partyIds = partyIds;
  }
}

/**
 * O envio não cabe (422 DELIVERY_NOT_ALLOWED; Envios RN03, RN05 e RN09): grupo
 * fora da fila do lembrete ou o canal QR fora do convite.
 */
export class DeliveryNotAllowedError extends Error {
  override name = 'DeliveryNotAllowedError';
  readonly code: 'PARTY_NOT_REMINDABLE' | 'QR_ONLY_FOR_INVITE';
  readonly partyIds: readonly string[];

  constructor({
    code,
    partyIds = [],
  }: {
    code: 'PARTY_NOT_REMINDABLE' | 'QR_ONLY_FOR_INVITE';
    partyIds?: readonly string[];
  }) {
    super();
    this.code = code;
    this.partyIds = partyIds;
  }
}
