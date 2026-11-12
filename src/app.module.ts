import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { BillingModule } from './modules/billing/billing.module';
import { DevPaymentsModule } from './modules/billing/dev-payments.module';
import { devPaymentRoutesEnabled } from './modules/billing/dev-routes';
import { AccessModule } from './modules/access/access.module';
import { GuestsModule } from './modules/guests/guests.module';
import { LogsModule } from './modules/logs/logs.module';
import { ProductEventsModule } from './modules/product-events/product-events.module';
import { RsvpModule } from './modules/rsvp/rsvp.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PlannerModule } from './modules/planner/planner.module';
import { AppConfigModule } from './shared/config/app-config.module';
import { CryptoModule } from './shared/crypto/crypto.module';
import { DatabaseModule } from './shared/database/database.module';
import { EmailModule } from './shared/email/email.module';
import { HealthModule } from './shared/health/health.module';
import { HttpSecurityModule } from './shared/http/http-security.module';
import { JobsModule } from './shared/jobs/jobs.module';
import { SiteModule } from './modules/site/site.module';
import { StorageModule } from './shared/storage/storage.module';
import { ObservabilityModule } from './shared/observability/observability.module';
import { RateLimitModule } from './shared/rate-limit/rate-limit.module';
import { RedisModule } from './shared/redis/redis.module';

@Module({
  imports: [
    AppConfigModule,
    ObservabilityModule,
    DatabaseModule,
    RedisModule,
    // A API produz jobs (e-mails); o worker os consome.
    JobsModule,
    EmailModule,
    StorageModule,
    CryptoModule,
    HealthModule,
    LogsModule,
    ProductEventsModule,
    // Ordem dos guards globais: rate limit → origem (CSRF) → sessão. O rate
    // limit vem primeiro: barra o abuso antes de qualquer outra checagem.
    RateLimitModule,
    HttpSecurityModule,
    AccessModule,
    GuestsModule,
    SiteModule,
    RsvpModule,
    NotificationsModule,
    PlannerModule,
    BillingModule,
    // A rota dev de pagamentos só existe em local e test (Publicar e pagar RN15).
    ConditionalModule.registerWhen(DevPaymentsModule, devPaymentRoutesEnabled),
  ],
})
export class AppModule {}
