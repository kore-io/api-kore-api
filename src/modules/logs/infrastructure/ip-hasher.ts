import { createHmac } from 'node:crypto';
import { isIPv6 } from 'node:net';

/**
 * Hash do IP para o log da aplicação: permite limitar abuso (mesmo IP, mesmo
 * hash) sem guardar o IP. HMAC com chave secreta, porque um SHA-256 simples de
 * um IPv4 se reverte por força bruta em minutos.
 */
export class IpHasher {
  private readonly key: Buffer;

  constructor({ keyBase64 }: { keyBase64: string }) {
    this.key = Buffer.from(keyBase64, 'base64');
  }

  hash({ ip }: { ip: string }): string {
    return createHmac('sha256', this.key).update(normalizeIp({ ip })).digest('base64url');
  }
}

/**
 * Forma canônica do IP, para o mesmo endereço sempre dar o mesmo hash: IPv4
 * mapeado em IPv6 (::ffff:1.2.3.4) vira IPv4, e o IPv6 fica comprimido e em
 * minúsculas.
 */
export function normalizeIp({ ip }: { ip: string }): string {
  const trimmed = ip.trim();
  if (!isIPv6(trimmed)) return trimmed;
  const canonical = new URL(`http://[${trimmed}]`).hostname.slice(1, -1);
  const mappedIpv4 = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (!mappedIpv4) return canonical;
  const high = parseInt(mappedIpv4[1], 16);
  const low = parseInt(mappedIpv4[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}
