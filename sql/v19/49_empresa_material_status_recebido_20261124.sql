-- APONTE ILUMINACAO V19 ETAPA 808 - status Recebido permite consumo, edicao e estorno de material pela empresa responsavel.
-- Nenhuma alteracao em saldos, usuarios, chamados ou historico durante esta migracao.
-- Controles de titularidade, empresa/municipio, saldo, idempotencia e auditoria permanecem intactos.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';

-- v19_consumir_material_chamado_empresa
CREATE OR REPLACE FUNCTION public.v19_consumir_material_chamado_empresa(p_chamado_id uuid, p_material_id uuid, p_quantidade numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'Recebido','Em programação','Em execução','Aguard. material','Aguardando material'
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
$function$;


-- v19_editar_material_chamado_empresa
CREATE OR REPLACE FUNCTION public.v19_editar_material_chamado_empresa(p_item_id uuid, p_nova_qtd numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_material_empresa uuid;
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
  IF NOT FOUND OR v_user_perfil IS DISTINCT FROM 'empresa'
     OR v_user_empresa IS NULL OR v_user_consorcio IS NULL THEN
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHAMADO_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;

  IF v_status IS NULL OR v_status NOT IN (
     'Recebido','Em programação','Em execução','Aguard. material','Aguardando material'
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

  IF v_qtd_anterior IS NULL OR v_qtd_anterior<=0 THEN
    RAISE EXCEPTION 'QUANTIDADE_ORIGINAL_INVALIDA' USING ERRCODE='22023';
  END IF;
  v_delta:=p_nova_qtd-v_qtd_anterior;
  IF v_delta=0 THEN
    RAISE EXCEPTION 'QUANTIDADE_NAO_FOI_ALTERADA' USING ERRCODE='22023';
  END IF;

  SELECT m.consorcio_id,m.nome,m.empresa_id
    INTO v_material_consorcio,v_material_nome,v_material_empresa
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

  -- Apenas a empresa proprietaria do ESTOQUE DE ORIGEM pode ajustar.
  -- Nem Master nem Consorcio possuem permissao de escrita.
  -- Materiais exclusivos nunca devem estar vinculados a outra empresa.
  IF v_user_empresa IS DISTINCT FROM v_estoque_empresa
     OR v_user_consorcio IS DISTINCT FROM v_consorcio
     OR (v_material_empresa IS NOT NULL
         AND v_material_empresa IS DISTINCT FROM v_estoque_empresa) THEN
    RAISE EXCEPTION 'ESTOQUE_ORIGEM_NAO_PERTENCE_A_EMPRESA'
      USING ERRCODE='42501';
  END IF;
  -- Caso o chamado tenha sido transferido, a empresa original pode
  -- reduzir o consumo do proprio estoque, MAS nunca aumentá-lo.
  -- Estorno integral tambem usa o estoque_id historico.
  IF v_empresa_atual IS DISTINCT FROM v_user_empresa AND v_delta>0 THEN
    RAISE EXCEPTION 'CHAMADO_TRANSFERIDO_NAO_PERMITE_CONSUMO_ADICIONAL'
      USING ERRCODE='42501';
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
$function$;


-- v19_remover_material_chamado_empresa
CREATE OR REPLACE FUNCTION public.v19_remover_material_chamado_empresa(p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_material_empresa uuid;
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
  IF NOT FOUND OR v_user_perfil IS DISTINCT FROM 'empresa'
     OR v_user_empresa IS NULL OR v_user_consorcio IS NULL THEN
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHAMADO_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;

  IF v_status IS NULL OR v_status NOT IN (
    'Recebido','Em programação','Em execução','Aguard. material','Aguardando material'
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
  IF v_qtd IS NULL OR v_qtd<=0 THEN
    RAISE EXCEPTION 'QUANTIDADE_ORIGINAL_INVALIDA' USING ERRCODE='22023';
  END IF;

  SELECT m.consorcio_id,m.nome,m.empresa_id
    INTO v_material_consorcio,v_material_nome,v_material_empresa
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

  -- Apenas a empresa proprietaria do ESTOQUE DE ORIGEM pode ajustar.
  -- Nem Master nem Consorcio possuem permissao de escrita.
  -- Materiais exclusivos nunca devem estar vinculados a outra empresa.
  IF v_user_empresa IS DISTINCT FROM v_estoque_empresa
     OR v_user_consorcio IS DISTINCT FROM v_consorcio
     OR (v_material_empresa IS NOT NULL
         AND v_material_empresa IS DISTINCT FROM v_estoque_empresa) THEN
    RAISE EXCEPTION 'ESTOQUE_ORIGEM_NAO_PERTENCE_A_EMPRESA'
      USING ERRCODE='42501';
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
$function$;

COMMIT;
