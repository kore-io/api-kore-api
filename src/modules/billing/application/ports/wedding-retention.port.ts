import type { PurgeReason } from '../../domain/retention';
import type { BillingRecipient } from './payment-ledger.port';

/** Um casamento que a rotina da retenção olha (Retenção RN02, RN03 e RN05). */
export interface RetentionCandidate {
  weddingId: string;
  status: string;
  /** O fuso gravado; nulo nas linhas antigas (o de Brasília). */
  timezone: string | null;
  /** AAAA-MM-DD. */
  purgeAt: string | null;
  expiredAt: string | null;
  deletionScheduledFor: string | null;
  purgeNoticeSentAt: Date | null;
  blocked: boolean;
}

/** O que o aviso de 30 dias precisa depois de gravado: quem recebe e os nomes do casal. */
export interface RetentionNoticeTarget {
  recipients: BillingRecipient[];
  partnerNames: [string, string];
}

/**
 * A retenção pela conexão do backoffice (a rotina atravessa os casamentos).
 * Cada gravação trava o casamento e confere de novo o estado: o que mudou no
 * meio do caminho (renovou, bloqueou, cancelou a exclusão) vence.
 * `weddingId` recorta a rodada a um casamento (o teste; a rotina roda sem ele).
 */
export interface WeddingRetentionStore {
  /** Os expirados perto do `purgeAt` e as exclusões agendadas que vencem, sem os bloqueados. */
  listCandidates(input: { now: Date; weddingId?: string }): Promise<RetentionCandidate[]>;
  /**
   * Grava o `purgeNoticeSentAt`, o log `wedding.purge_notice_sent` e a
   * notificação `billing` das pessoas donas, numa transação; nulo se o
   * casamento já não está expirado, sem aviso, sem bloqueio e sem exclusão.
   */
  markNotice(input: {
    weddingId: string;
    purgeAt: string;
    now: Date;
  }): Promise<RetentionNoticeTarget | null>;
  /** O e-mail não saiu: desfaz a marca daquele aviso, para a rotina tentar de novo (decisão 180(8)). */
  clearNotice(input: { weddingId: string; noticeSentAt: Date }): Promise<boolean>;
  /**
   * Apaga os dados e deixa a lápide (a tabela da RN03), anonimiza o
   * `refundReason` e o `payload` dos eventos do gateway, apaga os arquivos das
   * imagens e grava `wedding.purged` com o motivo, numa transação com o
   * casamento travado. Na exclusão pedida pelo casal, a cerimonialista
   * colaboradora recebe o `membership_removed`. false se o estado mudou.
   */
  purge(input: { weddingId: string; reason: PurgeReason; now: Date }): Promise<boolean>;
  /** O `Alert purge_failed` do casamento que a rodada pulou (RN04). */
  openPurgeFailedAlert(input: { weddingId: string; error: string }): Promise<void>;
}

export const WEDDING_RETENTION_STORE = Symbol('WeddingRetentionStore');
