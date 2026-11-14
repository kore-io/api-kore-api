import { Inject, Injectable, Logger } from '@nestjs/common';
import { localDate } from '../../../shared/time/local-date';
import { promisedPurgeDay, retentionStep } from '../domain/retention';
import { BILLING_MAILER, type BillingMailer } from './ports/billing-mailer.port';
import {
  type RetentionCandidate,
  WEDDING_RETENTION_STORE,
  type WeddingRetentionStore,
} from './ports/wedding-retention.port';

const logger = new Logger('WeddingRetention');

export interface RetentionTally {
  notices: number;
  purged: number;
  failed: number;
}

/**
 * A rotina diária da retenção e do expurgo (Retenção e expurgo RN02 a RN05),
 * no worker, com o relógio injetado:
 * - o aviso de 30 dias: grava a marca e a notificação, depois manda o e-mail
 *   de serviço às pessoas donas; se o e-mail não entra na fila, a marca é
 *   desfeita e a rotina tenta de novo no dia seguinte (decisão 180(8));
 * - o expurgo: o fim da retenção (com o aviso maduro) e a exclusão pedida pelo
 *   casal (no dia agendado, sem aviso);
 * - cada casamento por si: um erro (fuso inválido, armazenamento fora) pula o
 *   casamento, vira o `Alert purge_failed` e não derruba a rodada (RN04).
 */
@Injectable()
export class PurgeRetainedWeddings {
  constructor(
    @Inject(WEDDING_RETENTION_STORE) private readonly store: WeddingRetentionStore,
    @Inject(BILLING_MAILER) private readonly mailer: BillingMailer,
  ) {}

  async execute({ now, weddingId }: { now: Date; weddingId?: string }): Promise<RetentionTally> {
    const tally: RetentionTally = { notices: 0, purged: 0, failed: 0 };
    for (const wedding of await this.store.listCandidates({ now, weddingId })) {
      try {
        const done = await this.step({ wedding, now });
        if (done === 'notice') tally.notices++;
        if (done === 'purged') tally.purged++;
      } catch (error) {
        tally.failed++;
        const name = (error as Error).name;
        logger.warn(`Expurgo de ${wedding.weddingId} pulado: ${name}`);
        await this.store
          .openPurgeFailedAlert({ weddingId: wedding.weddingId, error: name })
          .catch(() => undefined);
      }
    }
    return tally;
  }

  private async step({
    wedding,
    now,
  }: {
    wedding: RetentionCandidate;
    now: Date;
  }): Promise<'notice' | 'purged' | null> {
    // O "hoje" do casamento: um fuso inválido lança aqui, e o casamento é pulado.
    const today = localDate({ at: now, timezone: wedding.timezone });
    const step = retentionStep({ ...wedding, today, now });
    if (!step) return null;
    if (step.kind === 'purge') {
      const purged = await this.store.purge({
        weddingId: wedding.weddingId,
        reason: step.reason,
        seenDeletionScheduledFor: wedding.deletionScheduledFor,
        now,
      });
      return purged ? 'purged' : null;
    }
    const purgeAt = wedding.purgeAt as string;
    // O aviso atrasado promete o dia real: o expurgo espera os 30 dias do aviso.
    const promisedDay = promisedPurgeDay({ purgeAt, today });
    const target = await this.store.markNotice({
      weddingId: wedding.weddingId,
      purgeAt,
      promisedDay,
      now,
    });
    if (!target) return null;
    try {
      for (const recipient of target.recipients)
        await this.mailer.purgeSoon({
          notice: {
            to: recipient.email,
            firstName: recipient.firstName,
            weddingId: wedding.weddingId,
            noticeSentAt: now,
            purgeAt: promisedDay,
            expiredAt: wedding.expiredAt ?? purgeAt,
            partnerNames: target.partnerNames,
          },
        });
    } catch (error) {
      // Sem o e-mail, o aviso não conta (RN02): a marca sai e a rodada de amanhã avisa.
      await this.store.clearNotice({ weddingId: wedding.weddingId, noticeSentAt: now, now });
      logger.warn(`Aviso de expurgo de ${wedding.weddingId} não saiu: ${(error as Error).name}`);
      return null;
    }
    return 'notice';
  }
}
