import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  EMAIL_SENDER,
  type EmailSender,
} from '../../src/shared/email/application/email-sender.port';
import { createTestApp } from '../support/create-test-app';
import { waitForInbox } from '../support/mailpit';

describe('SmtpEmailSender (Mailpit real)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('dada uma mensagem, quando envia, então o Mailpit recebe com o remetente configurado', async () => {
    const to = `casal.${randomUUID()}@kore.local`;

    await app.get<EmailSender>(EMAIL_SENDER).send({
      message: { to, subject: 'Teste do SMTP', text: 'Corpo do teste' },
    });

    const [message] = await waitForInbox({ to });
    expect(message.Subject).toBe('Teste do SMTP');
    expect(message.From.Address).toBe('nao-responda@kore.local');
  });
});
