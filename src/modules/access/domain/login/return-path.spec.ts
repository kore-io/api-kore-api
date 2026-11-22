import { safeReturnPath } from './return-path';

describe('RN10 e decisão 136 (7) - página de volta depois do login', () => {
  it.each(['/app/convidados', '/app/convidados?grupo=12#topo', '/'])(
    'dado o caminho relativo %s, quando confere, então vale',
    (next) => {
      expect(safeReturnPath({ next })).toBe(next);
    },
  );

  it.each([
    undefined,
    '',
    'app/convidados',
    '//evil.example/x',
    '/\\evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '/\u0000x',
    `/${'a'.repeat(600)}`,
  ])('dado %p, quando confere, então é ignorado (sem erro)', (next) => {
    expect(safeReturnPath({ next })).toBeNull();
  });
});
