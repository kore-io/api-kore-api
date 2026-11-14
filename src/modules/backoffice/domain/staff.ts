/** Os papéis da equipe do Kore no Backoffice (Backoffice - acesso RN02; decisões 67 a 69). */
export type StaffRole = 'admin' | 'support';

/** Quem do staff faz a requisição, com o papel lido do banco nesta requisição (RN01). */
export interface StaffMember {
  userId: string;
  role: StaffRole;
}

/** Fora do staff (403 STAFF_ONLY): a resposta não diz qual dos motivos (RN01). */
export class StaffOnlyError extends Error {
  override name = 'StaffOnlyError';
}

/**
 * O guard do Backoffice (RN01): login pelo Google, com o `hd` verificado igual
 * ao domínio da empresa, e o papel `admin` ou `support` no banco. O e-mail
 * verificado já é exigido no login pelo Google.
 */
export function isStaffSession({
  authMethod,
  staffDomain,
  expectedDomain,
}: {
  authMethod: string;
  staffDomain: string | null;
  expectedDomain: string;
}): boolean {
  return authMethod === 'google' && staffDomain !== null && staffDomain === expectedDomain;
}

/**
 * Os alertas de dinheiro (RN02 e RN12; decisão 69): o suporte não os vê nem
 * os resolve. O suporte vê os de acesso, de conteúdo e do expurgo.
 */
export const MONEY_ALERT_TYPES = [
  'orphan_payment',
  'gateway_amount_mismatch',
  'refund_failed',
  'payment_disputed',
  'dispute_lost',
  'repeated_refund',
  'payout_failed',
  'manual_adjustment',
  'pix_key_churn',
  'webhook_failure',
] as const;

export function visibleAlertTypes({
  role,
  all,
}: {
  role: StaffRole;
  all: readonly string[];
}): string[] {
  if (role === 'admin') return [...all];
  return all.filter((type) => !(MONEY_ALERT_TYPES as readonly string[]).includes(type));
}

/** Os valores em centavos ficam fora do que o suporte lê (RN02; decisão 69). */
export function withoutMoney({ data, role }: { data: unknown; role: StaffRole }): unknown {
  if (role === 'admin' || !data || typeof data !== 'object' || Array.isArray(data)) return data;
  return Object.fromEntries(
    Object.entries(data as Record<string, unknown>).filter(([key]) => !/cents$/i.test(key)),
  );
}
