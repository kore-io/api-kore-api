import { createHmac } from 'node:crypto';

/**
 * weddingRef dos eventos de produto: HMAC-SHA256 do weddingId com chave
 * própria (decisão 135). Permite contar por casamento sem identificar qual.
 */
export class WeddingPseudonymizer {
  private readonly key: Buffer;

  constructor({ keyBase64 }: { keyBase64: string }) {
    this.key = Buffer.from(keyBase64, 'base64');
  }

  weddingRef({ weddingId }: { weddingId: string }): string {
    return createHmac('sha256', this.key).update(weddingId.toLowerCase()).digest('base64url');
  }
}
