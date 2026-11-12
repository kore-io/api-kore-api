import { Inject, Injectable } from '@nestjs/common';
import { AFTER_COMMIT, type AfterCommit } from '../../../shared/database/after-commit.port';
import type { PartyTransactionContext } from '../../../shared/database/tenant-transaction';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import { RsvpWriteRateLimit } from '../../../shared/rate-limit/rsvp-write-rate-limit';
import { daysBetween, localDate } from '../../../shared/time/local-date';
import { deliveryStatusAfter, hasPending } from '../../guests/domain/party-rules';
import {
  ACCESS_IP_LOG_WRITER,
  type AccessIpLogWriter,
} from '../../logs/application/ports/access-ip-log-writer.port';
import {
  PRODUCT_EVENT_RECORDER,
  type ProductEventRecorder,
} from '../../product-events/application/ports/product-event-recorder.port';
import {
  RSVP_DAILY_LIMIT,
  partyCounts,
  partyRespondedAt,
  planRsvp,
  rsvpState,
  type RsvpAnswer,
} from '../domain/rsvp';
import {
  PreviewReadOnlyError,
  RsvpChangedError,
  RsvpClosedError,
  RsvpInvalidError,
  RsvpLimitError,
  RsvpRateLimitedError,
  PartySessionInvalidError,
} from '../domain/rsvp.errors';
import { RSVP_STORE, type RsvpStore } from './ports/rsvp-store.port';
import { responseStatsDelta } from './response-stats';
import { RsvpSessions } from './rsvp-sessions.service';
import { rsvpView, type RsvpView } from './rsvp-view';

/**
 * Ids das notificações novas por gravação, um por dono ativo: o casamento tem
 * no máximo 2 donos (os 2 noivos, Partner.slot 1 e 2; chk_partners_slot), e a
 * notify_rsvp usa um id por dono. A folga cobre a troca de dono no meio.
 */
const NOTIFICATION_IDS = 4;

/**
 * GET /v1/sites/{slug}/rsvp (RSVP RN01, RN03 e RN08): o formulário do grupo
 * identificado, com as respostas atuais e a `version` do grupo; na prévia
 * como grupo, o mesmo formulário com `state: preview`, só para leitura.
 */
@Injectable()
export class GetRsvp {
  constructor(
    private readonly sessions: RsvpSessions,
    @Inject(RSVP_STORE) private readonly store: RsvpStore,
  ) {}

  async execute({
    slug,
    cookies,
    now,
  }: {
    slug: string;
    cookies: Record<string, string | undefined>;
    now: Date;
  }): Promise<RsvpView> {
    const weddingId = await this.sessions.liveWedding({ slug });
    const preview = await this.sessions.preview({
      slug,
      cookies,
      now,
      work: async ({ claims }) => {
        if (claims.mode !== 'party' || !claims.partyId) return null;
        const party = await this.store.readParty({ partyId: claims.partyId });
        const wedding = await this.store.wedding({ weddingId });
        if (!party || !wedding) return null;
        const guests = await this.store.guests({ partyId: party.id });
        return rsvpView({ party, guests, wedding, state: 'preview' });
      },
    });
    if (preview) return preview.value;

    const session = this.sessions.party({ weddingId, cookies });
    return this.sessions.asParty({
      session,
      work: async (context) => {
        const party = await this.store.readParty({ partyId: session.partyId });
        if (!party) throw new PartySessionInvalidError();
        const guests = await this.store.guests({ partyId: party.id });
        return rsvpView({ party, guests, wedding: context, state: stateOf({ context, now }) });
      },
    });
  }
}

/**
 * PUT /v1/sites/{slug}/rsvp (RSVP RN04 a RN13), numa transação do grupo:
 * - a prévia não grava (403 PREVIEW_READ_ONLY); sem cookie válido, 401;
 * - limite por IP e grupo (429 RSVP_RATE_LIMITED);
 * - fechado depois do prazo e no pós-evento (409 RSVP_CLOSED);
 * - locks `wedding_stats` → `parties` (ordem da F1, decisão 217); versão velha
 *   é 409 RSVP_CHANGED com as respostas atuais;
 * - a validação que depende do grupo (400 com errors[]);
 * - sem mudança, nada é gravado; com mudança, o teto do dia (429 RSVP_LIMIT,
 *   contado no banco, falha fechada), a RsvpSubmission, os convidados, o
 *   histórico, os números, o status de envio, a versão, a notificação dos
 *   donos (notify_rsvp) e, depois do commit, `primeira_resposta`;
 * - o AccessIpLog de cada gravação (RN12).
 */
@Injectable()
export class SubmitRsvp {
  constructor(
    private readonly sessions: RsvpSessions,
    @Inject(RSVP_STORE) private readonly store: RsvpStore,
    private readonly rateLimit: RsvpWriteRateLimit,
    @Inject(ACCESS_IP_LOG_WRITER) private readonly ipLog: AccessIpLogWriter,
    @Inject(PRODUCT_EVENT_RECORDER) private readonly productEvents: ProductEventRecorder,
    @Inject(AFTER_COMMIT) private readonly afterCommit: AfterCommit,
  ) {}

  async execute({
    slug,
    cookies,
    version,
    signedByGuestId,
    answers,
    ip,
    now,
  }: {
    slug: string;
    cookies: Record<string, string | undefined>;
    version: number;
    signedByGuestId: string;
    answers: readonly RsvpAnswer[];
    ip: string;
    now: Date;
  }): Promise<RsvpView> {
    const weddingId = await this.sessions.liveWedding({ slug });
    const preview = await this.sessions.preview({
      slug,
      cookies,
      now,
      work: () => Promise.resolve(true),
    });
    if (preview) throw new PreviewReadOnlyError();
    const session = this.sessions.party({ weddingId, cookies });
    if ((await this.rateLimit.hit({ ip, partyId: session.partyId })).blocked)
      throw new RsvpRateLimitedError();

    return this.sessions.asParty({
      session,
      work: async (context) => {
        const state = stateOf({ context, now });
        if (state !== 'open') throw new RsvpClosedError({ reason: state });

        await this.store.lockStats({ weddingId });
        const party = await this.store.lockParty({ partyId: session.partyId });
        if (!party) throw new PartySessionInvalidError();
        const guests = await this.store.guests({ partyId: party.id });
        if (version !== party.version)
          throw new RsvpChangedError({
            current: rsvpView({ party, guests, wedding: context, state }),
          });

        const plan = planRsvp({
          guests,
          answers,
          signedByGuestId,
          songQuestionEnabled: context.songQuestionEnabled,
          now,
        });
        if (!plan.ok) throw new RsvpInvalidError({ issues: plan.issues });
        this.afterCommit.schedule(() =>
          this.ipLog.record({
            entry: {
              action: 'rsvp.answered',
              ip,
              occurredAt: now,
              actorKind: 'party',
              partyId: party.id,
            },
          }),
        );
        if (plan.updates.length === 0) return rsvpView({ party, guests, wedding: context, state });

        if (
          (await this.store.submissionsToday({
            partyId: party.id,
            timezone: context.timezone,
            now,
          })) >= RSVP_DAILY_LIMIT
        )
          throw new RsvpLimitError();

        const counts = partyCounts({ guests: plan.guests });
        const submissionId = uuidV7({ now: now.getTime() });
        await this.store.saveSubmission({
          weddingId,
          partyId: party.id,
          submissionId,
          actor: { kind: 'party', signedByGuestId },
          counts,
          updates: plan.updates,
          now,
        });
        await this.store.applyStats({
          weddingId,
          delta: responseStatsDelta({
            updates: plan.updates,
            pendingBefore: hasPending({ members: guests }),
            pendingAfter: hasPending({ members: plan.guests }),
          }),
        });
        const deliveryStatus = deliveryStatusAfter({
          current: party.deliveryStatus,
          firstViewedAt: party.firstViewedAt,
          members: plan.guests,
          afterResponse: true,
        });
        await this.store.markResponded({
          partyId: party.id,
          deliveryStatus,
          respondedAt: partyRespondedAt({
            guests: plan.guests,
            responded: deliveryStatus === 'responded',
          }),
          actor: { kind: 'party', signedByGuestId },
        });
        const notified = await this.store.notify({
          submissionId,
          notificationIds: Array.from({ length: NOTIFICATION_IDS }, (_, index) =>
            uuidV7({ now: now.getTime() + index }),
          ),
        });
        if (notified.firstResponse && context.publishedAt) {
          const days = daysBetween({
            from: localDate({ at: new Date(context.publishedAt), timezone: context.timezone }),
            to: localDate({ at: now, timezone: context.timezone }),
          });
          this.afterCommit.schedule(() =>
            this.productEvents.record({
              event: {
                name: 'primeira_resposta',
                weddingId,
                props: { dias_desde_publicacao: days },
              },
              occurredAt: now,
            }),
          );
        }
        return rsvpView({
          party: { ...party, version: party.version + 1 },
          guests: plan.guests,
          wedding: context,
          state,
        });
      },
    });
  }
}

function stateOf({ context, now }: { context: PartyTransactionContext; now: Date }) {
  return rsvpState({
    status: context.status,
    rsvpDeadline: context.rsvpDeadline,
    timezone: context.timezone,
    now,
  });
}
