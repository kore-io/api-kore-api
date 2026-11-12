import type { DeliveryStatus, RsvpStatus } from './party';
import { canBeContact } from './party';

/** Um convidado ativo do grupo, na ordem do grupo (RN17). */
export interface GroupMember {
  id: string;
  name: string | null;
  isPlusOne: boolean;
  rsvpStatus: RsvpStatus;
  phone: string | null;
  email: string | null;
}

/** Vaga vazia: acompanhante sem nome, em qualquer resposta (decisão 186, item 13). */
export function isEmptySlot({ isPlusOne, name }: Pick<GroupMember, 'isPlusOne' | 'name'>): boolean {
  return isPlusOne && name === null;
}

/**
 * O contato do grupo depois de uma mudança (RN06): o atual continua se ainda
 * está no grupo e tem telefone ou e-mail; senão, passa ao primeiro do grupo,
 * na ordem do grupo, com telefone ou e-mail; ninguém, o grupo fica sem contato.
 * Vaga vazia nunca é contato.
 */
export function contactAfter({
  currentContactId,
  members,
}: {
  currentContactId: string | null;
  members: readonly GroupMember[];
}): string | null {
  const eligible = members.filter((member) => !isEmptySlot(member) && canBeContact(member));
  if (currentContactId && eligible.some((member) => member.id === currentContactId))
    return currentContactId;
  return eligible[0]?.id ?? null;
}

/** O grupo tem algum convidado ou vaga pendente (partiesPending, RN16). */
export function hasPending({
  members,
}: {
  members: readonly Pick<GroupMember, 'rsvpStatus'>[];
}): boolean {
  return members.some((member) => member.rsvpStatus === 'pending');
}

/**
 * Status de envio depois de uma mudança no grupo (RN10; decisão 199(1)): conta
 * só os convidados com nome; a vaga não segura o "respondido". Sem pendente,
 * um grupo já enviado fica respondido; com pendente, um respondido volta a
 * visualizado ou enviado. Um grupo não enviado não muda, exceto numa resposta
 * (`afterResponse`): a resposta leva a `responded` a partir de qualquer
 * status, inclusive `not_sent` (decisão 217(2), que revê a 199(1) só aí).
 */
export function deliveryStatusAfter({
  current,
  firstViewedAt,
  members,
  afterResponse = false,
}: {
  current: DeliveryStatus;
  firstViewedAt: Date | null;
  members: readonly Pick<GroupMember, 'name' | 'rsvpStatus'>[];
  afterResponse?: boolean;
}): DeliveryStatus {
  if (current === 'not_sent' && !afterResponse) return current;
  const namedPending = members.some(
    (member) => member.name !== null && member.rsvpStatus === 'pending',
  );
  if (!namedPending) return 'responded';
  if (current !== 'responded') return current;
  // Quem respondeu já recebeu o convite: sem visualização gravada, enviado.
  return firstViewedAt ? 'viewed' : 'sent';
}
