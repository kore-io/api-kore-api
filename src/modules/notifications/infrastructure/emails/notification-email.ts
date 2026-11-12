import type { EmailMessage } from '../../../../shared/email/application/email-sender.port';
import {
  renderEmailHtml,
  SUPPORT_LINE,
  type EmailBlock,
} from '../../../access/infrastructure/emails/email-layout';

/** Um grupo do payload da notificação (Central RN04). */
export interface EmailGroup {
  partyId: string;
  name: string;
  confirmed: number;
  declined: number;
  /** ISO 8601. */
  at: string;
}

/** No máximo um e-mail "Na hora" a cada 15 minutos (E-mail e push RN03). */
export const IMMEDIATE_WINDOW_MS = 15 * 60_000;
/** O Resumo diário sai a partir das 20h no fuso do casamento (RN04). */
export const DIGEST_HOUR = 20;

/**
 * Os grupos que ainda não foram por e-mail (RN02; decisão 217(b)): os do
 * payload com `at > emailedThrough`. O mesmo grupo em mais de uma notificação
 * entra uma vez, com a resposta mais nova; na ordem em que responderam.
 */
export function pendingGroups({
  payloads,
  emailedThrough,
}: {
  payloads: readonly unknown[];
  emailedThrough: Date | null;
}): EmailGroup[] {
  const latest = new Map<string, EmailGroup>();
  for (const payload of payloads)
    for (const entry of Array.isArray(payload) ? (payload as EmailGroup[]) : []) {
      const at = Date.parse(entry.at);
      if (Number.isNaN(at) || (emailedThrough && at <= emailedThrough.getTime())) continue;
      const current = latest.get(entry.partyId);
      if (!current || Date.parse(current.at) < at) latest.set(entry.partyId, entry);
    }
  return [...latest.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** O `at` mais novo entre os grupos mandados: o novo `emailedThrough`. */
export function newestAt({ groups }: { groups: readonly EmailGroup[] }): Date {
  return new Date(Math.max(...groups.map((group) => Date.parse(group.at))));
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "a, b e c" (sem a parte vazia). */
function joinParts(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}

/** "3 confirmados, 1 recusado": a parte com zero sai (RN03). */
export function groupLine({ group }: { group: EmailGroup }): string {
  const parts = [
    group.confirmed > 0 ? plural(group.confirmed, 'confirmado', 'confirmados') : null,
    group.declined > 0 ? plural(group.declined, 'recusado', 'recusados') : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? `${group.name}: ${parts.join(', ')}` : group.name;
}

/** "No total, o casamento tem 96 confirmados, 18 recusados e 28 pendentes." (Grupos RN13). */
export function totalsLine({
  confirmed,
  declined,
  pending,
}: {
  confirmed: number;
  declined: number;
  pending: number;
}): string {
  const parts = [
    confirmed > 0 ? plural(confirmed, 'confirmado', 'confirmados') : null,
    declined > 0 ? plural(declined, 'recusado', 'recusados') : null,
    pending > 0 ? plural(pending, 'pendente', 'pendentes') : null,
  ].filter((part): part is string => part !== null);
  return `No total, o casamento tem ${joinParts(parts)}.`;
}

/** O nome do grupo no assunto, sem quebra de linha (RN06; R8-9). */
const oneLine = (text: string) => text.replace(/[\r\n]+/g, ' ').trim();

export interface EmailContext {
  to: string;
  /** O primeiro nome de quem recebe; nulo sem nome. */
  firstName: string | null;
  groups: readonly EmailGroup[];
  totals: { confirmed: number; declined: number; pending: number };
  /** APP_URL/app/convidados. */
  guestsUrl: string;
  /** O link direto para Configurações › Notificações (R8-9). */
  settingsUrl: string;
}

function message({
  context,
  subject,
  preheader,
  intro,
  footer,
}: {
  context: EmailContext;
  subject: string;
  preheader: string;
  intro: string;
  footer: string;
}): EmailMessage {
  const blocks: EmailBlock[] = [
    { kind: 'paragraph', text: context.firstName ? `Olá, ${context.firstName}.` : 'Olá.' },
    { kind: 'paragraph', text: intro },
    ...context.groups.map((group) => ({ kind: 'paragraph' as const, text: groupLine({ group }) })),
    { kind: 'paragraph', text: totalsLine(context.totals) },
    { kind: 'button', text: 'Ver a lista de convidados', href: context.guestsUrl },
  ];
  const footerWithLink = `${footer} ${context.settingsUrl}`;
  const text = [
    ...blocks.map((block) =>
      block.kind === 'button' ? `${block.text}: ${block.href ?? ''}` : block.text,
    ),
    SUPPORT_LINE,
    footerWithLink,
  ].join('\n\n');
  return {
    to: context.to,
    subject: oneLine(subject),
    text,
    // Os nomes de grupo são escapados pelo layout (RN06).
    html: renderEmailHtml({ preheader, blocks, footer: footerWithLink }),
  };
}

/** O e-mail "Na hora" (RN03; Pena). */
export function immediateEmail({ context }: { context: EmailContext }): EmailMessage {
  const [first] = context.groups;
  return message({
    context,
    subject:
      context.groups.length === 1
        ? `${first.name} respondeu o convite`
        : `${context.groups.length} grupos responderam o convite`,
    // Sem nome nem número: aparece na tela bloqueada.
    preheader: 'Confira as respostas no Kore.',
    intro: 'Chegaram respostas ao convite do casamento de vocês:',
    footer:
      'Você recebe este e-mail porque escolheu receber as respostas na hora. Para mudar, abra Configurações › Notificações no Kore.',
  });
}

/** O Resumo diário às 20h (RN04; Pena). */
export function digestEmail({ context }: { context: EmailContext }): EmailMessage {
  const count = context.groups.length;
  return message({
    context,
    subject:
      count === 1
        ? 'Resumo do dia: 1 grupo respondeu'
        : `Resumo do dia: ${count} grupos responderam`,
    preheader: 'As respostas de hoje ao convite.',
    intro:
      count === 1
        ? 'Hoje, 1 grupo respondeu o convite:'
        : `Hoje, ${count} grupos responderam o convite:`,
    footer:
      'Você recebe este resumo porque escolheu o resumo diário. Para mudar, abra Configurações › Notificações no Kore.',
  });
}

/** A hora local (0 a 23) no fuso do casamento. */
export function localHour({ at, timezone }: { at: Date; timezone: string }): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(at),
  );
}
