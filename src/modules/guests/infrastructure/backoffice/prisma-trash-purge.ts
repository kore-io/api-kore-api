import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import type { PurgeCounts, TrashPurge } from '../../application/ports/trash-purge.port';
import { DEFAULT_TIMEZONE, TRASH_RETENTION_DAYS } from '../../domain/trash';

/**
 * Pela conexão do backoffice (sem RLS), numa transação. A regra de data é a
 * do domínio (isPurgeDue), escrita em SQL para não varrer linha a linha: o dia
 * de deleted_at no fuso do casamento + 30 < o dia de hoje no mesmo fuso.
 * Os índices parciais de deleted_at IS NOT NULL (migration guests) servem
 * esta leitura. Casamento expurgado (lápide) não tem mais lista; o bloqueado
 * fica de fora (RN10).
 */
@Injectable()
export class PrismaTrashPurge implements TrashPurge {
  constructor(private readonly prisma: BackofficePrismaService) {}

  async purgeDue({ now }: { now: Date }): Promise<PurgeCounts> {
    return this.prisma.$transaction(async (tx) => {
      const due = (table: string) => `
        SELECT x.id FROM ${table} x JOIN weddings w ON w.id = x.wedding_id
        WHERE x.deleted_at IS NOT NULL AND w.status <> 'purged'
          -- Casamento bloqueado RN06: a lixeira para; os vencidos saem quando o bloqueio sai.
          AND w.blocked_at IS NULL
          AND (x.deleted_at AT TIME ZONE coalesce(w.timezone, '${DEFAULT_TIMEZONE}'))::date
              + ${TRASH_RETENTION_DAYS}
            < ($1::timestamptz AT TIME ZONE coalesce(w.timezone, '${DEFAULT_TIMEZONE}'))::date`;

      // Retenção RN04 (card 67): o lock dos números de cada casamento com algo a
      // apagar, na ordem das escritas da lixeira (números, depois grupos), para
      // um restaurar no mesmo minuto não somar um convidado apagado.
      await tx.$queryRawUnsafe(
        `SELECT 1 FROM wedding_stats WHERE wedding_id IN (
           SELECT wedding_id FROM parties WHERE id IN (${due('parties')})
           UNION SELECT wedding_id FROM guests WHERE id IN (${due('guests')})
           UNION SELECT wedding_id FROM tags WHERE id IN (${due('tags')}))
         ORDER BY wedding_id FOR UPDATE`,
        now,
      );
      // Grupos: com eles vão os convidados (do lote ou que foram sozinhos
      // antes), as respostas e os vínculos de tag (ON DELETE CASCADE).
      const [{ parties, party_guests: partyGuests }] = await tx.$queryRawUnsafe<
        { parties: number; party_guests: number }[]
      >(
        `WITH due AS (${due('parties')}),
         counted AS (SELECT count(*)::int AS n FROM guests WHERE party_id IN (SELECT id FROM due)),
         deleted AS (DELETE FROM parties WHERE id IN (SELECT id FROM due) RETURNING id)
         SELECT (SELECT count(*)::int FROM deleted) AS parties, (SELECT n FROM counted) AS party_guests`,
        now,
      );
      // Convidados que foram sozinhos, de um grupo que continua. Quem foi para a
      // lixeira já passou o contato adiante (RN04); se não, o grupo fica sem.
      await tx.$executeRawUnsafe(
        `UPDATE parties SET contact_guest_id = NULL WHERE contact_guest_id IN (${due('guests')})`,
        now,
      );
      const [{ guests }] = await tx.$queryRawUnsafe<{ guests: number }[]>(
        `WITH deleted AS (DELETE FROM guests WHERE id IN (${due('guests')}) RETURNING id)
         SELECT count(*)::int AS guests FROM deleted`,
        now,
      );
      // Tags: com elas vão os vínculos guardados.
      const [{ tags }] = await tx.$queryRawUnsafe<{ tags: number }[]>(
        `WITH deleted AS (DELETE FROM tags WHERE id IN (${due('tags')}) RETURNING id)
         SELECT count(*)::int AS tags FROM deleted`,
        now,
      );
      return { parties, guests: partyGuests + guests, tags };
    });
  }
}
