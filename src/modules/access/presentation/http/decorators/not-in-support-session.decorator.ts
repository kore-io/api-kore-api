import { SetMetadata } from '@nestjs/common';

export const NOT_IN_SUPPORT_SESSION = 'notInSupportSession';

/**
 * O GET que grava ou leva dados para fora (o Exportar) fica fechado durante o
 * Ver como o casal (Backoffice - acesso RN08): 403 SUPPORT_READ_ONLY.
 */
export const NotInSupportSession = () => SetMetadata(NOT_IN_SUPPORT_SESSION, true);
