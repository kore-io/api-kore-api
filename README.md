# api-kore-api

API do Kore (NestJS, Prisma, PostgreSQL). Documentação no vault `docs-kore-hub`.

## Ambiente local

Requer Docker com Docker Compose.

```bash
docker compose up -d   # Postgres 5433, Redis 6380, MinIO 9000/9001, Mailpit 1025/8025
docker compose down    # para os serviços (os volumes kore-* ficam)
```

| Serviço  | Host                                           | Credenciais locais            |
| -------- | ---------------------------------------------- | ----------------------------- |
| Postgres | `localhost:5433`                               | `kore` / `kore`, banco `kore` |
| Redis    | `localhost:6380`                               | —                             |
| MinIO    | API `localhost:9000`, console `localhost:9001` | `kore` / `kore-minio-local`   |
| Mailpit  | SMTP `localhost:1025`, web `localhost:8025`    | —                             |

## Desenvolvimento

Node 24 (`.nvmrc`) e pnpm 10.

```bash
pnpm install
pnpm start:dev         # API em http://localhost:3000, Swagger em /docs, health em /health
pnpm start:worker:dev  # worker das filas e rotinas (BullMQ), processo separado da API
pnpm lint && pnpm typecheck
pnpm test              # unitários
pnpm test:e2e          # ponta a ponta, com banco real (precisa do docker compose no ar)
```

Os e2e usam o banco `kore_test` no mesmo Postgres do compose (`.env.test`): o
`globalSetup` cria o banco, aplica as migrations e o usuário da API. Os scripts
de teste ligam `--experimental-vm-modules` porque o runtime do Prisma 7 carrega o
query compiler (wasm) por import dinâmico.

## Configuração e banco

As variáveis ficam em `.env` (copie de `.env.example`) e são validadas na subida:
a API não sobe com variável faltando ou inválida.

```bash
cp .env.example .env
pnpm db:setup          # aplica as migrations e cria o usuário local kore_api
pnpm db:migrate:dev    # nova migration (--create-only): revise o SQL antes de aplicar
```

A API conecta como `kore_api`, membro do papel `kore_app` (sujeito à RLS). As
migrations rodam com o dono do schema (`DATABASE_MIGRATION_URL`).

## Adaptadores locais

| Porta (`application/`) | Adaptador local (`infrastructure/`)          | Depois, com a infra |
| ---------------------- | -------------------------------------------- | ------------------- |
| `EmailSender`          | SMTP no Mailpit                              | Amazon SES          |
| `KeyManagement`        | chave mestra local (só `local`/`test`)       | AWS KMS             |
| `FieldCipher`          | envelope AES-256-GCM sobre o `KeyManagement` | —                   |

Observabilidade: OpenTelemetry com exportador de console (`OTEL_EXPORTER=console`)
e logs do `pino` com `traceId`. Só sai o que está na lista fechada
(`src/shared/observability/allowed-attributes.ts`): método, molde da rota, status e
IDs; URL real, query, cabeçalhos, SQL e dado pessoal são descartados.

## Worker e rotinas

As rotinas agendadas e as filas (BullMQ, no mesmo Redis) rodam num processo
separado da API (`src/worker.ts`; na imagem: `node dist/worker`). Cada rotina
tem um agendamento com id fixo, registrado na subida do worker.

| Rotina                           | Quando                    | O que faz                                                 |
| -------------------------------- | ------------------------- | --------------------------------------------------------- |
| `purge-expired-access-ip-logs`   | todo dia, 4h (Brasília)   | apaga o IP real com mais de 6 meses (decisão 116)         |
| `purge-expired-application-logs` | todo dia, 4h30 (Brasília) | apaga o log da aplicação com mais de 5 anos (decisão 137) |

Toda execução de rotina fica registrada no log da aplicação (`access_ip_log.purged`,
`application_log.purged`).

O backoffice e as rotinas usam a conexão `DATABASE_BACKOFFICE_URL`, que assume o
papel `kore_backoffice` (BYPASSRLS). O log da aplicação e o log de IP real são
só inserção para a API: o banco nega leitura, alteração e exclusão a `kore_app`.

## Origens, CORS e CSRF

`ALLOWED_ORIGINS` lista as origens do app (só esquema, host e porta). Elas recebem
os cabeçalhos de CORS com credenciais, e o `OriginGuard` recusa com
`403 ORIGIN_NOT_ALLOWED` toda escrita (POST, PUT, PATCH, DELETE) vinda de outra
origem, ou sem `Origin` quando há cookie de sessão. Clientes fora do navegador
(Bruno, webhooks), sem cookie de sessão, não precisam mandar `Origin`.

## Rate limit

Limite por IP, por minuto, com o contador no Redis (`@nestjs/throttler`): 100
requisições no geral (`RATE_LIMIT_GENERAL_PER_MINUTE`) e 10 nas rotas de auth
marcadas com `@AuthRateLimit()` (`RATE_LIMIT_AUTH_PER_MINUTE`), somadas entre
elas. Acima do limite: `429 TOO_MANY_REQUESTS`. Com o Redis fora, as requisições
passam e o log avisa (decisão 97). Atrás de proxy, `TRUST_PROXY_HOPS` diz quantos
saltos do `X-Forwarded-For` são confiáveis.
