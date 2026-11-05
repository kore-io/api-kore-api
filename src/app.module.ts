import { Module } from '@nestjs/common';
import { AppConfigModule } from './shared/config/app-config.module';
import { DatabaseModule } from './shared/database/database.module';
import { EmailModule } from './shared/email/email.module';
import { HealthModule } from './shared/health/health.module';
import { RedisModule } from './shared/redis/redis.module';

@Module({
  imports: [AppConfigModule, DatabaseModule, RedisModule, EmailModule, HealthModule],
})
export class AppModule {}
