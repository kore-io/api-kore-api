/**
 * O aviso, depois do commit da resposta, de que a notificação nasceu ou somou
 * (Central RN02): o e-mail e o push saem por job (E-mail e push RN01). Uma
 * falha aqui não desfaz a resposta: a rotina de 15 minutos é a rede de segurança.
 */
export interface NotificationDispatcher {
  notified({
    weddingId,
    userIds,
  }: {
    weddingId: string;
    userIds: readonly string[];
  }): Promise<void>;
}

export const NOTIFICATION_DISPATCHER = Symbol('NotificationDispatcher');
