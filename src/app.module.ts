import { Module } from '@nestjs/common';
import { AppConfigModule } from './shared/config/app-config.module';
import { DatabaseModule } from './shared/database/database.module';

@Module({
  imports: [AppConfigModule, DatabaseModule],
})
export class AppModule {}
