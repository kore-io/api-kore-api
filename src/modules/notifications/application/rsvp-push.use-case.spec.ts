import { plannerPushBody, pushBody } from './rsvp-push.use-case';

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
