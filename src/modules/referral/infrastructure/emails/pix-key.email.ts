import type { EmailMessage } from '../../../../shared/email/application/email-sender.port';
import {
  renderEmailHtml,
  SUPPORT_LINE,
  type EmailBlock,
} from '../../../access/infrastructure/emails/email-layout';

const TIMEZONE = 'America/Sao_Paulo';

/** "28 de set. às 14h" (ou "às 14h30"), no fuso de São Paulo. */
export function formatDayAndHour(at: Date): string {
  const day = new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'short',
    timeZone: TIMEZONE,
  }).format(at);
  const [hour, minute] = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: TIMEZONE,
  })
    .format(at)
    .split(':');
  return `${day} às ${Number(hour)}h${minute === '00' ? '' : minute}`;
}

/** A linha de segurança de todos os e-mails da chave (Repasse RN03; Pena). */
const NOT_YOU = 'Se não foi você, cancele a troca no Kore ou escreva para suporte@kore.com.br.';
/** O rodapé: por que a pessoa recebe (decisão 244(1); a Pena revisa na fase de Docs). */
const FOOTER = 'Você recebeu este e-mail porque cadastrou dados para receber no Kore.';

function message({
  to,
  subject,
  preheader,
  blocks,
}: {
  to: string;
  subject: string;
  preheader: string;
  blocks: EmailBlock[];
}): EmailMessage {
  const all: EmailBlock[] = [...blocks, { kind: 'paragraph', text: NOT_YOU }];
  const text = [
    ...all.map((block) =>
      block.kind === 'button' ? `${block.text}: ${block.href ?? ''}` : block.text,
    ),
    SUPPORT_LINE,
    FOOTER,
  ].join('\n\n');
  return { to, subject, text, html: renderEmailHtml({ preheader, blocks: all, footer: FOOTER }) };
}

const hello = (firstName: string | null) => (firstName ? `Olá, ${firstName}!` : 'Olá!');

/**
 * O link de confirmação (decisão 244(1), (a) e (b) num e-mail só): a primeira
 * chave ou a troca, com a chave mascarada; o link vale 30 minutos.
 */
export function pixKeyConfirmEmail({
  to,
  firstName,
  firstKey,
  keyMasked,
  url,
}: {
  to: string;
  firstName: string | null;
  firstKey: boolean;
  keyMasked: string;
  url: string;
}): EmailMessage {
  return message({
    to,
    subject: firstKey ? 'Confirme a sua chave Pix' : 'Confirme a troca da chave Pix',
    preheader: 'O link vale por 30 minutos.',
    blocks: [
      { kind: 'paragraph', text: hello(firstName) },
      {
        kind: 'paragraph',
        text: `Para confirmar a chave Pix ${keyMasked}, abra o link abaixo. Ele vale por 30 minutos.`,
      },
      { kind: 'button', text: 'Confirmar chave Pix', href: url },
    ],
  });
}

/** A troca confirmada (decisão 244(1), (c)): a nova chave vale 48 h depois. */
export function pixKeyChangeConfirmedEmail({
  to,
  firstName,
  activeFrom,
  url,
}: {
  to: string;
  firstName: string | null;
  activeFrom: Date;
  url: string;
}): EmailMessage {
  return message({
    to,
    subject: 'Troca da chave Pix confirmada',
    preheader: `A nova chave vale a partir de ${formatDayAndHour(activeFrom)}.`,
    blocks: [
      { kind: 'paragraph', text: hello(firstName) },
      {
        kind: 'paragraph',
        text: `A nova chave vale a partir de ${formatDayAndHour(activeFrom)}.`,
      },
      { kind: 'button', text: 'Ver dados para receber', href: url },
    ],
  });
}

/** A troca cancelada (decisão 244(1), (d)). */
export function pixKeyChangeCanceledEmail({
  to,
  firstName,
  url,
}: {
  to: string;
  firstName: string | null;
  url: string;
}): EmailMessage {
  return message({
    to,
    subject: 'Troca da chave Pix cancelada',
    preheader: 'A chave atual continua valendo.',
    blocks: [
      { kind: 'paragraph', text: hello(firstName) },
      { kind: 'paragraph', text: 'A chave atual continua valendo.' },
      { kind: 'button', text: 'Ver dados para receber', href: url },
    ],
  });
}
