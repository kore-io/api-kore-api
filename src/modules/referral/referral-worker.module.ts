import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ActivatePixKeys, PIX_KEY_ACTIVATION } from './application/activate-pix-keys.use-case';
import {
  PIX_KEY_ACTIVATION_QUEUE,
  PixKeyActivationProcessor,
  PixKeyActivationScheduler,
} from './infrastructure/pix-key-activation.job';
import { PrismaPixKeyActivation } from './infrastructure/backoffice/prisma-pix-key-activation';

/** Rotinas do indicador, do lado do worker: a ativação das trocas da chave Pix. */
@Module({
  imports: [BullModule.registerQueue({ name: PIX_KEY_ACTIVATION_QUEUE })],
  providers: [
    { provide: PIX_KEY_ACTIVATION, useClass: PrismaPixKeyActivation },
    ActivatePixKeys,
    PixKeyActivationProcessor,
    PixKeyActivationScheduler,
  ],
})
export class ReferralWorkerModule {}
