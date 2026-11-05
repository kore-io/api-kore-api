import { z } from 'zod';
import { OTEL_EXPORTERS } from '../observability/otel-exporters';

export const APP_ENVS = ['local', 'test', 'homolog', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export const LOCAL_KEY_ENVS: readonly AppEnv[] = ['local', 'test'];

const postgresUrl = z
  .url({ protocol: /^postgres(ql)?$/ })
  .describe('URL de conexão do Postgres (postgresql://usuario:senha@host:porta/banco)');

// Lista de origens separadas por vírgula, cada uma só esquema, host e porta.
const originList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  .pipe(
    z
      .array(
        z
          .url({ protocol: /^https?$/ })
          .refine((origin) => new URL(origin).origin === origin, 'use só esquema, host e porta'),
      )
      .min(1, 'informe pelo menos uma origem'),
  );

const base64Key32 = z
  .base64()
  .refine((value) => Buffer.from(value, 'base64').length === 32, 'precisa ter 32 bytes em base64');

export const envSchema = z
  .object({
    APP_ENV: z.enum(APP_ENVS),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: postgresUrl,
    // Backoffice e rotinas agendadas: conexão que assume o papel kore_backoffice
    // (BYPASSRLS); todo acesso é registrado no log da aplicação (ADR de multi-tenant).
    DATABASE_BACKOFFICE_URL: postgresUrl,
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    // Origens do app que podem chamar a API com o cookie de sessão (CORS e
    // proteção contra CSRF nas escritas).
    ALLOWED_ORIGINS: originList,
    // Endereço do app, para os links dos e-mails (botão de acesso, convites).
    APP_URL: z.url({ protocol: /^https?$/ }),
    // Rate limit por IP, por minuto (decisão 135, Q4).
    RATE_LIMIT_GENERAL_PER_MINUTE: z.coerce.number().int().min(1).default(100),
    RATE_LIMIT_AUTH_PER_MINUTE: z.coerce.number().int().min(1).default(10),
    // Quantos proxies confiáveis estão na frente da API, para o IP do rate
    // limit e do log ser o do cliente (X-Forwarded-For). 0 no local.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
    // E-mail aos usuários. Só SMTP por enquanto (Mailpit no local); o SES entra
    // com a infraestrutura.
    EMAIL_PROVIDER: z.enum(['smtp']),
    EMAIL_FROM: z.string().min(1),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
    // Chave mestra da criptografia de envelope. No local e nos testes, uma chave
    // de desenvolvimento; o AWS KMS entra com a infraestrutura.
    KMS_PROVIDER: z.enum(['local']),
    KMS_LOCAL_MASTER_KEY: base64Key32.optional(),
    // Chave do HMAC do IP no log da aplicação (o IP real fica só no log de IP real).
    IP_HASH_KEY: base64Key32,
    // Chave do HMAC que pseudonimiza o casamento nos eventos de produto (decisão 135).
    PRODUCT_EVENT_KEY: base64Key32,
    // Chave do HMAC do código de login de 6 números (decisão 139).
    LOGIN_CODE_KEY: base64Key32,
    // Login pelo Google (decisão 147): `dev` simula a volta sem credencial (só em
    // local e test); `google` usa o OIDC real com o cliente abaixo.
    GOOGLE_PROVIDER: z.enum(['dev', 'google']),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    // URL do callback da API registrada no Google (…/v1/auth/google/callback).
    GOOGLE_REDIRECT_URI: z.url({ protocol: /^https?$/ }).optional(),
    // Chave do HMAC do cookie do state e do PKCE do Google (decisão 147).
    OAUTH_STATE_KEY: base64Key32,
    // Versão vigente dos Termos e da Política (RN11 de Cadastro; decisão 166).
    TERMS_VERSION: z.string().min(1).default('2026-09'),
    // Observabilidade: console no local; o OTLP do SigNoz entra com a infraestrutura.
    OTEL_EXPORTER: z.enum(OTEL_EXPORTERS).default('none'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.GOOGLE_PROVIDER === 'dev' && !LOCAL_KEY_ENVS.includes(env.APP_ENV)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_PROVIDER'],
        message: 'o Google de desenvolvimento só é aceito com APP_ENV local ou test',
      });
    }
    if (env.GOOGLE_PROVIDER === 'google') {
      for (const key of [
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'GOOGLE_REDIRECT_URI',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'obrigatória com GOOGLE_PROVIDER=google',
          });
        }
      }
    }
    if (env.KMS_PROVIDER !== 'local') return;
    // Decisão 97, item 4: a chave de desenvolvimento só vale em local ou test.
    if (!LOCAL_KEY_ENVS.includes(env.APP_ENV)) {
      ctx.addIssue({
        code: 'custom',
        path: ['KMS_PROVIDER'],
        message: 'a chave local só é aceita com APP_ENV local ou test',
      });
    }
    if (!env.KMS_LOCAL_MASTER_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['KMS_LOCAL_MASTER_KEY'],
        message: 'obrigatória com KMS_PROVIDER=local',
      });
    }
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
