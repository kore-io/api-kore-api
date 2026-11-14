import type { StaffMember } from '../../domain/staff';

export interface AccessEmailChangeInput {
  staff: StaffMember;
  weddingId: string;
  userId: string;
  newEmail: string;
  /** Os 4 dígitos que o casal informou; obrigatórios quando há pagamento. */
  payerLast4: string | null;
  reason: string;
  ipHash: string | null;
  now: Date;
}

export type AccessEmailChangeResult =
  | { result: 'changed'; oldEmail: string; newEmail: string }
  | { result: 'not_found' }
  | { result: 'not_allowed' }
  /** A 2ª troca no mesmo User em 7 dias: só o Admin (decisão 253(1)). */
  | { result: 'admin_only' }
  | { result: 'rate_limited'; retryAt: Date }
  | { result: 'locked'; availableAt: Date }
  | { result: 'checks_required' }
  | { result: 'checks_failed' }
  | { result: 'email_in_use' };

export type UnlockResult =
  | { result: 'unlocked' }
  | { result: 'not_found' }
  | { result: 'not_locked' }
  | { result: 'too_soon'; availableAt: Date };

/**
 * Trocar o e-mail de acesso (Backoffice - acesso RN09; decisão 253), numa
 * transação do backoffice com o Wedding travado. As tentativas e as
 * conferências erradas ficam no log (só inserção), que conta os limites; a
 * recusa por CHECKS_FAILED é gravada e devolvida como valor (não desfaz).
 */
export interface AccessEmailChanges {
  change(input: AccessEmailChangeInput): Promise<AccessEmailChangeResult>;
  /** O Admin libera a trava do casamento, uma vez a cada 24 h (decisão 253(1)). */
  unlock(input: {
    staff: StaffMember;
    weddingId: string;
    reason: string;
    ipHash: string | null;
    now: Date;
  }): Promise<UnlockResult>;
}

export const ACCESS_EMAIL_CHANGES = Symbol('AccessEmailChanges');
