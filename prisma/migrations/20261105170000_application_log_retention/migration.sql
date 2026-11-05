-- Retenção de 5 anos do log da aplicação (decisão 137): só a rotina, pelo
-- papel kore_backoffice, apaga o que passou do prazo. A API segue só inserindo.
GRANT DELETE ON "application_logs" TO kore_backoffice;
