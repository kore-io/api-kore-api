-- Os tipos novos da central da cerimonialista (Notificações da cerimonialista
-- RN01, RN03 e RN04). Numa migration própria: o valor novo de um enum só pode
-- ser usado depois do commit, e a migration seguinte cria um índice com ele.
ALTER TYPE "notification_type" ADD VALUE 'wedding_published';
ALTER TYPE "notification_type" ADD VALUE 'membership_removed';
