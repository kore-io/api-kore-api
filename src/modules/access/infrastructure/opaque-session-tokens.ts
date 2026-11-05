import { createHash, randomBytes } from 'node:crypto';
import type { SessionTokens } from '../application/ports/session-token.port';

const TOKEN_BYTES = 32;

/**
 * Token aleatório de 256 bits. Como ele não é adivinhável, um SHA-256 simples
 * basta para o hash no banco (não é senha: não precisa de sal nem de KDF).
 */
export class OpaqueSessionTokens implements SessionTokens {
  generate(): { token: string; tokenHash: string } {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    return { token, tokenHash: this.hash({ token }) };
  }

  hash({ token }: { token: string }): string {
    return createHash('sha256').update(token).digest('base64url');
  }
}
