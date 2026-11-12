import { localDate } from '../../../shared/time/local-date';
import { GUEST_NAME_MAX, type AgeGroup, type RsvpStatus } from '../../guests/domain/party';

/** Restrição alimentar (RSVP RN03; decisão 189(9)) e sugestão de música (Música RN04). */
export const DIETARY_RESTRICTION_MAX = 200;
export const SONG_SUGGESTION_MAX = 120;
/** A pergunta de música padrão (Música RN01; decisão 91 a). */
export const DEFAULT_SONG_QUESTION = 'Que música não pode faltar na festa?';
/** Teto de gravações por grupo por dia, no fuso do casamento (RSVP RN10). */
export const RSVP_DAILY_LIMIT = 50;

/** Onde o formulário está (RSVP RN01 e RN08). A prévia é decidida fora daqui. */
export type RsvpState = 'open' | 'deadline_passed' | 'post_event';

/**
 * O formulário aceita respostas enquanto o site está publicado e o prazo não
 * venceu (RN08). O prazo vale até as 23h59 do dia, no fuso do casamento
 * (Prazo RN01). O pós-evento (e a carência, que vem depois dele) fecha.
 */
export function rsvpState({
  status,
  rsvpDeadline,
  timezone,
  now,
}: {
  status: string;
  rsvpDeadline: string | null;
  timezone: string | null;
  now: Date;
}): RsvpState {
  if (status !== 'published') return 'post_event';
  if (rsvpDeadline && localDate({ at: now, timezone }) > rsvpDeadline) return 'deadline_passed';
  return 'open';
}

/** Um convidado ativo do grupo, como o RSVP lê e grava. */
export interface RsvpGuest {
  id: string;
  name: string | null;
  isPlusOne: boolean;
  rsvpStatus: RsvpStatus;
  ageGroup: AgeGroup | null;
  dietaryRestriction: string | null;
  songSuggestion: string | null;
  songSuggestedAt: Date | null;
  respondedAt: Date | null;
}

/** Uma resposta do PUT (RSVP, contrato; revisão técnica R2-5). */
export interface RsvpAnswer {
  id: string;
  status: RsvpStatus;
  dietaryRestriction?: string | null;
  songSuggestion?: string | null;
  name?: string | null;
}

export interface RsvpIssue {
  path: string;
  code: string;
  params: Record<string, unknown>;
}

/** O convidado depois da gravação, com o que mudou. */
export interface RsvpGuestUpdate {
  before: RsvpGuest;
  after: RsvpGuest;
  /** Muda o "Respondido em" e os números (RN07; R2-13). */
  statusChanged: boolean;
}

export type RsvpPlan =
  | { ok: false; issues: RsvpIssue[] }
  | { ok: true; updates: RsvpGuestUpdate[]; guests: RsvpGuest[] };

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const clean = (value: string | null | undefined): string | null =>
  value === null || value === undefined ? null : value.trim() || null;

/**
 * Confere e monta a gravação do grupo (RSVP RN04 a RN07; Música RN04):
 * - a lista traz todos os convidados com nome do grupo, sem repetir; a vaga
 *   pode faltar (fica como está);
 * - `pending` e `name` só na vaga; a vaga com Vou levar precisa do nome;
 * - com Não vou (ou a vaga sem resposta), a restrição, a música e o nome da
 *   vaga são apagados: o CHECK do banco exige a música vazia fora do confirmado;
 * - a música é ignorada com a pergunta desligada (e a guardada fica); campo
 *   ausente mantém o valor atual;
 * - quem assina é um convidado com nome do grupo, que não seja a vaga;
 * - o "Respondido em" do convidado muda só com a resposta ou o nome da vaga.
 * A ordem dos convidados é a do grupo (RN17).
 */
export function planRsvp({
  guests,
  answers,
  signedByGuestId,
  songQuestionEnabled,
  now,
}: {
  guests: readonly RsvpGuest[];
  answers: readonly RsvpAnswer[];
  signedByGuestId: string;
  songQuestionEnabled: boolean;
  now: Date;
}): RsvpPlan {
  const issues: RsvpIssue[] = [];
  const byId = new Map(guests.map((guest) => [guest.id, guest]));
  const answered = new Map<string, RsvpAnswer>();
  const tooLong = (path: string, value: string | null, max: number) => {
    if (value !== null && value.length > max)
      issues.push({ path, code: 'TOO_LONG', params: { max } });
  };

  answers.forEach((answer, index) => {
    const path = `guests.${index}`;
    if (answered.has(answer.id)) {
      issues.push({ path: `${path}.id`, code: 'DUPLICATE_GUEST', params: {} });
      return;
    }
    const guest = byId.get(answer.id);
    if (!guest) {
      issues.push({ path: `${path}.id`, code: 'GUEST_NOT_IN_PARTY', params: {} });
      return;
    }
    answered.set(answer.id, answer);
    if (!guest.isPlusOne) {
      if (answer.status === 'pending')
        issues.push({ path: `${path}.status`, code: 'PENDING_NOT_ALLOWED', params: {} });
      if (answer.name !== undefined && answer.name !== null)
        issues.push({ path: `${path}.name`, code: 'NAME_NOT_ALLOWED', params: {} });
    } else if (answer.status === 'confirmed') {
      const name = clean(answer.name);
      if (name === null) issues.push({ path: `${path}.name`, code: 'IS_NOT_EMPTY', params: {} });
      else if (CONTROL_CHARACTERS.test(name))
        issues.push({ path: `${path}.name`, code: 'CONTROL_CHARACTER', params: {} });
      else tooLong(`${path}.name`, name, GUEST_NAME_MAX);
    }
    if (answer.status === 'confirmed') {
      tooLong(
        `${path}.dietaryRestriction`,
        clean(answer.dietaryRestriction),
        DIETARY_RESTRICTION_MAX,
      );
      if (songQuestionEnabled)
        tooLong(`${path}.songSuggestion`, clean(answer.songSuggestion), SONG_SUGGESTION_MAX);
    }
  });
  for (const guest of guests)
    if (!guest.isPlusOne && !answered.has(guest.id))
      issues.push({ path: 'guests', code: 'ANSWER_MISSING', params: { guestId: guest.id } });
  const signer = byId.get(signedByGuestId);
  if (!signer || signer.isPlusOne)
    issues.push({ path: 'signedByGuestId', code: 'SIGNER_INVALID', params: {} });
  if (issues.length > 0) return { ok: false, issues };

  const updates: RsvpGuestUpdate[] = [];
  const after = guests.map((guest) => {
    const answer = answered.get(guest.id);
    if (!answer) return guest;
    const confirmed = answer.status === 'confirmed';
    const name = guest.isPlusOne ? (confirmed ? clean(answer.name) : null) : guest.name;
    const dietaryRestriction = !confirmed
      ? null
      : answer.dietaryRestriction === undefined
        ? guest.dietaryRestriction
        : clean(answer.dietaryRestriction);
    const songSuggestion = !confirmed
      ? null
      : !songQuestionEnabled || answer.songSuggestion === undefined
        ? guest.songSuggestion
        : clean(answer.songSuggestion);
    const statusChanged = answer.status !== guest.rsvpStatus;
    const nameChanged = name !== guest.name;
    const next: RsvpGuest = {
      ...guest,
      name,
      rsvpStatus: answer.status,
      dietaryRestriction,
      songSuggestion,
      // A hora da sugestão muda só quando o texto muda (Música RN04).
      songSuggestedAt:
        songSuggestion === null
          ? null
          : songSuggestion === guest.songSuggestion
            ? guest.songSuggestedAt
            : now,
      respondedAt:
        answer.status === 'pending' ? null : statusChanged || nameChanged ? now : guest.respondedAt,
    };
    if (
      statusChanged ||
      nameChanged ||
      dietaryRestriction !== guest.dietaryRestriction ||
      songSuggestion !== guest.songSuggestion
    )
      updates.push({ before: guest, after: next, statusChanged });
    return next;
  });
  return { ok: true, updates, guests: after };
}

/** Os totais do grupo depois da gravação (RsvpSubmission; Central RN04). */
export function partyCounts({ guests }: { guests: readonly RsvpGuest[] }): {
  confirmed: number;
  declined: number;
} {
  return {
    confirmed: guests.filter((guest) => guest.rsvpStatus === 'confirmed').length,
    declined: guests.filter((guest) => guest.rsvpStatus === 'declined').length,
  };
}

/**
 * O "Respondido em" do grupo (Prazo RN06): a resposta mais recente entre os
 * convidados com nome (a vaga não entra), nulo enquanto o grupo não está
 * respondido.
 */
export function partyRespondedAt({
  guests,
  responded,
}: {
  guests: readonly RsvpGuest[];
  responded: boolean;
}): Date | null {
  if (!responded) return null;
  const times = guests
    .filter((guest) => !guest.isPlusOne && guest.respondedAt)
    .map((guest) => guest.respondedAt!.getTime());
  return times.length > 0 ? new Date(Math.max(...times)) : null;
}

/** A alteração do casal (Prazo RN04): Vai · Não vai, a restrição e, na vaga, o nome. */
export interface CoupleAnswer {
  status: 'confirmed' | 'declined';
  dietaryRestriction?: string | null;
  name?: string | null;
}

/**
 * Confere e monta a alteração de um convidado pelo casal (Prazo RN04):
 * - o nome só na vaga; Vai na vaga pede o nome; Não vai sem nome é o "não vou
 *   levar", e tirar o nome de uma vaga com resposta a deixa recusada;
 * - a música não muda pelo casal; com Não vai, a restrição e a música são
 *   apagadas (o CHECK do banco, na mesma escrita);
 * - o "Respondido em" muda só com a resposta ou o nome da vaga.
 */
export function planCoupleResponse({
  guest,
  answer,
  now,
}: {
  guest: RsvpGuest;
  answer: CoupleAnswer;
  now: Date;
}): { ok: false; issues: RsvpIssue[] } | { ok: true; update: RsvpGuestUpdate | null } {
  const issues: RsvpIssue[] = [];
  const confirmed = answer.status === 'confirmed';
  const name = guest.isPlusOne ? clean(answer.name) : guest.name;
  if (!guest.isPlusOne && answer.name !== undefined && answer.name !== null)
    issues.push({ path: 'name', code: 'NAME_NOT_ALLOWED', params: {} });
  if (guest.isPlusOne && confirmed) {
    if (name === null) issues.push({ path: 'name', code: 'IS_NOT_EMPTY', params: {} });
    else if (CONTROL_CHARACTERS.test(name))
      issues.push({ path: 'name', code: 'CONTROL_CHARACTER', params: {} });
    else if (name.length > GUEST_NAME_MAX)
      issues.push({ path: 'name', code: 'TOO_LONG', params: { max: GUEST_NAME_MAX } });
  }
  const dietary = clean(answer.dietaryRestriction);
  if (confirmed && dietary !== null && dietary.length > DIETARY_RESTRICTION_MAX)
    issues.push({
      path: 'dietaryRestriction',
      code: 'TOO_LONG',
      params: { max: DIETARY_RESTRICTION_MAX },
    });
  if (issues.length > 0) return { ok: false, issues };

  const nextName = guest.isPlusOne ? (confirmed ? name : null) : guest.name;
  const dietaryRestriction = !confirmed
    ? null
    : answer.dietaryRestriction === undefined
      ? guest.dietaryRestriction
      : dietary;
  const songSuggestion = confirmed ? guest.songSuggestion : null;
  const statusChanged = answer.status !== guest.rsvpStatus;
  const nameChanged = nextName !== guest.name;
  if (
    !statusChanged &&
    !nameChanged &&
    dietaryRestriction === guest.dietaryRestriction &&
    songSuggestion === guest.songSuggestion
  )
    return { ok: true, update: null };
  return {
    ok: true,
    update: {
      before: guest,
      after: {
        ...guest,
        name: nextName,
        rsvpStatus: answer.status,
        dietaryRestriction,
        songSuggestion,
        songSuggestedAt: songSuggestion === null ? null : guest.songSuggestedAt,
        respondedAt: statusChanged || nameChanged ? now : guest.respondedAt,
      },
      statusChanged,
    },
  };
}

/** Depois do prazo ou no pós-evento, só o dono altera respostas (Prazo RN04). */
export function isAfterDeadline({
  status,
  rsvpDeadline,
  timezone,
  now,
}: {
  status: string;
  rsvpDeadline: string | null;
  timezone: string | null;
  now: Date;
}): boolean {
  if (status === 'post_event' || status === 'grace' || status === 'expired') return true;
  return rsvpDeadline !== null && localDate({ at: now, timezone }) > rsvpDeadline;
}
