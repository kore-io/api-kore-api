import { Injectable } from '@nestjs/common';
import { InjectThrottlerStorage, type ThrottlerStorage } from '@nestjs/throttler';
import { rateLimitTracker } from './rate-limit-tracker';
import { RATE_LIMIT_WINDOW_MS, RSVP_WRITES_PER_MINUTE, RSVP_WRITE_THROTTLER } from './rate-limits';

/**
 * O limite `rsvp_write` (RSVP RN10): o contador do Redis do throttler global
 * (kore:<env>:rl:rsvp_write:<ip>:<partyId>), contado a cada PUT. O grupo só é
 * conhecido depois de conferir o cookie, então o caso de uso pergunta aqui.
 */
@Injectable()
export class RsvpWriteRateLimit {
  constructor(@InjectThrottlerStorage() private readonly storage: ThrottlerStorage) {}

  async hit({ ip, partyId }: { ip: string; partyId: string }): Promise<{ blocked: boolean }> {
    const { isBlocked } = await this.storage.increment(
      `${RSVP_WRITE_THROTTLER}:${rateLimitTracker({ ip })}:${partyId}`,
      RATE_LIMIT_WINDOW_MS,
      RSVP_WRITES_PER_MINUTE,
      0,
      RSVP_WRITE_THROTTLER,
    );
    return { blocked: isBlocked };
  }
}
