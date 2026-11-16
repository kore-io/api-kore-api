import {
  decodePartyCursor,
  decodeRespondedCursor,
  encodePartyCursor,
  encodeRespondedCursor,
} from './party-cursor';

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

describe('Cursor por "Respondido em" (Central RN05; decisão 246)', () => {
  const id = '0190f0d2-1b2c-7d3e-8f40-123456789abc';

  it('decisão 246 - guarda o instante (ou nulo) e o id; não vale na ordem alfabética', () => {
    const at = new Date('2026-09-26T21:14:00Z');
    expect(
      decodeRespondedCursor({ cursor: encodeRespondedCursor({ respondedAt: at, id }) }),
    ).toEqual({ respondedAt: at, id });
    const empty = encodeRespondedCursor({ respondedAt: null, id });
    expect(decodeRespondedCursor({ cursor: empty })).toEqual({ respondedAt: null, id });
    expect(decodePartyCursor({ cursor: empty })).toBeNull();
    expect(decodeRespondedCursor({ cursor: encodePartyCursor({ name: 'x', id }) })).toBeNull();
  });
});
