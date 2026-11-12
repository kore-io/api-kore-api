import { randomBytes } from 'node:crypto';
import { AppEnv, LOCAL_KEY_ENVS } from '../../config/env.schema';
import { aesGcmDecrypt, aesGcmEncrypt } from './aes-gcm';
import { DataKey, KeyManagement } from '../application/key-management.port';

const DATA_KEY_BYTES = 32;

/**
 * Adaptador local do KMS: a chave mestra vem de variável de ambiente. Só vale
 * em local e test (decisão 97, item 4); em homologação e produção a chave
 * mestra fica no AWS KMS e nunca em variável.
 */
export class LocalKeyManagement implements KeyManagement {
  private readonly masterKey: Buffer;

  constructor({ appEnv, masterKeyBase64 }: { appEnv: AppEnv; masterKeyBase64: string }) {
    // Segunda barreira, além da validação do env: nunca sobe fora de local/test.
    if (!LOCAL_KEY_ENVS.includes(appEnv)) {
      throw new Error(`KMS local recusado com APP_ENV ${appEnv}.`);
    }
    this.masterKey = Buffer.from(masterKeyBase64, 'base64');
    if (this.masterKey.length !== 32) {
      throw new Error('KMS local: a chave mestra precisa ter 32 bytes.');
    }
  }

  generateDataKey(): Promise<DataKey> {
    const plaintext = randomBytes(DATA_KEY_BYTES);
    const encrypted = aesGcmEncrypt({ key: this.masterKey, plaintext });
    return Promise.resolve({ plaintext, encrypted });
  }

  decryptDataKey({ encrypted }: { encrypted: Buffer }): Promise<Buffer> {
    return Promise.resolve(aesGcmDecrypt({ key: this.masterKey, payload: encrypted }));
  }
}
