-- O funil do Simule o site (Simule RN11; decisão 205, D26): os nomes da fase
-- (decisão 138), sem casamento, sem props e sem o IP.
ALTER TYPE "product_event_name" ADD VALUE 'simule_iniciado';
ALTER TYPE "product_event_name" ADD VALUE 'simule_nomes';
ALTER TYPE "product_event_name" ADD VALUE 'simule_pronto';
ALTER TYPE "product_event_name" ADD VALUE 'simule_outra_cor_aberta';
ALTER TYPE "product_event_name" ADD VALUE 'simule_outra_cor_desistiu';
