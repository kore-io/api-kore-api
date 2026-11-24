import type { WeddingLifecycle } from '@/modules/access/application/ports/profile-directory.port';

/** Os campos do casamento de que sai o lifecycle (o /me e o Ver como o casal). */
export const WEDDING_LIFECYCLE_SELECT = {
  status: true,
  endDate: true,
  graceUntil: true,
  expiredAt: true,
  paidThrough: true,
  deletionScheduledFor: true,
  blockedAt: true,
} as const;

const day = (value: Date | null): string | null => value?.toISOString().slice(0, 10) ?? null;

/** O lifecycle das faixas e do selo da Topbar (Data de saída do ar RN06; decisão 231). */
export function weddingLifecycle({
  wedding,
}: {
  wedding: {
    status: string;
    endDate: Date | null;
    graceUntil: Date | null;
    expiredAt: Date | null;
    paidThrough: Date | null;
    deletionScheduledFor: Date | null;
    blockedAt: Date | null;
  };
}): WeddingLifecycle {
  return {
    status: wedding.status,
    blocked: wedding.blockedAt !== null,
    endDate: day(wedding.endDate),
    graceUntil: day(wedding.graceUntil),
    expiredAt: day(wedding.expiredAt),
    paidThrough: day(wedding.paidThrough),
    deletionScheduledFor: day(wedding.deletionScheduledFor),
  };
}
