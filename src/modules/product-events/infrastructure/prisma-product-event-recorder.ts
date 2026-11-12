import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import type { ProductEventRecorder } from '../application/ports/product-event-recorder.port';
import type { ProductEvent } from '../domain/product-event';
import { WeddingPseudonymizer } from './wedding-pseudonymizer';

@Injectable()
export class PrismaProductEventRecorder implements ProductEventRecorder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pseudonymizer: WeddingPseudonymizer,
  ) {}

  async record({ event, occurredAt }: { event: ProductEvent; occurredAt: Date }): Promise<void> {
    const weddingRef =
      'weddingId' in event ? this.pseudonymizer.weddingRef({ weddingId: event.weddingId }) : null;
    const props = 'props' in event ? event.props : undefined;
    // createMany não usa RETURNING: a API só tem INSERT nesta tabela.
    await this.prisma.productEvent.createMany({
      data: [{ name: event.name, occurredAt, weddingRef, props }],
    });
  }
}
