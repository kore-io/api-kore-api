import { z } from 'zod';

export const APP_ENVS = ['local', 'test', 'homolog', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const postgresUrl = z
  .url({ protocol: /^postgres(ql)?$/ })
  .describe('URL de conexão do Postgres (postgresql://usuario:senha@host:porta/banco)');

export const envSchema = z.object({
  APP_ENV: z.enum(APP_ENVS),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: postgresUrl,
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Valida as variáveis na subida: a API não sobe com configuração faltando ou
 * errada, e a mensagem diz quais variáveis falharam (nunca o valor).
 */
export function validateEnv({ config }: { config: Record<string, unknown> }): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Configuração inválida: ${problems}`);
  }
  return result.data;
}
