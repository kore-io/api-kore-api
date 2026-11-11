import type { AccessInvitationKind } from './access-invitation';
import type { ReferrerRecord } from './referral';
import type { MembershipRole } from './wedding-authorization';
import type { PartnerTitle } from './wedding-signup';

export interface InvitationPartner {
  slot: 1 | 2;
  displayName: string;
  title: PartnerTitle | null;
  userId: string | null;
}

/** O convite pelo token, como a função do banco devolve (decisão 172). */
export interface InvitationSnapshot {
  id: string;
  weddingId: string;
  kind: AccessInvitationKind;
  email: string | null;
  role: MembershipRole;
  expiresAt: Date;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  revokedAt: Date | null;
  supersededAt: Date | null;
  wedding: {
    status: string;
    eventDate: Date | null;
    city: string;
    state: string;
    createdByUserId: string;
    referralSource: string | null;
    partners: InvitationPartner[];
    activeOwners: number;
    activeCollaborators: number;
  };
  inviter: {
    userId: string;
    email: string;
    name: string | null;
    partnerName: string | null;
    referrerKind: 'planner' | 'seller' | null;
    creditName: string | null;
  };
  /** O indicador a que o casamento está atribuído, se houver. */
  referrer: ReferrerRecord | null;
  referralDiscountPercent: number;
}

/** RN12: por que o link já não vale (sem dados do casamento). */
export type InvalidInvitationReason = 'expired' | 'used' | 'revoked' | 'superseded';

/**
 * RN03 e RN12. Aceito ou recusado conta como usado (decisão 172, item 6); o
 * vencido é o pendente que passou dos 30 dias.
 */
export function invalidReason({
  invitation,
  now,
}: {
  invitation: Pick<
    InvitationSnapshot,
    'acceptedAt' | 'declinedAt' | 'revokedAt' | 'supersededAt' | 'expiresAt'
  >;
  now: Date;
}): InvalidInvitationReason | null {
  if (invitation.acceptedAt || invitation.declinedAt) return 'used';
  if (invitation.revokedAt) return 'revoked';
  if (invitation.supersededAt) return 'superseded';
  if (invitation.expiresAt <= now) return 'expired';
  return null;
}

/** RN07: o convite por e-mail foi para outro endereço; o link sem e-mail não compara. */
export function emailDiffers({
  invitationEmail,
  sessionEmail,
}: {
  invitationEmail: string | null;
  sessionEmail: string;
}): boolean {
  return invitationEmail !== null && invitationEmail.toLowerCase() !== sessionEmail.toLowerCase();
}

/** O primeiro nome dos dois noivos ("Ana & Marcos", decisão 168, item 7). */
export function coupleNames({ partners }: { partners: InvitationPartner[] }): string {
  return partners
    .slice()
    .sort((a, b) => a.slot - b.slot)
    .map((partner) => partner.displayName.trim().split(/\s+/)[0] ?? partner.displayName)
    .join(' & ');
}

export type PartnerChoice = { slot: 1 | 2; title: PartnerTitle | null };

/**
 * Qual noivo recebe o login de quem aceita (decisão 172, itens 1 e 2): no do
 * casal, a pessoa escolhe o nome e diz se é noivo ou noiva ("Quem é você?");
 * no do parceiro, o noivo sem login, e o título só se ele ainda não tiver.
 * 'missing' quando falta a escolha (400); 'taken' quando os dois noivos já têm
 * login; null no do cerimonialista, que não é noivo.
 */
export function partnerChoice({
  kind,
  partners,
  partnerIndex,
  myTitle,
}: {
  kind: AccessInvitationKind;
  partners: InvitationPartner[];
  partnerIndex: 1 | 2 | null;
  myTitle: PartnerTitle | null;
}): PartnerChoice | 'missing' | 'taken' | null {
  if (kind === 'planner') return null;
  if (kind === 'couple') {
    if (!partnerIndex || !myTitle) return 'missing';
    return { slot: partnerIndex, title: myTitle };
  }
  const free = partners.find((partner) => partner.userId === null);
  if (!free) return 'taken';
  if (free.title) return { slot: free.slot, title: null };
  return myTitle ? { slot: free.slot, title: myTitle } : 'missing';
}

/**
 * Código de indicação do perfil mínimo do cerimonialista (decisão 135, item 6):
 * o nome em minúsculas, sem acento, palavras unidas por hífen.
 */
export function referralCodeBase({ name }: { name: string }): string {
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'cerimonialista'
  );
}

/**
 * Se a base repetir, o próximo sufixo numérico livre (decisão 135, item 6;
 * decisão 211): o maior `base-N` em uso + 1, sem teto. `taken` são os códigos
 * em uso que começam pela base (outros nomes, como `ana-silva-prado` para
 * `ana-silva`, são ignorados).
 */
export function nextReferralCode({
  base,
  taken,
}: {
  base: string;
  taken: readonly string[];
}): string {
  if (!taken.includes(base)) return base;
  // A base só tem a-z, 0-9 e hífen: nada a escapar na expressão.
  const suffix = new RegExp(`^${base}-(\\d+)$`);
  const highest = taken.reduce((max, code) => {
    const match = suffix.exec(code);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 1);
  return `${base}-${highest + 1}`;
}
