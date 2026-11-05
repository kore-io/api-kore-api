import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { FIELD_CIPHER } from './application/field-cipher.port';
import { KEY_MANAGEMENT, KeyManagement } from './application/key-management.port';
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
  ],
  exports: [FIELD_CIPHER],
})
export class CryptoModule {}
