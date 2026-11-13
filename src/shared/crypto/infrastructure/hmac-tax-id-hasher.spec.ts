import { randomBytes } from 'node:crypto';
import { HmacTaxIdHasher, normalizeTaxId } from './hmac-tax-id-hasher';

describe('HmacTaxIdHasher (Publicar e pagar RN02; revisão técnica B2-12)', () => {
  const hasher = new HmacTaxIdHasher(randomBytes(32));

  it('RN02 - normaliza: com ou sem máscara, o mesmo CPF dá o mesmo hash', () => {
    expect(hasher.digest({ taxId: '529.982.247-25' })).toEqual(
      hasher.digest({ taxId: '52998224725' }),
    );
  });

  it('RN02 - guarda só o hash, a versão e os 4 últimos dígitos; nunca o número', () => {
    const digest = hasher.digest({ taxId: '529.982.247-25' });
    expect(digest.last4).toBe('4725');
    expect(digest.version).toBe(1);
    expect(digest.hash).not.toContain('52998224725');
  });

  it('Repasse RN02 - o CNPJ alfanumérico entra em maiúsculas', () => {
    expect(normalizeTaxId({ taxId: '12.abc.345/01de-35' })).toBe('12ABC34501DE35');
    expect(hasher.digest({ taxId: '12.abc.345/01de-35' })).toEqual(
      hasher.digest({ taxId: '12ABC34501DE35' }),
    );
  });

  it('B2-12 - outra chave dá outro hash', () => {
    const other = new HmacTaxIdHasher(randomBytes(32));
    expect(other.digest({ taxId: '52998224725' }).hash).not.toBe(
      hasher.digest({ taxId: '52998224725' }).hash,
    );
  });

  it('recusa uma chave que não tem 32 bytes', () => {
    expect(() => new HmacTaxIdHasher(randomBytes(16))).toThrow(/32 bytes/);
  });
});
