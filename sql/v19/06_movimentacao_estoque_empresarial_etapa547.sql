-- APONTE CIDADAO V19 — ETAPA 547
-- Nova RPC transacional de entradas/saidas EXCLUSIVAMENTE por empresa.
-- Executar SOMENTE no projeto Supabase V19 APOS a etapa 546.
-- Sem alteracao de saldos nesta instalacao; a interface permanece BLOQUEADA
-- para movimentacoes ate incorporar um seletor explicito de empresa.
-- Nunca executar no projeto V18.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.v19_movimentar_estoque_empresa(
  p_material_id uuid,
  p_empresa_id uuid,
  p_tipo text,
  p_quantidade numeric,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $v19$
DECLARE
  v_uid uuid;
  v_nome_usuario text;
  v_perfil text;
  v_consorcio_usuario uuid;
  v_consorcio_material uuid;
  v_empresa uuid;
  v_estoque_id uuid;
  v_saldo numeric;
  v_contratado numeric;
  v_saldo_novo numeric;
  v_contratado_novo numeric;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
  END IF;

  IF p_material_id IS NULL OR p_empresa_id IS NULL
     OR p_tipo IS NULL OR p_tipo NOT IN ('entrada','saida')
     OR p_quantidade IS NULL OR p_quantidade<=0
     OR p_quantidade>9999999999
     OR round(p_quantidade,2)<>p_quantidade THEN
    RAISE EXCEPTION 'MOVIMENTACAO_EMPRESARIAL_INVALIDA' USING ERRCODE='22023';
  END IF;

  -- Somente Master e gestor do proprio consorcio podem fazer ajustes manuais.
  -- A empresa executora movimenta seu saldo por consumo/estorno de chamados,
  -- cujas RPCs dedicadas serao instaladas em fases seguintes.
  SELECT u.id,u.nome,u.perfil,u.consorcio_id
  INTO v_uid,v_nome_usuario,v_perfil,v_consorcio_usuario
  FROM public.usuarios u
  WHERE u.auth_user_id=auth.uid() AND u.status='ativo'
  LIMIT 1;
  IF NOT FOUND OR v_perfil NOT IN ('master','consorcio') THEN
    RAISE EXCEPTION 'PERFIL_SEM_PERMISSAO_DE_ESTOQUE'
      USING ERRCODE='42501';
  END IF;

  -- Ordem de locks consistente com as antigas RPCs: material -> estoque.
  SELECT m.consorcio_id INTO v_consorcio_material
  FROM public.materiais m
  JOIN public.consorcios c ON c.id=m.consorcio_id AND c.status='ativo'
  WHERE m.id=p_material_id AND m.status='ativo'
  FOR UPDATE OF m;
  IF NOT FOUND OR
    (v_perfil='consorcio'
       AND v_consorcio_usuario IS DISTINCT FROM v_consorcio_material) THEN
    RAISE EXCEPTION 'MATERIAL_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;

  -- A empresa solicitada deve pertencer ao consorcio do material.
  SELECT e.id INTO v_empresa
  FROM public.empresas e
  WHERE e.id=p_empresa_id AND e.consorcio_id=v_consorcio_material
    AND e.status='ativo'
  FOR SHARE OF e;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EMPRESA_NAO_AUTORIZADA_OU_INATIVA' USING ERRCODE='42501';
  END IF;

  SELECT s.id,s.quantidade_disponivel,s.quantidade_contratada
  INTO v_estoque_id,v_saldo,v_contratado
  FROM public.estoques s
  WHERE s.material_id=p_material_id
    AND s.consorcio_id=v_consorcio_material
    AND s.empresa_id=v_empresa
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ESTOQUE_DA_EMPRESA_NAO_ENCONTRADO' USING ERRCODE='22023';
  END IF;

  v_saldo_novo := v_saldo +
    CASE WHEN p_tipo='entrada' THEN p_quantidade ELSE -p_quantidade END;
  v_contratado_novo := v_contratado +
    CASE WHEN p_tipo='entrada' THEN p_quantidade ELSE 0 END;

  IF v_saldo_novo<0 THEN
    RAISE EXCEPTION 'SALDO_INSUFICIENTE_DA_EMPRESA' USING ERRCODE='22023';
  END IF;
  IF v_saldo_novo>v_contratado_novo
     OR v_contratado_novo>9999999999 THEN
    RAISE EXCEPTION 'LIMITE_DE_ESTOQUE_EMPRESARIAL_INVALIDO'
      USING ERRCODE='22023';
  END IF;

  UPDATE public.estoques
  SET quantidade_disponivel=v_saldo_novo,
      quantidade_contratada=v_contratado_novo,
      updated_at=clock_timestamp()
  WHERE id=v_estoque_id;

  INSERT INTO public.movimentacoes(
    consorcio_id,empresa_id,estoque_id,material_id,
    tipo,quantidade,usuario_nome,usuario_id,origem,observacao
  ) VALUES (
    v_consorcio_material,v_empresa,v_estoque_id,p_material_id,
    p_tipo,p_quantidade,v_nome_usuario,v_uid,
    'ajuste_manual_empresa',left(btrim(coalesce(p_observacao,'')),500)
  );

  -- Rastreabilidade adicional para a operacao empresarial.
  INSERT INTO public.auditoria(
    consorcio_id,usuario_responsavel,acao,detalhes
  ) VALUES (
    v_consorcio_material,v_nome_usuario,
    'V19_ESTOQUE_EMPRESA_MOVIMENTACAO',
    'empresa_id='||v_empresa||'; estoque_id='||v_estoque_id||
    '; material_id='||p_material_id||'; tipo='||p_tipo||
    '; quantidade='||p_quantidade||
    '; disponivel='||v_saldo||'->'||v_saldo_novo
  );

  RETURN jsonb_build_object(
    'ok',true,
    'empresa_id',v_empresa,
    'estoque_id',v_estoque_id,
    'material_id',p_material_id,
    'tipo',p_tipo,
    'quantidade',p_quantidade,
    'saldo_anterior',v_saldo,
    'novo_saldo',v_saldo_novo,
    'contratado',v_contratado_novo
  );
END;
$v19$;

-- RPC chamada apenas por usuarios autenticados; RLS e escopo revalidados
-- internamente com usuario ativo e vinculo empresarial.
REVOKE ALL ON FUNCTION public.v19_movimentar_estoque_empresa(
  uuid,uuid,text,numeric,text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.v19_movimentar_estoque_empresa(
  uuid,uuid,text,numeric,text
) TO authenticated;

COMMENT ON FUNCTION public.v19_movimentar_estoque_empresa(
  uuid,uuid,text,numeric,text
) IS 'V19 Etapa 547: entrada/saida por empresa; verifica ator ativo, consorcio, empresa e saldo com lock transacional.';

COMMIT;

-- Conferencia sem movimentar quantidades:
SELECT
  p.oid::regprocedure::text AS funcao,
  p.prosecdef AS security_definer,
  has_function_privilege('authenticated',p.oid,'EXECUTE')
    AS authenticated_pode_executar,
  has_function_privilege('anon',p.oid,'EXECUTE')
    AS anon_pode_executar,
  (SELECT COUNT(*) FROM public.estoques) AS estoques,
  (SELECT COUNT(*) FROM public.estoques
     WHERE empresa_id IS NULL) AS estoques_sem_empresa,
  (SELECT COUNT(*) FROM public.movimentacoes) AS movimentos
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname='v19_movimentar_estoque_empresa';
