import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OriginGuard } from './origin.guard';

/** Proteções HTTP transversais, aplicadas a toda rota. */
@Module({
  providers: [{ provide: APP_GUARD, useClass: OriginGuard }],
})
export class HttpSecurityModule {}
