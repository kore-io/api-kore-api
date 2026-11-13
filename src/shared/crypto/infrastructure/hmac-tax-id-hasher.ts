import { createHmac } from 'node:crypto';
import type { TaxIdDigest, TaxIdHasher } from '../application/tax-id-hasher.port';
import type { PixKeyHasher } from '../application/pix-key-hasher.port';

/** Prefixo de domínio (B2-12): o mesmo HMAC nunca serve a outro tipo de dado. */
const DOMAIN_PREFIX = 'taxid:v1:';
/** A versão da chave, gravada ao lado do hash, para a rotação. */
export const TAX_ID_HASH_VERSION = 1;

/** Só dígitos; no CNPJ alfanumérico (2026), letras e dígitos em maiúsculas. */
export function normalizeTaxId({ taxId }: { taxId: string }): string {
  return taxId.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/**
 * HMAC-SHA256 com a chave de dados decifrada pelo KMS na subida (nunca a
 * chave mestra). A chave fica só em memória.
 */
export class HmacTaxIdHasher implements TaxIdHasher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('TaxIdHasher: a chave precisa ter 32 bytes.');
  }

  digest({ taxId }: { taxId: string }): TaxIdDigest {
    const normalized = normalizeTaxId({ taxId });
    if (normalized.length < 4) throw new Error('TaxIdHasher: número curto demais.');
    const hash = createHmac('sha256', this.key)
      .update(`${DOMAIN_PREFIX}${normalized}`)
      .digest('base64url');
    return { hash, version: TAX_ID_HASH_VERSION, last4: normalized.slice(-4) };
  }
}

/** O HMAC da chave Pix (Repasse RN03), com o prefixo de domínio próprio. */
export class HmacPixKeyHasher implements PixKeyHasher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('PixKeyHasher: a chave precisa ter 32 bytes.');
  }

  digest({ type, key }: { type: string; key: string }): string {
    return createHmac('sha256', this.key).update(`pixkey:v1:${type}:${key}`).digest('base64url');
  }
}
