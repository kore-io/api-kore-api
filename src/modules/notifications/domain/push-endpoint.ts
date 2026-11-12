import { isIP } from 'node:net';

/** Os serviços de push aceitos (E-mail e push RN07; decisão 217(c), contra SSRF). */
const EXACT_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com'];
const HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com'];

/**
 * O endpoint só é aceito em `https:`, sem IP literal, sem porta fora da 443 e
 * com o host numa lista fechada dos serviços de push. Vale no DTO e de novo no
 * worker, antes de cada envio.
 */
export function isAllowedPushEndpoint({ endpoint }: { endpoint: string }): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (url.port !== '' && url.port !== '443') return false;
  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, '')) !== 0) return false;
  return (
    EXACT_HOSTS.includes(host) ||
    HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length)
  );
}
