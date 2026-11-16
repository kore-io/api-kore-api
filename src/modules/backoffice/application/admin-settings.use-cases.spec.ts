import type { BackofficeTransaction } from '@/shared/database/backoffice-transaction';
import type { AuthenticatedSession } from '@/modules/access/domain/sessions/authenticated-session';
import {
  IntegrationNotConfiguredError,
  InvalidReferralSettingsError,
} from '@/modules/backoffice/domain/backoffice.errors';
import { INTEGRATION_TEST_TIMEOUT_MS } from '@/modules/backoffice/domain/referral-settings';
import { AdminSettings } from './admin-settings.use-cases';
import type { AdminSettingsStore } from './ports/admin-settings.store.port';
import type { IntegrationProbes } from './ports/integration-probes.port';

const now = new Date('2026-11-16T15:00:00Z');
const staff = { userId: 'admin-1', role: 'admin' as const };
const values = {
  defaultRatePercent: 20,
  referralDiscountPercent: 10,
  commissionHoldDays: 30,
  payoutMinCents: 5_000,
};

function setup({ probes }: { probes?: IntegrationProbes } = {}) {
  const store: jest.Mocked<AdminSettingsStore> = {
    readReferralSettings: jest
      .fn()
      .mockResolvedValue({ ...values, updatedAt: now, updatedBy: null }),
    lockReferralSettings: jest.fn().mockResolvedValue(values),
    updateReferralSettings: jest.fn().mockResolvedValue({ plannersUpdated: 3 }),
    logReferralSettingsUpdated: jest.fn(),
    lastIntegrationTests: jest.fn().mockResolvedValue({}),
  };
  const transaction = {
    run: (work: () => Promise<unknown>) => work(),
  } as unknown as BackofficeTransaction;
  const log = { record: jest.fn() };
  const settings = new AdminSettings(
    transaction,
    store,
    probes ?? { asaas: { local: true, ping: jest.fn().mockResolvedValue(undefined) } },
    log,
  );
  return { settings, store, log };
}

const session = (authenticatedAt: Date) =>
  ({ userId: 'admin-1', authenticatedAt }) as unknown as AuthenticatedSession;

describe('Configurações (Backoffice - cobrança RN10; decisão 267)', () => {
  it('RN10 - salvar a comissão padrão grava, leva as cerimonialistas junto e registra o antes e o depois', async () => {
    const { settings, store } = setup();
    const result = await settings.updateReferral({
      session: session(now),
      values: { ...values, defaultRatePercent: 22 },
      now,
    });
    expect(result.changed).toBe(true);
    expect(store.updateReferralSettings).toHaveBeenCalledWith({
      values: { ...values, defaultRatePercent: 22 },
      adminUserId: 'admin-1',
      now,
    });
    expect(store.logReferralSettingsUpdated).toHaveBeenCalledWith({
      adminUserId: 'admin-1',
      now,
      data: {
        before: values,
        after: { ...values, defaultRatePercent: 22 },
        changes: { defaultRatePercent: { from: 20, to: 22 } },
        plannersUpdated: 3,
      },
    });
  });

  it('RN10 - sem mudança, nada é gravado nem vai ao log', async () => {
    const { settings, store } = setup();
    expect((await settings.updateReferral({ session: session(now), values, now })).changed).toBe(
      false,
    );
    expect(store.updateReferralSettings).not.toHaveBeenCalled();
    expect(store.logReferralSettingsUpdated).not.toHaveBeenCalled();
  });

  it('RN10 - fora do formato: 422 com os campos, antes de travar a linha', async () => {
    const { settings, store } = setup();
    await expect(
      settings.updateReferral({
        session: session(now),
        values: { ...values, defaultRatePercent: 120 },
        now,
      }),
    ).rejects.toBeInstanceOf(InvalidReferralSettingsError);
    expect(store.lockReferralSettings).not.toHaveBeenCalled();
  });

  it('RN01 (B10-1) - mudar a comissão padrão pede sessão recente', async () => {
    const { settings } = setup();
    await expect(
      settings.updateReferral({
        session: session(new Date(now.getTime() - 60 * 60_000)),
        values: { ...values, defaultRatePercent: 22 },
        now,
      }),
    ).rejects.toMatchObject({ name: 'ReauthRequiredError' });
  });

  it('RN10 - o gateway local responde "Conectado (local)" e o teste vai ao log', async () => {
    const { settings, log } = setup();
    expect(await settings.testIntegration({ staff, name: 'asaas', now })).toEqual({
      status: 'connected',
      testedAt: now,
      local: true,
    });
    expect(log.record).toHaveBeenCalledWith({
      entry: expect.objectContaining({
        action: 'integration.tested',
        data: { name: 'asaas', status: 'connected', local: true },
      }) as unknown,
    });
  });

  it('RN10 - a falha vira Falhou, e o log leva só o tipo do erro (nunca a mensagem do serviço)', async () => {
    const ping = jest.fn().mockRejectedValue(new TypeError('smtp://user:senha@host recusou'));
    const { settings, log } = setup({ probes: { email: { local: false, ping } } });
    expect((await settings.testIntegration({ staff, name: 'email', now })).status).toBe('failed');
    const entry = (log.record.mock.calls[0] as [{ entry: { data: unknown } }])[0].entry;
    expect(entry.data).toEqual({
      name: 'email',
      status: 'failed',
      local: false,
      failure: 'TypeError',
    });
  });

  it('RN10 - sem resposta no tempo limite, Falhou', async () => {
    jest.useFakeTimers();
    try {
      const ping = jest.fn(() => new Promise<void>(() => undefined));
      const { settings } = setup({ probes: { asaas: { local: false, ping } } });
      const testing = settings.testIntegration({ staff, name: 'asaas', now });
      await jest.advanceTimersByTimeAsync(INTEGRATION_TEST_TIMEOUT_MS);
      expect((await testing).status).toBe('failed');
    } finally {
      jest.useRealTimers();
    }
  });

  it('decisão 267(1) - o mapa ainda não existe: 409 e nada no log; na leitura, not_configured', async () => {
    const { settings, log } = setup();
    await expect(settings.testIntegration({ staff, name: 'maps', now })).rejects.toBeInstanceOf(
      IntegrationNotConfiguredError,
    );
    expect(log.record).not.toHaveBeenCalled();
    const view = await settings.read();
    expect(view.integrations).toEqual([
      { name: 'asaas', status: 'not_tested', local: true },
      { name: 'email', status: 'not_configured', local: false },
      { name: 'maps', status: 'not_configured', local: false },
    ]);
  });
});
