-- APONTE CIDADAO V19 — ETAPA 558: CORRECAO DE TITULARIDADE DO ESTOQUE
-- REGRA DE NEGOCIO CONFIRMADA: cada empresa cadastra, movimenta, consome
-- e administra EXCLUSIVAMENTE seus proprios materiais e saldos.
-- Master e Consorcio CONSULTAM, mas NAO alteram os estoques.
-- Esta etapa habilita a entrada/saida MANUAL pela empresa no backend.
-- Cadastro de NOVOS MATERIAIS por empresa e consumo/estorno na tela
-- serao integrados em etapas seguintes.
-- EXECUTAR APENAS NA V19: xurrhczvyqpwyjemight; V18 INTOCADA.
--
-- Guarda: a funcao de consulta e os saldos ja devem existir da etapa 556.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $v19$
BEGIN
  IF to_regprocedure('public.v19_movimentar_estoque_empresa(uuid,uuid,text,numeric,text)') IS NULL
     OR to_regprocedure('public.v19_listar_estoques_por_empresa(uuid)') IS NULL
     OR (SELECT COUNT(*) FROM public.estoques WHERE empresa_id IS NULL)<>0
  THEN
    RAISE EXCEPTION 'ETAPA_558_BLOQUEADA: migracoes empresariais previas ausentes';
  END IF;
END
$v19$;

-- Nenhuma destas tabelas pode ser modificada diretamente por cliente.
-- RPCs SECURITY DEFINER revalidam vinculo e executam como proprietario.
-- SELECT com escopo RLS continua preservado.
REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.materiais,public.estoques,public.movimentacoes,
  public.chamado_materiais
FROM PUBLIC, anon, authenticated;

-- Funcoes empresariais de consumo e estorno ainda sem tela homologada.
-- Suspensas ate endurecimento de permissao para empresa dona do estoque.
REVOKE EXECUTE ON FUNCTION
  public.v19_consumir_material_chamado_empresa(uuid,uuid,numeric),
  public.v19_editar_material_chamado_empresa(uuid,numeric),
  public.v19_remover_material_chamado_empresa(uuid)
FROM PUBLIC, anon, authenticated;

-- A unica RPC de movimentacao agora valida o proprio empresa_id do JWT.
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
  v_empresa_usuario uuid;
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

  -- Unica gestora do estoque: EMPRESA proprietaria do saldo.
  -- Master e Consorcio apenas consultam; nem mesmo a escolha de
  -- p_empresa_id pelo cliente pode ampliar o acesso.
  SELECT u.id,u.nome,u.perfil,u.consorcio_id,u.empresa_id
  INTO v_uid,v_nome_usuario,v_perfil,v_consorcio_usuario,v_empresa_usuario
  FROM public.usuarios u
  WHERE u.auth_user_id=auth.uid() AND u.status='ativo'
  LIMIT 1;
  IF NOT FOUND OR v_perfil IS DISTINCT FROM 'empresa'
     OR v_consorcio_usuario IS NULL OR v_empresa_usuario IS NULL THEN
    RAISE EXCEPTION 'ESTOQUE_GERENCIADO_EXCLUSIVAMENTE_PELA_EMPRESA'
      USING ERRCODE='42501';
  END IF;
  IF p_empresa_id IS DISTINCT FROM v_empresa_usuario THEN
    RAISE EXCEPTION 'EMPRESA_DO_ESTOQUE_NAO_PERTENCE_A_CONTA'
      USING ERRCODE='42501';
  END IF;

  -- Ordem de locks consistente com as antigas RPCs: material -> estoque.
  SELECT m.consorcio_id INTO v_consorcio_material
  FROM public.materiais m
  JOIN public.consorcios c ON c.id=m.consorcio_id AND c.status='ativo'
  WHERE m.id=p_material_id AND m.status='ativo'
  FOR UPDATE OF m;
  IF NOT FOUND OR
     v_consorcio_usuario IS DISTINCT FROM v_consorcio_material THEN
    RAISE EXCEPTION 'MATERIAL_FORA_DO_CONSORCIO_DA_EMPRESA'
      USING ERRCODE='42501';
  END IF;

  -- A empresa da conta deve estar ativa e no consorcio do material.
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
    'movimentacao_pela_empresa',left(btrim(coalesce(p_observacao,'')),500)
  );

  -- Rastreabilidade adicional para a operacao empresarial.
  INSERT INTO public.auditoria(
    consorcio_id,usuario_responsavel,acao,detalhes
  ) VALUES (
    v_consorcio_material,v_nome_usuario,
    'V19_ESTOQUE_EMPRESA_MOVIMENTACAO_PROPRIA',
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

REVOKE ALL ON FUNCTION public.v19_movimentar_estoque_empresa(
  uuid,uuid,text,numeric,text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.v19_movimentar_estoque_empresa(
  uuid,uuid,text,numeric,text
) TO authenticated;
COMMENT ON FUNCTION public.v19_movimentar_estoque_empresa(
  uuid,uuid,text,numeric,text
) IS 'V19 558: somente empresa ativa gerencia seu proprio estoque; Master/Consorcio apenas leem.';

COMMIT;

-- Instalacao nao altera saldos nem registra movimentos.
-- Resultado esperado neste ponto: 4 estoques, 0 sem empresa, 13 movimentos.
SELECT
  (SELECT COUNT(*) FROM public.estoques) AS estoques,
  (SELECT COUNT(*) FROM public.estoques WHERE empresa_id IS NULL) AS sem_empresa,
  (SELECT COUNT(*) FROM public.movimentacoes) AS movimentos,
  has_function_privilege('authenticated',
    'public.v19_movimentar_estoque_empresa(uuid,uuid,text,numeric,text)'::regprocedure,
    'EXECUTE') AS autenticado_pode_invocar_rpc,
  has_function_privilege('anon',
    'public.v19_movimentar_estoque_empresa(uuid,uuid,text,numeric,text)'::regprocedure,
    'EXECUTE') AS anon_pode_invocar_rpc,
  has_table_privilege('authenticated','public.estoques','UPDATE')
    AS autenticado_pode_atualizar_tabela_diretamente;
