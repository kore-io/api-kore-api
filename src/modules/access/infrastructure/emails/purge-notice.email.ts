import type { EmailMessage } from '../../../../shared/email/application/email-sender.port';
import type { PurgeNotice } from '../../application/ports/purge-notice-mailer.port';
import { renderEmailHtml, SUPPORT_LINE, type EmailBlock } from './email-layout';

const DATE_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});

/** E-mail 6 da Voz & Microcopy: aviso de exclusão em 30 dias (RN13; decisão 136). */
export function purgeNoticeEmail({
  notice,
  url,
}: {
  notice: PurgeNotice;
  url: string;
}): EmailMessage {
  const [partner1, partner2] = notice.partnerNames;
  const couple = `${partner1} e ${partner2}`;
  const why =
    notice.status === 'awaiting_couple'
      ? `O casamento de ${couple} está sem atividade há 5 meses, e o casal ainda não aceitou o convite.`
      : `O casamento de ${couple} está sem atividade há 5 meses, e o convite para o casal ainda não foi enviado.`;
  const footer = 'Você recebeu este e-mail porque criou este casamento no Kore.';
  const blocks: EmailBlock[] = [
    { kind: 'paragraph', text: `Olá, ${notice.creatorName}.` },
    { kind: 'paragraph', text: why },
    {
      kind: 'paragraph',
      text: `Se continuar assim, ele será excluído em ${DATE_FORMAT.format(notice.purgeDate)}, com tudo o que você preparou. Não dá para desfazer.`,
    },
    { kind: 'paragraph', text: 'Para manter o casamento, abra o casamento no Kore.' },
    { kind: 'button', text: 'Abrir o casamento', href: url },
  ];
  const text = [
    ...blocks.map((block) =>
      block.kind === 'button' ? `${block.text}: ${block.href ?? ''}` : block.text,
    ),
    SUPPORT_LINE,
    footer,
  ].join('\n\n');
  return {
    to: notice.to,
    subject: `O casamento de ${couple} será excluído em 30 dias`,
    text,
    html: renderEmailHtml({ preheader: 'Ele está sem atividade há 5 meses.', blocks, footer }),
  };
}
