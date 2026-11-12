import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { GetMyWedding, ListMyWeddings } from './application/my-weddings.use-cases';
import { PLANNER_WEDDINGS_READER } from './application/ports/planner-weddings-reader.port';
import { PrismaPlannerWeddingsReader } from './infrastructure/prisma-planner-weddings.reader';
import { MyWeddingsController } from './presentation/my-weddings.controller';
import { REFERRED_WEDDINGS_READER } from './application/ports/referred-weddings-reader.port';
import { ListReferredWeddings } from './application/referred-weddings.use-case';
import { PrismaReferredWeddingsReader } from './infrastructure/prisma-referred-weddings.reader';
import { ReferredWeddingsController } from './presentation/referred-weddings.controller';

/**
 * Área do cerimonialista (decisão 223, D1): lê por vínculo, pela autorização
 * central; nenhuma consulta aceita um weddingId sem conferir o Membership ativo.
 */
@Module({
  imports: [AccessModule],
  controllers: [MyWeddingsController, ReferredWeddingsController],
  providers: [
    { provide: PLANNER_WEDDINGS_READER, useClass: PrismaPlannerWeddingsReader },
    ListMyWeddings,
    GetMyWedding,
    { provide: REFERRED_WEDDINGS_READER, useClass: PrismaReferredWeddingsReader },
    ListReferredWeddings,
  ],
})
export class PlannerModule {}
