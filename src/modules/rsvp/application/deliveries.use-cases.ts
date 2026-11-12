import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../shared/config/app-config.service';
import { AFTER_COMMIT, type AfterCommit } from '../../../shared/database/after-commit.port';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { PARTY_LINKS, type PartyLinks } from '../../guests/application/ports/party-links.port';
import type { DeliveryStatus } from '../../guests/domain/party';
import { maskEmail } from '../../guests/domain/email';
import { maskPhone } from '../../guests/domain/phone';
import {
  PRODUCT_EVENT_RECORDER,
  type ProductEventRecorder,
} from '../../product-events/application/ports/product-event-recorder.port';
import {
  deliveriesClosedReason,
  longDate,
  mailtoUrl,
  renderMessage,
  whatsappUrl,
  type DeliveryChannel,
} from '../domain/deliveries';
import type { MessageKind } from '../domain/message-templates';
import {
  DeliveriesClosedError,
  DeliveryNotAllowedError,
  DeliveryPartyNotFoundError,
} from '../domain/rsvp.errors';
import { MessageTemplates } from './message-templates.use-cases';
import {
  DELIVERY_STORE,
  type DeliveryPartyRow,
  type DeliveryStore,
  type DeliveryWedding,
} from './ports/delivery-store.port';

export interface DeliveryQueueItem {
  id: string;
  name: string;
  deliveryStatus: DeliveryStatus;
  sentAt: Date | null;
  lastChannel: DeliveryChannel | null;
  saveTheDateSentAt: Date | null;
  lastReminderAt: Date | null;
  /** Mascarado para mostrar; o inteiro só dentro das URLs (RN11). */
  contact: {
    guestId: string;
    name: string | null;
    phoneMasked: string | null;
    emailMasked: string | null;
  } | null;
  /** Nulo sem telefone no contato. */
  whatsappUrl: string | null;
  /** Nulo sem e-mail no contato. */
  mailtoUrl: string | null;
  copyText: string;
}

export interface DeliveryQueue {
  kind: MessageKind;
  subject: string;
  items: DeliveryQueueItem[];
  /** Pedidos que não entram: fora do lembrete, na lixeira ou de outro casamento (RN04). */
  skippedPartyIds: string[];
}

export interface DeliveredParty {
  id: string;
  deliveryStatus: DeliveryStatus;
  sentAt: Date | null;
  lastChannel: DeliveryChannel | null;
  saveTheDateSentAt: Date | null;
  lastReminderAt: Date | null;
}

/** A regra comum dos envios: quem pode, quando vale e os grupos (Envios RN01 e RN02). */
@Injectable()
export class DeliveryGuard {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(DELIVERY_STORE) private readonly store: DeliveryStore,
  ) {}

  async open({
    userId,
    weddingId,
    kind,
    now,
  }: {
    userId: string;
    weddingId: string;
    kind: MessageKind;
    now: Date;
  }): Promise<DeliveryWedding> {
    await this.authorization.require({ userId, weddingId, action: 'manage_guests' });
    const wedding = await this.store.wedding({ weddingId });
    if (!wedding) throw new Error('Casamento sem leitura na transação do vínculo.');
    const reason = deliveriesClosedReason({ kind, ...wedding, now });
    if (reason) throw new DeliveriesClosedError({ reason });
    return wedding;
  }
}

/**
 * GET …/deliveries/queue (Envios RN06, RN07 e RN11; decisão 217(10)): até 200
 * grupos; por grupo, o contato mascarado, o status e as URLs prontas, com a
 * mensagem guardada (ou a padrão) e os marcadores trocados no servidor. No
 * lembrete, só os grupos que entram nele.
 */
@Injectable()
export class GetDeliveryQueue {
  private readonly site: string;

  constructor(
    private readonly guard: DeliveryGuard,
    @Inject(DELIVERY_STORE) private readonly store: DeliveryStore,
    private readonly templates: MessageTemplates,
    @Inject(PARTY_LINKS) private readonly links: PartyLinks,
    config: AppConfigService,
  ) {
    // O endereço do site sem o protocolo, como na mensagem: kore.com.br/<slug>.
    const url = new URL(config.get({ key: 'SITE_URL' }));
    this.site = `${url.host}${url.pathname.replace(/\/+$/, '')}`;
  }

  async execute({
    userId,
    weddingId,
    kind,
    partyIds,
    now,
  }: {
    userId: string;
    weddingId: string;
    kind: MessageKind;
    partyIds: readonly string[];
    now: Date;
  }): Promise<DeliveryQueue> {
    const wedding = await this.guard.open({ userId, weddingId, kind, now });
    const template = (await this.templates.all({ weddingId })).find((item) => item.kind === kind)!;
    const parties = (await this.store.parties({ weddingId, partyIds, lock: false })).filter(
      (party) => kind !== 'reminder' || party.remindable,
    );
    const included = new Set(parties.map((party) => party.id));
    return {
      kind,
      subject: template.subject,
      items: parties.map((party) =>
        this.item({ party, wedding, kind, body: template.body, subject: template.subject }),
      ),
      skippedPartyIds: [...new Set(partyIds)].filter((id) => !included.has(id)),
    };
  }

  private item({
    party,
    wedding,
    kind,
    body,
    subject,
  }: {
    party: DeliveryPartyRow;
    wedding: DeliveryWedding;
    kind: MessageKind;
    body: string;
    subject: string;
  }): DeliveryQueueItem {
    const text = renderMessage({
      body,
      values: {
        partyName: party.name,
        eventDate: wedding.eventDate ? longDate({ day: wedding.eventDate }) : '',
        // O save the date não leva o link do grupo (RN03; D17).
        link:
          kind === 'save_the_date'
            ? ''
            : (this.links.url({ slug: wedding.slug, token: party.linkToken }) ?? ''),
        site: wedding.slug ? `${this.site}/${wedding.slug}` : '',
        deadline: wedding.rsvpDeadline ? longDate({ day: wedding.rsvpDeadline }) : '',
      },
    });
    const contact = party.contact;
    return {
      id: party.id,
      name: party.name,
      deliveryStatus: party.deliveryStatus,
      sentAt: party.sentAt,
      lastChannel: party.lastChannel,
      saveTheDateSentAt: party.saveTheDateSentAt,
      lastReminderAt: party.lastReminderAt,
      contact: contact && {
        guestId: contact.guestId,
        name: contact.name,
        phoneMasked: contact.phone ? maskPhone({ e164: contact.phone }) : null,
        emailMasked: contact.email ? maskEmail({ email: contact.email }) : null,
      },
      whatsappUrl: contact?.phone ? whatsappUrl({ phone: contact.phone, text }) : null,
      mailtoUrl: contact?.email ? mailtoUrl({ email: contact.email, subject, text }) : null,
      copyText: text,
    };
  }
}

/**
 * Marca os envios (Envios RN07 a RN09), também pelo QR: os grupos travados na
 * ordem do id; grupo pedido fora do casamento ou na lixeira é 404; no
 * lembrete, só quem entra nele (422); o QR só no convite (422). Depois do
 * commit, `grupo_enviado` no 1º envio do convite de cada grupo, com o canal e
 * o total de grupos do casamento.
 */
@Injectable()
export class DeliveryMarker {
  constructor(
    @Inject(DELIVERY_STORE) private readonly store: DeliveryStore,
    @Inject(PRODUCT_EVENT_RECORDER) private readonly productEvents: ProductEventRecorder,
    @Inject(AFTER_COMMIT) private readonly afterCommit: AfterCommit,
  ) {}

  async mark({
    userId,
    weddingId,
    partyIds,
    kind,
    channel,
    now,
  }: {
    userId: string;
    weddingId: string;
    partyIds: readonly string[];
    kind: MessageKind;
    channel: DeliveryChannel;
    now: Date;
  }): Promise<{ parties: DeliveryPartyRow[]; delivered: DeliveredParty[] }> {
    if (channel === 'qr' && kind !== 'invite')
      throw new DeliveryNotAllowedError({ code: 'QR_ONLY_FOR_INVITE' });
    const unique = [...new Set(partyIds)];
    const parties = await this.store.parties({ weddingId, partyIds: unique, lock: true });
    const found = new Set(parties.map((party) => party.id));
    const missing = unique.filter((id) => !found.has(id));
    if (missing.length > 0) throw new DeliveryPartyNotFoundError({ partyIds: missing });
    if (kind === 'reminder') {
      const outside = parties.filter((party) => !party.remindable).map((party) => party.id);
      if (outside.length > 0)
        throw new DeliveryNotAllowedError({ code: 'PARTY_NOT_REMINDABLE', partyIds: outside });
    }

    await this.store.mark({ weddingId, partyIds: unique, kind, channel, userId, now });
    const firstInvites = kind === 'invite' ? parties.filter((party) => !party.sentAt).length : 0;
    if (firstInvites > 0) {
      const total = await this.store.countActiveParties({ weddingId });
      this.afterCommit.schedule(async () => {
        for (let index = 0; index < firstInvites; index++)
          await this.productEvents.record({
            event: {
              name: 'grupo_enviado',
              weddingId,
              props: { canal: channel, grupos_total: total },
            },
            occurredAt: now,
          });
      });
    }
    const after = await this.store.parties({ weddingId, partyIds: unique, lock: false });
    return {
      parties: after,
      delivered: after.map((party) => ({
        id: party.id,
        deliveryStatus: party.deliveryStatus,
        sentAt: party.sentAt,
        lastChannel: party.lastChannel,
        saveTheDateSentAt: party.saveTheDateSentAt,
        lastReminderAt: party.lastReminderAt,
      })),
    };
  }
}

/** POST …/deliveries (Envios RN07): o clique no canal marca o envio dos grupos. */
@Injectable()
export class MarkDeliveries {
  constructor(
    private readonly guard: DeliveryGuard,
    private readonly marker: DeliveryMarker,
  ) {}

  async execute({
    userId,
    weddingId,
    partyIds,
    kind,
    channel,
    now,
  }: {
    userId: string;
    weddingId: string;
    partyIds: readonly string[];
    kind: MessageKind;
    channel: DeliveryChannel;
    now: Date;
  }): Promise<DeliveredParty[]> {
    await this.guard.open({ userId, weddingId, kind, now });
    return (await this.marker.mark({ userId, weddingId, partyIds, kind, channel, now })).delivered;
  }
}
