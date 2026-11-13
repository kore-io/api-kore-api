import type { EmailMessage } from '../../../../shared/email/application/email-sender.port';
import {
  renderEmailHtml,
  SUPPORT_LINE,
  type EmailBlock,
} from '../../../access/infrastructure/emails/email-layout';
import type {
  PaymentConfirmedNotice,
  PixExpiredNotice,
  RefundCompletedNotice,
} from '../../application/ports/billing-mailer.port';

/** "14 de fev. de 2027": a data é um dia, sem fuso. */
export function formatDay(day: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

function message({
  to,
  subject,
  preheader,
  blocks,
  footer,
}: {
  to: string;
  subject: string;
  preheader: string;
  blocks: EmailBlock[];
  footer: string;
}): EmailMessage {
  const text = [
    ...blocks.map((block) =>
      block.kind === 'button' ? `${block.text}: ${block.href ?? ''}` : block.text,
    ),
    SUPPORT_LINE,
    footer,
  ].join('\n\n');
  return { to, subject, text, html: renderEmailHtml({ preheader, blocks, footer }) };
}

/** "Pagamento confirmado. O site está no ar" (Publicar e pagar RN13; textos da Pena). Sem valor. */
export function paymentConfirmedEmail({
  notice,
  url,
}: {
  notice: PaymentConfirmedNotice;
  url: string;
}): EmailMessage {
  const until = formatDay(notice.endDate);
  const [partner1, partner2] = notice.partnerNames;
  return message({
    to: notice.to,
    subject: 'Pagamento confirmado. O site está no ar',
    preheader: `Ele fica no ar até ${until}.`,
    blocks: [
      { kind: 'paragraph', text: `Olá, ${notice.firstName}!` },
      {
        kind: 'paragraph',
        text: `O pagamento foi confirmado e o site de vocês já está no ar até ${until}.`,
      },
      { kind: 'paragraph', text: 'Agora vocês podem enviar os convites.' },
      { kind: 'button', text: 'Ver pagamentos', href: url },
      {
        kind: 'paragraph',
        text: 'Vocês podem desistir em até 7 dias depois de pagar, em Pagamentos.',
      },
    ],
    footer: `Você recebeu este e-mail porque o casamento de ${partner1} e ${partner2} é seu no Kore.`,
  });
}

/** "O código Pix venceu" (Publicar e pagar RN11 e RN13; textos da Pena). Sem valor. */
export function pixExpiredEmail({
  notice,
  url,
}: {
  notice: PixExpiredNotice;
  url: string;
}): EmailMessage {
  const [partner1, partner2] = notice.partnerNames;
  return message({
    to: notice.to,
    subject: 'O código Pix venceu',
    preheader: 'O site continua em rascunho.',
    blocks: [
      {
        kind: 'paragraph',
        text: 'O código Pix para publicar o site venceu antes do pagamento. Gerem um novo para publicar.',
      },
      { kind: 'button', text: 'Gerar novo Pix', href: url },
    ],
    footer: `Você recebeu este e-mail porque o casamento de ${partner1} e ${partner2} é seu no Kore.`,
  });
}

/** "Reembolso concluído" (Pagamentos e arrependimento RN07; textos da Pena). Sem valor. */
export function refundCompletedEmail({
  notice,
  url,
}: {
  notice: RefundCompletedNotice;
  url: string;
}): EmailMessage {
  const [partner1, partner2] = notice.partnerNames;
  return message({
    to: notice.to,
    subject: 'Reembolso concluído',
    preheader: 'O valor foi devolvido pela mesma forma de pagamento.',
    blocks: [
      { kind: 'paragraph', text: `Olá, ${notice.firstName}!` },
      {
        kind: 'paragraph',
        text: 'O reembolso foi concluído. O valor foi devolvido pela mesma forma de pagamento: no cartão, ele aparece numa das próximas faturas.',
      },
      { kind: 'button', text: 'Ver pagamentos', href: url },
    ],
    footer: `Você recebeu este e-mail porque o casamento de ${partner1} e ${partner2} é seu no Kore.`,
  });
}
