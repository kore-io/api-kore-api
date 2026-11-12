import { Inject, Injectable } from '@nestjs/common';
import { isAllowedPushEndpoint } from '../domain/push-endpoint';
import {
  PUSH_SUBSCRIPTION_STORE,
  type PushSubscriptionStore,
} from './ports/push-subscription-store.port';

/** O endpoint fora da lista fechada dos serviços de push (400 PUSH_ENDPOINT_NOT_ALLOWED). */
export class PushEndpointNotAllowedError extends Error {
  override name = 'PushEndpointNotAllowedError';
}

/**
 * A assinatura de push deste aparelho (E-mail e push RN07; decisão 217(8)):
 * ligar o switch grava a assinatura, presa à sessão, e a preferência push
 * fica ligada; desligar apaga a deste aparelho, e a preferência só vai a
 * false quando sai a última assinatura da pessoa.
 */
@Injectable()
export class PushSubscriptions {
  constructor(@Inject(PUSH_SUBSCRIPTION_STORE) private readonly store: PushSubscriptionStore) {}

  async subscribe({
    userId,
    sessionId,
    endpoint,
    p256dh,
    auth,
    userAgent,
  }: {
    userId: string;
    sessionId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent: string | null;
  }): Promise<void> {
    if (!isAllowedPushEndpoint({ endpoint })) throw new PushEndpointNotAllowedError();
    await this.store.save({ userId, sessionId, endpoint, p256dh, auth, userAgent });
    await this.store.setPushPreference({ userId, push: true });
  }

  async unsubscribe({ userId, endpoint }: { userId: string; endpoint: string }): Promise<void> {
    if ((await this.store.remove({ userId, endpoint })) === 0)
      await this.store.setPushPreference({ userId, push: false });
  }
}
