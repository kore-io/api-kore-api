import { maskEmail } from './email';

describe('maskEmail (decisão 202(3))', () => {
  it.each([
    ['celia.moreira@gmail.com', 'ce***@gmail.com'],
    ['bia@exemplo.kore.local', 'bi***@exemplo.kore.local'],
    ['ab@x.com', 'a***@x.com'],
    ['a@x.com', 'a***@x.com'],
  ])('%s vira %s', (email, masked) => {
    expect(maskEmail({ email })).toBe(masked);
  });
});
