import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { AppConfigService } from '../../../shared/config/app-config.service';
import type { SearchTermHasher } from '../application/admin-insights.use-cases';

/**
 * O termo da busca do staff em hash (RN03; B9-4): HMAC com a chave do hash do
 * IP e um prefixo próprio, para o mesmo termo dar o mesmo hash sem ficar em claro.
 */
@Injectable()
export class HmacSearchTermHasher implements SearchTermHasher {
  private readonly key: Buffer;

  constructor(config: AppConfigService) {
    this.key = Buffer.from(config.get({ key: 'IP_HASH_KEY' }), 'base64');
  }

  hash({ term }: { term: string }): string {
    return createHmac('sha256', this.key).update(`admin.search:${term}`).digest('base64url');
  }
}
