import type { Job } from 'bullmq';
import { EmailDeliveryFailures } from '../application/email-delivery-failures';
import type { EmailSender } from '../application/email-sender.port';
import { DefaultEmailProcessor, LoginEmailProcessor } from './email-delivery.processors';

const tag = { kind: 'purge_notice', data: { weddingId: 'w1' } };

function processorWith({ onGaveUp }: { onGaveUp: jest.Mock }) {
  const failures = new EmailDeliveryFailures();
  failures.register({ handler: { kind: 'purge_notice', onGaveUp } });
  const sender: EmailSender = { send: jest.fn() };
  return new DefaultEmailProcessor(sender, failures);
}

const failedJob = (attemptsMade: number, withTag = true) =>
  ({
    id: 'j1',
    attemptsMade,
    opts: { attempts: 5 },
    data: withTag ? { tag } : {},
  }) as unknown as Job<{
    tag?: typeof tag;
  }>;

describe('EmailDeliveryProcessor', () => {
  it('dado um job da fila, quando processa, então envia o e-mail pelo SMTP', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const sender: EmailSender = { send };
    const message = { to: 'ana@kore.local', subject: 'Assunto', text: 'Corpo' };

    await new LoginEmailProcessor(sender, new EmailDeliveryFailures()).process({
      data: { message },
    } as Job<{ message: typeof message }>);

    expect(send).toHaveBeenCalledWith({ message });
  });

  it('decisão 180(8) - na desistência final de um e-mail etiquetado, avisa quem etiquetou', async () => {
    const onGaveUp = jest.fn().mockResolvedValue(undefined);

    await processorWith({ onGaveUp }).onFailed(failedJob(5), new Error('smtp'));

    expect(onGaveUp).toHaveBeenCalledWith({ tag });
  });

  it('decisão 180(8) - falha com tentativas sobrando, ou sem etiqueta, não avisa', async () => {
    const onGaveUp = jest.fn().mockResolvedValue(undefined);
    const processor = processorWith({ onGaveUp });

    await processor.onFailed(failedJob(2), new Error('smtp'));
    await processor.onFailed(failedJob(5, false), new Error('smtp'));

    expect(onGaveUp).not.toHaveBeenCalled();
  });
});
