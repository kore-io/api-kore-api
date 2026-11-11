import { coupleNames } from './public-site';

describe('coupleNames (Site público RN05; decisão 182)', () => {
  it('RN05 - os primeiros nomes', () => {
    expect(coupleNames({ partners: ['Ana Beatriz Moreira', ' Marcos  Rocha '] })).toBe(
      'Ana & Marcos',
    );
  });

  it('RN05 - primeiros nomes iguais: os nomes completos', () => {
    expect(coupleNames({ partners: ['Ana Moreira', 'ana Rocha'] })).toBe('Ana Moreira & ana Rocha');
  });
});
