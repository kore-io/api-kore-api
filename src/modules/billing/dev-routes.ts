import { type AppEnv, LOCAL_KEY_ENVS } from '../../shared/config/env.schema';

/** A rota dev de pagamentos existe só com APP_ENV local ou test (Publicar e pagar RN15). */
export function devPaymentRoutesEnabled(env: NodeJS.ProcessEnv): boolean {
  return LOCAL_KEY_ENVS.includes(env.APP_ENV as AppEnv);
}
