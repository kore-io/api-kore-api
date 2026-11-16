-- referrers no kore_support: só os indicadores que ainda são membros do casamento da
-- sessão, e só o tipo de perfil. A referrers_public_select (do kore_app, para
-- o link de indicação) vale para todos os papéis com USING (true) e somava
-- com a policy do suporte: o kore_support lia todos os indicadores, com o CPF
-- cifrado e o hash. Agora uma policy RESTRICTIVE recorta o kore_support (entra
-- em AND com as outras), sem mexer no kore_app, e o grant é por coluna.
CREATE POLICY "referrers_support_scope" ON "referrers" AS RESTRICTIVE FOR SELECT TO kore_support
  USING ("user_id" IN (SELECT m."user_id" FROM "memberships" m
                       WHERE m."wedding_id" = current_wedding_id()
                         AND m."removed_at" IS NULL));
REVOKE SELECT ON "referrers" FROM kore_support;
GRANT SELECT ("id", "user_id", "kind", "status") ON "referrers" TO kore_support;
