export interface PurgeNotice {
  /** Para desfazer a marca se o worker desistir do e-mail (decisão 180(8)). */
  weddingId: string;
  noticeSentAt: Date;
  to: string;
  /** Primeiro nome de quem criou ("Olá, {Juliana}."). */
  creatorName: string;
  partnerNames: [string, string];
  status: 'awaiting_couple' | 'draft';
  purgeDate: Date;
}

/** E-mail 6 da Voz & Microcopy: aviso de exclusão em 30 dias (sempre sai, decisão 136). */
export interface PurgeNoticeMailer {
  send({ notice }: { notice: PurgeNotice }): Promise<void>;
}

export const PURGE_NOTICE_MAILER = Symbol('PurgeNoticeMailer');
