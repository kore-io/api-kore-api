import type { Provider } from '@nestjs/common';
import { AppConfigService } from '../../../shared/config/app-config.service';
import { IpHasher } from './ip-hasher';

export const ipHasherProvider: Provider = {
  provide: IpHasher,
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) =>
    new IpHasher({ keyBase64: config.get({ key: 'IP_HASH_KEY' }) }),
};
