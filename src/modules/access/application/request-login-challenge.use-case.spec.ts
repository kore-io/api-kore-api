import { LoginRequestLimitError, LoginRequestTooSoonError } from '../domain/access.errors';
import type { LoginChallengeSecrets } from './ports/login-challenge-secrets.port';
import type {
  LoginChallengeStore,
  LoginChallengeTransaction,
} from './ports/login-challenge-store.port';
import type { LoginCodeMailer } from './ports/login-code-mailer.port';
import { RequestLoginChallenge } from './request-login-challenge.use-case';

const now = new Date('2026-11-05T13:00:00.000Z');
const secondsAgo = (seconds: number) => new Date(now.getTime() - seconds * 1000);

function build({ requestTimes }: { requestTimes: Date[] }) {
  const transaction = {
    listRequestTimesSince: jest.fn().mockResolvedValue(requestTimes),
    invalidateActive: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<LoginChallengeTransaction>;
  const store: LoginChallengeStore = {
    exclusiveForEmail: ({ work }) => work(transaction),
    findByTokenHash: jest.fn(),
  };
  const secrets: LoginChallengeSecrets = {
    issue: () => ({ token: 'tok', tokenHash: 'th', code: '123456', codeHash: 'ch' }),
    hashToken: jest.fn(),
    matchesCode: jest.fn(),
  };
  const send = jest.fn().mockResolvedValue(undefined);
  const mailer: LoginCodeMailer = { send };
  return { useCase: new RequestLoginChallenge(store, secrets, mailer), transaction, send };
}

const request = {
  email: 'ana@kore.local',
  origin: 'invite' as const,
  originRef: 'convite',
  requestIp: '1.2.3.4',
  now,
};

describe('RequestLoginChallenge', () => {
  it('RN01 e RN03 - dado um e-mail, quando pede o código, então invalida o anterior, cria o pedido e envia o e-mail', async () => {
    const { useCase, transaction, send } = build({ requestTimes: [] });

    const result = await useCase.execute(request);

    expect(result).toEqual({
      email: 'ana@kore.local',
      resendAvailableAt: new Date(now.getTime() + 60_000),
    });
    expect(transaction.invalidateActive).toHaveBeenCalledWith({ email: 'ana@kore.local', now });
    expect(transaction.create).toHaveBeenCalledWith({
      challenge: {
        email: 'ana@kore.local',
        tokenHash: 'th',
        codeHash: 'ch',
        expiresAt: new Date(now.getTime() + 15 * 60_000),
        origin: 'invite',
        originRef: 'convite',
        requestIp: '1.2.3.4',
      },
    });
    expect(send).toHaveBeenCalledWith({ email: 'ana@kore.local', token: 'tok', code: '123456' });
  });

  it('RN04 - dado um pedido há 30 segundos, quando pede outro, então recusa e não envia e-mail', async () => {
    const { useCase, send } = build({ requestTimes: [secondsAgo(30)] });

    await expect(useCase.execute(request)).rejects.toEqual(
      new LoginRequestTooSoonError({ resendAvailableAt: new Date(now.getTime() + 30_000) }),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('RN04 - dados 5 pedidos na última hora, quando pede o sexto, então recusa com os minutos de espera', async () => {
    const { useCase } = build({ requestTimes: [2220, 1800, 1200, 600, 120].map(secondsAgo) });

    await expect(useCase.execute(request)).rejects.toEqual(
      new LoginRequestLimitError({ retryAfterMinutes: 23 }),
    );
  });
});
