import { Inject, Injectable } from '@nestjs/common';
import { monthsBefore } from '../../../shared/time/months-before';
import { firstName } from '../domain/access-invitation';
import {
  OWNERLESS_PURGE_MONTHS,
  PURGE_NOTICE_DAYS,
  ownerlessStep,
  promisedPurgeDate,
} from '../domain/ownerless-purge';
import { OWNERLESS_WEDDINGS, type OwnerlessWeddings } from './ports/ownerless-weddings.port';
import { PURGE_NOTICE_MAILER, type PurgeNoticeMailer } from './ports/purge-notice-mailer.port';

/**
 * Rotina diária do casamento sem dono (RN13 de Convites; decisões 102, 136 e
 * 180): avisa o indicador 30 dias antes e expurga quando o prazo do aviso
 * venceu. O e-mail sai depois de o aviso estar gravado.
 */
@Injectable()
export class PurgeOwnerlessWeddings {
  constructor(
    @Inject(OWNERLESS_WEDDINGS) private readonly weddings: OwnerlessWeddings,
    @Inject(PURGE_NOTICE_MAILER) private readonly mailer: PurgeNoticeMailer,
  ) {}

  async execute({ now }: { now: Date }): Promise<{ notices: number; purged: number }> {
    // Quem já pode receber o aviso: a data do expurgo cai em até 30 dias.
    const inThirtyDays = new Date(now.getTime() + PURGE_NOTICE_DAYS * 24 * 60 * 60 * 1000);
    const candidates = await this.weddings.listCandidates({
      lastActivityBefore: monthsBefore({ now: inThirtyDays, months: OWNERLESS_PURGE_MONTHS }),
    });
    let notices = 0;
    let purged = 0;
    for (const wedding of candidates) {
      const step = ownerlessStep({ ...wedding, now });
      const seen = {
        weddingId: wedding.weddingId,
        seenLastActivityAt: wedding.lastActivityAt,
        now,
      };
      if (step === 'purge' && (await this.weddings.purge(seen))) purged++;
      if (step !== 'notice' || !(await this.weddings.markNoticeSent(seen))) continue;
      notices++;
      if (!wedding.creator) continue;
      await this.mailer.send({
        notice: {
          to: wedding.creator.email,
          creatorName: firstName({ name: wedding.creator.name ?? '' }),
          partnerNames: wedding.partnerNames,
          status: wedding.status,
          purgeDate: promisedPurgeDate({ lastActivityAt: wedding.lastActivityAt, now }),
        },
      });
    }
    return { notices, purged };
  }
}
