import { Injectable } from '@nestjs/common';
import webpush, { WebPushError } from 'web-push';
import { AppConfigService } from '../../../shared/config/app-config.service';
import type { PushResult, PushSender, PushTarget } from '../application/ports/push-sender.port';

/** 24 horas de vida e urgência normal (R8-7). */
const TTL_SECONDS = 24 * 60 * 60;

/** Com a biblioteca `web-push` (MIT; decisão 217(12)). */
@Injectable()
export class WebPushSender implements PushSender {
  private readonly vapid: { subject: string; publicKey: string; privateKey: string } | null;

  constructor(config: AppConfigService) {
    const publicKey = config.get({ key: 'VAPID_PUBLIC_KEY' });
    const privateKey = config.get({ key: 'VAPID_PRIVATE_KEY' });
    const subject = config.get({ key: 'VAPID_SUBJECT' });
    this.vapid = publicKey && privateKey && subject ? { subject, publicKey, privateKey } : null;
  }

  enabled(): boolean {
    return this.vapid !== null;
  }

  async send({ target, payload }: { target: PushTarget; payload: string }): Promise<PushResult> {
    if (!this.vapid) return 'retry';
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        payload,
        { TTL: TTL_SECONDS, urgency: 'normal', vapidDetails: this.vapid },
      );
      return 'sent';
    } catch (error) {
      if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410))
        return 'gone';
      return 'retry';
    }
  }
}
