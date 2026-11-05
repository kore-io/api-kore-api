import type { Queue } from 'bullmq';
import type { EmailSender } from '../application/email-sender.port';
import { BullmqEmailOutbox } from './bullmq-email-outbox';
import { EMAIL_JOB_OPTIONS } from './email-queues';

const message = { to: 'ana@kore.local', subject: 'Assunto', text: 'Corpo' };

function build({ add }: { add: jest.Mock }) {
  const loginQueue = { add } as unknown as Queue;
  const defaultAdd = jest.fn().mockResolvedValue({});
  const defaultQueue = { add: defaultAdd } as unknown as Queue;
  const send = jest.fn().mockResolvedValue(undefined);
  const sender: EmailSender = { send };
  return { outbox: new BullmqEmailOutbox(loginQueue, defaultQueue, sender), send, defaultAdd };
}

describe('BullmqEmailOutbox', () => {
  it('dado um e-mail de login, quando enfileira, então vai para a fila prioritária e sai do Redis depois de enviado', async () => {
    const add = jest.fn().mockResolvedValue({});
    const { outbox, send, defaultAdd } = build({ add });

    await outbox.enqueue({ message, priority: 'login' });

    expect(add).toHaveBeenCalledWith('deliver', { message }, EMAIL_JOB_OPTIONS);
    expect(EMAIL_JOB_OPTIONS).toMatchObject({ removeOnComplete: true, removeOnFail: true });
    expect(defaultAdd).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('dado o Redis fora do ar, quando enfileira, então envia direto pelo SMTP', async () => {
    const add = jest.fn().mockRejectedValue(new Error('Connection is closed.'));
    const { outbox, send } = build({ add });

    await outbox.enqueue({ message, priority: 'login' });

    expect(send).toHaveBeenCalledWith({ message });
  });
});
