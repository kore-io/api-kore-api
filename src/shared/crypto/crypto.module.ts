import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { FIELD_CIPHER } from './application/field-cipher.port';
import { KEY_MANAGEMENT, KeyManagement } from './application/key-management.port';
import { TAX_ID_HASHER, type TaxIdHasher } from './application/tax-id-hasher.port';
import { HmacTaxIdHasher } from './infrastructure/hmac-tax-id-hasher';
import { EnvelopeFieldCipher } from './infrastructure/envelope-field-cipher';
import { LocalKeyManagement } from './infrastructure/local-key-management';

@Global()
@Module({
  providers: [
    {
      provide: KEY_MANAGEMENT,
      inject: [AppConfigService],
      // Só o adaptador local por enquanto; o AWS KMS entra com a infraestrutura.
      useFactory: (config: AppConfigService): KeyManagement =>
        new LocalKeyManagement({
          appEnv: config.get({ key: 'APP_ENV' }),
          masterKeyBase64: config.get({ key: 'KMS_LOCAL_MASTER_KEY' }) ?? '',
        }),
    },
    { provide: FIELD_CIPHER, useClass: EnvelopeFieldCipher },
    {
      // A chave do HMAC do CPF e do CNPJ chega cifrada pelo KMS e é decifrada
      // uma vez, na subida (Publicar e pagar RN02; B2-12).
      provide: TAX_ID_HASHER,
      inject: [AppConfigService, KEY_MANAGEMENT],
      useFactory: async (config: AppConfigService, kms: KeyManagement): Promise<TaxIdHasher> =>
        new HmacTaxIdHasher(
          await kms.decryptDataKey({
            encrypted: Buffer.from(config.get({ key: 'TAX_ID_HASH_KEY_ENCRYPTED' }), 'base64'),
          }),
        ),
    },
  ],
  exports: [FIELD_CIPHER, TAX_ID_HASHER],
})
export class CryptoModule {}
