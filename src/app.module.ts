import { Module } from '@nestjs/common';
import { AccessModule } from './modules/access/access.module';
import { LogsModule } from './modules/logs/logs.module';
import { AppConfigModule } from './shared/config/app-config.module';
import { CryptoModule } from './shared/crypto/crypto.module';
import { DatabaseModule } from './shared/database/database.module';
import { EmailModule } from './shared/email/email.module';
import { HealthModule } from './shared/health/health.module';
import { HttpSecurityModule } from './shared/http/http-security.module';
import { ObservabilityModule } from './shared/observability/observability.module';
import { RateLimitModule } from './shared/rate-limit/rate-limit.module';
import { RedisModule } from './shared/redis/redis.module';

@Module({
  imports: [
    AppConfigModule,
    ObservabilityModule,
    DatabaseModule,
    RedisModule,
    EmailModule,
    CryptoModule,
    HealthModule,
    LogsModule,
    // Ordem dos guards globais: rate limit → origem (CSRF) → sessão. O rate
    // limit vem primeiro: barra o abuso antes de qualquer outra checagem.
    RateLimitModule,
    HttpSecurityModule,
    AccessModule,
  ],
})
export class AppModule {}
