import { Injectable, RequestMethod, VERSION_NEUTRAL } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, VERSION_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { IS_SITE_ROUTE } from './site-route.decorator';

/** A versão das rotas sem @Version (configureApp: defaultVersion '1'). */
const DEFAULT_VERSION = '1';

type Handler = (...args: unknown[]) => unknown;

interface SiteRouteMatcher {
  method: RequestMethod;
  pattern: RegExp;
}

const segments = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value])
    .filter((part): part is string => typeof part === 'string')
    .flatMap((part) => part.split('/'))
    .filter(Boolean);

/**
 * Os caminhos das rotas @SiteRoute(), montados dos metadados dos controllers.
 * O CORS roda antes do roteamento (inclusive no preflight, que não chega a
 * rota nenhuma), então precisa saber pelo caminho se ele é de uma rota do site.
 */
@Injectable()
export class SiteRouteRegistry {
  private matchers: SiteRouteMatcher[] | undefined;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  /** Algum método de rota do site responde neste caminho (o preflight não sabe o método). */
  isSitePath({ path }: { path: string }): boolean {
    return this.routes().some(({ pattern }) => pattern.test(path));
  }

  private routes(): SiteRouteMatcher[] {
    this.matchers ??= this.discovery.getControllers().flatMap(({ metatype, instance }) => {
      if (!metatype || !instance) return [];
      const controllerIsSite = this.reflector.get<boolean>(IS_SITE_ROUTE, metatype) === true;
      const prototype = Object.getPrototypeOf(instance) as object;
      return this.scanner.getAllMethodNames(prototype).flatMap((name) => {
        const handler = (prototype as Record<string, unknown>)[name] as Handler;
        const method = this.reflector.get<RequestMethod | undefined>(METHOD_METADATA, handler);
        if (method === undefined) return [];
        if (!controllerIsSite && this.reflector.get<boolean>(IS_SITE_ROUTE, handler) !== true)
          return [];
        const version =
          this.reflector.get<unknown>(VERSION_METADATA, handler) ??
          this.reflector.get<unknown>(VERSION_METADATA, metatype) ??
          DEFAULT_VERSION;
        // Uma versão só nas rotas do Kore (string); a neutra fica fora do /v.
        const first: unknown = Array.isArray(version) ? version[0] : version;
        const parts = [
          ...(first === VERSION_NEUTRAL || typeof first !== 'string' ? [] : [`v${first}`]),
          ...segments(this.reflector.get<unknown>(PATH_METADATA, metatype)),
          ...segments(this.reflector.get<unknown>(PATH_METADATA, handler)),
        ];
        const body = parts
          .map((part) =>
            part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          )
          .join('/');
        return [{ method, pattern: new RegExp(`^/${body}/?$`) }];
      });
    });
    return this.matchers;
  }
}
