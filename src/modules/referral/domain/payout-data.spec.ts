import { isValidCnpj, maskPixKey, maskTaxId, normalizePixKey, normalizeTaxId } from './payout-data';

describe('Dados para receber: CPF, CNPJ e chave Pix (Repasse RN02 e RN03; decisão 244)', () => {
  it('RN02 - CNPJ numérico e alfanumérico, com os dígitos verificadores', () => {
    expect(isValidCnpj({ value: '11.222.333/0001-81' })).toBe(true);
    expect(isValidCnpj({ value: '12.abc.345/01de-35' })).toBe(true);
    expect(isValidCnpj({ value: '11.222.333/0001-82' })).toBe(false);
    expect(isValidCnpj({ value: '00000000000000' })).toBe(false);
  });

  it('RN02 - normaliza e recusa o inválido', () => {
    expect(normalizeTaxId({ type: 'cpf', value: '529.982.247-25' })).toBe('52998224725');
    expect(normalizeTaxId({ type: 'cpf', value: '529.982.247-24' })).toBeNull();
    expect(normalizeTaxId({ type: 'cnpj', value: '12.abc.345/01de-35' })).toBe('12ABC34501DE35');
  });

  it('decisão 244(2) - as máscaras do CPF e do CNPJ', () => {
    expect(maskTaxId({ type: 'cpf', value: '52998224725' })).toBe('***.982.247-**');
    expect(maskTaxId({ type: 'cnpj', value: '11222333000181' })).toBe('**.222.333/0001-**');
  });

  it('decisão 244(2) - a chave Pix por tipo: o formato do DICT e a máscara', () => {
    const email = normalizePixKey({ type: 'email', value: ' Juliana@PradoAssessoria.com.br ' });
    expect(email).toBe('juliana@pradoassessoria.com.br');
    expect(maskPixKey({ type: 'email', value: email! })).toBe('jul***@pradoassessoria.com.br');

    const phone = normalizePixKey({ type: 'phone', value: '(19) 99876-3310' });
    expect(phone).toBe('+5519998763310');
    expect(maskPixKey({ type: 'phone', value: phone! })).toBe('(19) 9****-3310');

    const random = normalizePixKey({
      type: 'random',
      value: 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3BC3D4',
    });
    expect(maskPixKey({ type: 'random', value: random! })).toBe('a1b2…c3d4');
    expect(normalizePixKey({ type: 'random', value: 'nao-e-uuid' })).toBeNull();
    expect(normalizePixKey({ type: 'email', value: 'sem-arroba' })).toBeNull();
  });
});
