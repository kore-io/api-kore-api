import { Inject, Injectable } from '@nestjs/common';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import { localDate } from '../../../shared/time/local-date';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { deliveryStatusAfter, hasPending } from '../../guests/domain/party-rules';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import {
  isAfterDeadline,
  partyCounts,
  partyRespondedAt,
  planCoupleResponse,
  type CoupleAnswer,
} from '../domain/rsvp';
import {
  DeadlineAfterEventError,
  DeadlineInPastError,
  ResponseGuestNotFoundError,
  RsvpChangedError,
  RsvpInvalidError,
} from '../domain/rsvp.errors';
import { RSVP_STORE, type RsvpStore } from './ports/rsvp-store.port';
import { responseStatsDelta } from './response-stats';

/**
 * PUT …/rsvp-deadline (Prazo RN01 a RN03): `manage_guests`. O prazo não fica
 * no passado nem depois do casamento (sem data do casamento, essa regra não
 * vale), com "hoje" no fuso do casamento. Nulo tira o prazo. Gravar uma data
 * nova reabre o RSVP para todos e só muda o `rsvpDeadline` (R3-8).
 */
@Injectable()
export class SetRsvpDeadline {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(RSVP_STORE) private readonly store: RsvpStore,
  ) {}

  async execute({
    userId,
    weddingId,
    rsvpDeadline,
    now,
  }: {
    userId: string;
    weddingId: string;
    rsvpDeadline: string | null;
    now: Date;
  }): Promise<{ rsvpDeadline: string | null }> {
    await this.authorization.require({ userId, weddingId, action: 'manage_guests' });
    if (rsvpDeadline !== null) {
      const wedding = await this.store.wedding({ weddingId });
      if (!wedding) throw new Error('Casamento sem leitura na transação do vínculo.');
      if (rsvpDeadline < localDate({ at: now, timezone: wedding.timezone }))
        throw new DeadlineInPastError();
      if (wedding.eventDate && rsvpDeadline > wedding.eventDate)
        throw new DeadlineAfterEventError({ eventDate: wedding.eventDate });
    }
    await this.store.updateDeadline({ weddingId, rsvpDeadline });
    return { rsvpDeadline };
  }
}

/**
 * PUT …/guests/{guestId}/response (Prazo RN04): o casal altera a resposta de
 * um convidado, em rascunho ou publicado. `manage_guests`; depois do prazo ou
 * no pós-evento, `edit_response_after_deadline` (só o dono). Grava como o
 * RSVP: locks `wedding_stats` → `parties`, a `version` conferida (409
 * RSVP_CHANGED) e subida, a RsvpSubmission e a GuestResponse com
 * `actor = couple`, os números, o status de envio (responded também a partir
 * de not_sent) e o "Respondido em". Sem notificação nem primeira_resposta; o
 * log `guest.response_changed` só com ids.
 */
@Injectable()
export class ChangeGuestResponse {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(RSVP_STORE) private readonly store: RsvpStore,
    @Inject(APPLICATION_LOG_WRITER) private readonly log: ApplicationLogWriter,
  ) {}

  async execute({
    userId,
    weddingId,
    guestId,
    version,
    answer,
    ip,
    now,
  }: {
    userId: string;
    weddingId: string;
    guestId: string;
    version: number;
    answer: CoupleAnswer;
    ip: string | null;
    now: Date;
  }): Promise<{ partyId: string; version: number }> {
    await this.authorization.require({ userId, weddingId, action: 'manage_guests' });
    const wedding = await this.store.wedding({ weddingId });
    if (!wedding) throw new Error('Casamento sem leitura na transação do vínculo.');
    if (isAfterDeadline({ ...wedding, now }))
      await this.authorization.require({
        userId,
        weddingId,
        action: 'edit_response_after_deadline',
      });

    await this.store.lockStats({ weddingId });
    const partyId = await this.store.partyOfGuest({ guestId });
    const party = partyId ? await this.store.lockParty({ partyId }) : null;
    if (!party) throw new ResponseGuestNotFoundError();
    const guests = await this.store.guests({ partyId: party.id });
    const guest = guests.find((member) => member.id === guestId);
    // Mudou de grupo ou foi para a lixeira entre a leitura e o lock.
    if (!guest) throw new ResponseGuestNotFoundError();
    if (version !== party.version)
      throw new RsvpChangedError({ current: { version: party.version } });

    const plan = planCoupleResponse({ guest, answer, now });
    if (!plan.ok) throw new RsvpInvalidError({ issues: plan.issues });
    if (!plan.update) return { partyId: party.id, version: party.version };

    const after = guests.map((member) => (member.id === guestId ? plan.update!.after : member));
    const actor = { kind: 'couple' as const, userId };
    await this.store.saveSubmission({
      weddingId,
      partyId: party.id,
      submissionId: uuidV7({ now: now.getTime() }),
      actor,
      counts: partyCounts({ guests: after }),
      updates: [plan.update],
      now,
    });
    await this.store.applyStats({
      weddingId,
      delta: responseStatsDelta({
        updates: [plan.update],
        pendingBefore: hasPending({ members: guests }),
        pendingAfter: hasPending({ members: after }),
      }),
    });
    const deliveryStatus = deliveryStatusAfter({
      current: party.deliveryStatus,
      firstViewedAt: party.firstViewedAt,
      members: after,
      afterResponse: true,
    });
    await this.store.markResponded({
      partyId: party.id,
      deliveryStatus,
      respondedAt: partyRespondedAt({ guests: after, responded: deliveryStatus === 'responded' }),
      actor,
    });
    await this.log.record({
      entry: {
        action: 'guest.response_changed',
        actorKind: 'user',
        actorUserId: userId,
        weddingId,
        entityType: 'guest',
        entityId: guestId,
        data: { partyId: party.id },
        ...(ip ? { ip } : {}),
      },
    });
    return { partyId: party.id, version: party.version + 1 };
  }
}
