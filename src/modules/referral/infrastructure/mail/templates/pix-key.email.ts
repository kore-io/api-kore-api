import type { EmailMessage } from '@/shared/email/application/email-sender.port';
import {
  renderEmailHtml,
  SUPPORT_LINE,
  type EmailBlock,
} from '@/modules/access/infrastructure/mail/templates/email-layout';

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

/**
 * Cada e-mail da chave tem a sua linha de segurança e o seu rodapé (decisão
 * 302(2); Pena, tabela 2.6): o "cancele a troca" só onde há troca a cancelar,
 * e o rodapé neutro, porque o aviso existe para quem não pediu.
 */
const NOT_YOU = {
  firstKey: 'Se não foi você, não use o botão e escreva para suporte@kore.com.br.',
  change:
    'Se não foi você, não use o botão. Cancele a troca no Kore ou escreva para suporte@kore.com.br.',
  changeConfirmed: 'Se não foi você, cancele a troca no Kore ou escreva para suporte@kore.com.br.',
  changeCanceled: 'Se não foi você, escreva para suporte@kore.com.br.',
} as const;
const FOOTER = {
  firstKey: 'Você recebeu este e-mail porque uma chave Pix foi cadastrada na sua conta do Kore.',
  changeRequested:
    'Você recebeu este e-mail porque a troca da chave Pix foi pedida na sua conta do Kore.',
  changeCanceled:
    'Você recebeu este e-mail porque a troca da chave Pix foi cancelada na sua conta do Kore.',
} as const;

function message({
  to,
  subject,
  preheader,
  blocks,
  notYou,
  footer,
}: {
  to: string;
  subject: string;
  preheader: string;
  blocks: EmailBlock[];
  notYou: string;
  footer: string;
}): EmailMessage {
  const all: EmailBlock[] = [...blocks, { kind: 'paragraph', text: notYou }];
  const text = [
    ...all.map((block) =>
      block.kind === 'button' ? `${block.text}: ${block.href ?? ''}` : block.text,
    ),
    SUPPORT_LINE,
    footer,
  ].join('\n\n');
  return { to, subject, text, html: renderEmailHtml({ preheader, blocks: all, footer }) };
}

/** "Olá, {nome}." com ponto; "Olá!" sem nome (decisão 302(3)). */
const hello = (firstName: string | null) => (firstName ? `Olá, ${firstName}.` : 'Olá!');

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
    subject: firstKey ? 'Confirme sua chave Pix' : 'Confirme a troca da chave Pix',
    preheader: 'O link vale por 30 minutos.',
    blocks: [
      { kind: 'paragraph', text: hello(firstName) },
      {
        kind: 'paragraph',
        text: firstKey
          ? `Para confirmar a chave Pix ${keyMasked}, use o botão abaixo. Ele vale por 30 minutos.`
          : `Para confirmar a troca para a chave Pix ${keyMasked}, use o botão abaixo. Ele vale por 30 minutos.`,
      },
      { kind: 'button', text: firstKey ? 'Confirmar chave Pix' : 'Confirmar a troca', href: url },
    ],
    notYou: firstKey ? NOT_YOU.firstKey : NOT_YOU.change,
    footer: firstKey ? FOOTER.firstKey : FOOTER.changeRequested,
  });
}

/**
 * A troca confirmada (decisão 244(1), (c)): a nova chave vale 48 h depois. Traz
 * a chave nova mascarada, para quem não pediu reconhecê-la, e a espera dos
 * repasses (decisão 302(2)); o pré-cabeçalho não leva a chave.
 */
export function pixKeyChangeConfirmedEmail({
  to,
  firstName,
  keyMasked,
  activeFrom,
  url,
}: {
  to: string;
  firstName: string | null;
  keyMasked: string;
  activeFrom: Date;
  url: string;
}): EmailMessage {
  return message({
    to,
    subject: 'Troca da chave Pix confirmada',
    preheader: 'Até lá, os repasses ficam em espera.',
    blocks: [
      { kind: 'paragraph', text: hello(firstName) },
      {
        kind: 'paragraph',
        text: `A nova chave Pix ${keyMasked} vale a partir de ${formatDayAndHour(activeFrom)}. Até lá, os repasses ficam em espera.`,
      },
      { kind: 'button', text: 'Ver dados para receber', href: url },
    ],
    notYou: NOT_YOU.changeConfirmed,
    footer: FOOTER.changeRequested,
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
    notYou: NOT_YOU.changeCanceled,
    footer: FOOTER.changeCanceled,
  });
}
