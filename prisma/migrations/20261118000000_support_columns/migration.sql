-- Defesa em profundidade da decisão 69 no papel kore_support (Ver como o
-- casal, Backoffice - acesso RN02 e RN08; revisão do Crivo no PR 11c). A
-- aplicação já filtra como a colaboradora; aqui o banco também garante.

-- (1) payments: só as colunas do ciclo, sem os valores, o gateway, o pagador
-- e os detalhes do estorno (o suporte nunca vê o payer_tax_id_last4, RN09).
REVOKE SELECT ON "payments" FROM kore_support;
GRANT SELECT ("id", "created_at", "updated_at", "short_code", "wedding_id", "kind", "status",
              "method", "installments", "price_version", "period_start", "period_end",
              "months_covered", "due_at", "paid_at", "applied_at", "canceled_at",
              "previous_end_date", "previous_paid_through", "refund_requested_at",
              "refunded_at", "disputed_at", "dispute_deadline", "dispute_resolved_at")
  ON "payments" TO kore_support;

-- (2) users: só o que a lista de quem tem acesso mostra, sem o papel na
-- plataforma, o status, os termos e as datas de acesso.
REVOKE SELECT ON "users" FROM kore_support;
GRANT SELECT ("id", "name", "email", "avatar_key") ON "users" TO kore_support;

-- (3) referrers: só os indicadores que ainda são membros do casamento da
-- sessão (antes, contava também os removidos).
DROP POLICY "referrers_support_select" ON "referrers";
CREATE POLICY "referrers_support_select" ON "referrers" FOR SELECT TO kore_support
  USING ("user_id" IN (SELECT m."user_id" FROM "memberships" m
                       WHERE m."wedding_id" = current_wedding_id()
                         AND m."removed_at" IS NULL));

-- (4) O fim da sessão de suporte pelo papel revogado tem motivo próprio (era
-- o mesmo `exit` do Sair), para a auditoria.
ALTER TYPE "support_session_end_reason" ADD VALUE IF NOT EXISTS 'role_revoked';
