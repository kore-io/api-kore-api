import { daysBetween, localDate } from '../../../shared/time/local-date';

/** Os grupos ativos por status de envio (Dashboard RN02). */
export interface DeliveryCounts {
  notSent: number;
  sent: number;
  viewed: number;
  responded: number;
}

/**
 * A fila do lembrete (Envios RN03; Prazo RN02, T5): grupos já enviados com
 * algum convidado com nome pendente; `guests` são esses convidados; e
 * `notReminded`, os grupos da fila sem lembrete depois do convite (R6-1).
 */
export interface ReminderQueue {
  parties: number;
  guests: number;
  notReminded: number;
}

export type ChecklistKey = 'guests' | 'appearance' | 'publish' | 'invites' | 'reminders';

export interface ChecklistItem {
  key: ChecklistKey;
  done: boolean;
  /** Nos envios: grupos enviados de todos; no lembrete: grupos da fila já lembrados. */
  progress: { done: number; total: number } | null;
}

export function partiesTotal({ delivery }: { delivery: DeliveryCounts }): number {
  return delivery.notSent + delivery.sent + delivery.viewed + delivery.responded;
}

/**
 * O Checklist (Dashboard RN03; D28), nesta ordem. A chave Pix entra na F7.
 * - convidados: pelo menos um grupo ativo;
 * - aparência: `appearanceSetAt` (quem vem do Simule já chega com ele);
 * - publicar: `publishedAt`;
 * - envios: pelo menos 1 grupo e nenhum `not_sent` ("enviado" é
 *   `deliveryStatus <> 'not_sent'`, R4-5 e R6-2);
 * - lembrete: aparece depois do 1º envio; feito quando todo grupo da fila já
 *   recebeu lembrete depois do convite.
 */
export function checklist({
  delivery,
  reminderQueue,
  appearanceSet,
  published,
}: {
  delivery: DeliveryCounts;
  reminderQueue: ReminderQueue;
  appearanceSet: boolean;
  published: boolean;
}): ChecklistItem[] {
  const total = partiesTotal({ delivery });
  const sent = total - delivery.notSent;
  const items: ChecklistItem[] = [
    { key: 'guests', done: total > 0, progress: null },
    { key: 'appearance', done: appearanceSet, progress: null },
    { key: 'publish', done: published, progress: null },
    {
      key: 'invites',
      done: total > 0 && delivery.notSent === 0,
      progress: { done: sent, total },
    },
  ];
  if (sent > 0)
    items.push({
      key: 'reminders',
      done: reminderQueue.notReminded === 0,
      progress: {
        done: reminderQueue.parties - reminderQueue.notReminded,
        total: reminderQueue.parties,
      },
    });
  return items;
}

/** Dias até o casamento, no fuso dele (Dashboard RN01); nulo sem data. */
export function daysUntilEvent({
  eventDate,
  timezone,
  now,
}: {
  eventDate: string | null;
  timezone: string | null;
  now: Date;
}): number | null {
  if (!eventDate) return null;
  return daysBetween({ from: localDate({ at: now, timezone }), to: eventDate });
}
