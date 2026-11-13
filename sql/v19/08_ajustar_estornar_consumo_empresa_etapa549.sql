-- APONTE CIDADAO V19 — ETAPA 549
-- Instala NOVAS RPCs de edicao e estorno de consumo por estoque empresarial.
-- Executar SOMENTE no Supabase V19 (xurrhczvyqpwyjemight), apos a etapa 548.
-- NAO reabilita as RPCs antigas nem ativa a interface.
-- A INSTALACAO NAO ALTERA SALDOS OU MOVIMENTACOES.
-- A empresa de origem e tomada de chamado_materiais.estoque_id, NAO do
-- chamado atual, que pode ter sido transferido para outra empresa.
-- V18 PRODUCAO NAO DEVE SER ALTERADA.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.v19_editar_material_chamado_empresa(
  p_item_id uuid, p_nova_qtd numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $v19$
DECLARE
  v_chamado_id uuid;
  v_consorcio uuid;
  v_status text;
  v_protocolo text;
  v_empresa_atual uuid;

  v_material_id uuid;
  v_estoque_id uuid;
  v_estoque_empresa uuid;
  v_estoque_consorcio uuid;
  v_material_consorcio uuid;
  v_material_nome text;
  v_qtd_anterior numeric;
  v_preco numeric;
  v_delta numeric;
  v_total numeric;
  v_saldo numeric;
  v_contratado numeric;
  v_saldo_novo numeric;

  v_user_id uuid;
  v_user_nome text;
  v_user_perfil text;
  v_user_empresa uuid;
  v_user_consorcio uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
  END IF;
  IF p_item_id IS NULL OR p_nova_qtd IS NULL
     OR p_nova_qtd<=0 OR p_nova_qtd>9999999999
     OR round(p_nova_qtd,2)<>p_nova_qtd THEN
    RAISE EXCEPTION 'QUANTIDADE_INVALIDA' USING ERRCODE='22023';
  END IF;

  SELECT u.id,u.nome,u.perfil,u.empresa_id,u.consorcio_id
    INTO v_user_id,v_user_nome,v_user_perfil,
         v_user_empresa,v_user_consorcio
  FROM public.usuarios u
  WHERE u.auth_user_id=auth.uid() AND u.status='ativo'
  LIMIT 1;
  IF NOT FOUND OR v_user_perfil NOT IN ('master','consorcio','empresa') THEN
    RAISE EXCEPTION 'PERFIL_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;

  -- Apenas consulta inicial para descobrir o chamado; lock vem em seguida.
  SELECT cm.chamado_id INTO v_chamado_id
  FROM public.chamado_materiais cm WHERE cm.id=p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NAO_DISPONIVEL' USING ERRCODE='42501';
  END IF;

  -- Ordem de locks padrao: chamado -> item -> material -> estoque.
  SELECT ch.consorcio_id,ch.status,ch.protocolo,ch.empresa_id
    INTO v_consorcio,v_status,v_protocolo,v_empresa_atual
  FROM public.chamados ch WHERE ch.id=v_chamado_id
  FOR UPDATE;
  IF NOT FOUND OR NOT public._v19_ajuste_consumo_autorizado(v_chamado_id) THEN
    RAISE EXCEPTION 'CHAMADO_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;

  IF v_status NOT IN (
     'Em programação','Em execução','Aguard. material','Aguardando material'
  ) THEN
    RAISE EXCEPTION 'STATUS_NAO_PERMITE_AJUSTE_DE_CONSUMO' USING ERRCODE='22023';
  END IF;

  SELECT cm.material_id,cm.estoque_id,cm.quantidade,cm.preco_unitario
    INTO v_material_id,v_estoque_id,v_qtd_anterior,v_preco
  FROM public.chamado_materiais cm
  WHERE cm.id=p_item_id AND cm.chamado_id=v_chamado_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_JA_REMOVIDO' USING ERRCODE='22023';
  END IF;
  IF v_estoque_id IS NULL THEN
    RAISE EXCEPTION 'ITEM_SEM_ESTOQUE_ORIGEM' USING ERRCODE='42501';
  END IF;
  IF v_preco IS NULL OR v_preco<0 THEN
    RAISE EXCEPTION 'PRECO_ORIGINAL_INVALIDO' USING ERRCODE='22023';
  END IF;

  v_delta:=p_nova_qtd-v_qtd_anterior;
  IF v_delta=0 THEN
    RAISE EXCEPTION 'QUANTIDADE_NAO_FOI_ALTERADA' USING ERRCODE='22023';
  END IF;

  SELECT m.consorcio_id,m.nome
    INTO v_material_consorcio,v_material_nome
  FROM public.materiais m WHERE m.id=v_material_id
  FOR UPDATE;
  IF NOT FOUND OR v_material_consorcio IS DISTINCT FROM v_consorcio THEN
    RAISE EXCEPTION 'MATERIAL_FORA_DO_CONSORCIO' USING ERRCODE='42501';
  END IF;

  SELECT s.empresa_id,s.consorcio_id,
         s.quantidade_disponivel,s.quantidade_contratada
    INTO v_estoque_empresa,v_estoque_consorcio,v_saldo,v_contratado
  FROM public.estoques s
  WHERE s.id=v_estoque_id AND s.material_id=v_material_id
  FOR UPDATE;
  IF NOT FOUND OR v_estoque_empresa IS NULL
     OR v_estoque_consorcio IS DISTINCT FROM v_consorcio THEN
    RAISE EXCEPTION 'ESTOQUE_ORIGEM_INVALIDO' USING ERRCODE='42501';
  END IF;

  -- Um usuario de empresa so pode ajustar itens do seu estoque,
  -- e do chamado que ainda lhe pertence. Se o chamado mudou de empresa,
  -- um Master/Gestor do Consorcio pode fazer o estorno no estoque original.
  IF v_user_perfil='empresa'
     AND (v_user_empresa IS DISTINCT FROM v_estoque_empresa
          OR v_user_empresa IS DISTINCT FROM v_empresa_atual) THEN
    RAISE EXCEPTION 'ESTOQUE_ORIGEM_DE_OUTRA_EMPRESA' USING ERRCODE='42501';
  END IF;
  IF v_user_perfil='consorcio'
     AND v_user_consorcio IS DISTINCT FROM v_consorcio THEN
    RAISE EXCEPTION 'CONSORCIO_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;

  v_saldo_novo:=v_saldo-v_delta;
  v_total:=round(v_preco*p_nova_qtd,2);
  IF v_saldo_novo<0 THEN
    RAISE EXCEPTION 'SALDO_INSUFICIENTE_DA_EMPRESA' USING ERRCODE='22023';
  END IF;
  IF v_saldo_novo>v_contratado OR v_total>999999999999.99 THEN
    RAISE EXCEPTION 'LIMITE_DE_ESTOQUE_OU_TOTAL' USING ERRCODE='22023';
  END IF;

  UPDATE public.estoques
  SET quantidade_disponivel=v_saldo_novo,
      updated_at=clock_timestamp()
  WHERE id=v_estoque_id;

  UPDATE public.chamado_materiais
  SET quantidade=p_nova_qtd,total=v_total
  WHERE id=p_item_id;

  INSERT INTO public.movimentacoes(
    consorcio_id,empresa_id,estoque_id,material_id,chamado_id,
    tipo,quantidade,usuario_id,usuario_nome,origem,observacao
  ) VALUES (
    v_consorcio,v_estoque_empresa,v_estoque_id,
    v_material_id,v_chamado_id,
    CASE WHEN v_delta>0 THEN 'consumo' ELSE 'devolucao' END,
    abs(v_delta),v_user_id,v_user_nome,'ajuste_consumo_empresa',
    'Item '||p_item_id||': '||v_qtd_anterior||' -> '||p_nova_qtd
  );

  INSERT INTO public.chamado_historico(
    chamado_id,status,mensagem,observacao,usuario_nome
  ) VALUES (
    v_chamado_id,v_status,'Material consumido ajustado',
    v_material_nome||': '||v_qtd_anterior||' -> '||p_nova_qtd,
    v_user_nome
  );

  INSERT INTO public.auditoria(
    consorcio_id,usuario_responsavel,acao,detalhes
  ) VALUES (
    v_consorcio,v_user_nome,'V19_ESTOQUE_EMPRESA_CONSUMO_EDITADO',
    'empresa_origem_id='||v_estoque_empresa||
    '; estoque_id='||v_estoque_id||
    '; chamado_id='||v_chamado_id||
    '; item_id='||p_item_id||
    '; quantidade='||v_qtd_anterior||'->'||p_nova_qtd||
    '; saldo='||v_saldo||'->'||v_saldo_novo
  );

  RETURN jsonb_build_object(
    'ok',true,'item_id',p_item_id,'protocolo',v_protocolo,
    'estoque_id',v_estoque_id,'empresa_id',v_estoque_empresa,
    'quantidade_anterior',v_qtd_anterior,'quantidade_nova',p_nova_qtd,
    'novo_saldo',v_saldo_novo,'novo_total',v_total
  );
END
$v19$;

CREATE OR REPLACE FUNCTION public.v19_remover_material_chamado_empresa(
  p_item_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $v19$
DECLARE
  v_chamado_id uuid;
  v_consorcio uuid;
  v_status text;
  v_protocolo text;
  v_empresa_atual uuid;

  v_material_id uuid;
  v_estoque_id uuid;
  v_estoque_empresa uuid;
  v_estoque_consorcio uuid;
  v_material_consorcio uuid;
  v_material_nome text;
  v_qtd numeric;
  v_saldo numeric;
  v_contratado numeric;
  v_saldo_novo numeric;

  v_user_id uuid;
  v_user_nome text;
  v_user_perfil text;
  v_user_empresa uuid;
  v_user_consorcio uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
  END IF;
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'ITEM_OBRIGATORIO' USING ERRCODE='22023';
  END IF;

  SELECT u.id,u.nome,u.perfil,u.empresa_id,u.consorcio_id
    INTO v_user_id,v_user_nome,v_user_perfil,
         v_user_empresa,v_user_consorcio
  FROM public.usuarios u
  WHERE u.auth_user_id=auth.uid() AND u.status='ativo'
  LIMIT 1;
  IF NOT FOUND OR v_user_perfil NOT IN ('master','consorcio','empresa') THEN
    RAISE EXCEPTION 'PERFIL_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;

  SELECT cm.chamado_id INTO v_chamado_id
  FROM public.chamado_materiais cm WHERE cm.id=p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NAO_DISPONIVEL' USING ERRCODE='42501';
  END IF;

  -- Mesmo lock do consumo: chamado -> item -> material -> estoque.
  SELECT ch.consorcio_id,ch.status,ch.protocolo,ch.empresa_id
    INTO v_consorcio,v_status,v_protocolo,v_empresa_atual
  FROM public.chamados ch WHERE ch.id=v_chamado_id
  FOR UPDATE;
  IF NOT FOUND OR NOT public._v19_ajuste_consumo_autorizado(v_chamado_id) THEN
    RAISE EXCEPTION 'CHAMADO_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;

  IF v_status NOT IN (
    'Em programação','Em execução','Aguard. material','Aguardando material'
  ) THEN
    RAISE EXCEPTION 'STATUS_NAO_PERMITE_ESTORNO' USING ERRCODE='22023';
  END IF;

  SELECT cm.material_id,cm.estoque_id,cm.quantidade
    INTO v_material_id,v_estoque_id,v_qtd
  FROM public.chamado_materiais cm
  WHERE cm.id=p_item_id AND cm.chamado_id=v_chamado_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_JA_REMOVIDO' USING ERRCODE='22023';
  END IF;
  IF v_estoque_id IS NULL THEN
    RAISE EXCEPTION 'ITEM_SEM_ESTOQUE_ORIGEM' USING ERRCODE='42501';
  END IF;

  SELECT m.consorcio_id,m.nome
    INTO v_material_consorcio,v_material_nome
  FROM public.materiais m WHERE m.id=v_material_id
  FOR UPDATE;
  IF NOT FOUND OR v_material_consorcio IS DISTINCT FROM v_consorcio THEN
    RAISE EXCEPTION 'MATERIAL_FORA_DO_CONSORCIO' USING ERRCODE='42501';
  END IF;

  SELECT s.empresa_id,s.consorcio_id,
         s.quantidade_disponivel,s.quantidade_contratada
    INTO v_estoque_empresa,v_estoque_consorcio,v_saldo,v_contratado
  FROM public.estoques s
  WHERE s.id=v_estoque_id AND s.material_id=v_material_id
  FOR UPDATE;
  IF NOT FOUND OR v_estoque_empresa IS NULL
     OR v_estoque_consorcio IS DISTINCT FROM v_consorcio THEN
    RAISE EXCEPTION 'ESTOQUE_ORIGEM_INVALIDO' USING ERRCODE='42501';
  END IF;

  IF v_user_perfil='empresa'
     AND (v_user_empresa IS DISTINCT FROM v_estoque_empresa
          OR v_user_empresa IS DISTINCT FROM v_empresa_atual) THEN
    RAISE EXCEPTION 'ESTOQUE_ORIGEM_DE_OUTRA_EMPRESA' USING ERRCODE='42501';
  END IF;
  IF v_user_perfil='consorcio'
     AND v_user_consorcio IS DISTINCT FROM v_consorcio THEN
    RAISE EXCEPTION 'CONSORCIO_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;

  v_saldo_novo:=v_saldo+v_qtd;
  IF v_saldo_novo>v_contratado THEN
    RAISE EXCEPTION 'ESTORNO_EXCEDE_ESTOQUE_CONTRATADO' USING ERRCODE='22023';
  END IF;

  UPDATE public.estoques
  SET quantidade_disponivel=v_saldo_novo,
      updated_at=clock_timestamp()
  WHERE id=v_estoque_id;

  DELETE FROM public.chamado_materiais WHERE id=p_item_id;

  INSERT INTO public.movimentacoes(
    consorcio_id,empresa_id,estoque_id,material_id,chamado_id,
    tipo,quantidade,usuario_id,usuario_nome,origem,observacao
  ) VALUES (
    v_consorcio,v_estoque_empresa,v_estoque_id,
    v_material_id,v_chamado_id,
    'estorno',v_qtd,v_user_id,v_user_nome,'estorno_consumo_empresa',
    'Estorno integral do item '||p_item_id
  );

  INSERT INTO public.chamado_historico(
    chamado_id,status,mensagem,observacao,usuario_nome
  ) VALUES (
    v_chamado_id,v_status,'Material consumido estornado',
    v_material_nome||' x '||v_qtd||' (item '||p_item_id||')',
    v_user_nome
  );

  INSERT INTO public.auditoria(
    consorcio_id,usuario_responsavel,acao,detalhes
  ) VALUES (
    v_consorcio,v_user_nome,'V19_ESTOQUE_EMPRESA_CONSUMO_ESTORNADO',
    'empresa_origem_id='||v_estoque_empresa||
    '; estoque_id='||v_estoque_id||
    '; chamado_id='||v_chamado_id||
    '; item_id='||p_item_id||
    '; quantidade_estornada='||v_qtd||
    '; saldo='||v_saldo||'->'||v_saldo_novo
  );

  RETURN jsonb_build_object(
    'ok',true,'item_id',p_item_id,'protocolo',v_protocolo,
    'empresa_id',v_estoque_empresa,'estoque_id',v_estoque_id,
    'quantidade_estornada',v_qtd,'novo_saldo',v_saldo_novo
  );
END
$v19$;

-- Somente authenticated pode invocar; as funcoes revalidam permissao
-- e operam com as validacoes transacionais (RLS nao e bypass de ACL).
REVOKE ALL ON FUNCTION public.v19_editar_material_chamado_empresa(
  uuid,numeric
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.v19_editar_material_chamado_empresa(
  uuid,numeric
) TO authenticated;

REVOKE ALL ON FUNCTION public.v19_remover_material_chamado_empresa(
  uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.v19_remover_material_chamado_empresa(
  uuid
) TO authenticated;

COMMENT ON FUNCTION public.v19_editar_material_chamado_empresa(uuid,numeric)
IS 'V19 Etapa 549: edita consumo no estoque_id de origem e audita delta.';
COMMENT ON FUNCTION public.v19_remover_material_chamado_empresa(uuid)
IS 'V19 Etapa 549: estorna consumo no estoque_id de origem; veda transferencia de saldo entre empresas.';

COMMIT;

-- Conferencia de instalacao, SEM alterar saldo/consumo:
SELECT
  p.oid::regprocedure::text AS funcao,
  p.prosecdef AS security_definer,
  has_function_privilege('authenticated',p.oid,'EXECUTE')
    AS authenticated_pode_executar,
  has_function_privilege('anon',p.oid,'EXECUTE')
    AS anon_pode_executar,
  (SELECT COUNT(*) FROM public.estoques) AS estoques,
  (SELECT COUNT(*) FROM public.estoques WHERE empresa_id IS NULL) AS sem_empresa,
  (SELECT COALESCE(SUM(quantidade_disponivel),0)
    FROM public.estoques) AS total_disponivel,
  (SELECT COUNT(*) FROM public.chamado_materiais) AS consumos_ativos,
  (SELECT COUNT(*) FROM public.movimentacoes) AS movimentacoes
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN (
    'v19_editar_material_chamado_empresa',
    'v19_remover_material_chamado_empresa'
  )
ORDER BY funcao;
