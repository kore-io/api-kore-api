import { Injectable } from '@nestjs/common';
import type { ProfileDirectory } from '../application/ports/profile-directory.port';
import type { ProfileKind } from '../domain/authenticated-session';

/**
 * Perfis da pessoa (RN14). Casal (dono de casamento) e cerimonialista ou
 * vendedor (Referrer) dependem das tabelas de casamento e de indicação, que
 * entram nas próximas branches; até lá nenhuma conta tem perfil (decisão 139).
 */
@Injectable()
export class PrismaProfileDirectory implements ProfileDirectory {
  listProfiles(): Promise<ProfileKind[]> {
    return Promise.resolve([]);
  }
}
