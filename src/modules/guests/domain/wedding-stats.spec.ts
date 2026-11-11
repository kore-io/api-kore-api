import { guestsDelta } from './wedding-stats';

describe('Números do casamento (Grupos RN16)', () => {
  it('RN16 - convidados novos, pendentes, sobem guestsTotal e pending', () => {
    expect(
      guestsDelta({
        guests: [
          { rsvpStatus: 'pending', ageGroup: 'adult' },
          { rsvpStatus: 'pending', ageGroup: null },
        ],
        sign: 1,
      }),
    ).toMatchObject({ guestsTotal: 2, pending: 2, confirmed: 0, adultsConfirmed: 0 });
  });

  it('RN16 - quem sai leva a resposta e a faixa etária de confirmado', () => {
    expect(
      guestsDelta({
        guests: [
          { rsvpStatus: 'confirmed', ageGroup: 'child' },
          { rsvpStatus: 'declined', ageGroup: 'adult' },
        ],
        sign: -1,
      }),
    ).toMatchObject({ guestsTotal: -2, confirmed: -1, declined: -1, childrenConfirmed: -1 });
  });
});
