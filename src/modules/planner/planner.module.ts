import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { GetMyWedding, ListMyWeddings } from './application/my-weddings.use-cases';
import { PLANNER_WEDDINGS_READER } from './application/ports/planner-weddings-reader.port';
import { PrismaPlannerWeddingsReader } from './infrastructure/prisma-planner-weddings.reader';
import { MyWeddingsController } from './presentation/my-weddings.controller';

/**
 * Área do cerimonialista (decisão 223, D1): lê por vínculo, pela autorização
 * central; nenhuma consulta aceita um weddingId sem conferir o Membership ativo.
 */
@Module({
  imports: [AccessModule],
  controllers: [MyWeddingsController],
  providers: [
    { provide: PLANNER_WEDDINGS_READER, useClass: PrismaPlannerWeddingsReader },
    ListMyWeddings,
    GetMyWedding,
  ],
})
export class PlannerModule {}
