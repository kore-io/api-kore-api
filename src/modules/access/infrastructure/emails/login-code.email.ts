import type { EmailMessage } from '../../../../shared/email/application/email-sender.port';
import { renderEmailHtml, SUPPORT_LINE } from './email-layout';

/**
 * E-mail 1, Código de login (Voz & Microcopy, E-mails transacionais da Fase 0).
 * Sem nome na saudação: o mesmo texto para quem tem conta e para quem não tem
 * (RN03). O código e o link nunca vão no assunto nem no pré-cabeçalho.
 */
export function loginCodeEmail({
  to,
  code,
  accessUrl,
}: {
  to: string;
  code: string;
  accessUrl: string;
}): EmailMessage {
  const subject = 'Seu código para entrar no Kore';
  const preheader = 'Ele vale por 15 minutos.';
  const spacedCode = `${code.slice(0, 3)} ${code.slice(3)}`;
  const footer =
    'Você recebeu este e-mail porque alguém pediu para entrar no Kore com este endereço. Se não foi você, ignore: ninguém entra sem o código.';
  const validity =
    'O código e o botão valem por 15 minutos e só uma vez. Quando você usa um, o outro deixa de funcionar.';

  const text = [
    'Olá!',
    'Use este código para entrar no Kore:',
    spacedCode,
    'Ou entre direto pelo botão:',
    `Entrar no Kore: ${accessUrl}`,
    validity,
    SUPPORT_LINE,
    footer,
  ].join('\n\n');

  const html = renderEmailHtml({
    preheader,
    blocks: [
      { kind: 'paragraph', text: 'Olá!' },
      { kind: 'paragraph', text: 'Use este código para entrar no Kore:' },
      { kind: 'highlight', text: spacedCode },
      { kind: 'paragraph', text: 'Ou entre direto pelo botão:' },
      { kind: 'button', text: 'Entrar no Kore', href: accessUrl },
      { kind: 'paragraph', text: validity },
    ],
    footer,
  });

  return { to, subject, text, html };
}
