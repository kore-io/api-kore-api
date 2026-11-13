import type { AppConfigService } from '../../../shared/config/app-config.service';
import { commissionAvailableEmail } from '../infrastructure/emails/notification-email';
import { CommissionEmails } from './commission-emails.use-case';
import type {
  CommissionEmailStore,
  LockedCommissionEmail,
} from './ports/commission-email-store.port';
import { commissionPushBody } from './rsvp-push.use-case';

const pending = new Date('2026-09-09T06:30:00Z');

function setup(state: Partial<LockedCommissionEmail> = {}) {
  const cursors: (Date | null)[] = [];
  const store: CommissionEmailStore = {
    dailyCandidates: jest.fn().mockResolvedValue(['u-j']),
    withLockedState: async ({ work }) => {
      cursors.push(
        await work({
          email: 'juliana@kore.local',
          firstName: 'Juliana',
          frequency: 'daily',
          newestPendingAt: pending,
          ...state,
        }),
      );
    },
  };
  const send = jest.fn().mockResolvedValue(undefined);
  const useCase = new CommissionEmails(store, { send }, { record: jest.fn() }, {
    get: () => 'http://localhost:5173/',
  } as unknown as AppConfigService);
  return { useCase, send, cursors };
}

describe('O e-mail de comissão disponível (Comissões do indicador RN09; decisão 242)', () => {
  it('decisão 242 - manda só no modo da preferência e avança o cursor', async () => {
    const daily = setup();
    expect(await daily.useCase.send({ userId: 'u-j', mode: 'immediate' })).toBe(false);
    expect(await daily.useCase.send({ userId: 'u-j', mode: 'daily' })).toBe(true);
    expect(daily.cursors).toEqual([null, pending]);

    const off = setup({ frequency: 'off' });
    expect(await off.useCase.send({ userId: 'u-j', mode: 'daily' })).toBe(false);
    expect(off.send).not.toHaveBeenCalled();
  });

  it('decisão 242 - sem comissão nova, nada sai', async () => {
    const { useCase, send } = setup({ newestPendingAt: null });
    expect(await useCase.send({ userId: 'u-j', mode: 'daily' })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('decisão 242 - o Resumo diário só a partir das 20h de São Paulo', async () => {
    const before = setup();
    expect(await before.useCase.sweep({ now: new Date('2026-09-09T22:59:00Z') })).toEqual({
      sent: 0,
      failed: 0,
    });
    const after = setup();
    expect(await after.useCase.sweep({ now: new Date('2026-09-09T23:00:00Z') })).toEqual({
      sent: 1,
      failed: 0,
    });
  });

  it('RN09 - os textos da Pena, sem valor', () => {
    const message = commissionAvailableEmail({
      to: 'juliana@kore.local',
      firstName: 'Juliana',
      mode: 'daily',
      commissionsUrl: 'http://app/cerimonialista/comissoes',
      settingsUrl: 'http://app/cerimonialista/configuracoes/notificacoes',
    });
    expect(message.subject).toBe('Você tem comissão disponível');
    expect(message.text).toContain('Olá, Juliana!');
    expect(message.text).toContain(
      'Uma comissão ficou disponível. Veja o valor e peça o repasse no Kore.',
    );
    expect(message.text).toContain('Ver comissões: http://app/cerimonialista/comissoes');
    expect(message.html).toContain('Ela já pode entrar no seu próximo repasse.');
    expect(message.text).not.toMatch(/R\$/);
    expect(commissionPushBody({ partnerNames: ['Ana', 'Marcos'] })).toBe(
      'Comissão de Ana e Marcos disponível para repasse',
    );
  });
});
