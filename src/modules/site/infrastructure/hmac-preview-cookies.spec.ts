import { createHmac } from 'node:crypto';
import type { AppConfigService } from '../../../shared/config/app-config.service';
import { HmacPreviewCookies } from './hmac-preview-cookies';

const config = (key: string) => ({ get: () => key }) as unknown as AppConfigService;
const KEY = 'Qk7j0cX6vJ2m3nL9pR5tW8yZ1aB4dE7gH0kM3nP6qS8=';
const OTHER_KEY = 'gGXUHiAkgObPVjMgOTTQoB8bQ2x3bAQZFsTsRZ2mT0E=';
const weddingId = '0195b2e4-0000-7000-8000-000000000001';
const userId = '0195b2e4-0000-7000-8000-000000000003';
const partyId = '0195b2e4-0000-7000-8000-000000000002';
const expiresAt = new Date('2026-11-14T20:30:00Z');

describe('HmacPreviewCookies (Pré-visualização do site RN03)', () => {
  const cookies = new HmacPreviewCookies(config(KEY));
  const forge = (payload: Record<string, unknown>, signature: string) =>
    `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;

  it('RN03 - o nome é por casamento; o valor assinado volta com a pessoa, o modo, o grupo e o vencimento', () => {
    expect(cookies.name({ weddingId })).toBe(`kore_site_preview_${weddingId}`);
    for (const claims of [
      { userId, mode: 'visitor' as const, partyId: null, expiresAt },
      { userId, mode: 'party' as const, partyId, expiresAt },
    ])
      expect(cookies.verify({ weddingId, value: cookies.sign({ weddingId, claims }) })).toEqual(
        claims,
      );
  });

  it('RN03 - outro casamento, outra chave, assinatura mexida, payload forjado ou lixo: nulo', () => {
    const value = cookies.sign({
      weddingId,
      claims: { userId, mode: 'visitor', partyId: null, expiresAt },
    });
    const [payload, signature] = value.split('.');

    expect(cookies.verify({ weddingId: '0195b2e4-0000-7000-8000-000000000009', value })).toBeNull();
    expect(new HmacPreviewCookies(config(OTHER_KEY)).verify({ weddingId, value })).toBeNull();
    expect(cookies.verify({ weddingId, value: `${payload}.${signature.slice(1)}x` })).toBeNull();
    expect(cookies.verify({ weddingId, value: `${payload}.${signature}.extra` })).toBeNull();
    // A pessoa trocada no payload, com a assinatura do original.
    expect(
      cookies.verify({
        weddingId,
        value: forge(
          { w: weddingId, u: partyId, m: 'visitor', p: null, e: expiresAt.getTime() },
          signature,
        ),
      }),
    ).toBeNull();
    expect(cookies.verify({ weddingId, value: 'lixo' })).toBeNull();
  });

  it('RN03 - assinado, mas fora do formato: modo grupo sem o grupo, modo desconhecido, grupo no modo visitante, sem vencimento', () => {
    // Assinados com a chave certa, como faria quem tivesse a chave.
    const signed = (payload: Record<string, unknown>) => {
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const mac = createHmac('sha256', Buffer.from(KEY, 'base64'))
        .update(encoded)
        .digest('base64url');
      return `${encoded}.${mac}`;
    };
    const base = { w: weddingId, u: userId, e: expiresAt.getTime() };
    expect(
      cookies.verify({ weddingId, value: signed({ ...base, m: 'visitor', p: null }) }),
    ).toEqual({ userId, mode: 'visitor', partyId: null, expiresAt });

    expect(
      cookies.verify({ weddingId, value: signed({ ...base, m: 'party', p: null }) }),
    ).toBeNull();
    expect(
      cookies.verify({ weddingId, value: signed({ ...base, m: 'admin', p: null }) }),
    ).toBeNull();
    expect(
      cookies.verify({ weddingId, value: signed({ ...base, m: 'visitor', p: partyId }) }),
    ).toBeNull();
    expect(
      cookies.verify({
        weddingId,
        value: signed({ w: weddingId, u: userId, m: 'visitor', p: null }),
      }),
    ).toBeNull();
    expect(
      cookies.verify({ weddingId, value: signed({ ...base, u: 'ana', m: 'visitor', p: null }) }),
    ).toBeNull();
  });
});
