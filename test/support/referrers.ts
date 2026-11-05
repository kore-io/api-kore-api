import { randomUUID } from 'node:crypto';
import type { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';

/**
 * Cria um indicador pela conexão do backoffice: os testes montam o cenário
 * sem depender do aceite de convite (perfil do cerimonialista) nem do backoffice.
 */
export async function seedReferrer({
  db,
  kind,
  name,
  status = 'active',
  accountStatus = 'active',
  referralDiscountEnabled = true,
}: {
  db: BackofficePrismaService;
  kind: 'planner' | 'seller';
  name: string;
  status?: 'active' | 'blocked' | 'inactive';
  accountStatus?: 'active' | 'blocked';
  referralDiscountEnabled?: boolean;
}): Promise<{ referralCode: string; userId: string }> {
  const referralCode = `indicador-${randomUUID()}`;
  const user = await db.user.create({
    data: { email: `${referralCode}@kore.local`, name, status: accountStatus },
    select: { id: true },
  });
  await db.referrer.create({
    data: {
      userId: user.id,
      kind,
      referralCode,
      ratePercent: 20,
      status,
      referralDiscountEnabled,
      ...(kind === 'planner' && { planner: { create: { creditName: name } } }),
    },
  });
  return { referralCode, userId: user.id };
}
