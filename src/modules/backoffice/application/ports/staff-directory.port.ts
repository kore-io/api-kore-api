import type { StaffRole } from '../../domain/staff';

/** O papel do staff, lido do banco a cada requisição, nunca guardado na sessão (RN01). */
export interface StaffDirectory {
  /** O papel da conta ativa; nulo sem papel ou com a conta bloqueada. */
  roleOf(input: { userId: string }): Promise<StaffRole | null>;
}

export const STAFF_DIRECTORY = Symbol('StaffDirectory');
