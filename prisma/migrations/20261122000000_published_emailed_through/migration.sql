-- Notificações da cerimonialista RN07 (DoD da F6, decisão 308(5)): o aviso
-- "Site publicado" do Resumo diário ganha um cursor próprio. Com um cursor só,
-- o e-mail na hora de uma resposta posterior passava por cima da publicação
-- e o Resumo a descartava.
ALTER TABLE "notification_email_states" ADD COLUMN "published_emailed_through" TIMESTAMPTZ(3);

-- O que já saiu pelo cursor comum conta como mandado (nada sai de novo).
UPDATE "notification_email_states" SET "published_emailed_through" = "emailed_through";
