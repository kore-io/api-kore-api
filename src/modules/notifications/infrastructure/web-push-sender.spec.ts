import webpush, { WebPushError } from 'web-push';
import type { AppConfigService } from '../../../shared/config/app-config.service';
import { WebPushSender } from './web-push-sender';

const target = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'p', auth: 'a' };

function sender() {
  const values: Record<string, string> = {
    VAPID_PUBLIC_KEY: 'pub',
    VAPID_PRIVATE_KEY: 'priv',
    VAPID_SUBJECT: 'mailto:suporte@kore.com.br',
  };
  return new WebPushSender({
    get: ({ key }: { key: string }) => values[key],
  } as unknown as AppConfigService);
}

const failWith = (statusCode: number) =>
  new WebPushError('falhou', statusCode, {}, '', target.endpoint);

describe('WebPushSender (E-mail e push RN07 e RN08)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('RN07 (R8-7) - manda com TTL de 24 h, urgência normal e as chaves VAPID', async () => {
    const send = jest.spyOn(webpush, 'sendNotification').mockResolvedValue({
      statusCode: 201,
      body: '',
      headers: {},
    });

    expect(await sender().send({ target, payload: '{"title":"Kore"}' })).toBe('sent');
    expect(send).toHaveBeenCalledWith(
      { endpoint: target.endpoint, keys: { p256dh: 'p', auth: 'a' } },
      '{"title":"Kore"}',
      {
        TTL: 86_400,
        urgency: 'normal',
        vapidDetails: {
          subject: 'mailto:suporte@kore.com.br',
          publicKey: 'pub',
          privateKey: 'priv',
        },
      },
    );
  });

  it.each([
    [404, 'gone'],
    [410, 'gone'],
    [429, 'retry'],
    [500, 'retry'],
    [503, 'retry'],
  ] as const)(
    'RN08 - "Assinatura vencida": o serviço responde %i e o resultado é %s',
    async (status, result) => {
      jest.spyOn(webpush, 'sendNotification').mockRejectedValue(failWith(status));
      expect(await sender().send({ target, payload: '{}' })).toBe(result);
    },
  );

  it('RN08 - erro de rede (sem status) tenta de novo', async () => {
    jest.spyOn(webpush, 'sendNotification').mockRejectedValue(new Error('ECONNRESET'));
    expect(await sender().send({ target, payload: '{}' })).toBe('retry');
  });
});
