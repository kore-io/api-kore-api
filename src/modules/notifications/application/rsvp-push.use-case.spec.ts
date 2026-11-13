import type { AppConfigService } from '../../../shared/config/app-config.service';
import type { PushStore } from './ports/push-store.port';
import { BILLING_PUSH_BODY, plannerPushBody, pushBody, RsvpPush } from './rsvp-push.use-case';

describe('O texto do push (E-mail e push RN07; Notificações da cerimonialista RN07)', () => {
  it('casal: o nome do grupo; agrupado, a contagem', () => {
    expect(pushBody({ count: 1, firstGroupName: 'Família Moreira' })).toBe(
      'Família Moreira respondeu o convite',
    );
    expect(pushBody({ count: 3, firstGroupName: 'Família Moreira' })).toBe('3 grupos responderam');
  });

  it('cerimonialista: o casal, sem nome de grupo; agrupado, a contagem (Pena)', () => {
    expect(plannerPushBody({ count: 1, partnerNames: ['Ana', 'Marcos'] })).toBe(
      'Novas respostas em Ana e Marcos',
    );
    expect(plannerPushBody({ count: 3, partnerNames: ['Ana', 'Marcos'] })).toBe(
      '3 grupos responderam em Ana e Marcos',
    );
  });
});

describe('O push da cobrança (Publicar e pagar RN13; decisão 236)', () => {
  const subscription = {
    id: 's1',
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    p256dh: 'k',
    auth: 'a',
    sessionActive: true,
  };

  function build(recipient: Partial<Awaited<ReturnType<PushStore['recipient']>>>) {
    const store = {
      recipient: jest.fn().mockResolvedValue({
        member: true,
        role: 'owner',
        partnerNames: ['', ''],
        push: true,
        subscriptions: [subscription],
        notification: { groupKey: 'billing:pay-1', count: 1, firstGroupName: null },
        ...recipient,
      }),
      remove: jest.fn().mockResolvedValue(undefined),
      markSuccess: jest.fn().mockResolvedValue(undefined),
    };
    const sender = { enabled: () => true, send: jest.fn().mockResolvedValue('sent') };
    const config = { get: () => 'http://localhost:5173' } as unknown as AppConfigService;
    const push = new RsvpPush(store, sender, config);
    return { push, store, sender };
  }

  it('RN13 - sem valor, com a tag do pagamento e o link para Cobrança e publicação', async () => {
    const { push, store, sender } = build({});
    const now = new Date();
    await push.send({ userId: 'u1', weddingId: 'w1', type: 'billing', now });
    expect(store.recipient).toHaveBeenCalledWith({
      userId: 'u1',
      weddingId: 'w1',
      type: 'billing',
      now,
    });
    const payload = JSON.parse((sender.send.mock.calls[0][0] as { payload: string }).payload);
    expect(payload).toEqual({
      title: 'Kore',
      body: BILLING_PUSH_BODY,
      tag: 'billing:pay-1',
      url: 'http://localhost:5173/app/cobranca',
    });
    expect(BILLING_PUSH_BODY).toBe('Pagamento confirmado. O site está no ar');
    expect(payload.body).not.toMatch(/R\$|\d/);
  });

  it('decisão 236 - com o Push desligado, não sai', async () => {
    const { push, sender } = build({ push: false });
    expect(
      await push.send({ userId: 'u1', weddingId: 'w1', type: 'billing', now: new Date() }),
    ).toEqual({ sent: 0 });
    expect(sender.send).not.toHaveBeenCalled();
  });
});
