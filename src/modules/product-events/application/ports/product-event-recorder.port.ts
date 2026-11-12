import type { ProductEvent } from '../../domain/product-event';

/** Porta usada pelos outros módulos para registrar um evento de produto. */
export interface ProductEventRecorder {
  record({ event, occurredAt }: { event: ProductEvent; occurredAt: Date }): Promise<void>;
}

export const PRODUCT_EVENT_RECORDER = Symbol('ProductEventRecorder');
