import type { Queue } from 'bullmq';
import { BullmqRefundQueue } from './refunds.queue';

describe('BullmqRefundQueue (Pagamentos e arrependimento RN04 e RN05)', () => {
  function build(existing: { failed: boolean } | null) {
    const job = existing && {
      isFailed: jest.fn().mockResolvedValue(existing.failed),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const queue = {
      getJob: jest.fn().mockResolvedValue(job),
      add: jest.fn().mockResolvedValue(undefined),
    };
    return { refunds: new BullmqRefundQueue(queue as unknown as Queue), queue, job };
  }

  it('RN05 (decisão 275) - o job falho da contagem anterior sai antes, e a mesma tentativa entra de novo com o mesmo id', async () => {
    const { refunds, queue, job } = build({ failed: true });
    await refunds.enqueue({ paymentId: 'p1', attempt: 2, delayMs: 3_600_000 });
    expect(queue.getJob).toHaveBeenCalledWith('refund-p1-2');
    expect(job!.remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(
      'refund',
      { paymentId: 'p1', attempt: 2 },
      expect.objectContaining({ jobId: 'refund-p1-2', delay: 3_600_000 }),
    );
  });

  it('RN04 - o job que espera ou roda continua barrando o repetido (não é removido)', async () => {
    const { refunds, job } = build({ failed: false });
    await refunds.enqueue({ paymentId: 'p1', attempt: 1, delayMs: 0 });
    expect(job!.remove).not.toHaveBeenCalled();
  });

  it('RN04 e RN05 - o Tentar o estorno de novo e a reconciliação põem a tentativa 1 com o mesmo id', async () => {
    const { refunds, queue } = build(null);
    await refunds.enqueue({ paymentId: 'p1', attempt: 1, delayMs: 0 });
    expect(queue.add).toHaveBeenCalledWith(
      'refund',
      expect.anything(),
      expect.objectContaining({ jobId: 'refund-p1-1' }),
    );
  });
});
