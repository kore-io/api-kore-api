import { addDays } from './pricing';

/** AAAA-MM-DD. */
type Day = string;

/** O aviso de expurgo sai 30 dias antes do `purgeAt` (Retenção RN02; decisões 136(5) e 180). */
export const RETENTION_NOTICE_DAYS = 30;
const NOTICE_MS = RETENTION_NOTICE_DAYS * 86_400_000;

/** Por que o casamento é expurgado: o fim da retenção ou o Excluir do casal (log `wedding.purged`). */
export type PurgeReason = 'retention' | 'owner_request';

export type RetentionStep = { kind: 'notice' } | { kind: 'purge'; reason: PurgeReason } | null;

/**
 * O passo da rotina diária para um casamento (Retenção RN02, RN03 e RN05), com
 * o "hoje" já no fuso do casamento:
 * - bloqueado: nada (decisão 86); nem aviso, nem expurgo;
 * - com a exclusão agendada: expurgo no dia `deletionScheduledFor`, sem o aviso
 *   de 30 dias; e nenhum aviso de retenção enquanto ela durar (RN05);
 * - expirado: aviso a partir de `purgeAt − 30 dias`; expurgo quando `purgeAt`
 *   já passou E o aviso saiu há 30 dias ou mais (aviso que falhou não conta).
 */
export function retentionStep({
  status,
  purgeAt,
  purgeNoticeSentAt,
  deletionScheduledFor,
  blocked,
  today,
  now,
}: {
  status: string;
  purgeAt: Day | null;
  purgeNoticeSentAt: Date | null;
  deletionScheduledFor: Day | null;
  blocked: boolean;
  today: Day;
  now: Date;
}): RetentionStep {
  if (blocked || status === 'purged') return null;
  if (deletionScheduledFor)
    return today >= deletionScheduledFor ? { kind: 'purge', reason: 'owner_request' } : null;
  if (status !== 'expired' || !purgeAt) return null;
  if (!purgeNoticeSentAt)
    return today >= addDays({ day: purgeAt, days: -RETENTION_NOTICE_DAYS })
      ? { kind: 'notice' }
      : null;
  const noticeMatured = now.getTime() >= purgeNoticeSentAt.getTime() + NOTICE_MS;
  return today > purgeAt && noticeMatured ? { kind: 'purge', reason: 'retention' } : null;
}
