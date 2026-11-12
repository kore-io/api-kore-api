/** Os três tipos de mensagem pronta (Envios RN03 e RN06). */
export const MESSAGE_KINDS = ['invite', 'save_the_date', 'reminder'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** Limites da mensagem (Envios RN06): corpo até 1.000; assunto do e-mail até 120. */
export const MESSAGE_BODY_MAX = 1000;
export const MESSAGE_SUBJECT_MAX = 120;

/** O marcador do link do grupo: obrigatório no convite e no lembrete (RN06; decisão 216, D15). */
export const LINK_PLACEHOLDER = '{link}';

export function requiresLink({ kind }: { kind: MessageKind }): boolean {
  return kind === 'invite' || kind === 'reminder';
}

/**
 * As mensagens padrão, na voz do casal e sem emoji (Envios RN06; Pena). A
 * cidade e os nomes do casal vêm do casamento (não são marcadores do casal);
 * `{nome_do_grupo}`, `{data}`, `{link}`, `{site}` e `{prazo}` ficam para a
 * troca na hora do envio. O lembrete tem duas versões: com prazo e sem prazo.
 */
export function defaultMessage({
  kind,
  city,
  coupleNames,
  hasDeadline,
}: {
  kind: MessageKind;
  city: string;
  coupleNames: string;
  hasDeadline: boolean;
}): { subject: string; body: string } {
  const signature = `Com carinho, ${coupleNames}`;
  if (kind === 'invite')
    return {
      subject: `Convite do casamento de ${coupleNames}`,
      body: `Oi, {nome_do_grupo}! Vamos nos casar no dia {data}, em ${city}, e contamos com a sua presença.\nA confirmação é por este link: {link}\n\n${signature}`,
    };
  if (kind === 'save_the_date')
    return {
      subject: `Data marcada: casamento de ${coupleNames}`,
      body: `Oi, {nome_do_grupo}! A data está marcada: vamos nos casar em {data}, em ${city}.\nO convite chega mais perto do dia. Enquanto isso, o nosso site já está no ar: {site}\n\n${signature}`,
    };
  return {
    subject: `Lembrete: confirmação do casamento de ${coupleNames}`,
    body: hasDeadline
      ? `Oi, {nome_do_grupo}! Ainda não recebemos a sua resposta ao nosso convite.\nDá para confirmar até {prazo} por este link: {link}\n\n${signature}`
      : `Oi, {nome_do_grupo}! Ainda não recebemos a sua resposta ao nosso convite.\nA confirmação é por este link: {link}\n\n${signature}`,
  };
}
