/** "A cerimonialista saiu": um por pessoa dona (Notificações da cerimonialista RN09; D19). */
export interface PlannerLeftNotice {
  to: string;
  /** Primeiro nome da dona ("Olá, {Ana}."). */
  ownerName: string;
  /** O nome dela na conta ("{Juliana}"). */
  plannerName: string;
  /** O nome da assessoria (`Planner.creditName`). */
  agencyName: string;
  /** Os primeiros nomes dos noivos. */
  partnerNames: [string, string];
}

/** "O casal aceitou", à indicadora que criou o casamento (RN09; D20). */
export interface CoupleAcceptedNotice {
  to: string;
  /** Primeiro nome dela ("Olá, {Juliana}."). */
  plannerName: string;
  /** Os primeiros nomes dos noivos. */
  partnerNames: [string, string];
  weddingId: string;
}

/**
 * Os e-mails fora das preferências da RN09 de Notificações da cerimonialista,
 * enfileirados depois do commit (decisão 170).
 */
export interface CollaborationNoticeMailer {
  plannerLeft({ notice }: { notice: PlannerLeftNotice }): Promise<void>;
  coupleAccepted({ notice }: { notice: CoupleAcceptedNotice }): Promise<void>;
}

export const COLLABORATION_NOTICE_MAILER = Symbol('CollaborationNoticeMailer');
