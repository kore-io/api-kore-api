import { SetMetadata } from '@nestjs/common';

export const ALLOW_WHEN_BLOCKED = 'allowWhenBlocked';

/**
 * Escrita liberada com o casamento bloqueado ou com a exclusão agendada
 * (Casamento bloqueado RN03): a pré-visualização (é leitura) e sair do
 * casamento. O caso de uso confere o resto, quando a rota faz mais de uma coisa.
 */
export const AllowWhenBlocked = () => SetMetadata(ALLOW_WHEN_BLOCKED, true);
