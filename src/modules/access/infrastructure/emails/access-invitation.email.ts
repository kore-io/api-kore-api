import type { EmailMessage } from '../../../../shared/email/application/email-sender.port';
import type { InvitationEmail } from '../../application/ports/invitation-mailer.port';
import { firstName } from '../../domain/access-invitation';
import { renderEmailHtml, SUPPORT_LINE, type EmailBlock } from './email-layout';

const VALIDITY = 'O convite vale por 30 dias e só pode ser usado uma vez.';
const RESENT = 'Este é um convite novo. O link do anterior deixou de funcionar.';

const DATE_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "sáb., 20 de mar. de 2027 · Valinhos (SP)"; sem data, só a cidade. */
export function weddingWhenAndWhere({
  eventDate,
  city,
  state,
}: {
  eventDate: Date | null;
  city: string;
  state: string;
}): string {
  const place = `${city} (${state})`;
  return eventDate ? `${DATE_FORMAT.format(eventDate)} · ${place}` : place;
}

/** O nome de quem convida (Voz & Microcopy, e-mails 2 a 4): só o primeiro nome. */
function inviterName({ inviter }: Pick<InvitationEmail, 'inviter'>): string {
  if (inviter.referrerKind === 'planner')
    return inviter.creditName ?? firstName({ name: inviter.userName ?? '' });
  const name = firstName({ name: inviter.partnerName ?? inviter.userName ?? '' });
  return inviter.referrerKind === 'seller' ? `${name}, do Kore,` : name;
}

/**
 * E-mails 2 (parceiro), 3 (casal) e 4 (cerimonialista) da Voz & Microcopy. O
 * link nunca vai no assunto nem no pré-cabeçalho. A mensagem de quem convida
 * vem citada depois da frase principal (decisão 168).
 */
export function accessInvitationEmail({
  email,
  url,
}: {
  email: InvitationEmail;
  url: string;
}): EmailMessage {
  const [partner1, partner2] = email.wedding.partnerNames.map((name) => firstName({ name }));
  const couple = `${partner1} e ${partner2}`;
  const inviter = inviterName(email);
  const whenAndWhere = weddingWhenAndWhere(email.wedding);

  const content = (() => {
    if (email.kind === 'partner') {
      return {
        subject: `${inviter} convidou você para o casamento no Kore`,
        preheader: 'Montem o site e a lista juntos, cada pessoa com o próprio login.',
        lead: `${inviter} convidou você para organizar o casamento de ${couple} no Kore.`,
        details: [
          'Vocês montam o site, a lista de convidados e acompanham as respostas juntos, cada pessoa com o próprio login.',
        ],
        button: 'Ver o convite',
        footer: `Você recebeu este e-mail porque ${inviter} convidou este endereço no Kore.`,
      };
    }
    if (email.kind === 'couple') {
      return {
        subject: `${inviter} preparou o site do casamento de vocês`,
        preheader: 'Confira o site e a lista de convidados no Kore.',
        lead: `${inviter} preparou o site do casamento de ${couple} no Kore e convidou você para conferir.`,
        details: [
          'Quando você aceitar, o casamento passa a ser de vocês: o casal publica o site e cuida da chave Pix.',
          ...(email.inviter.referrerKind === 'planner'
            ? [`${inviter} continua ajudando no site e na lista.`]
            : []),
        ],
        button: 'Ver o site e o convite',
        footer: `Você recebeu este e-mail porque ${inviter} convidou este endereço no Kore.`,
      };
    }
    return {
      subject: `${couple} convidaram você como cerimonialista`,
      preheader: 'Ajude a montar o site e a lista do casamento no Kore.',
      lead: `${couple} convidaram você como cerimonialista do casamento no Kore.`,
      details: [
        'O casamento vai aparecer em Meus casamentos, e você ajuda a montar o site e a lista. Publicar, pagar e a chave Pix ficam com o casal.',
      ],
      button: 'Ver o convite',
      footer: `Você recebeu este e-mail porque ${inviter} convidou este endereço no Kore.`,
    };
  })();
  const footer = content.footer;

  const blocks: EmailBlock[] = [
    { kind: 'paragraph', text: 'Olá!' },
    { kind: 'paragraph', text: content.lead },
    ...(email.message ? [{ kind: 'quote' as const, text: `“${email.message}”` }] : []),
    { kind: 'paragraph', text: whenAndWhere },
    ...content.details.map((text) => ({ kind: 'paragraph' as const, text })),
    ...(email.resent ? [{ kind: 'paragraph' as const, text: RESENT }] : []),
    { kind: 'button', text: content.button, href: url },
    { kind: 'paragraph', text: VALIDITY },
  ];
  const text = [
    ...blocks.map((block) =>
      block.kind === 'button' ? `${block.text}: ${block.href ?? ''}` : block.text,
    ),
    SUPPORT_LINE,
    footer,
  ].join('\n\n');

  return {
    to: email.to,
    subject: content.subject,
    text,
    html: renderEmailHtml({ preheader: content.preheader, blocks, footer }),
  };
}
