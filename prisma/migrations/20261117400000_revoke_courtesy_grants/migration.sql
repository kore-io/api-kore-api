-- DoD das F4 e F5 (decisão 246): a Cortesia saiu (Publicar e pagar RN17), e
-- com ela o motivo do GRANT UPDATE do kore_app nas colunas da publicação
-- (20261113000000_f4_f5_model). Hoje só o backoffice (o pagamento, o expurgo)
-- e a função set_wedding_end_date (dona kore_rls) as gravam: a API não publica
-- por fora do pagamento, nem muda a data de saída sem a função.
REVOKE UPDATE ("end_date", "publication_source", "published_by_user_id") ON "weddings" FROM kore_app;
