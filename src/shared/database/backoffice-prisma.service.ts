import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { AppConfigService } from '../config/app-config.service';

export const BACKOFFICE_DB_ROLE = 'kore_backoffice';

/**
 * Conexão do backoffice e das rotinas agendadas, que atravessam os casamentos
 * (ADR de multi-tenant, item 5). Cada conexão assume o papel kore_backoffice,
 * porque o BYPASSRLS não é herdado por participação no papel. Não usar em
 * rota de produto: ali vale o PrismaService, sujeito à RLS.
 */
@Injectable()
export class BackofficePrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: AppConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get({ key: 'DATABASE_BACKOFFICE_URL' }),
        options: `-c role=${BACKOFFICE_DB_ROLE}`,
      }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
