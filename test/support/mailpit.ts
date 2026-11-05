const MAILPIT_API_URL = process.env.MAILPIT_API_URL ?? 'http://localhost:8025';

interface MailpitSummary {
  ID: string;
  Subject: string;
}

/** Os e-mails recebidos por um endereço, do mais novo para o mais antigo. */
export async function inbox({ to }: { to: string }): Promise<MailpitSummary[]> {
  const response = await fetch(
    `${MAILPIT_API_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
  );
  const { messages } = (await response.json()) as { messages: MailpitSummary[] };
  return messages;
}

/** O código e o token do e-mail de login mais recente para o endereço. */
export async function latestLoginEmail({
  to,
}: {
  to: string;
}): Promise<{ subject: string; code: string; token: string; text: string }> {
  const [latest] = await inbox({ to });
  if (!latest) throw new Error(`Nenhum e-mail para ${to}.`);
  const response = await fetch(`${MAILPIT_API_URL}/api/v1/message/${latest.ID}`);
  const { Text } = (await response.json()) as { Text: string };
  const code = /(\d{3}) (\d{3})/.exec(Text);
  const token = /token=([\w-]+)/.exec(Text);
  if (!code || !token) throw new Error('E-mail sem código ou token.');
  return { subject: latest.Subject, code: `${code[1]}${code[2]}`, token: token[1], text: Text };
}
