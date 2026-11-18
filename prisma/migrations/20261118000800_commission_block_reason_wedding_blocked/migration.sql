-- Decisão 282(3): no bloqueio do casamento, as comissões em aberto dele ficam
-- Bloqueadas com o motivo próprio, no padrão da RN04 de Comissões; quem libera
-- é o Desbloquear comissão do Admin.
ALTER TYPE "commission_block_reason" ADD VALUE 'wedding_blocked';
