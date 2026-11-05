import { isIPv6 } from 'node:net';

/**
 * Quem o rate limit conta. IPv4 conta por endereço. IPv6 conta pela rede /64:
 * um cliente costuma ter a /64 inteira e trocaria de endereço para fugir do
 * limite. IPv4 mapeado em IPv6 (::ffff:1.2.3.4) conta como o IPv4.
 */
export function rateLimitTracker({ ip }: { ip: string }): string {
  if (!ip) return 'unknown';
  if (!isIPv6(ip)) return ip;
  const canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (mapped) {
    const high = parseInt(mapped[1], 16);
    const low = parseInt(mapped[2], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  return `${expandIpv6({ ip: canonical }).slice(0, 4).join(':')}::/64`;
}

function expandIpv6({ ip }: { ip: string }): string[] {
  const [head, tail = ''] = ip.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  return [...headGroups, ...Array<string>(missing).fill('0'), ...tailGroups];
}
