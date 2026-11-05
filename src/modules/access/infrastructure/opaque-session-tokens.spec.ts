import { OpaqueSessionTokens } from './opaque-session-tokens';

describe('OpaqueSessionTokens', () => {
  const tokens = new OpaqueSessionTokens();

  it('dado um token gerado, quando calcula o hash, então bate com o hash gerado e não contém o token', () => {
    const { token, tokenHash } = tokens.generate();

    expect(tokens.hash({ token })).toBe(tokenHash);
    expect(tokenHash).not.toContain(token);
  });

  it('dados dois tokens gerados, quando compara, então são diferentes', () => {
    expect(tokens.generate().token).not.toBe(tokens.generate().token);
  });
});
