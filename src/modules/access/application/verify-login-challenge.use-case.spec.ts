import {
  InvalidLoginCodeError,
  LoginChallengeExpiredError,
  LoginChallengeLockedError,
} from '../domain/access.errors';
import type { CompleteLogin } from './complete-login.use-case';
import type { LoginChallengeSecrets } from './ports/login-challenge-secrets.port';
import type {
  LoginChallengeRecord,
  LoginChallengeStore,
  LoginChallengeTransaction,
} from './ports/login-challenge-store.port';
import type { LoginCodeMailer } from './ports/login-code-mailer.port';
import { VerifyLoginChallenge } from './verify-login-challenge.use-case';

const now = new Date('2026-11-05T13:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

function challenge(overrides: Partial<LoginChallengeRecord> = {}): LoginChallengeRecord {
  return {
    id: 'c1',
    email: 'ana@kore.local',
    codeHash: 'hash:123456',
    expiresAt: new Date(now.getTime() + 10 * 60_000),
    attempts: 0,
    consumedAt: null,
    invalidatedAt: null,
    origin: 'none',
    originRef: null,
    ...overrides,
  };
}

function build({
  open = challenge(),
  byToken = challenge(),
  attemptsAfterFailure = 1,
  requestTimes = [minutesAgo(10)],
}: {
  open?: LoginChallengeRecord | null;
  byToken?: LoginChallengeRecord | null;
  attemptsAfterFailure?: number;
  requestTimes?: Date[];
} = {}) {
  const transaction: jest.Mocked<LoginChallengeTransaction> = {
    listRequestTimesSince: jest.fn().mockResolvedValue(requestTimes),
    invalidateActive: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockResolvedValue(undefined),
    findLatestOpen: jest.fn().mockResolvedValue(open),
    registerFailedAttempt: jest.fn().mockResolvedValue(attemptsAfterFailure),
    invalidate: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockResolvedValue(true),
  };
  const store: LoginChallengeStore = {
    exclusiveForEmail: ({ work }) => work(transaction),
    findByTokenHash: jest.fn().mockResolvedValue(byToken),
  };
  const secrets: LoginChallengeSecrets = {
    issue: () => ({ token: 'novo-token', tokenHash: 'th', code: '654321', codeHash: 'ch' }),
    hashToken: ({ token }) => `hash:${token}`,
    matchesCode: ({ code, codeHash }) => codeHash === `hash:${code}`,
  };
  const send = jest.fn().mockResolvedValue(undefined);
  const mailer: LoginCodeMailer = { send };
  const execute = jest.fn().mockResolvedValue({ user: { id: 'u1' }, next: 'choose_profile' });
  const completeLogin = { execute } as unknown as CompleteLogin;
  return {
    useCase: new VerifyLoginChallenge(store, secrets, mailer, completeLogin),
    transaction,
    send,
    completeLogin: execute,
  };
}

const byCode = (code: string) => ({
  credentials: { email: 'ana@kore.local', code },
  ip: '1.2.3.4',
  now,
});

describe('VerifyLoginChallenge', () => {
  it('RN01 - dado o código certo dentro de 15 minutos, quando confirma, então usa o pedido e entra', async () => {
    const { useCase, transaction, completeLogin } = build();

    await useCase.execute(byCode('123456'));

    expect(transaction.consume).toHaveBeenCalledWith({ id: 'c1', now });
    expect(completeLogin).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ana@kore.local', method: 'email', origin: 'none' }),
    );
  });

  it('RN01 - dado o botão de acesso, quando clica, então entra sem o código e usa o mesmo pedido', async () => {
    const { useCase, transaction, completeLogin } = build();

    await useCase.execute({ credentials: { token: 'tok' }, ip: null, now });

    expect(transaction.consume).toHaveBeenCalledWith({ id: 'c1', now });
    expect(completeLogin).toHaveBeenCalled();
  });

  it('RN02 - dado um pedido de 16 minutos atrás, quando digita o código certo, então não entra', async () => {
    const { useCase } = build({ open: challenge({ expiresAt: minutesAgo(1) }) });

    await expect(useCase.execute(byCode('123456'))).rejects.toThrow(LoginChallengeExpiredError);
  });

  it('RN02 - dado um botão já usado, quando clica de novo, então não entra', async () => {
    const { useCase } = build({ byToken: challenge({ consumedAt: minutesAgo(1) }) });

    await expect(useCase.execute({ credentials: { token: 'tok' }, ip: null, now })).rejects.toThrow(
      LoginChallengeExpiredError,
    );
  });

  it('RN05 - dado um código errado, quando confirma, então diz quantas tentativas restam', async () => {
    const { useCase } = build({ attemptsAfterFailure: 1 });

    await expect(useCase.execute(byCode('000000'))).rejects.toEqual(
      new InvalidLoginCodeError({ attemptsLeft: 4 }),
    );
  });

  it('RN05 - dados 4 erros, quando erra a quinta vez com espaço na RN04, então invalida e envia um código novo', async () => {
    const { useCase, transaction, send } = build({ attemptsAfterFailure: 5 });

    const error = await useCase.execute(byCode('000000')).catch((caught: unknown) => caught);

    expect(error).toEqual(new LoginChallengeLockedError({ newCodeSent: true }));
    expect(transaction.invalidate).toHaveBeenCalledWith({ id: 'c1', now });
    expect(transaction.create).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({
      email: 'ana@kore.local',
      token: 'novo-token',
      code: '654321',
    });
  });

  it('RN05 - dados 5 pedidos na última hora, quando erra a quinta vez, então nenhum código novo é enviado', async () => {
    const { useCase, transaction, send } = build({
      attemptsAfterFailure: 5,
      requestTimes: [50, 40, 30, 20, 10].map(minutesAgo),
    });

    const error = await useCase.execute(byCode('000000')).catch((caught: unknown) => caught);

    expect(error).toEqual(
      new LoginChallengeLockedError({ newCodeSent: false, retryAfterMinutes: 10 }),
    );
    expect((error as LoginChallengeLockedError).retryAfterMinutes).toBe(10);
    expect(transaction.create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('decisão 150 - dado um pedido há 30 segundos, quando erra a quinta vez, então diz para tentar em 1 minuto (nunca 0)', async () => {
    const { useCase } = build({
      attemptsAfterFailure: 5,
      requestTimes: [new Date(now.getTime() - 30_000)],
    });

    const error = await useCase.execute(byCode('000000')).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ newCodeSent: false, retryAfterMinutes: 1 });
  });

  it('RN04 - dado que pediu outro código, quando digita o primeiro, então não entra (o primeiro foi invalidado)', async () => {
    // O pedido aberto é o segundo; o código do primeiro não bate com ele.
    const { useCase } = build({
      open: challenge({ id: 'c2', codeHash: 'hash:999999' }),
      attemptsAfterFailure: 1,
    });

    await expect(useCase.execute(byCode('123456'))).rejects.toThrow(InvalidLoginCodeError);
  });
});
