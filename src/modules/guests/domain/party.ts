/** Faixa etária do convidado (Grupos RN03). */
export const AGE_GROUPS = ['adult', 'child', 'baby'] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

export const RSVP_STATUSES = ['pending', 'confirmed', 'declined'] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

export const DELIVERY_STATUSES = ['not_sent', 'sent', 'viewed', 'responded'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Cores de tag: nomes de token do Design System (decisões 191(1) e 192(4)). */
export const TAG_COLORS = ['wine', 'champagne', 'green', 'amber', 'red', 'blue'] as const;
export type TagColor = (typeof TAG_COLORS)[number];

/** Tags ativas por casamento (Tags RN01) e tamanho do nome (RN02; decisão 185(6)). */
export const TAGS_PER_WEDDING_MAX = 10;
export const TAG_NAME_MAX = 40;

/** Limites da RN04 e da RN07 (decisão 184, itens 10 e 12). */
export const PARTY_NAME_MAX = 80;
export const GUEST_NAME_MAX = 80;
export const INTERNAL_NOTE_MAX = 500;
export const PLUS_ONE_SLOTS_MAX = 5;

/** Algo que pode receber o convite: tem telefone ou e-mail (RN06). */
export function canBeContact({
  phone,
  email,
}: {
  phone?: string | null;
  email?: string | null;
}): boolean {
  return Boolean(phone) || Boolean(email);
}

/**
 * O contato padrão (RN06): o primeiro convidado, na ordem do grupo, com
 * telefone ou e-mail; ninguém com contato, o grupo fica sem contato.
 */
export function defaultContactIndex({
  guests,
}: {
  guests: readonly { phone?: string | null; email?: string | null }[];
}): number | null {
  const index = guests.findIndex((guest) => canBeContact(guest));
  return index === -1 ? null : index;
}
