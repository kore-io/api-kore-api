import type { PixKeyType, TaxIdType } from '../../domain/payout-data';

export interface PixKeyRow {
  id: string;
  keyType: PixKeyType;
  keyMasked: string;
  status: 'pending_confirmation' | 'pending_activation' | 'active' | 'replaced' | 'canceled';
  createdAt: Date;
  confirmExpiresAt: Date | null;
  confirmedAt: Date | null;
  activeFrom: Date | null;
  replacedAt: Date | null;
  canceledAt: Date | null;
}

/**
 * Os dados para receber da própria pessoa indicadora (Repasse RN02 e RN03),
 * na transação da requisição: as gravações passam pelas funções `SECURITY
 * DEFINER`, que acham o indicador pela sessão (G3).
 */
export interface PayoutDataStore {
  setTaxId(input: {
    type: TaxIdType;
    encrypted: string;
    hash: string;
    version: number;
  }): Promise<'ok' | 'locked' | 'in_use' | 'no_referrer'>;
  requestPixKey(input: {
    id: string;
    type: PixKeyType;
    encrypted: string;
    hash: string;
    masked: string;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<
    | { result: 'ok'; firstKey: boolean }
    | { result: 'change_pending'; activeFrom: Date }
    | { result: 'no_referrer' }
  >;
  confirmPixKey(input: { tokenHash: string; now: Date; alertId: string }): Promise<
    | {
        result: 'active' | 'pending_activation';
        keyId: string;
        activeFrom: Date;
        keyMasked: string;
      }
    | { result: 'expired' | 'not_found' | 'no_referrer' }
  >;
  cancelPixKey(input: {
    id: string;
    now: Date;
  }): Promise<
    | { result: 'ok'; wasChange: boolean; keyMasked: string }
    | { result: 'not_found' | 'no_referrer' }
  >;
  /** As chaves, da mais nova para a mais antiga, com as trocas vencidas já ativadas. */
  listPixKeys({ now }: { now: Date }): Promise<PixKeyRow[]>;
  /** Nulo sem perfil de indicador ativo. */
  payoutData(): Promise<{
    referrerId: string;
    taxIdType: TaxIdType | null;
    taxIdEncrypted: string | null;
    pixKeyMasked: string | null;
  } | null>;
  /** O e-mail e o primeiro nome de quem está na sessão, para os avisos. */
  recipient({ userId }: { userId: string }): Promise<{ email: string; firstName: string | null }>;
}

export const PAYOUT_DATA_STORE = Symbol('PayoutDataStore');
