import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_ROUTE = 'isPublicRoute';

/**
 * Rota que não exige sessão. Toda rota exige sessão por padrão (guard global
 * do módulo access); esta marcação é a exceção explícita.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_ROUTE, true);

export const IS_OPTIONAL_SESSION_ROUTE = 'isOptionalSessionRoute';

/**
 * Rota pública que usa a sessão quando ela existe (ex.: o convite, que compara
 * o e-mail da sessão, RN07 de Convites). Sessão inválida ou vencida segue como
 * sem sessão, sem erro.
 */
export const OptionalSession = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_OPTIONAL_SESSION_ROUTE, true);
