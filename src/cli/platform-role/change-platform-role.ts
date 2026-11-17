import type { PrismaClient } from '@/generated/prisma/client';
import { uuidV7 } from '@/shared/kernel/ids/uuid-v7';

export const PLATFORM_ROLES = ['admin', 'support', 'none'] as const;
export type PlatformRoleValue = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_ROLE_CHANGED_ACTION = 'user.platform_role_changed';

export interface PlatformRoleChangeInput {
  email: string;
  role: string;
  /** Quem roda o script (o e-mail da pessoa de operação). */
  by: string;
  reason: string;
}

export type PlatformRoleChange =
  | { outcome: 'changed'; userId: string; from: PlatformRoleValue; to: PlatformRoleValue }
  | { outcome: 'unchanged'; userId: string; role: PlatformRoleValue };

export class PlatformRoleUsageError extends Error {
  override name = 'PlatformRoleUsageError';
}

/** Os argumentos `--email`, `--role`, `--by` e `--reason`, todos obrigatórios. */
export function parsePlatformRoleArgs({ argv }: { argv: string[] }): PlatformRoleChangeInput {
  const value = (flag: string) => {
    const index = argv.indexOf(`--${flag}`);
    const found = index >= 0 ? argv[index + 1]?.trim() : undefined;
    if (!found || found.startsWith('--'))
      throw new PlatformRoleUsageError(
        'Uso: pnpm staff:role --email <e-mail> --role admin|support|none --by <quem roda> --reason "<motivo>"',
      );
    return found;
  };
  return { email: value('email'), role: value('role'), by: value('by'), reason: value('reason') };
}

/**
 * Dá ou tira o `platformRole` (Backoffice - acesso RN01; decisão 275): o
 * papel só muda por este script de operação, sem tela, e cada mudança deixa a
 * linha `user.platform_role_changed` no log da aplicação, na mesma transação,
 * com quem rodou e o motivo. O guard do Backoffice relê o papel a cada
 * requisição: o papel tirado vale na próxima (e encerra o Ver como o casal
 * aberto com `role_revoked`).
 */
export async function changePlatformRole({
  db,
  input,
  now,
}: {
  db: PrismaClient;
  input: PlatformRoleChangeInput;
  now: Date;
}): Promise<PlatformRoleChange> {
  const role = input.role.trim().toLowerCase();
  if (!(PLATFORM_ROLES as readonly string[]).includes(role))
    throw new PlatformRoleUsageError(`Papel "${input.role}" inválido: admin, support ou none.`);
  const to = role as PlatformRoleValue;
  const reason = input.reason.trim();
  const by = input.by.trim();
  if (!reason || !by) throw new PlatformRoleUsageError('Faltam o motivo e quem roda o script.');
  const email = input.email.trim().toLowerCase();

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; platform_role: PlatformRoleValue }[]>`
      SELECT id::text, platform_role::text FROM users WHERE email = ${email}::citext FOR UPDATE`;
    const user = rows[0];
    if (!user) throw new PlatformRoleUsageError(`Nenhuma conta com o e-mail ${email}.`);
    if (user.platform_role === to)
      return { outcome: 'unchanged' as const, userId: user.id, role: to };
    await tx.user.update({ where: { id: user.id }, data: { platformRole: to } });
    await tx.applicationLog.create({
      data: {
        id: uuidV7({ now: now.getTime() }),
        createdAt: now,
        actorKind: 'system',
        action: PLATFORM_ROLE_CHANGED_ACTION,
        entityType: 'user',
        entityId: user.id,
        data: { from: user.platform_role, to, by, reason },
      },
    });
    return { outcome: 'changed' as const, userId: user.id, from: user.platform_role, to };
  });
}
