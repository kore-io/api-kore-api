import { Module } from '@nestjs/common';
import { PAYOUT_DATA_STORE } from './application/ports/payout-data-store.port';
import { PayoutDataUseCases } from './application/payout-data.use-cases';
import { PrismaPayoutDataStore } from './infrastructure/prisma-payout-data.store';
import { PayoutDataController } from './presentation/payout-data.controller';

/** O indicador como quem recebe: Dados para receber e, depois, o repasse (Repasse e Dados para receber). */
@Module({
  controllers: [PayoutDataController],
  providers: [{ provide: PAYOUT_DATA_STORE, useClass: PrismaPayoutDataStore }, PayoutDataUseCases],
  exports: [PayoutDataUseCases],
})
export class ReferralModule {}
