import type { EmailMessage } from '@/shared/email/application/email-sender.port';
import {
  renderEmailHtml,
  SUPPORT_LINE,
  type EmailBlock,
} from '@/modules/access/infrastructure/mail/templates/email-layout';

/** O rodapé: por que a pessoa recebe (a Pena revisa na fase de Docs). */
const FOOTER = 'Você recebeu este e-mail porque pediu um repasse no Kore.';

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
  const text = [
    ...blocks.map((block) =>
      block.kind === 'button' ? `${block.text}: ${block.href ?? ''}` : block.text,
    ),
    SUPPORT_LINE,
    FOOTER,
  ].join('\n\n');
  return { to, subject, text, html: renderEmailHtml({ preheader, blocks, footer: FOOTER }) };
}

/** "Olá, {nome}." com ponto; "Olá!" sem nome (decisão 302(3)). */
const hello = (firstName: string | null) => (firstName ? `Olá, ${firstName}.` : 'Olá!');

/** "Repasse pago" (Repasse RN08; textos da Pena, decisão 302(4)): só e-mail, sem valor. */
export function payoutPaidEmail({
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
    subject: 'Repasse pago',
    preheader: 'O Pix foi enviado para sua chave.',
    blocks: [
      { kind: 'paragraph', text: hello(firstName) },
      {
        kind: 'paragraph',
        text: 'O Kore pagou seu repasse por Pix. O comprovante está em Repasses, no Kore.',
      },
      { kind: 'button', text: 'Ver repasses', href: url },
    ],
  });
}

/**
 * "Repasse recusado" (Repasse RN07 e RN08; textos da Pena, decisão 302(4)): só
 * e-mail, sem valor; o motivo fica no app.
 */
export function payoutRejectedEmail({
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
    subject: 'Repasse recusado',
    preheader: 'Suas comissões voltaram ao saldo.',
    blocks: [
      { kind: 'paragraph', text: hello(firstName) },
      {
        kind: 'paragraph',
        text: 'Seu pedido de repasse foi recusado. Veja o motivo em Repasses: as comissões voltaram ao saldo disponível, e você pode pedir de novo agora.',
      },
      { kind: 'button', text: 'Ver repasses', href: url },
    ],
  });
}
