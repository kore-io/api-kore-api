import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../shared/config/app-config.service';
import { isAllowedPushEndpoint } from '../domain/push-endpoint';
import { PUSH_SENDER, type PushSender } from './ports/push-sender.port';
import { PUSH_STORE, type PushStore } from './ports/push-store.port';

/** O serviço de push pediu nova tentativa (429 ou 5xx): o job tenta de novo com espera. */
export class PushRetryError extends Error {
  override name = 'PushRetryError';
}

/** O texto do aviso: só o nome do grupo, sem números nem dado sensível (RN07; Voz). */
/**
 * O push da cerimonialista (Notificações da cerimonialista RN07; Pena): sem
 * nome de convidado nem de grupo; o nome do casal diz de qual casamento é.
 */
export function plannerPushBody({
  count,
  partnerNames,
}: {
  count: number;
  partnerNames: readonly [string, string];
}): string {
  const couple = partnerNames.filter((name) => name.length > 0).join(' e ');
  return count > 1 ? `${count} grupos responderam em ${couple}` : `Novas respostas em ${couple}`;
}

export function pushBody({
  count,
  firstGroupName,
}: {
  count: number;
  firstGroupName: string | null;
}): string {
  return count === 1 && firstGroupName
    ? `${firstGroupName} respondeu o convite`
    : `${count} grupos responderam`;
}

/**
 * O push da resposta (E-mail e push RN07 a RN09): sai a cada soma, para cada
 * aparelho da pessoa com o push ligado, com `tag = groupKey` (um aviso por
 * casamento, trocado a cada soma). Confere de novo o vínculo, a preferência e
 * o endpoint; a assinatura de sessão revogada ou vencida, ou que o serviço
 * diz que não existe (404/410), sai.
 */
@Injectable()
export class RsvpPush {
  private readonly url: string;
  private readonly plannerUrl: string;

  constructor(
    @Inject(PUSH_STORE) private readonly store: PushStore,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
    config: AppConfigService,
  ) {
    const appUrl = config.get({ key: 'APP_URL' }).replace(/\/+$/, '');
    this.url = `${appUrl}/app/notificacoes`;
    // A central da cerimonialista (Notificações da cerimonialista RN05).
    this.plannerUrl = `${appUrl}/cerimonialista/notificacoes`;
  }

  async send({
    userId,
    weddingId,
    now,
  }: {
    userId: string;
    weddingId: string;
    now: Date;
  }): Promise<{ sent: number }> {
    if (!this.sender.enabled()) return { sent: 0 };
    const recipient = await this.store.recipient({ userId, weddingId, now });
    if (!recipient.member || !recipient.push || !recipient.notification) return { sent: 0 };

    const stale = recipient.subscriptions.filter(
      (subscription) =>
        !subscription.sessionActive || !isAllowedPushEndpoint({ endpoint: subscription.endpoint }),
    );
    await this.store.remove({ ids: stale.map((subscription) => subscription.id) });
    const planner = recipient.role === 'planner';
    const payload = JSON.stringify({
      title: 'Kore',
      body: planner
        ? plannerPushBody({
            count: recipient.notification.count,
            partnerNames: recipient.partnerNames,
          })
        : pushBody(recipient.notification),
      tag: recipient.notification.groupKey,
      url: planner ? this.plannerUrl : this.url,
    });
    const sent: string[] = [];
    const gone: string[] = [];
    let retry = false;
    for (const subscription of recipient.subscriptions) {
      if (stale.includes(subscription)) continue;
      const result = await this.sender.send({ target: subscription, payload });
      if (result === 'sent') sent.push(subscription.id);
      else if (result === 'gone') gone.push(subscription.id);
      else retry = true;
    }
    await this.store.remove({ ids: gone });
    await this.store.markSuccess({ ids: sent, now });
    if (retry) throw new PushRetryError();
    return { sent: sent.length };
  }
}
