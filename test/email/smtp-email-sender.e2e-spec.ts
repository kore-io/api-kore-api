import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EMAIL_SENDER, EmailSender } from '../../src/shared/email/application/email-sender.port';
import { createTestApp } from '../support/create-test-app';

interface MailpitSearch {
  messages: { Subject: string; To: { Address: string }[]; From: { Address: string } }[];
}

const MAILPIT_API_URL = process.env.MAILPIT_API_URL ?? 'http://localhost:8025';

describe('SmtpEmailSender (Mailpit real)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('dada uma mensagem, quando envia, então o Mailpit recebe com o remetente configurado', async () => {
    const subject = `Teste ${randomUUID()}`;

    await app.get<EmailSender>(EMAIL_SENDER).send({
      message: { to: 'casal@kore.local', subject, text: 'Corpo do teste' },
    });

    const response = await fetch(
      `${MAILPIT_API_URL}/api/v1/search?query=${encodeURIComponent(`subject:"${subject}"`)}`,
    );
    const { messages } = (await response.json()) as MailpitSearch;
    expect(messages).toHaveLength(1);
    expect(messages[0].To[0].Address).toBe('casal@kore.local');
    expect(messages[0].From.Address).toBe('nao-responda@kore.local');
  });
});
