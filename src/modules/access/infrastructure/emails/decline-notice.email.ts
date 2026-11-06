import type { EmailMessage } from '../../../../shared/email/application/email-sender.port';
import type { DeclineNotice } from '../../application/ports/decline-notice-mailer.port';
import { renderEmailHtml, SUPPORT_LINE, type EmailBlock } from './email-layout';

/**
 * E-mail 5 da Voz & Microcopy: aviso de convite recusado (RN11; decisão 136),
 * para quem convidou. Sem o link do convite.
 */
export function declineNoticeEmail({
  notice,
  url,
}: {
  notice: DeclineNotice;
  url: string;
}): EmailMessage {
  const [partner1, partner2] = notice.partnerNames;
  const lines: Record<DeclineNotice['kind'], [string, string]> = {
    partner: [
      `${notice.declinedBy} recusou o convite para o casamento de vocês no Kore.`,
      'Se foi engano, envie um convite novo em Colaboradores.',
    ],
    couple: [
      `${notice.declinedBy} recusou o convite para o casamento de ${partner1} e ${partner2}.`,
      'Você pode reenviar o convite ou convidar outro e-mail no detalhe do casamento.',
    ],
    planner: [
      `${notice.declinedBy} recusou o convite para ser cerimonialista do casamento de vocês.`,
      'Você pode convidar outra pessoa em Colaboradores.',
    ],
  };
  const [what, next] = lines[notice.kind];
  const footer = `Você recebeu este e-mail porque convidou ${notice.declinedBy} no Kore.`;
  const blocks: EmailBlock[] = [
    { kind: 'paragraph', text: `Olá, ${notice.inviterName}.` },
    { kind: 'paragraph', text: what },
    { kind: 'paragraph', text: next },
    { kind: 'button', text: 'Abrir o Kore', href: url },
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
    subject: `${notice.declinedBy} recusou o convite`,
    text,
    html: renderEmailHtml({
      preheader: 'Você pode convidar de novo quando quiser.',
      blocks,
      footer,
    }),
  };
}
