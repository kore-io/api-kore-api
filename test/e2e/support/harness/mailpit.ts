const MAILPIT_API_URL = process.env.MAILPIT_API_URL ?? 'http://localhost:8025';
// Logo depois de o worker subir (e no CI, com o banco recém-criado), a primeira
// entrega pode passar de 5 s; o caso tem 20 s (testTimeout do e2e).
const WAIT_TIMEOUT_MS = 10_000;
const WAIT_INTERVAL_MS = 100;

export interface MailpitSummary {
  ID: string;
  Subject: string;
  From: { Address: string; Name: string };
  To: { Address: string }[];
}

/**
 * Os e-mails recebidos por um endereço, do mais novo para o mais antigo. Com
 * `subject`, só os desse assunto exato: um e-mail assíncrono de outro tipo
 * (que chega fora de ordem) não toma o lugar do esperado.
 */
export async function inbox({
  to,
  subject,
}: {
  to: string;
  subject?: string;
}): Promise<MailpitSummary[]> {
  const query = subject ? `to:"${to}" subject:"${subject}"` : `to:"${to}"`;
  const response = await fetch(
    `${MAILPIT_API_URL}/api/v1/search?query=${encodeURIComponent(query)}`,
  );
  const { messages } = (await response.json()) as { messages: MailpitSummary[] };
  // A busca do Mailpit acha o assunto por trecho; aqui, só o exato.
  return subject ? messages.filter((message) => message.Subject === subject) : messages;
}

/**
 * Espera a caixa ter pelo menos `count` e-mails: o envio e a indexação do
 * Mailpit não são instantâneos (e, com a fila, o envio é assíncrono).
 */
export async function waitForInbox({
  to,
  subject,
  count = 1,
}: {
  to: string;
  subject?: string;
  count?: number;
}): Promise<MailpitSummary[]> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    const messages = await inbox({ to, subject });
    if (messages.length >= count) return messages;
    if (Date.now() > deadline) {
      const what = subject ? `"${subject}" ` : '';
      throw new Error(
        `Esperava ${count} e-mail(s) ${what}para ${to}, chegaram ${messages.length}.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_INTERVAL_MS));
  }
}

/** O código e o token do e-mail de login mais recente (o `count`-ésimo) para o endereço. */
export async function latestLoginEmail({
  to,
  count = 1,
}: {
  to: string;
  count?: number;
}): Promise<{ subject: string; code: string; token: string; text: string }> {
  const [latest] = await waitForInbox({ to, count });
  const response = await fetch(`${MAILPIT_API_URL}/api/v1/message/${latest.ID}`);
  const { Text } = (await response.json()) as { Text: string };
  const code = /(\d{3}) (\d{3})/.exec(Text);
  const token = /token=([\w-]+)/.exec(Text);
  if (!code || !token) throw new Error('E-mail sem código ou token.');
  return { subject: latest.Subject, code: `${code[1]}${code[2]}`, token: token[1], text: Text };
}

/** O texto puro de um e-mail do Mailpit. */
export async function messageText({ id }: { id: string }): Promise<string> {
  const response = await fetch(`${MAILPIT_API_URL}/api/v1/message/${id}`);
  const { Text } = (await response.json()) as { Text: string };
  return Text;
}
