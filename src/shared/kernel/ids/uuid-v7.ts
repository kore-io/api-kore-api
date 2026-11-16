import { randomBytes } from 'node:crypto';

/**
 * UUID v7 (RFC 9562) gerado na aplicação, para quando o id precisa existir
 * antes do INSERT (ex.: a RLS barra o RETURNING de uma linha que a pessoa
 * ainda não pode ler).
 */
export function uuidV7({ now = Date.now() }: { now?: number } = {}): string {
  const bytes = randomBytes(16);
  const timestamp = BigInt(now);
  for (let i = 0; i < 6; i++) bytes[i] = Number((timestamp >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
