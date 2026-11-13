-- Aponte Cidadao V19 — ETAPA 542
-- Interface de CONSULTA segregada para estoques por empresa.
-- Executar somente no Supabase V19, APOS as etapas 538 e 541.
-- Preparacao: nao cria saldos, nao altera quantidades nem RLS existentes.
-- Regra definitiva: so existe estoque operacional POR EMPRESA.
-- Um material sem linha de estoque empresarial aparece com saldo ZERO.
-- Saldos antigos nao atribuidos NAO sao exibidos nesta consulta: ficam
-- preservados em sua tabela de origem ate conciliacao supervisionada.
-- MASTER e CONSORCIO podem ver empresas autorizadas, NAO o saldo antigo.
-- EMPRESA so consulta o seu proprio estoque.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.v19_listar_estoques_por_empresa(
    p_consorcio_id uuid DEFAULT NULL
)
RETURNS TABLE (
    material_id uuid,
    material_nome text,
    unidade text,
    consorcio_id uuid,
    empresa_id uuid,
    empresa_nome text,
    estoque_id uuid,
    quantidade_contratada numeric,
    quantidade_disponivel numeric,
    estoque_minimo numeric,
    preco_unitario numeric,
    saldo_legado boolean -- compatibilidade temporaria: sempre FALSE; nao cria terceiro estoque
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $v19$
DECLARE
  v_perfil text;
  v_consorcio uuid;
  v_empresa uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
  END IF;

  -- A origem destas funcoes e a tabela de usuarios com status='ativo'.
  v_perfil := public.v19_perfil_atual();
  v_consorcio := public.v19_consorcio_atual();
  v_empresa := public.v19_empresa_atual();

  IF v_perfil IS NULL OR v_perfil NOT IN ('master','consorcio','empresa') THEN
    RAISE EXCEPTION 'PERFIL_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;
  IF (v_perfil='consorcio' AND v_consorcio IS NULL)
     OR (v_perfil='empresa' AND (v_consorcio IS NULL OR v_empresa IS NULL)) THEN
    RAISE EXCEPTION 'VINCULO_INVALIDO' USING ERRCODE='42501';
  END IF;

  -- Apenas o proprio consorcio, exceto Master.
  IF p_consorcio_id IS NOT NULL AND v_perfil<>'master'
     AND p_consorcio_id IS DISTINCT FROM v_consorcio THEN
    RAISE EXCEPTION 'CONSORCIO_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
    -- Uma linha por material + empresa; se nao ha saldo especifico, retorna ZERO.
    -- A coluna saldo_legado e temporaria e sempre FALSE, para manter assinatura.
    SELECT
      m.id, m.nome::text, m.unidade::text, m.consorcio_id,
      emp.id, emp.nome::text,
      s.id,
      COALESCE(s.quantidade_contratada,0)::numeric,
      COALESCE(s.quantidade_disponivel,0)::numeric,
      m.estoque_minimo, m.preco_unitario, false
    FROM public.materiais m
    JOIN public.empresas emp
      ON emp.consorcio_id=m.consorcio_id AND emp.status='ativo'
    LEFT JOIN public.estoques s
      ON s.material_id=m.id
      AND s.consorcio_id=m.consorcio_id
      AND s.empresa_id=emp.id
    WHERE m.status='ativo'
      AND (p_consorcio_id IS NULL OR m.consorcio_id=p_consorcio_id)
      AND (
        v_perfil='master'
        OR (v_perfil='consorcio' AND m.consorcio_id=v_consorcio)
        OR (v_perfil='empresa'
            AND m.consorcio_id=v_consorcio AND emp.id=v_empresa)
      )
;
END
$v19$;

REVOKE ALL ON FUNCTION public.v19_listar_estoques_por_empresa(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.v19_listar_estoques_por_empresa(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.v19_listar_estoques_por_empresa(uuid)
  TO authenticated;
COMMENT ON FUNCTION public.v19_listar_estoques_por_empresa(uuid) IS
  'V19 Etapa 542: consulta somente de estoques empresariais; historico nao atribuido preservado e nao exibido; ainda sem movimentacoes empresariais.';

COMMIT;

-- Confirma apenas a criacao. Nao usar esta consulta para simular um usuario,
-- pois o SQL Editor executa como postgres e nao como authenticated.
SELECT
    p.proname AS funcao,
    p.prosecdef AS security_definer,
    has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_pode_executar,
    has_function_privilege('anon',p.oid,'EXECUTE') AS anon_pode_executar
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname='v19_listar_estoques_por_empresa';
