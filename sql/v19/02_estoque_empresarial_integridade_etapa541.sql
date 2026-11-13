-- APONTE CIDADAO V19 — ETAPA 541
-- Fase preparatoria de integridade referencial, SOMENTE Supabase V19.
-- Requisitos: executar apos sql/v19/01_estoque_empresarial_fase_a.sql.
--
-- SEGURO: nao altera linhas/saldos, nao muda RPCs, RLS, nem exclui
-- restricao antiga estoques_material_id_consorcio_id_key. Logo, a separacao
-- empresarial AINDA NAO ESTA ATIVA e nao e permitido criar novos estoques
-- por empresa ate a migracao transacional de corte das RPCs.
--
-- As 2 linhas legadas permanecem empresa_id NULL; 35 contratadas,
-- 19 disponiveis; as 11 movimentacoes permanecem legadas.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Permite exigir que a empresa de um saldo pertença ao consorcio do material.
-- (id) ja e chave primaria de empresas; (id,consorcio_id) tambem e unico.
CREATE UNIQUE INDEX IF NOT EXISTS v19_empresas_id_consorcio_uniq
  ON public.empresas(id, consorcio_id);

-- Identidade material/saldo usada por movimentos e itens de consumo.
CREATE UNIQUE INDEX IF NOT EXISTS v19_estoques_id_material_uniq
  ON public.estoques(id, material_id);

-- Impede duas linhas empresariais do mesmo material para a mesma empresa.
-- Nao remove a UNIQUE antiga, que continua impedindo criacao prematura
-- de varias linhas de mesmo material no mesmo consorcio.
CREATE UNIQUE INDEX IF NOT EXISTS v19_estoques_material_empresa_uniq
  ON public.estoques(material_id, empresa_id)
  WHERE empresa_id IS NOT NULL;

-- Mantem unicidade de saldo legado por material e consorcio mesmo depois
-- da futura remocao da UNIQUE antiga.
CREATE UNIQUE INDEX IF NOT EXISTS v19_estoques_legado_material_consorcio_uniq
  ON public.estoques(material_id, consorcio_id)
  WHERE empresa_id IS NULL;

-- FKs complementares para impedir vinculacao cruzada de empresa/consorcio
-- e de material/saldo. NULL legado e aceito sem atribuicao artificial.
DO $v19$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.estoques'::regclass
      AND conname='v19_estoques_empresa_consorcio_fk'
  ) THEN
    ALTER TABLE public.estoques
      ADD CONSTRAINT v19_estoques_empresa_consorcio_fk
      FOREIGN KEY (empresa_id, consorcio_id)
      REFERENCES public.empresas(id, consorcio_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.movimentacoes'::regclass
      AND conname='v19_movimentacoes_empresa_consorcio_fk'
  ) THEN
    ALTER TABLE public.movimentacoes
      ADD CONSTRAINT v19_movimentacoes_empresa_consorcio_fk
      FOREIGN KEY (empresa_id, consorcio_id)
      REFERENCES public.empresas(id, consorcio_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.movimentacoes'::regclass
      AND conname='v19_movimentacoes_estoque_material_fk'
  ) THEN
    ALTER TABLE public.movimentacoes
      ADD CONSTRAINT v19_movimentacoes_estoque_material_fk
      FOREIGN KEY (estoque_id, material_id)
      REFERENCES public.estoques(id, material_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.chamado_materiais'::regclass
      AND conname='v19_chamado_materiais_estoque_material_fk'
  ) THEN
    ALTER TABLE public.chamado_materiais
      ADD CONSTRAINT v19_chamado_materiais_estoque_material_fk
      FOREIGN KEY (estoque_id, material_id)
      REFERENCES public.estoques(id, material_id);
  END IF;
END
$v19$;

COMMIT;

-- Apos a transacao, todos os numeros devem permanecer iguais.
SELECT
  COUNT(*) AS registros_estoque,
  COUNT(*) FILTER (WHERE empresa_id IS NULL) AS registros_legados,
  COUNT(*) FILTER (WHERE empresa_id IS NOT NULL) AS registros_empresariais,
  COALESCE(SUM(quantidade_contratada),0) AS contratadas,
  COALESCE(SUM(quantidade_disponivel),0) AS disponiveis
FROM public.estoques;

SELECT
  COUNT(*) AS movimentacoes,
  COUNT(*) FILTER (WHERE empresa_id IS NULL) AS movimentacoes_legadas,
  COUNT(*) FILTER (WHERE empresa_id IS NOT NULL) AS movimentacoes_empresariais
FROM public.movimentacoes;
