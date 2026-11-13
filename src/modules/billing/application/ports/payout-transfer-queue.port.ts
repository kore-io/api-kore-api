/**
 * O job do Pix de saída (Repasse RN05; G1 e B7-2): entra depois do commit do
 * requested → processing, com jobId fixo por repasse.
 */
export interface PayoutTransferQueue {
  enqueue(input: { payoutId: string }): Promise<void>;
}

export const PAYOUT_TRANSFER_QUEUE = Symbol('PayoutTransferQueue');
