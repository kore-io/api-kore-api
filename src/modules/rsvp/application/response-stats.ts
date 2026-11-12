import { guestsDelta, type StatsDelta } from '../../guests/domain/wedding-stats';
import type { RsvpGuestUpdate } from '../domain/rsvp';

/** Os números pelas transições de cada convidado (Grupos RN16, evento "Responder"). */
export function responseStatsDelta({
  updates,
  pendingBefore,
  pendingAfter,
}: {
  updates: readonly RsvpGuestUpdate[];
  pendingBefore: boolean;
  pendingAfter: boolean;
}): StatsDelta {
  const total: Required<StatsDelta> = {
    guestsTotal: 0,
    confirmed: 0,
    declined: 0,
    pending: 0,
    adultsConfirmed: 0,
    childrenConfirmed: 0,
    babiesConfirmed: 0,
    partiesPending: Number(pendingAfter) - Number(pendingBefore),
  };
  for (const { before, after, statusChanged } of updates) {
    if (!statusChanged) continue;
    for (const delta of [
      guestsDelta({ guests: [before], sign: -1 }),
      guestsDelta({ guests: [after], sign: 1 }),
    ])
      for (const [key, value] of Object.entries(delta) as [keyof StatsDelta, number][])
        total[key] += value;
  }
  return total;
}
