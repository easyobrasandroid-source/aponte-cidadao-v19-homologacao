-- APONTE CIDADAO V19 — ETAPA 575
-- Preparacao backend para baixa real de material por chamado.
-- SOMENTE a empresa vinculada ao chamado e dona do estoque pode consumir.
-- Master e Consorcio: apenas consulta. Edicao/estorno: ainda REVOGADOS.
-- A interface continua em modo SIMULACAO ate a proxima etapa.
-- NENHUM saldo, consumo ou movimento e alterado por esta instalacao.
-- Aplicar SOMENTE no Supabase de HOMOLOGACAO V19:
--   xurrhczvyqpwyjemight
-- NUNCA aplicar na V18 de producao.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Impedir habilitacao se o estado da homologacao nao for o esperado
-- ou se uma funcao de consumo diferente estiver instalada.
DO $guard$
DECLARE
  v_def text;
BEGIN
  IF (SELECT COUNT(*) FROM public.estoques) <> 6
     OR (SELECT COUNT(*) FROM public.estoques WHERE empresa_id IS NULL) <> 0
     OR (SELECT COUNT(*) FROM public.movimentacoes) <> 15
     OR (SELECT COUNT(*) FROM public.chamado_materiais) <> 0
  THEN
    RAISE EXCEPTION 'ETAPA_575_BLOQUEADA: estado dos testes mudou. Nao executar ate revisar';
  END IF;

  SELECT pg_get_functiondef(p.oid)
  INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname='v19_consumir_material_chamado_empresa'
    AND p.oid = to_regprocedure(
      'public.v19_consumir_material_chamado_empresa(uuid,uuid,numeric)'
    )
    AND p.prosecdef
    AND p.proconfig @> ARRAY['search_path='];
  IF NOT FOUND OR v_def IS NULL
     OR position('v_perfil IS DISTINCT FROM ''empresa''' in v_def)=0
     OR position('v_empresa_usuario IS DISTINCT FROM v_empresa_chamado' in v_def)=0
     OR position('m.empresa_id IS NULL OR m.empresa_id=v_empresa_chamado' in v_def)=0
     OR position('s.empresa_id=v_empresa_chamado' in v_def)=0
     OR position('FOR UPDATE' in v_def)=0
  THEN
    RAISE EXCEPTION 'ETAPA_575_BLOQUEADA: funcao de consumo divergente do codigo aprovado';
  END IF;

  IF to_regprocedure('public.v19_editar_material_chamado_empresa(uuid,numeric)') IS NULL
     OR to_regprocedure('public.v19_remover_material_chamado_empresa(uuid)') IS NULL
  THEN
    RAISE EXCEPTION 'ETAPA_575_BLOQUEADA: funcoes da etapa 569 ausentes';
  END IF;
END
$guard$;

-- Mesma funcao homologada na etapa 568, com duas checagens adicionais:
-- status NULL e saldo NULL nao permitem qualquer consumo.
CREATE OR REPLACE FUNCTION public.v19_consumir_material_chamado_empresa(
  p_chamado_id uuid,
  p_material_id uuid,
  p_quantidade numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $v19$
DECLARE
  v_usuario_id uuid;
  v_usuario_nome text;
  v_perfil text;
  v_consorcio_usuario uuid;
  v_empresa_usuario uuid;

  v_consorcio_chamado uuid;
  v_cidade_chamado uuid;
  v_empresa_chamado uuid;
  v_status_chamado text;
  v_protocolo text;

  v_material_nome text;
  v_preco numeric;
  v_estoque_id uuid;
  v_saldo numeric;
  v_contratado numeric;
  v_saldo_novo numeric;
  v_total numeric;
  v_item_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
  END IF;

  IF p_chamado_id IS NULL OR p_material_id IS NULL
     OR p_quantidade IS NULL OR p_quantidade<=0
     OR p_quantidade>9999999999
     OR round(p_quantidade,2)<>p_quantidade THEN
    RAISE EXCEPTION 'PARAMETROS_DE_CONSUMO_INVALIDOS' USING ERRCODE='22023';
  END IF;

  SELECT u.id,u.nome,u.perfil,u.consorcio_id,u.empresa_id
  INTO v_usuario_id,v_usuario_nome,v_perfil,
       v_consorcio_usuario,v_empresa_usuario
  FROM public.usuarios u
  WHERE u.auth_user_id=auth.uid() AND u.status='ativo'
  LIMIT 1;

  -- Somente o proprio usuario ativo de empresa pode consumir materiais.
  -- Master e Consorcio sao exclusivamente consultivos.
  IF NOT FOUND OR v_perfil IS DISTINCT FROM 'empresa'
     OR v_consorcio_usuario IS NULL OR v_empresa_usuario IS NULL THEN
    RAISE EXCEPTION 'CONSUMO_EXCLUSIVO_DA_EMPRESA' USING ERRCODE='42501';
  END IF;

  -- Ordem dos locks: chamado -> material -> estoque. Ajustes e estornos
  -- posteriores devem manter a MESMA ordem para evitar deadlocks.
  SELECT ch.consorcio_id,ch.cidade_id,ch.empresa_id,ch.status,ch.protocolo
  INTO v_consorcio_chamado,v_cidade_chamado,v_empresa_chamado,
       v_status_chamado,v_protocolo
  FROM public.chamados ch
  WHERE ch.id=p_chamado_id
  FOR UPDATE;

  IF NOT FOUND OR v_empresa_chamado IS NULL THEN
    RAISE EXCEPTION 'CHAMADO_SEM_EMPRESA_RESPONSAVEL' USING ERRCODE='42501';
  END IF;

  IF v_empresa_usuario IS DISTINCT FROM v_empresa_chamado
     OR v_consorcio_usuario IS DISTINCT FROM v_consorcio_chamado THEN
    RAISE EXCEPTION 'CHAMADO_NAO_PERTENCE_A_EMPRESA'
      USING ERRCODE='42501';
  END IF;

  -- Nao consumimos de empresa inativa nem de empresa sem municipio
  -- autorizado, independentemente do perfil do operador.
  IF NOT EXISTS (
    SELECT 1
    FROM public.empresas emp
    JOIN public.empresa_cidades ec ON ec.empresa_id=emp.id
    JOIN public.cidades ci ON ci.id=ec.cidade_id
    WHERE emp.id=v_empresa_chamado
      AND emp.consorcio_id=v_consorcio_chamado
      AND emp.status='ativo'
      AND ci.id=v_cidade_chamado
      AND ci.consorcio_id=v_consorcio_chamado
      AND ci.status='ativo'
  ) THEN
    RAISE EXCEPTION 'EMPRESA_OU_MUNICIPIO_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;

  IF v_status_chamado IS NULL OR v_status_chamado NOT IN (
    'Em programação','Em execução','Aguard. material','Aguardando material'
  ) THEN
    RAISE EXCEPTION 'STATUS_NAO_PERMITE_CONSUMO' USING ERRCODE='22023';
  END IF;

  SELECT m.nome,m.preco_unitario INTO v_material_nome,v_preco
  FROM public.materiais m
  WHERE m.id=p_material_id
    AND m.consorcio_id=v_consorcio_chamado
    AND m.status='ativo'
    -- Material historico do consorcio so pode ser consumido pela empresa
    -- que possui posicao de estoque real; os novos sao exclusivos.
    AND (m.empresa_id IS NULL OR m.empresa_id=v_empresa_chamado)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATERIAL_DE_OUTRO_CONSORCIO_OU_INATIVO'
      USING ERRCODE='42501';
  END IF;

  -- Nunca buscar por material/consorcio apenas. O saldo da empresa do
  -- chamado e o UNICO que pode ser debitado.
  SELECT s.id,s.quantidade_disponivel,s.quantidade_contratada
  INTO v_estoque_id,v_saldo,v_contratado
  FROM public.estoques s
  WHERE s.material_id=p_material_id
    AND s.consorcio_id=v_consorcio_chamado
    AND s.empresa_id=v_empresa_chamado
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ESTOQUE_DA_EMPRESA_NAO_ENCONTRADO'
      USING ERRCODE='22023';
  END IF;

  IF v_saldo IS NULL OR v_saldo<p_quantidade THEN
    RAISE EXCEPTION 'SALDO_INSUFICIENTE_DA_EMPRESA' USING ERRCODE='22023';
  END IF;

  v_saldo_novo:=v_saldo-p_quantidade;
  v_total:=round(p_quantidade*v_preco,2);
  IF v_total>999999999999.99 THEN
    RAISE EXCEPTION 'TOTAL_DE_CONSUMO_INVALIDO' USING ERRCODE='22023';
  END IF;

  UPDATE public.estoques
  SET quantidade_disponivel=v_saldo_novo,
      updated_at=clock_timestamp()
  WHERE id=v_estoque_id;

  -- Guardar estoque_id no item impede devolucao a empresa incorreta
  -- se no futuro a empresa executora do chamado mudar.
  INSERT INTO public.chamado_materiais(
    chamado_id,material_id,estoque_id,quantidade,preco_unitario,
    total,usuario_nome
  ) VALUES (
    p_chamado_id,p_material_id,v_estoque_id,p_quantidade,
    v_preco,v_total,v_usuario_nome
  ) RETURNING id INTO v_item_id;

  INSERT INTO public.movimentacoes(
    consorcio_id,empresa_id,estoque_id,material_id,chamado_id,
    tipo,quantidade,usuario_nome,usuario_id,origem,observacao
  ) VALUES (
    v_consorcio_chamado,v_empresa_chamado,v_estoque_id,
    p_material_id,p_chamado_id,
    'consumo',p_quantidade,v_usuario_nome,v_usuario_id,
    'chamado_empresa',
    'Consumo vinculado ao protocolo '||v_protocolo
  );

  INSERT INTO public.chamado_historico(
    chamado_id,status,mensagem,observacao,usuario_nome
  ) VALUES (
    p_chamado_id,v_status_chamado,'Material consumido',
    v_material_nome||' x '||p_quantidade,v_usuario_nome
  );

  INSERT INTO public.auditoria(
    consorcio_id,usuario_responsavel,acao,detalhes
  ) VALUES (
    v_consorcio_chamado,v_usuario_nome,
    'V19_ESTOQUE_EMPRESA_CONSUMO',
    'empresa_id='||v_empresa_chamado||
    '; estoque_id='||v_estoque_id||
    '; chamado_id='||p_chamado_id||
    '; item_id='||v_item_id||
    '; material_id='||p_material_id||
    '; quantidade='||p_quantidade||
    '; saldo='||v_saldo||'->'||v_saldo_novo
  );

  RETURN jsonb_build_object(
    'ok',true,
    'protocolo',v_protocolo,
    'item_id',v_item_id,
    'empresa_id',v_empresa_chamado,
    'estoque_id',v_estoque_id,
    'material_id',p_material_id,
    'quantidade',p_quantidade,
    'saldo_anterior',v_saldo,
    'novo_saldo',v_saldo_novo,
    'total',v_total,
    'executor_perfil',v_perfil
  );
END
$v19$;

-- Desabilitar RPCs antigas de consumo/movimentacao compartilhada
-- se ainda existirem. Nao permitir escrita de Master/Consorcio
-- por endpoints anteriores a separacao empresarial.
DO $guard$
DECLARE
  v_signature text;
BEGIN
  -- Incluir TODAS as assinaturas existentes, evitando ignorar overloads.
  FOR v_signature IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN (
        'consumir_material_chamado',
        'editar_material_chamado',
        'remover_material_chamado',
        'v19_movimentar_estoque',
        'v19_salvar_material'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      v_signature);
  END LOOP;
END
$guard$;

-- Acesso autenticado habilitado SOMENTE para consumo pela empresa:
-- a funcao valida auth.uid(), usuarios ativos, escopo do chamado
-- e empresa proprietaria do estoque. anon e PUBLIC sem EXECUTE.
REVOKE ALL ON FUNCTION public.v19_consumir_material_chamado_empresa(
  uuid,uuid,numeric
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v19_consumir_material_chamado_empresa(
  uuid,uuid,numeric
) TO authenticated;

-- Edicao e estorno permanecem fechados para todos os clientes.
REVOKE ALL ON FUNCTION public.v19_editar_material_chamado_empresa(
  uuid,numeric
) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.v19_remover_material_chamado_empresa(
  uuid
) FROM PUBLIC,anon,authenticated;

-- INSERT/UPDATE/DELETE diretos continuam bloqueados.
REVOKE INSERT,UPDATE,DELETE ON TABLE
  public.materiais,public.estoques,public.movimentacoes,
  public.chamado_materiais
FROM PUBLIC,anon,authenticated;

COMMENT ON FUNCTION public.v19_consumir_material_chamado_empresa(
  uuid,uuid,numeric
) IS 'V19 575: consumo transacional somente pela empresa do chamado e do estoque; autenticados executam com validacao interna estrita.';

COMMIT;

-- Resultado esperado:
-- consumo: true / false, edicao: false / false, estorno: false / false.
-- estoque=6, movimentos=15, consumos_ativos=0 (nenhuma baixa na instalacao).
SELECT
  p.oid::regprocedure::text AS funcao,
  p.prosecdef AS security_definer,
  has_function_privilege('authenticated',p.oid,'EXECUTE')
    AS autenticado_pode_executar,
  has_function_privilege('anon',p.oid,'EXECUTE')
    AS anon_pode_executar,
  (SELECT COUNT(*) FROM public.estoques) AS estoques,
  (SELECT COUNT(*) FROM public.movimentacoes) AS movimentos,
  (SELECT COUNT(*) FROM public.chamado_materiais) AS consumos_ativos
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN (
    'v19_consumir_material_chamado_empresa',
    'v19_editar_material_chamado_empresa',
    'v19_remover_material_chamado_empresa'
  )
ORDER BY funcao;
