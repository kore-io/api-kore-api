import { isValidCpf } from './tax-id';

describe('isValidCpf (Publicar e pagar RN02)', () => {
  it.each(['529.982.247-25', '52998224725', '111.444.777-35'])('RN02 - %s é válido', (value) => {
    expect(isValidCpf({ value })).toBe(true);
  });

  it.each([
    ['111.111.111-11', 'dígitos repetidos (cenário "CPF inválido")'],
    ['529.982.247-24', 'verificador errado'],
    ['5299822472', '10 dígitos'],
    ['529982247250', '12 dígitos'],
    ['52998224725a', 'letra'],
    ['', 'vazio'],
  ])('RN02 - %s é inválido (%s)', (value) => {
    expect(isValidCpf({ value })).toBe(false);
  });
});
