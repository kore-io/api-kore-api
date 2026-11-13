/** O CPF ou CNPJ já protegido: o HMAC, a versão da chave e os 4 últimos caracteres. */
export interface TaxIdDigest {
  hash: string;
  version: number;
  last4: string;
}

/**
 * Porta do HMAC do CPF e do CNPJ (Publicar e pagar RN02; Repasse RN02;
 * revisão técnica B2-12). O mesmo número dá o mesmo hash em qualquer lugar do
 * Kore (autoindicação, recuperação de acesso), e o número inteiro nunca vai ao
 * banco. A entrada é normalizada aqui: só dígitos, e o CNPJ alfanumérico em
 * maiúsculas.
 */
export interface TaxIdHasher {
  digest({ taxId }: { taxId: string }): TaxIdDigest;
}

export const TAX_ID_HASHER = Symbol('TaxIdHasher');
