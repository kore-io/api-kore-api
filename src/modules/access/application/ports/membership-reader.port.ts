import type { MembershipRole } from '../../domain/wedding-authorization';

/** Lê o vínculo ativo da pessoa no casamento, dentro da transação com RLS. */
export interface MembershipReader {
  activeRole({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<MembershipRole | null>;
}

export const MEMBERSHIP_READER = Symbol('MembershipReader');
