-- Decisão 272 (Ver como o casal, Backoffice - acesso RN02 e RN08): o
-- kore_support lia id, nome, e-mail e foto de TODOS os usuários (a users não
-- tinha RLS). Agora ele só lê quem tem ou teve vínculo com o casamento da
-- sessão; os outros papéis leem e gravam como antes.

-- (1) RLS na users com uma policy aberta para todos os papéis: o kore_app e
-- os demais seguem como estavam (sem RLS, era o mesmo que USING true), e o
-- dono da tabela (kore, sem FORCE) e o kore_backoffice (BYPASSRLS) não passam
-- pela RLS.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_open" ON "users" FOR ALL USING (true) WITH CHECK (true);

-- (2) O recorte do suporte, RESTRICTIVE (entra em AND com a aberta): os
-- membros do casamento da sessão, inclusive os removidos, porque o histórico
-- das respostas mostra quem alterou. A memberships já está recortada ao
-- casamento da sessão pela memberships_support_select.
CREATE POLICY "users_support_scope" ON "users" AS RESTRICTIVE FOR SELECT TO kore_support
  USING ("id" IN (SELECT m."user_id" FROM "memberships" m
                  WHERE m."wedding_id" = current_wedding_id()));

-- (3) Do pagamento, o suporte vê a Cobrança como a colaboradora: só status e
-- datas (decisão 272(2)); a forma e as parcelas saem do grant.
REVOKE SELECT ("method", "installments") ON "payments" FROM kore_support;
