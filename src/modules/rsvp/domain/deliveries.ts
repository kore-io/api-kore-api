import { localDate } from '../../../shared/time/local-date';
import type { MessageKind } from './message-templates';

/** Os canais do envio (Envios RN05); o QR só no convite. */
export const DELIVERY_CHANNELS = ['whatsapp', 'email', 'link', 'qr'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/** Até 200 grupos por envio, por leitura da fila e por arquivo de QR (Envios RN10). */
export const DELIVERY_PARTIES_MAX = 200;

export type DeliveriesClosedReason = 'not_published' | 'deadline_passed' | 'post_event';

/**
 * Quando os envios valem (Envios RN01; D19; R4-3): o convite e o save the
 * date só com o site publicado; o lembrete também com o prazo aberto (até as
 * 23h59 do dia, no fuso do casamento); no pós-evento, só leitura. Null = vale.
 */
export function deliveriesClosedReason({
  kind,
  status,
  rsvpDeadline,
  timezone,
  now,
}: {
  kind: MessageKind;
  status: string;
  rsvpDeadline: string | null;
  timezone: string | null;
  now: Date;
}): DeliveriesClosedReason | null {
  if (status === 'post_event' || status === 'grace' || status === 'expired') return 'post_event';
  if (status !== 'published') return 'not_published';
  if (kind === 'reminder' && rsvpDeadline && localDate({ at: now, timezone }) > rsvpDeadline)
    return 'deadline_passed';
  return null;
}

const LONG_DATE = new Intl.DateTimeFormat('pt-BR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

/** A data por extenso dos marcadores: "14 de novembro" (Envios RN06). */
export function longDate({ day }: { day: string }): string {
  return LONG_DATE.format(new Date(`${day}T00:00:00Z`));
}

/** Os valores dos marcadores de um grupo (Envios RN06). */
export interface MessageValues {
  partyName: string;
  /** "14 de novembro"; vazio sem data. */
  eventDate: string;
  /** O link do grupo; vazio sem endereço. */
  link: string;
  /** O endereço do site: kore.com.br/<slug>. */
  site: string;
  /** "15 de outubro"; vazio sem prazo. */
  deadline: string;
}

const PLACEHOLDERS = /\{(nome_do_grupo|data|link|site|prazo)\}/g;

/**
 * Troca os marcadores numa passada só, no servidor (Envios RN06; R4-4): os
 * valores não são reprocessados, então um grupo chamado "{link}" não vira o
 * link. O texto sai puro (sem HTML); quem mostra trata como texto.
 */
export function renderMessage({ body, values }: { body: string; values: MessageValues }): string {
  const byName: Record<string, string> = {
    nome_do_grupo: values.partyName,
    data: values.eventDate,
    link: values.link,
    site: values.site,
    prazo: values.deadline,
  };
  return body.replace(PLACEHOLDERS, (_, name: string) => byName[name]);
}

/** `https://wa.me/<E.164 sem +>?text=…` (Envios RN07). */
export function whatsappUrl({ phone, text }: { phone: string; text: string }): string {
  return `https://wa.me/${phone.replace(/^\+/, '')}?text=${encodeURIComponent(text)}`;
}

/** `mailto:<e-mail>?subject=…&body=…`, cada parâmetro com encodeURIComponent (Envios RN07). */
export function mailtoUrl({
  email,
  subject,
  text,
}: {
  email: string;
  subject: string;
  text: string;
}): string {
  const address = encodeURIComponent(email).replace(/%40/g, '@');
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}
