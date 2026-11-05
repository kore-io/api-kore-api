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
pnpm start:dev         # API em http://localhost:3000, Swagger em /docs
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
