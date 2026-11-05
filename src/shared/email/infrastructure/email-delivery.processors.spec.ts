import type { Job } from 'bullmq';
import type { EmailSender } from '../application/email-sender.port';
import { LoginEmailProcessor } from './email-delivery.processors';

describe('EmailDeliveryProcessor', () => {
  it('dado um job da fila, quando processa, então envia o e-mail pelo SMTP', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const sender: EmailSender = { send };
    const message = { to: 'ana@kore.local', subject: 'Assunto', text: 'Corpo' };

    await new LoginEmailProcessor(sender).process({ data: { message } } as Job<{
      message: typeof message;
    }>);

    expect(send).toHaveBeenCalledWith({ message });
  });
});
