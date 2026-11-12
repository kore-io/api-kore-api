import { evaluateLoginRequestQuota, isLoginChallengeUsable } from './login-challenge-rules';

const now = new Date('2026-11-05T13:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const secondsAgo = (seconds: number) => new Date(now.getTime() - seconds * 1000);

describe('RN04 - limites de pedidos de código por e-mail', () => {
  it('dado nenhum pedido recente, quando pede, então pode', () => {
    expect(evaluateLoginRequestQuota({ recentRequests: [], now })).toEqual({ allowed: true });
  });

  it('dado um pedido há 30 segundos, quando pede outro, então não pode e mostra quando pode reenviar', () => {
    expect(evaluateLoginRequestQuota({ recentRequests: [secondsAgo(30)], now })).toEqual({
      allowed: false,
      reason: 'too_soon',
      resendAvailableAt: new Date(now.getTime() + 30_000),
    });
  });

  it('dado um pedido há 60 segundos, quando pede outro, então pode', () => {
    expect(evaluateLoginRequestQuota({ recentRequests: [secondsAgo(60)], now })).toEqual({
      allowed: true,
    });
  });

  it('dados 5 pedidos na última hora, quando pede o sexto, então diz em quantos minutos pode tentar de novo', () => {
    const recentRequests = [37, 30, 20, 10, 2].map(minutesAgo);

    expect(evaluateLoginRequestQuota({ recentRequests, now })).toEqual({
      allowed: false,
      reason: 'too_many',
      retryAfterMinutes: 23,
    });
  });

  it('dados 5 pedidos, o mais antigo há mais de uma hora, quando pede, então pode', () => {
    const recentRequests = [61, 30, 20, 10, 2].map(minutesAgo);

    expect(evaluateLoginRequestQuota({ recentRequests, now })).toEqual({ allowed: true });
  });
});

describe('RN02 e RN04 - quando o pedido ainda vale', () => {
  const base = {
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
    invalidatedAt: null,
  };

  it.each([
    ['dentro do prazo', base, true],
    ['vencido', { ...base, expiresAt: minutesAgo(1) }, false],
    ['já usado', { ...base, consumedAt: minutesAgo(1) }, false],
    ['substituído por outro pedido', { ...base, invalidatedAt: minutesAgo(1) }, false],
  ])('dado um pedido %s, quando confere, então vale = %s', (_, challenge, expected) => {
    expect(isLoginChallengeUsable({ challenge, now })).toBe(expected);
  });
});
