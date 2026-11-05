import { randomBytes } from 'node:crypto';
import { HmacLoginChallengeSecrets } from './hmac-login-challenge-secrets';

describe('HmacLoginChallengeSecrets', () => {
  const secrets = new HmacLoginChallengeSecrets({
    codeKeyBase64: randomBytes(32).toString('base64'),
  });

  it('RN01 - dado um pedido, quando gera os segredos, então o código tem 6 números e só os hashes vão para o banco', () => {
    const { token, tokenHash, code, codeHash } = secrets.issue();

    expect(code).toMatch(/^\d{6}$/);
    expect(tokenHash).not.toContain(token);
    expect(codeHash).not.toContain(code);
    expect(secrets.hashToken({ token })).toBe(tokenHash);
  });

  it('dado o código certo, quando confere, então bate; dado outro, então não', () => {
    const { code, codeHash } = secrets.issue();
    const other = code === '000000' ? '000001' : '000000';

    expect(secrets.matchesCode({ code, codeHash })).toBe(true);
    expect(secrets.matchesCode({ code: other, codeHash })).toBe(false);
  });

  it('dadas chaves diferentes, quando calcula o hash do mesmo código, então os hashes diferem (decisão 139)', () => {
    const { code, codeHash } = secrets.issue();
    const otherKey = new HmacLoginChallengeSecrets({
      codeKeyBase64: randomBytes(32).toString('base64'),
    });

    expect(otherKey.matchesCode({ code, codeHash })).toBe(false);
  });
});
