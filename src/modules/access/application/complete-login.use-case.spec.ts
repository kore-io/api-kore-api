import type { AccessIpLogWriter } from '../../logs/application/ports/access-ip-log-writer.port';
import type { ProductEventRecorder } from '../../product-events/application/ports/product-event-recorder.port';
import { UserBlockedError } from '../domain/access.errors';
import { CompleteLogin } from './complete-login.use-case';
import type { ProfileDirectory } from './ports/profile-directory.port';
import type { UserAccount, UserAccounts } from './ports/user-accounts.port';
import type { StartSession } from './start-session.use-case';

const now = new Date('2026-11-05T13:00:00.000Z');

function build({ account, created }: { account: UserAccount; created: boolean }) {
  const accounts: jest.Mocked<UserAccounts> = {
    findByEmail: jest.fn(),
    createOrGet: jest.fn().mockResolvedValue({ account, created }),
    ensureIdentity: jest.fn().mockResolvedValue(undefined),
    recordLogin: jest.fn().mockResolvedValue(undefined),
  };
  const profiles: ProfileDirectory = {
    listProfiles: jest.fn().mockResolvedValue([]),
    overview: jest.fn(),
  };
  const ipLog = { record: jest.fn().mockResolvedValue(undefined) } satisfies AccessIpLogWriter;
  const productEvents = {
    record: jest.fn().mockResolvedValue(undefined),
  } satisfies ProductEventRecorder;
  const startSession = {
    execute: jest.fn().mockResolvedValue({ token: 'tok', expiresAt: now }),
  } as unknown as jest.Mocked<StartSession>;
  return {
    useCase: new CompleteLogin(accounts, profiles, ipLog, productEvents, startSession),
    accounts,
    ipLog,
    productEvents,
    startSession,
  };
}

const input = {
  email: 'novo@kore.local',
  method: 'email' as const,
  providerSubject: 'novo@kore.local',
  origin: 'referral' as const,
  ip: '200.1.2.3',
  now,
};

describe('CompleteLogin', () => {
  it('RN06 - dado um e-mail sem conta, quando entra, então ganha um usuário na hora e registra conta_criada', async () => {
    const { useCase, productEvents } = build({
      account: { id: 'u1', email: 'novo@kore.local', status: 'active' },
      created: true,
    });

    const result = await useCase.execute(input);

    expect(result.user).toEqual({ id: 'u1', email: 'novo@kore.local', isNew: true });
    expect(result.next).toBe('couple_signup');
    expect(productEvents.record).toHaveBeenCalledWith({
      event: { name: 'conta_criada', props: { origem: 'referral', metodo: 'email' } },
      occurredAt: now,
    });
  });

  it('dado um usuário que já existe, quando entra, então não registra conta_criada', async () => {
    const { useCase, productEvents } = build({
      account: { id: 'u1', email: 'ana@kore.local', status: 'active' },
      created: false,
    });

    const result = await useCase.execute({ ...input, email: 'ana@kore.local' });

    expect(result.user.isNew).toBe(false);
    expect(productEvents.record).not.toHaveBeenCalled();
  });

  it('RN08 e decisão 116 - dado um login, quando completa, então abre a sessão com o método e guarda o IP real', async () => {
    const { useCase, startSession, ipLog, accounts } = build({
      account: { id: 'u1', email: 'ana@kore.local', status: 'active' },
      created: false,
    });

    const result = await useCase.execute(input);

    expect(result.session).toEqual({ token: 'tok', expiresAt: now });
    expect(startSession.execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', authMethod: 'email' }),
    );
    expect(accounts.ensureIdentity).toHaveBeenCalledWith({
      userId: 'u1',
      provider: 'email',
      providerSubject: 'novo@kore.local',
    });
    expect(ipLog.record).toHaveBeenCalledWith({
      entry: {
        action: 'login',
        ip: '200.1.2.3',
        occurredAt: now,
        actorKind: 'user',
        actorUserId: 'u1',
      },
    });
  });

  it('RN11 - dado um usuário bloqueado, quando confirma o código, então não entra e nenhuma sessão é aberta', async () => {
    const { useCase, startSession } = build({
      account: { id: 'u1', email: 'ana@kore.local', status: 'blocked' },
      created: false,
    });

    await expect(useCase.execute(input)).rejects.toThrow(UserBlockedError);
    expect(startSession.execute).not.toHaveBeenCalled();
  });
});
