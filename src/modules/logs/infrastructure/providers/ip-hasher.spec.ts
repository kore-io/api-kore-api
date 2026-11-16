import { randomBytes } from 'node:crypto';
import { IpHasher, normalizeIp } from './ip-hasher';

describe('normalizeIp', () => {
  it.each([
    ['200.1.2.3', '200.1.2.3'],
    ['::ffff:200.1.2.3', '200.1.2.3'],
    ['::FFFF:C801:0203', '200.1.2.3'],
    ['2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['2001:db8::1', '2001:db8::1'],
  ])('dado %s, quando normaliza, então vira %s', (ip, expected) => {
    expect(normalizeIp({ ip })).toBe(expected);
  });
});

describe('IpHasher', () => {
  const hasher = new IpHasher({ keyBase64: randomBytes(32).toString('base64') });

  it('dadas formas diferentes do mesmo IP, quando calcula o hash, então o hash é igual', () => {
    expect(hasher.hash({ ip: '::ffff:200.1.2.3' })).toBe(hasher.hash({ ip: '200.1.2.3' }));
  });

  it('dados IPs diferentes, quando calcula o hash, então os hashes diferem e não contêm o IP', () => {
    const hash = hasher.hash({ ip: '200.1.2.3' });
    expect(hash).not.toBe(hasher.hash({ ip: '200.1.2.4' }));
    expect(hash).not.toContain('200.1.2.3');
  });
});
