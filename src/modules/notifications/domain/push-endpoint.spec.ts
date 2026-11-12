import { isAllowedPushEndpoint } from './push-endpoint';

describe('Endpoint do push (E-mail e push RN07; decisão 217(c))', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGuQyavXutnMH',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://fcm.googleapis.com:443/fcm/send/abc',
  ])('aceita %s', (endpoint) => {
    expect(isAllowedPushEndpoint({ endpoint })).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://127.0.0.1/push',
    'https://[::1]/push',
    'https://169.254.169.254/latest/meta-data',
    'https://evil.com/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.com/x',
    'https://push.apple.com/x',
    'https://user:pass@fcm.googleapis.com/x',
    'not a url',
  ])('recusa %s', (endpoint) => {
    expect(isAllowedPushEndpoint({ endpoint })).toBe(false);
  });
});
