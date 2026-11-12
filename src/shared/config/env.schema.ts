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
    // Endereço do site do casal, base do link do grupo (Grupos RN11; decisão 196).
    SITE_URL: z.url({ protocol: /^https?$/ }),
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
    // Chave do HMAC do cookie do grupo, kore_party_<weddingId> (Site público
    // RN06 e RN08; ADR-36).
    PARTY_COOKIE_KEY: base64Key32,
    // Chave do HMAC do cookie da prévia, kore_site_preview_<weddingId>
    // (Pré-visualização RN03).
    PREVIEW_COOKIE_KEY: base64Key32,
    // O simulador do site (Simule RN01; decisão 207, item 9): desligado em
    // homologação e produção até o PO liberar. Sem a variável, ligado só em local e test.
    SIMULATOR_ENABLED: z.enum(['true', 'false']).optional(),
    // Publicação por Cortesia (Publicação RN01; decisão 216, D1): sem valor,
    // desligada. Recusada em homolog e production (decisão 217(11)): ligar lá é
    // publicar para o público, e exige mudança de código e decisão do PO.
    // Cadastro próprio de cerimonialista (Cadastro e perfil RN02; decisão 223,
    // D23): sem valor, desligado; só liga em local e test até o termo de parceria.
    PLANNER_SIGNUP_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    // Base do Link de indicação (Link de indicação RN01): o redirect /i/{código}
    // fica no Site Institucional (RN07), fora da API.
    REFERRAL_LINK_URL: z.url({ protocol: /^https?$/ }).default('https://kore.com.br/i'),
    COURTESY_PUBLICATION_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    // Push com VAPID (E-mail e push RN07; decisão 216, D25): as chaves ficam
    // fora de arquivo e são geradas no ambiente. Opcionais em local e test (sem
    // elas, o push aparece desligado); obrigatórias em homolog e production.
    // Trocar a chave privada invalida todas as assinaturas.
    VAPID_PUBLIC_KEY: z.string().min(1).optional(),
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    // mailto: ou https: (o contato do serviço de push).
    VAPID_SUBJECT: z
      .string()
      .regex(/^(mailto:|https:\/\/)/)
      .optional(),
    // Versão vigente dos Termos e da Política (RN11 de Cadastro; decisão 166).
    TERMS_VERSION: z.string().min(1).default('2026-09'),
    // Armazenamento compatível com S3 (Imagens do site, RN06): MinIO no local,
    // R2 em homologação e produção (ADR do MinIO). Path-style só no MinIO.
    STORAGE_ENDPOINT: z.url({ protocol: /^https?$/ }),
    STORAGE_REGION: z.string().min(1).default('auto'),
    STORAGE_ACCESS_KEY_ID: z.string().min(1),
    STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
    STORAGE_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    // Originais do envio, nunca públicos; e as versões servidas pelo CDN.
    STORAGE_PRIVATE_BUCKET: z.string().min(3),
    STORAGE_PUBLIC_BUCKET: z.string().min(3),
    // Base pública das versões servidas (o domínio do CDN; no local, o MinIO).
    STORAGE_PUBLIC_URL: z.url({ protocol: /^https?$/ }),
    // Gateway de pagamento (Publicar e pagar RN14 e RN16; decisão 230, D11): só o
    // adaptador local por enquanto, com o estado no Postgres; o Asaas entra com o
    // card 65. O local é recusado em homolog e production, então a API não sobe
    // lá até o card 65 (B2-18): nenhum site vai ao ar sem pagamento.
    PAYMENT_GATEWAY_PROVIDER: z.enum(['local']),
    // Segredo do webhook do gateway, comparado em tempo constante (RN09).
    PAYMENT_WEBHOOK_SECRET: z.string().min(32),
    // Chave do HMAC do CPF e do CNPJ (porta TaxIdHasher; Publicar e pagar RN02;
    // revisão técnica B2-12): 32 bytes cifrados pelo KMS, em base64, decifrados
    // na subida. Nunca a chave mestra.
    TAX_ID_HASH_KEY_ENCRYPTED: z.base64().min(1),
    // Observabilidade: console no local; o OTLP do SigNoz entra com a infraestrutura.
    OTEL_EXPORTER: z.enum(OTEL_EXPORTERS).default('none'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((env, ctx) => {
    // A origem do site só vale nas rotas do site (Site público RN07): na lista
    // do app, ela leria e escreveria nas rotas do app com a sessão do casal.
    if (env.ALLOWED_ORIGINS.includes(new URL(env.SITE_URL).origin)) {
      ctx.addIssue({
        code: 'custom',
        path: ['ALLOWED_ORIGINS'],
        message: 'não pode ter a origem do SITE_URL (a origem do site vale só nas rotas do site)',
      });
    }
    if (env.PLANNER_SIGNUP_ENABLED && !LOCAL_KEY_ENVS.includes(env.APP_ENV)) {
      ctx.addIssue({
        code: 'custom',
        path: ['PLANNER_SIGNUP_ENABLED'],
        message:
          'o cadastro de cerimonialista só pode ser ligado com APP_ENV local ou test (decisão 224(8))',
      });
    }
    if (env.COURTESY_PUBLICATION_ENABLED && !LOCAL_KEY_ENVS.includes(env.APP_ENV)) {
      ctx.addIssue({
        code: 'custom',
        path: ['COURTESY_PUBLICATION_ENABLED'],
        message: 'a Cortesia só pode ser ligada com APP_ENV local ou test (decisão 217(11))',
      });
    }
    if (env.PAYMENT_GATEWAY_PROVIDER === 'local' && !LOCAL_KEY_ENVS.includes(env.APP_ENV)) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_GATEWAY_PROVIDER'],
        message:
          'o gateway local só é aceito com APP_ENV local ou test (Publicar e pagar RN16; decisão 230, D11)',
      });
    }
    if (!LOCAL_KEY_ENVS.includes(env.APP_ENV)) {
      for (const key of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'obrigatória com APP_ENV homolog ou production (o push, E-mail e push RN07)',
          });
        }
      }
    }
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
  })
  // Sem a variável, o simulador fica ligado só em local e test (Simule RN01).
  .transform((env) => ({
    ...env,
    SIMULATOR_ENABLED: simulatorEnabled({ appEnv: env.APP_ENV, value: env.SIMULATOR_ENABLED }),
  }));

/** O simulador: o valor da variável; sem ela, ligado só em local e test (Simule RN01). */
export function simulatorEnabled({
  appEnv,
  value,
}: {
  appEnv: AppEnv;
  value: 'true' | 'false' | undefined;
}): boolean {
  return value === undefined ? LOCAL_KEY_ENVS.includes(appEnv) : value === 'true';
}

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
