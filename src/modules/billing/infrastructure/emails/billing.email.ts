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
  EndDateSoonNotice,
  GraceNotice,
  SiteExpiredNotice,
  PurgeSoonNotice,
  DeletionScheduledNotice,
} from '../../application/ports/billing-mailer.port';

/** "14 de fev.": o dia sem o ano (os avisos de saída do ar, Pena). */
export function formatShortDay(day: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

/** "R$ 29" ou "R$ 29,90": o preço da regra, sem centavos quando redondo. */
export function formatPrice(cents: number): string {
  const reais = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? `R$ ${reais}` : `R$ ${reais},${String(rest).padStart(2, '0')}`;
}

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

const OWNER_FOOTER = (partnerNames: [string, string]) =>
  `Você recebeu este e-mail porque o casamento de ${partnerNames[0]} e ${partnerNames[1]} é seu no Kore.`;

/** Antes da data de saída do ar (Data de saída do ar RN03; textos da Pena). */
export function endDateSoonEmail({
  notice,
  url,
}: {
  notice: EndDateSoonNotice;
  url: string;
}): EmailMessage {
  const until = formatShortDay(notice.endDate);
  return message({
    to: notice.to,
    subject: `O site fica no ar até ${until}`,
    preheader: 'Adiem a data para mantê-lo no ar.',
    blocks: [
      { kind: 'paragraph', text: `Olá, ${notice.firstName}!` },
      {
        kind: 'paragraph',
        text: `O site de vocês fica no ar até ${until} Depois dessa data, ele fica mais 7 dias no ar e então sai do ar.`,
      },
      {
        kind: 'paragraph',
        text: `Para manter o site, adiem a data. Cada mês a mais custa ${formatPrice(notice.monthlyCents)}.`,
      },
      { kind: 'button', text: 'Adiar a data', href: url },
    ],
    footer: OWNER_FOOTER(notice.partnerNames),
  });
}

/** No 1º e no 5º dia depois da data de saída do ar (RN03; textos da Pena). */
export function graceEmail({ notice, url }: { notice: GraceNotice; url: string }): EmailMessage {
  const until = formatShortDay(notice.graceUntil);
  return message({
    to: notice.to,
    subject: `O site sai do ar depois de ${until}`,
    preheader: 'A data de saída do ar passou.',
    blocks: [
      {
        kind: 'paragraph',
        text: `A data de saída do ar passou, e o site fica no ar só até ${until} Depois, os convidados não conseguem mais abrir o site.`,
      },
      { kind: 'button', text: 'Adiar a data', href: url },
    ],
    footer: OWNER_FOOTER(notice.partnerNames),
  });
}

/** Quando o site expira (RN03; textos da Pena). */
export function siteExpiredEmail({
  notice,
  url,
}: {
  notice: SiteExpiredNotice;
  url: string;
}): EmailMessage {
  const renew = notice.renewUntil
    ? `, e vocês podem renovar até ${formatDay(notice.renewUntil)}`
    : '';
  return message({
    to: notice.to,
    subject: 'O site saiu do ar',
    preheader: 'Renovem para os convidados voltarem a vê-lo.',
    blocks: [
      {
        kind: 'paragraph',
        text: `O site de vocês saiu do ar em ${formatShortDay(notice.expiredAt)} Os dados continuam guardados${renew}.`,
      },
      { kind: 'button', text: 'Renovar', href: url },
    ],
    footer: OWNER_FOOTER(notice.partnerNames),
  });
}

/** 30 dias antes do expurgo (Retenção e expurgo RN02; textos da Pena). */
export function purgeSoonEmail({
  notice,
  renewUrl,
  exportUrl,
}: {
  notice: PurgeSoonNotice;
  renewUrl: string;
  exportUrl: string;
}): EmailMessage {
  const purgeDay = formatShortDay(notice.purgeAt);
  return message({
    to: notice.to,
    subject: 'Os dados do casamento serão apagados em 30 dias',
    preheader: `Renovem o site ou exportem os convidados antes de ${purgeDay}`,
    blocks: [
      { kind: 'paragraph', text: `Olá, ${notice.firstName}!` },
      {
        kind: 'paragraph',
        text: `O site de vocês está fora do ar desde ${formatShortDay(notice.expiredAt)} Em ${purgeDay}, os convidados, as respostas e o site serão apagados.`,
      },
      {
        kind: 'paragraph',
        text: 'Para manter tudo, renovem o site. Para guardar a lista, exportem os convidados.',
      },
      { kind: 'button', text: 'Renovar', href: renewUrl },
      { kind: 'button', text: 'Exportar os convidados', href: exportUrl },
    ],
    footer: OWNER_FOOTER(notice.partnerNames),
  });
}

/** A exclusão pedida pelo casal (Retenção e expurgo RN05; textos da Pena). */
export function deletionScheduledEmail({
  notice,
  url,
}: {
  notice: DeletionScheduledNotice;
  url: string;
}): EmailMessage {
  const until = formatShortDay(notice.deletionScheduledFor);
  return message({
    to: notice.to,
    subject: 'O casamento será apagado em 7 dias',
    preheader: `Até ${until}, dá para cancelar.`,
    blocks: [
      { kind: 'paragraph', text: `Olá, ${notice.firstName}!` },
      {
        kind: 'paragraph',
        text: `${notice.requesterFirstName} pediu para excluir o casamento no Kore. O site saiu do ar, e os convidados, as respostas e o site serão apagados em ${until}`,
      },
      { kind: 'paragraph', text: 'Se mudarem de ideia, cancelem a exclusão até lá.' },
      { kind: 'button', text: 'Cancelar a exclusão', href: url },
      {
        kind: 'paragraph',
        text: 'Se ninguém do casal pediu, cancele agora e escreva para suporte@kore.com.br.',
      },
    ],
    footer: OWNER_FOOTER(notice.partnerNames),
  });
}
