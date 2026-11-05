import type { Context } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace';
import {
  ALLOWED_EVENT_ATTRIBUTES,
  ALLOWED_EVENT_NAMES,
  filterAttributes,
  REDACTED_EVENT_NAME,
} from './allowed-attributes';

/**
 * Envolve o processador que exporta e entrega a ele o span só com o que pode
 * sair: atributos da lista, eventos só com nome da lista e o tipo do erro, links sem atributos
 * e o status sem mensagem. Fica no caminho de toda exportação, então nenhuma
 * instrumentação consegue mandar dado fora da lista.
 */
export class AllowListSpanProcessor implements SpanProcessor {
  constructor(private readonly next: SpanProcessor) {}

  onStart(span: Span, parentContext: Context): void {
    this.next.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    const overrides: Partial<ReadableSpan> = {
      attributes: filterAttributes({ attributes: span.attributes }),
      events: span.events.map((event) => ({
        ...event,
        name: ALLOWED_EVENT_NAMES.has(event.name) ? event.name : REDACTED_EVENT_NAME,
        attributes: filterAttributes({
          attributes: event.attributes,
          allowed: ALLOWED_EVENT_ATTRIBUTES,
        }),
      })),
      links: span.links.map((link) => ({ ...link, attributes: {} })),
      status: { code: span.status.code },
    };
    const filtered = new Proxy(span, {
      get: (target, property): unknown =>
        property in overrides
          ? overrides[property as keyof ReadableSpan]
          : Reflect.get(target, property, target),
    });
    this.next.onEnd(filtered);
  }

  forceFlush(): Promise<void> {
    return this.next.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.next.shutdown();
  }
}
