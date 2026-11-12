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

  /** Se o casamento tem algum vínculo `owner` ativo (decisões 31, 65 e 180). */
  hasActiveOwner({ weddingId }: { weddingId: string }): Promise<boolean>;
}

export const MEMBERSHIP_READER = Symbol('MembershipReader');
