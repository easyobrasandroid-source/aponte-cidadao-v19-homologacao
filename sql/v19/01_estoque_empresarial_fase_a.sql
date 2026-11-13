-- APONTE CIDADAO V19 - FASE A / ETAPA 538
-- Somente estrutura. Executar EXCLUSIVAMENTE no Supabase V19 de homologacao.
--
-- NAO distribui saldos legados; NAO cria saldos empresariais; NAO muda RLS,
-- restricoes UNIQUE anteriores, RPCs, permissao de escrita nem aplicativo.
-- Os 2 saldos existentes seguem com empresa_id = NULL ate conciliacao.
-- Fase B deve atualizar RPCs, policies e interface antes de uso empresarial.
--
-- Executar como um script unico no SQL Editor, em uma unica transacao.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.estoques
  ADD COLUMN IF NOT EXISTS empresa_id uuid;

ALTER TABLE public.movimentacoes
  ADD COLUMN IF NOT EXISTS empresa_id uuid;
ALTER TABLE public.movimentacoes
  ADD COLUMN IF NOT EXISTS estoque_id uuid;

ALTER TABLE public.chamado_materiais
  ADD COLUMN IF NOT EXISTS estoque_id uuid;

-- FKs garantem rastreabilidade e evitam exclusao de um saldo referenciado.
-- Nulos existentes continuam validos (historico legado sem atribuicao).
DO $v19$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.estoques'::regclass
      AND conname = 'v19_estoques_empresa_fk'
  ) THEN
    ALTER TABLE public.estoques
      ADD CONSTRAINT v19_estoques_empresa_fk
      FOREIGN KEY (empresa_id) REFERENCES public.empresas(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.movimentacoes'::regclass
      AND conname = 'v19_movimentacoes_empresa_fk'
  ) THEN
    ALTER TABLE public.movimentacoes
      ADD CONSTRAINT v19_movimentacoes_empresa_fk
      FOREIGN KEY (empresa_id) REFERENCES public.empresas(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.movimentacoes'::regclass
      AND conname = 'v19_movimentacoes_estoque_fk'
  ) THEN
    ALTER TABLE public.movimentacoes
      ADD CONSTRAINT v19_movimentacoes_estoque_fk
      FOREIGN KEY (estoque_id) REFERENCES public.estoques(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.chamado_materiais'::regclass
      AND conname = 'v19_chamado_materiais_estoque_fk'
  ) THEN
    ALTER TABLE public.chamado_materiais
      ADD CONSTRAINT v19_chamado_materiais_estoque_fk
      FOREIGN KEY (estoque_id) REFERENCES public.estoques(id);
  END IF;
END
$v19$;

CREATE INDEX IF NOT EXISTS v19_estoques_empresa_material_idx
  ON public.estoques(empresa_id, material_id)
  WHERE empresa_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS v19_movimentacoes_empresa_data_idx
  ON public.movimentacoes(empresa_id, created_at DESC)
  WHERE empresa_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS v19_movimentacoes_estoque_data_idx
  ON public.movimentacoes(estoque_id, created_at DESC)
  WHERE estoque_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS v19_chamado_materiais_estoque_idx
  ON public.chamado_materiais(estoque_id)
  WHERE estoque_id IS NOT NULL;

COMMENT ON COLUMN public.estoques.empresa_id IS
  'V19: proprietaria do saldo; NULL significa saldo legado sem atribuicao.';
COMMENT ON COLUMN public.movimentacoes.empresa_id IS
  'V19: empresa proprietaria da movimentacao; NULL em registros legados.';
COMMENT ON COLUMN public.movimentacoes.estoque_id IS
  'V19: saldo especifico de origem/destino; NULL em registros legados.';
COMMENT ON COLUMN public.chamado_materiais.estoque_id IS
  'V19: saldo do qual o item foi consumido, preservado para edicao/estorno.';

COMMIT;

-- Verificacao pos-migracao: nenhuma quantidade deve mudar.
SELECT
  COUNT(*) AS registros_estoque,
  COUNT(*) FILTER (WHERE empresa_id IS NULL) AS registros_legados,
  COUNT(*) FILTER (WHERE empresa_id IS NOT NULL) AS estoques_empresariais,
  COALESCE(SUM(quantidade_contratada), 0) AS quantidade_contratada,
  COALESCE(SUM(quantidade_disponivel), 0) AS quantidade_disponivel
FROM public.estoques;

SELECT
  COUNT(*) AS movimentacoes,
  COUNT(*) FILTER (WHERE empresa_id IS NULL) AS movimentos_legados,
  COUNT(*) FILTER (WHERE empresa_id IS NOT NULL) AS movimentos_empresariais
FROM public.movimentacoes;
