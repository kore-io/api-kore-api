import type { EmailMessage } from '../../../../shared/email/application/email-sender.port';
import { renderEmailHtml, SUPPORT_LINE, type EmailBlock } from './email-layout';

const FOOTER =
  'Você recebeu este e-mail porque a equipe do Kore trocou o e-mail de acesso de uma conta.';

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

/** Ao endereço novo (Backoffice - acesso RN09; textos da spec): o botão de acesso de 15 minutos. */
export function newAccessEmail({
  to,
  accessUrl,
}: {
  to: string;
  accessUrl: string | null;
}): EmailMessage {
  return message({
    to,
    subject: 'Seu novo e-mail de acesso ao Kore',
    preheader: 'O botão vale por 15 minutos.',
    blocks: [
      { kind: 'paragraph', text: 'Olá!' },
      {
        kind: 'paragraph',
        text: 'A pedido do casal, a equipe do Kore trocou o e-mail de acesso da sua conta para este endereço.',
      },
      ...(accessUrl ? [{ kind: 'button' as const, text: 'Entrar no Kore', href: accessUrl }] : []),
      {
        kind: 'paragraph',
        text: 'O botão vale por 15 minutos e só uma vez. Depois, entre com este e-mail para receber um código.',
      },
    ],
  });
}

/** Ao endereço antigo (Backoffice - acesso RN09; textos da spec), com o novo mascarado. */
export function oldAccessEmail({
  to,
  newEmailMasked,
}: {
  to: string;
  newEmailMasked: string;
}): EmailMessage {
  return message({
    to,
    subject: 'O e-mail de acesso da sua conta mudou',
    preheader: 'Este endereço não entra mais no Kore.',
    blocks: [
      {
        kind: 'paragraph',
        text: `A pedido do casal, a equipe do Kore trocou o e-mail de acesso da sua conta para ${newEmailMasked}. Este endereço não entra mais no Kore.`,
      },
      { kind: 'paragraph', text: 'Se não foi você, escreva agora para suporte@kore.com.br.' },
    ],
  });
}
