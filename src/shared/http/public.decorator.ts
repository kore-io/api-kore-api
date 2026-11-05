import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_ROUTE = 'isPublicRoute';

/**
 * Rota que não exige sessão. Toda rota exige sessão por padrão (guard global
 * do módulo access); esta marcação é a exceção explícita.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_ROUTE, true);
