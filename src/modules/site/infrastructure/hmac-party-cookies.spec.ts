import type { AppConfigService } from '../../../shared/config/app-config.service';
import { HmacPartyCookies } from './hmac-party-cookies';

const config = (key: string) => ({ get: () => key }) as unknown as AppConfigService;
const KEY = 'Qk7j0cX6vJ2m3nL9pR5tW8yZ1aB4dE7gH0kM3nP6qS8=';
const OTHER_KEY = 'gGXUHiAkgObPVjMgOTTQoB8bQ2x3bAQZFsTsRZ2mT0E=';
const weddingId = '0195b2e4-0000-7000-8000-000000000001';
const claims = { partyId: '0195b2e4-0000-7000-8000-000000000002', linkVersion: 3 };

describe('HmacPartyCookies (Site público RN06 e RN08; ADR-36)', () => {
  const cookies = new HmacPartyCookies(config(KEY));

  it('RN06 - o nome é por casamento, e o valor assinado volta com o grupo e a versão', () => {
    expect(cookies.name({ weddingId })).toBe(`kore_party_${weddingId}`);
    const value = cookies.sign({ weddingId, claims });
    expect(cookies.verify({ weddingId, value })).toEqual(claims);
  });

  it('RN06 - outro casamento, outra chave, assinatura mexida ou lixo: nulo', () => {
    const value = cookies.sign({ weddingId, claims });
    const [payload, signature] = value.split('.');
    expect(cookies.verify({ weddingId: '0195b2e4-0000-7000-8000-000000000009', value })).toBeNull();
    expect(new HmacPartyCookies(config(OTHER_KEY)).verify({ weddingId, value })).toBeNull();
    expect(cookies.verify({ weddingId, value: `${payload}.${signature.slice(1)}x` })).toBeNull();
    const forged = Buffer.from(JSON.stringify({ w: weddingId, p: claims.partyId, v: 9 })).toString(
      'base64url',
    );
    expect(cookies.verify({ weddingId, value: `${forged}.${signature}` })).toBeNull();
    expect(cookies.verify({ weddingId, value: 'lixo' })).toBeNull();
  });
});
