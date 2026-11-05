import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigService } from './app-config.service';
import { validateEnv } from './env.schema';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      // No local o .env é lido; nos outros ambientes as variáveis vêm do host.
      ignoreEnvFile: process.env.APP_ENV !== undefined && process.env.APP_ENV !== 'local',
      validate: (config) => validateEnv({ config }),
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
