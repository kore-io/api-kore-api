import type { Attributes } from '@opentelemetry/api';

/**
 * Lista do que PODE sair para a observabilidade (ADR de observabilidade, item
 * 5): só IDs, rota, status, duração e erro técnico. Todo o resto é descartado,
 * mesmo que um desenvolvedor esqueça de mascarar: URL com token, query string,
 * cabeçalhos, SQL, comando do Redis, e-mail, nome.
 */
export const ALLOWED_SPAN_ATTRIBUTES: ReadonlySet<string> = new Set([
  // HTTP (semconv atual e antiga)
  'http.request.method',
  'http.method',
  'http.route',
  'http.response.status_code',
  'http.status_code',
  // Banco e Redis: só o tipo e a operação, nunca o texto do comando
  'db.system',
  'db.system.name',
  'db.namespace',
  'db.operation.name',
  // Rede, sem endereço do cliente
  'server.address',
  'server.port',
  'network.protocol.version',
  // Erro técnico
  'error.type',
  // IDs do domínio, com o prefixo app.
  'app.wedding_id',
  'app.party_id',
  'app.guest_id',
  'app.surface',
]);

/**
 * Dos eventos (inclusive o de recordException) só sai o tipo do erro: a
 * mensagem e a pilha podem carregar dado pessoal (ex.: o valor que violou um
 * índice único).
 */
export const ALLOWED_EVENT_ATTRIBUTES: ReadonlySet<string> = new Set(['exception.type']);

/** Nome de evento fora desta lista sai como REDACTED_EVENT_NAME. */
export const ALLOWED_EVENT_NAMES: ReadonlySet<string> = new Set(['exception']);
export const REDACTED_EVENT_NAME = '[redacted]';

export function filterAttributes({
  attributes,
  allowed = ALLOWED_SPAN_ATTRIBUTES,
}: {
  attributes: Attributes | undefined;
  allowed?: ReadonlySet<string>;
}): Attributes {
  return Object.fromEntries(Object.entries(attributes ?? {}).filter(([key]) => allowed.has(key)));
}
