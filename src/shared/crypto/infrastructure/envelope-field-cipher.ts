import { Inject, Injectable } from '@nestjs/common';
import { FieldCipher, FieldCipherContext } from '../application/field-cipher.port';
import { KEY_MANAGEMENT, type KeyManagement } from '../application/key-management.port';
import { aesGcmDecrypt, aesGcmEncrypt } from './aes-gcm';
import { DataKeyCache } from './data-key-cache';

const FORMAT_VERSION = 'v1';
const DATA_KEY_CACHE_TTL_MS = 5 * 60 * 1000;
const DATA_KEY_CACHE_MAX_ENTRIES = 1_000;

/**
 * Criptografia de envelope (ADR da chave Pix e do CPF-CNPJ): cada valor é
 * cifrado com uma chave de dados nova; a chave de dados vai junto, cifrada pela
 * chave mestra. Formato: v1.<chave de dados cifrada>.<iv|tag|texto cifrado>,
 * em base64url. O contexto (tabela, coluna, casamento) é o AAD do GCM.
 */
@Injectable()
export class EnvelopeFieldCipher implements FieldCipher {
  private readonly dataKeys = new DataKeyCache({
    ttlMs: DATA_KEY_CACHE_TTL_MS,
    maxEntries: DATA_KEY_CACHE_MAX_ENTRIES,
  });

  constructor(@Inject(KEY_MANAGEMENT) private readonly kms: KeyManagement) {}

  async encrypt({
    plaintext,
    context,
  }: {
    plaintext: string;
    context: FieldCipherContext;
  }): Promise<string> {
    const dataKey = await this.kms.generateDataKey();
    const payload = aesGcmEncrypt({
      key: dataKey.plaintext,
      plaintext: Buffer.from(plaintext),
      aad: toAad({ context }),
    });
    dataKey.plaintext.fill(0);
    return [
      FORMAT_VERSION,
      dataKey.encrypted.toString('base64url'),
      payload.toString('base64url'),
    ].join('.');
  }

  async decrypt({
    ciphertext,
    context,
  }: {
    ciphertext: string;
    context: FieldCipherContext;
  }): Promise<string> {
    const [version, encryptedKey, payload, ...rest] = ciphertext.split('.');
    if (version !== FORMAT_VERSION || !encryptedKey || !payload || rest.length > 0) {
      throw new Error('Envelope em formato desconhecido.');
    }
    const key = await this.dataKey({ encryptedKey });
    try {
      return aesGcmDecrypt({
        key,
        payload: Buffer.from(payload, 'base64url'),
        aad: toAad({ context }),
      }).toString();
    } finally {
      // A chave aberta deste decrypt é uma cópia: zera ao terminar.
      key.fill(0);
    }
  }

  private async dataKey({ encryptedKey }: { encryptedKey: string }): Promise<Buffer> {
    const cached = this.dataKeys.get({ id: encryptedKey });
    if (cached) return cached;

    const key = await this.kms.decryptDataKey({
      encrypted: Buffer.from(encryptedKey, 'base64url'),
    });
    this.dataKeys.set({ id: encryptedKey, key });
    return key;
  }
}

// Serialização sem ambiguidade (lista JSON), com prefixo de versão do formato.
function toAad({ context }: { context: FieldCipherContext }): Buffer {
  return Buffer.from(
    JSON.stringify([
      'kore',
      FORMAT_VERSION,
      context.table,
      context.column,
      context.weddingId ?? null,
    ]),
  );
}
