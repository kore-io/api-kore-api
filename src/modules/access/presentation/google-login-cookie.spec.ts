import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import type { GoogleLoginAttempt } from '../application/start-google-login.use-case';
import { GoogleLoginCookie } from './google-login-cookie';

const now = new Date('2026-11-06T12:00:00.000Z');
const attempt: GoogleLoginAttempt = {
  state: 'st',
  codeVerifier: 'cv',
  origin: 'none',
  returnPath: '/app',
};

function issued({ cookie }: { cookie: GoogleLoginCookie }): string {
  let value = '';
  const response = { cookie: (_: string, v: string) => (value = v) } as unknown as Response;
  cookie.set({ response, attempt, now });
  return value;
}

describe('GoogleLoginCookie (decisão 147)', () => {
  const cookie = new GoogleLoginCookie({ keyBase64: randomBytes(32).toString('base64') });

  it('dado o cookie da ida, quando volta com o mesmo state em até 10 minutos, então devolve o pedido', () => {
    const value = issued({ cookie });

    expect(cookie.read({ value, state: 'st', now: new Date(now.getTime() + 9 * 60_000) })).toEqual(
      attempt,
    );
  });

  it.each([
    ['outro state', (v: string) => v, 'outro', 0],
    ['mais de 10 minutos', (v: string) => v, 'st', 11 * 60_000],
    ['assinatura adulterada', (v: string) => `${v}x`, 'st', 0],
    ['conteúdo adulterado', (v: string) => `A${v}`, 'st', 0],
  ])('dado %s, quando volta, então recusa', (_, tamper, state, elapsed) => {
    const value = tamper(issued({ cookie }));

    expect(cookie.read({ value, state, now: new Date(now.getTime() + elapsed) })).toBeNull();
  });

  it('dado um cookie assinado com outra chave, quando volta, então recusa', () => {
    const other = new GoogleLoginCookie({ keyBase64: randomBytes(32).toString('base64') });

    expect(cookie.read({ value: issued({ cookie: other }), state: 'st', now })).toBeNull();
  });
});
