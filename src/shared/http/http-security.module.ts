import { Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { OriginGuard } from './origin.guard';
import { SiteRouteRegistry } from './site-routes.registry';

/** Proteções HTTP transversais, aplicadas a toda rota. */
@Module({
  imports: [DiscoveryModule],
  providers: [{ provide: APP_GUARD, useClass: OriginGuard }, SiteRouteRegistry],
  exports: [SiteRouteRegistry],
})
export class HttpSecurityModule {}
