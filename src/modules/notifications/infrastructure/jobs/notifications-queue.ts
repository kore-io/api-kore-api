/**
 * A fila das notificações (E-mail e push): `notified` (a API avisa depois do
 * commit da resposta), `push` (o aviso nos aparelhos de uma pessoa, da
 * resposta ou da cobrança), `email`
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

/**
 * O push de uma pessoa: o da resposta (padrão), o da cobrança (Publicar e
 * pagar RN13) ou o da comissão disponível (Comissões do indicador RN09).
 */
export interface PushJob extends EmailJob {
  type?: 'rsvp' | 'billing' | 'commission';
}

/** O e-mail "Na hora" da comissão de uma pessoa, depois da rodada da liberação (decisão 242). */
export interface CommissionEmailJob {
  userId: string;
}
