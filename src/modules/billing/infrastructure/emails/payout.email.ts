import type { EmailMessage } from '../../../../shared/email/application/email-sender.port';
import {
  renderEmailHtml,
  SUPPORT_LINE,
  type EmailBlock,
} from '../../../access/infrastructure/emails/email-layout';

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

const hello = (firstName: string | null) => (firstName ? `Olá, ${firstName}!` : 'Olá!');

/** "Repasse pago" (Repasse RN08; textos da Pena): só e-mail, sem valor. */
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
    preheader: 'O Pix foi enviado para a sua chave.',
    blocks: [
      { kind: 'paragraph', text: hello(firstName) },
      {
        kind: 'paragraph',
        text: 'O Kore pagou o seu repasse por Pix. O comprovante está no Kore.',
      },
      { kind: 'button', text: 'Ver repasses', href: url },
    ],
  });
}

/** "Repasse recusado" (Repasse RN07 e RN08; textos da Pena): só e-mail, sem valor. */
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
        text: 'O seu pedido de repasse foi recusado. O motivo está no Kore, e as comissões voltaram ao saldo disponível. Você pode pedir de novo agora.',
      },
      { kind: 'button', text: 'Ver repasses', href: url },
    ],
  });
}
