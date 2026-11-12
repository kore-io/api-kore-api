import { SetMetadata, type ExecutionContext } from '@nestjs/common';

/** Janela dos limites por IP (ADR do rate limit; decisão 135, Q4). */
export const RATE_LIMIT_WINDOW_MS = 60_000;

export const GENERAL_THROTTLER = 'general';
export const AUTH_THROTTLER = 'auth';

const AUTH_RATE_LIMITED = 'authRateLimited';

/**
 * Rota de autenticação (pedir código, confirmar código, voltar do Google):
 * além do limite geral, entra no limite de auth, somado entre essas rotas.
 */
export const AuthRateLimit = (): MethodDecorator & ClassDecorator =>
  SetMetadata(AUTH_RATE_LIMITED, true);

export function isAuthRateLimited(context: ExecutionContext): boolean {
  return (
    Reflect.getMetadata(AUTH_RATE_LIMITED, context.getHandler()) === true ||
    Reflect.getMetadata(AUTH_RATE_LIMITED, context.getClass()) === true
  );
}

/**
 * Importação de convidados (decisões 186, item 16, e 189, item 3): 20 pedidos
 * por minuto por usuário, somados entre as duas prévias e as duas confirmações.
 * O tracker é o userId da sessão; por isso o limite é um guard da rota, que
 * roda depois da sessão, e não um throttler do guard global (que roda antes).
 */
export const GUEST_IMPORT_THROTTLER = 'guest_import';
export const GUEST_IMPORT_PER_MINUTE = 20;

/** Imagens do site (S4 RN07): 30 por minuto por usuário, autorização e confirmação somadas. */
export const SITE_IMAGE_THROTTLER = 'site_image';
export const SITE_IMAGE_PER_MINUTE = 30;

/**
 * Link do grupo (Site público RN06; ADR-36, item 4; decisão 207, item 7): 20
 * falhas por minuto por IP no POST party-session. Contam só as falhas, para
 * um convite aberto por muita gente atrás do mesmo IP (CGNAT) não bloquear o
 * convidado de verdade.
 */
export const PARTY_LINK_THROTTLER = 'party_link';
export const PARTY_LINK_FAILURES_PER_MINUTE = 20;

/**
 * Métricas do simulador (Simule RN11): 30 por minuto por IP. O IP só entra na
 * chave do limite, no Redis (kore:<env>:rl:simulator_event:<ip>), que vence em
 * 1 minuto; não vai ao evento nem ao log.
 */
export const SIMULATOR_EVENT_THROTTLER = 'simulator_event';
export const SIMULATOR_EVENTS_PER_MINUTE = 30;

/**
 * Gravação do RSVP (RSVP RN10; revisão técnica R2-8): 20 por minuto pela chave
 * IP + grupo, para não barrar convidados de verdade atrás do mesmo IP de
 * operadora (CGNAT). O teto do dia por grupo é contado no banco.
 */
export const RSVP_WRITE_THROTTLER = 'rsvp_write';
export const RSVP_WRITES_PER_MINUTE = 20;

/**
 * Novo casamento pela cerimonialista (Novo casamento RN04; decisão 224(9)):
 * além do teto de casamentos sem dono, um limite de pedidos por conta.
 */
export const PLANNER_WEDDING_THROTTLER = 'planner_wedding';
export const PLANNER_WEDDINGS_PER_MINUTE = 10;

/**
 * Webhook do gateway de pagamento (Publicar e pagar RN09; B2-6): limite próprio
 * por IP, fora do limite geral, para um lote de eventos do gateway não ser
 * barrado junto com o tráfego do app (nem o contrário).
 */
export const PAYMENT_WEBHOOK_THROTTLER = 'payment_webhook';
export const PAYMENT_WEBHOOK_PER_MINUTE = 600;
