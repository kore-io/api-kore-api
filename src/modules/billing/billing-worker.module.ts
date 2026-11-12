import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { GATEWAY_EVENT_QUEUE } from './application/ports/gateway-event.queue.port';
import { GATEWAY_EVENT_STORE } from './application/ports/gateway-event.store.port';
import { ProcessGatewayEvent } from './application/process-gateway-event.use-case';
import { RequeueGatewayEvents } from './application/requeue-gateway-events.use-case';
import { PrismaGatewayEventStore } from './infrastructure/backoffice/prisma-gateway-event.store';
import {
  GatewayEventsProcessor,
  GatewayEventsRequeueScheduler,
} from './infrastructure/gateway-events.job';
import {
  BullmqGatewayEventQueue,
  GATEWAY_EVENTS_QUEUE,
} from './infrastructure/gateway-events.queue';
import { PAYMENT_GATEWAY_PROVIDERS } from './infrastructure/backoffice/payment-gateway.providers';

/** Cobrança e publicação (F3), do lado do worker: o processamento dos eventos do gateway. */
@Module({
  imports: [BullModule.registerQueue({ name: GATEWAY_EVENTS_QUEUE })],
  providers: [
    ...PAYMENT_GATEWAY_PROVIDERS,
    { provide: GATEWAY_EVENT_STORE, useClass: PrismaGatewayEventStore },
    { provide: GATEWAY_EVENT_QUEUE, useClass: BullmqGatewayEventQueue },
    ProcessGatewayEvent,
    RequeueGatewayEvents,
    GatewayEventsProcessor,
    GatewayEventsRequeueScheduler,
  ],
})
export class BillingWorkerModule {}
