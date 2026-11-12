import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { LoginChallengeSecrets } from '../application/ports/login-challenge-secrets.port';

const TOKEN_BYTES = 32;

/**
 * Token do botão: 256 bits aleatórios, guardado com SHA-256. Código de 6
 * números: pouca entropia, então o hash é HMAC com chave própria
 * (LOGIN_CODE_KEY, decisão 139); um vazamento do banco não revela os códigos.
 */
export class HmacLoginChallengeSecrets implements LoginChallengeSecrets {
  private readonly codeKey: Buffer;

  constructor({ codeKeyBase64 }: { codeKeyBase64: string }) {
    this.codeKey = Buffer.from(codeKeyBase64, 'base64');
  }

  issue(): { token: string; tokenHash: string; code: string; codeHash: string } {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    return { token, tokenHash: this.hashToken({ token }), code, codeHash: this.hashCode({ code }) };
  }

  hashToken({ token }: { token: string }): string {
    return createHash('sha256').update(token).digest('base64url');
  }

  matchesCode({ code, codeHash }: { code: string; codeHash: string }): boolean {
    const actual = Buffer.from(this.hashCode({ code }));
    const expected = Buffer.from(codeHash);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private hashCode({ code }: { code: string }): string {
    return createHmac('sha256', this.codeKey).update(code).digest('base64url');
  }
}
