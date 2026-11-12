import type { EmailMessage } from '../../../../shared/email/application/email-sender.port';
import type {
  CoupleAcceptedNotice,
  PlannerLeftNotice,
} from '../../application/ports/collaboration-notice-mailer.port';
import { renderEmailHtml, SUPPORT_LINE, type EmailBlock } from './email-layout';

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

/**
 * "A cerimonialista saiu" (Notificações da cerimonialista RN09; textos da Pena).
 * Quando o nome da assessoria é o próprio nome dela, os parênteses saem.
 */
export function plannerLeftEmail({
  notice,
  url,
}: {
  notice: PlannerLeftNotice;
  url: string;
}): EmailMessage {
  const [partner1, partner2] = notice.partnerNames;
  const sameName =
    notice.agencyName.trim().toLocaleLowerCase('pt-BR') ===
    notice.plannerName.trim().toLocaleLowerCase('pt-BR');
  const who = sameName ? notice.plannerName : `${notice.plannerName} (${notice.agencyName})`;
  return message({
    to: notice.to,
    subject: `${notice.agencyName} saiu do casamento de vocês`,
    preheader: 'O site e a lista continuam como estão.',
    blocks: [
      { kind: 'paragraph', text: `Olá, ${notice.ownerName}.` },
      {
        kind: 'paragraph',
        text: `${who} saiu do casamento de ${partner1} e ${partner2} no Kore. O site e a lista continuam como estão, e a assinatura da assessoria saiu do rodapé do site.`,
      },
      { kind: 'paragraph', text: 'Se quiserem, convidem outra pessoa em Colaboradores.' },
      { kind: 'button', text: 'Abrir Colaboradores', href: url },
    ],
    footer: `Você recebeu este e-mail porque o casamento de ${partner1} e ${partner2} é seu no Kore.`,
  });
}

/** "O casal aceitou", à indicadora que criou (RN09; textos da Pena). */
export function coupleAcceptedEmail({
  notice,
  url,
}: {
  notice: CoupleAcceptedNotice;
  url: string;
}): EmailMessage {
  const [partner1, partner2] = notice.partnerNames;
  return message({
    to: notice.to,
    subject: `${partner1} e ${partner2} aceitaram o convite`,
    preheader: 'Você continua colaborando no site e na lista.',
    blocks: [
      { kind: 'paragraph', text: `Olá, ${notice.plannerName}.` },
      {
        kind: 'paragraph',
        text: `${partner1} e ${partner2} aceitaram o convite. O casal assumiu o casamento, e você continua colaborando no site e na lista.`,
      },
      { kind: 'button', text: 'Abrir o casamento', href: url },
    ],
    footer: 'Você recebeu este e-mail porque criou este casamento no Kore.',
  });
}
