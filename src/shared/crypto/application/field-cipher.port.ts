/**
 * Onde o valor cifrado mora. Entra como dado autenticado (AAD) do AES-GCM:
 * um valor copiado para outra coluna, tabela ou casamento não decifra.
 */
export interface FieldCipherContext {
  table: string;
  column: string;
  /** Casamento dono do dado, quando o dado pertence a um casamento. */
  weddingId?: string;
}

/**
 * Porta para cifrar um campo sensível em repouso (chave Pix, CPF-CNPJ). Os
 * casos de uso dependem só dela, sem saber do KMS nem do algoritmo.
 */
export interface FieldCipher {
  encrypt({
    plaintext,
    context,
  }: {
    plaintext: string;
    context: FieldCipherContext;
  }): Promise<string>;
  decrypt({
    ciphertext,
    context,
  }: {
    ciphertext: string;
    context: FieldCipherContext;
  }): Promise<string>;
}

export const FIELD_CIPHER = Symbol('FieldCipher');
