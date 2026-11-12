export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** O resultado do serviço de push (RN07; R8-7). */
export type PushResult =
  /** Aceito. */
  | 'sent'
  /** 404 ou 410: a assinatura não existe mais e sai. */
  | 'gone'
  /** 429 ou 5xx: nova tentativa com espera. */
  | 'retry';

/** O Web Push com VAPID (E-mail e push RN07; decisão 216, D25). */
export interface PushSender {
  /** Falso sem as chaves VAPID no ambiente (local e test sem elas): o push fica desligado. */
  enabled(): boolean;
  send({ target, payload }: { target: PushTarget; payload: string }): Promise<PushResult>;
}

export const PUSH_SENDER = Symbol('PushSender');
