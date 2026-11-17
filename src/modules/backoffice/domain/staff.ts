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

/**
 * As ações do log que são de dinheiro fora do que o suporte vê (RN02 e RN11;
 * decisões 69 e 275): Cobrança, fila de Repasses, chave Pix e Configurações.
 * O suporte não recebe essas linhas; as de comissão ficam, sem os valores.
 */
export const MONEY_LOG_ACTION_PREFIXES = [
  'payment.',
  'payments.',
  'payout.',
  'pix_key.',
  'settings.',
  'integration.',
] as const;

export function hiddenLogActionPrefixes({ role }: { role: StaffRole }): string[] {
  return role === 'admin' ? [] : [...MONEY_LOG_ACTION_PREFIXES];
}

/**
 * Os valores em centavos ficam fora do que o suporte lê, em qualquer nível do
 * JSON (RN02; decisões 69 e 275): sai toda chave cujo nome contém `cents`.
 */
export function withoutMoney({ data, role }: { data: unknown; role: StaffRole }): unknown {
  if (role === 'admin') return data;
  return stripCents(data);
}

function stripCents(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCents);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/cents/i.test(key))
      .map(([key, inner]) => [key, stripCents(inner)]),
  );
}
