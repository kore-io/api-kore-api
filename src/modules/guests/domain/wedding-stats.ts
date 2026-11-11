import type { AgeGroup, RsvpStatus } from './party';

/**
 * O que muda nos números do casamento numa escrita (Grupos RN16): cada campo
 * soma (ou subtrai) do valor gravado. O rsvpPercent é calculado pelo banco.
 */
export interface StatsDelta {
  guestsTotal?: number;
  confirmed?: number;
  declined?: number;
  pending?: number;
  adultsConfirmed?: number;
  childrenConfirmed?: number;
  babiesConfirmed?: number;
  partiesPending?: number;
}

const CONFIRMED_BY_AGE: Record<AgeGroup, keyof StatsDelta> = {
  adult: 'adultsConfirmed',
  child: 'childrenConfirmed',
  baby: 'babiesConfirmed',
};

/**
 * O delta de convidados que entram (sign 1) ou saem (sign -1) da conta, pela
 * resposta e pela faixa etária de cada um (RN16). Os grupos pendentes ficam
 * com quem chama, porque dependem do grupo inteiro.
 */
export function guestsDelta({
  guests,
  sign,
}: {
  guests: readonly { rsvpStatus: RsvpStatus; ageGroup: AgeGroup | null }[];
  sign: 1 | -1;
}): StatsDelta {
  const delta: Required<StatsDelta> = {
    guestsTotal: 0,
    confirmed: 0,
    declined: 0,
    pending: 0,
    adultsConfirmed: 0,
    childrenConfirmed: 0,
    babiesConfirmed: 0,
    partiesPending: 0,
  };
  for (const guest of guests) {
    delta.guestsTotal += sign;
    delta[guest.rsvpStatus] += sign;
    if (guest.rsvpStatus === 'confirmed' && guest.ageGroup)
      delta[CONFIRMED_BY_AGE[guest.ageGroup]] += sign;
  }
  return delta;
}
