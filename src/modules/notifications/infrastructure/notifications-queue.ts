/**
 * A fila das notificações (E-mail e push): `notified` (a API avisa depois do
 * commit da resposta), `push` (o aviso nos aparelhos de uma pessoa), `email`
 * (o "Na hora" de uma pessoa num casamento) e o
 * job do agendamento (a rotina de 15 minutos: o Resumo diário e a rede de
 * segurança).
 */
export const NOTIFICATIONS_QUEUE = 'notifications';
export const NOTIFICATIONS_SWEEP_SCHEDULER_ID = 'notifications-sweep';

export interface NotifiedJob {
  weddingId: string;
  userIds: string[];
}

export interface EmailJob {
  userId: string;
  weddingId: string;
}
