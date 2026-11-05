export interface DataKey {
  /** Chave de dados aberta: fica só em memória. */
  plaintext: Buffer;
  /** A mesma chave cifrada pela chave mestra: é o que vai para o banco. */
  encrypted: Buffer;
}

/**
 * Porta do serviço de chaves (criptografia de envelope). A chave mestra nunca
 * sai do serviço: ele só gera chaves de dados e as decifra.
 */
export interface KeyManagement {
  generateDataKey(): Promise<DataKey>;
  decryptDataKey({ encrypted }: { encrypted: Buffer }): Promise<Buffer>;
}

export const KEY_MANAGEMENT = Symbol('KeyManagement');
