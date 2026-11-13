/**
 * Porta do HMAC da chave Pix do indicador (`ReferrerPixKey.keyHash`; Repasse
 * RN03): a mesma chave de dados do `TaxIdHasher`, com outro prefixo de
 * domínio, para um HMAC nunca servir a outro tipo de dado (B2-12). A entrada
 * já vem no formato do DICT (normalizada pelo domínio).
 */
export interface PixKeyHasher {
  digest({ type, key }: { type: string; key: string }): string;
}

export const PIX_KEY_HASHER = Symbol('PixKeyHasher');
