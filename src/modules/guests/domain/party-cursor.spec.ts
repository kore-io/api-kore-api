import { decodePartyCursor, encodePartyCursor } from './party-cursor';

describe('Cursor da lista (Grupos RN13)', () => {
  it('RN13 - guarda o nome normalizado e o id do último grupo', () => {
    const cursor = encodePartyCursor({
      name: 'familia silva',
      id: '0190f0d2-1b2c-7d3e-8f40-123456789abc',
    });

    expect(decodePartyCursor({ cursor })).toEqual({
      name: 'familia silva',
      id: '0190f0d2-1b2c-7d3e-8f40-123456789abc',
    });
  });

  it.each(['nao-e-cursor', '', encodePartyCursor({ name: 'x', id: 'nao-e-uuid' })])(
    'RN13 - o cursor "%s" é recusado',
    (cursor) => {
      expect(decodePartyCursor({ cursor })).toBeNull();
    },
  );
});
