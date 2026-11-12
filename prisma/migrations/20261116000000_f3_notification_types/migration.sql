-- Os tipos novos da central na F3 (Publicar e pagar RN13; Comissões RN09;
-- Backoffice - acesso RN07). Numa migration própria: o valor novo de um enum só
-- pode ser usado depois do commit, e a migration seguinte cria policies com ele.
ALTER TYPE "notification_type" ADD VALUE 'billing';
ALTER TYPE "notification_type" ADD VALUE 'commission';
ALTER TYPE "notification_type" ADD VALUE 'referrer_reassigned';
