-- O token do convite de acesso não fica no pedido de login (RN03 de Convites:
-- só o hash do token é guardado; decisão 142). Apaga o que já foi gravado e
-- trava novas gravações.
UPDATE "login_challenges" SET "origin_ref" = NULL WHERE "origin" = 'invite';

ALTER TABLE "login_challenges" ADD CONSTRAINT "chk_login_challenges_invite_without_ref"
  CHECK ("origin" <> 'invite' OR "origin_ref" IS NULL);
