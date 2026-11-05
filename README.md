# api-kore-api

API do Kore (NestJS, Prisma, PostgreSQL). Documentação no vault `docs-kore-hub`.

## Ambiente local

Requer Docker com Docker Compose.

```bash
docker compose up -d   # Postgres 5433, Redis 6380, MinIO 9000/9001, Mailpit 1025/8025
docker compose down    # para os serviços (os volumes kore-* ficam)
```

| Serviço  | Host                              | Credenciais locais        |
| -------- | --------------------------------- | ------------------------- |
| Postgres | `localhost:5433`                  | `kore` / `kore`, banco `kore` |
| Redis    | `localhost:6380`                  | —                         |
| MinIO    | API `localhost:9000`, console `localhost:9001` | `kore` / `kore-minio-local` |
| Mailpit  | SMTP `localhost:1025`, web `localhost:8025` | —              |
