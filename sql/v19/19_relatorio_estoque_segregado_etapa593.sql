-- APONTE CIDADAO V19 — ETAPA 593
-- Fonte confiavel para Relatorios/PDF/Excel de estoque: 1 linha por
-- material + EMPRESA + estoque de origem. Sem saldos compartilhados.
-- Somente LEITURA. Master: todas; Consorcio: apenas seu consorcio;
-- Empresa: apenas a propria empresa.
-- Os movimentos antigos sem estoque_id/empresa_id NAO sao atribuidos
-- artificialmente a nenhuma empresa. Indices de movimentos referem-se
-- somente aos movimentos identificados para este estoque empresarial.
-- NENHUM DADO DE ESTOQUE E MODIFICADO.
-- Executar SOMENTE no Supabase V19 xurrhczvyqpwyjemight, NUNCA V18.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

-- Exigir fonte de estoque empresarial existente e protegida.
DO $guard$
BEGIN
  IF to_regprocedure('public.v19_listar_estoques_por_empresa(uuid)') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid=to_regprocedure(
        'public.v19_listar_estoques_por_empresa(uuid)')
        AND p.prosecdef
    )
  THEN
    RAISE EXCEPTION 'ETAPA_593_BLOQUEADA: fonte empresarial nao homologada';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.v19_relatorio_estoque_empresarial(
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
  movimentos_identificados bigint,
  saidas_identificadas numeric,
  devolucoes_identificadas numeric,
  saidas_liquidas_identificadas numeric
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
  IF auth.uid() IS NULL
     OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
  END IF;

  -- As tres funcoes abaixo usam usuarios.status='ativo'.
  v_perfil:=public.v19_perfil_atual();
  v_consorcio:=public.v19_consorcio_atual();
  v_empresa:=public.v19_empresa_atual();
  IF v_perfil IS NULL
     OR v_perfil NOT IN ('master','consorcio','empresa') THEN
    RAISE EXCEPTION 'PERFIL_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;
  IF (v_perfil='consorcio' AND v_consorcio IS NULL)
     OR (v_perfil='empresa'
         AND (v_consorcio IS NULL OR v_empresa IS NULL)) THEN
    RAISE EXCEPTION 'VINCULO_INVALIDO' USING ERRCODE='42501';
  END IF;
  IF p_consorcio_id IS NOT NULL AND v_perfil<>'master'
     AND p_consorcio_id IS DISTINCT FROM v_consorcio THEN
    RAISE EXCEPTION 'CONSORCIO_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  SELECT
    s.material_id,s.material_nome,s.unidade,s.consorcio_id,
    s.empresa_id,s.empresa_nome,s.estoque_id,
    s.quantidade_contratada,s.quantidade_disponivel,
    s.estoque_minimo,s.preco_unitario,
    COALESCE(mv.movimentos,0)::bigint,
    COALESCE(mv.saidas,0)::numeric,
    COALESCE(mv.devolucoes,0)::numeric,
    (COALESCE(mv.saidas,0)-COALESCE(mv.devolucoes,0))::numeric
  FROM public.v19_listar_estoques_por_empresa(p_consorcio_id) s
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::bigint AS movimentos,
      COALESCE(SUM(
        CASE WHEN h.tipo IN ('saida','consumo')
          THEN h.quantidade ELSE 0 END
      ),0)::numeric AS saidas,
      COALESCE(SUM(
        CASE WHEN h.tipo IN ('devolucao','estorno')
          THEN h.quantidade ELSE 0 END
      ),0)::numeric AS devolucoes
    FROM public.movimentacoes h
    WHERE h.estoque_id=s.estoque_id
      AND h.empresa_id=s.empresa_id
      AND h.material_id=s.material_id
      AND h.consorcio_id=s.consorcio_id
  ) mv ON TRUE
  WHERE s.estoque_id IS NOT NULL
    AND s.empresa_id IS NOT NULL
    AND s.saldo_legado IS FALSE
    AND (
      v_perfil='master'
      OR (v_perfil='consorcio'
          AND s.consorcio_id=v_consorcio)
      OR (v_perfil='empresa'
          AND s.consorcio_id=v_consorcio
          AND s.empresa_id=v_empresa)
    )
  ORDER BY s.empresa_nome,s.material_nome,s.estoque_id;
END
$v19$;

REVOKE ALL ON FUNCTION public.v19_relatorio_estoque_empresarial(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v19_relatorio_estoque_empresarial(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.v19_relatorio_estoque_empresarial(uuid) IS
 'V19 Etapa 593: relatorio por estoque_id e empresa_id, sem misturar estoque; movimentos identificados excluem historico legado sem vinculo. Apenas leitura.';

COMMIT;

-- O SQL Editor roda como postgres; NAO simular o perfil usando SQL Editor.
-- Validar a consulta com a sessao autenticada real na interface, apos
-- integrar o frontend na proxima etapa.
SELECT
  p.oid::regprocedure::text AS funcao,
  p.prosecdef AS security_definer,
  has_function_privilege('authenticated',p.oid,'EXECUTE')
    AS autenticado_pode_executar,
  has_function_privilege('anon',p.oid,'EXECUTE')
    AS anon_pode_executar,
  (SELECT COUNT(*) FROM public.estoques
    WHERE empresa_id IS NOT NULL) AS estoques_empresariais,
  (SELECT COUNT(*) FROM public.movimentacoes) AS movimentos_preservados
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname='v19_relatorio_estoque_empresarial';
