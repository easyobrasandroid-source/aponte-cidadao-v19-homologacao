-- Aponte Cidadao V19 - ETAPA 641
-- Instalacao EXCLUSIVA no Supabase V19 de homologacao.
-- Corrige os dados operacionais de um chamado em transacao autenticada, sem
-- liberar UPDATE direto, nem interferir em RPCs de status, garantia ou materiais.
BEGIN;

CREATE OR REPLACE FUNCTION public.v19_editar_dados_chamado(
  p_chamado_id uuid,
  p_alteracoes jsonb,
  p_atualizado_em timestamptz,
  p_status_esperado text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_perfil text;
  v_consorcio uuid;
  v_cidade uuid;
  v_empresa uuid;
  v_usuario_nome text;
  v_quantidade_usuarios integer;
  v_atual public.chamados%ROWTYPE;
  v_novo public.chamados%ROWTYPE;
  v_key text;
  v_permitidos text[];
  v_alterados text[];
  v_sla integer;
  v_alterou_observacoes boolean;
  v_outras_alteracoes text[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ACESSO_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;
  SELECT count(*) INTO v_quantidade_usuarios
    FROM public.usuarios u
   WHERE u.auth_user_id=auth.uid() AND u.status='ativo';
  IF v_quantidade_usuarios <> 1 THEN
    RAISE EXCEPTION 'PERFIL_ATIVO_UNICO_NAO_ENCONTRADO' USING ERRCODE='42501';
  END IF;
  SELECT u.perfil,u.consorcio_id,u.cidade_id,u.empresa_id,u.nome
    INTO v_perfil,v_consorcio,v_cidade,v_empresa,v_usuario_nome
    FROM public.usuarios u
   WHERE u.auth_user_id=auth.uid() AND u.status='ativo';

  IF v_perfil NOT IN ('master','consorcio','prefeitura','empresa') THEN
    RAISE EXCEPTION 'PERFIL_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;
  IF p_chamado_id IS NULL OR p_atualizado_em IS NULL OR
     p_status_esperado IS NULL THEN
    RAISE EXCEPTION 'IDENTIFICACAO_OU_VERSAO_OBRIGATORIA'
      USING ERRCODE='22023';
  END IF;
  IF p_alteracoes IS NULL OR jsonb_typeof(p_alteracoes) <> 'object' OR
     (SELECT count(*) FROM jsonb_object_keys(p_alteracoes)) NOT BETWEEN 1 AND 14 THEN
    RAISE EXCEPTION 'ALTERACOES_INVALIDAS' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_atual FROM public.chamados
   WHERE id=p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHAMADO_NAO_ENCONTRADO' USING ERRCODE='22023';
  END IF;
  IF (v_perfil='consorcio' AND
      (v_consorcio IS NULL OR v_atual.consorcio_id IS DISTINCT FROM v_consorcio))
     OR (v_perfil='prefeitura' AND
      (v_cidade IS NULL OR v_consorcio IS NULL OR
       v_atual.cidade_id IS DISTINCT FROM v_cidade OR
       v_atual.consorcio_id IS DISTINCT FROM v_consorcio))
     OR (v_perfil='empresa' AND
      (v_empresa IS NULL OR v_consorcio IS NULL OR
       v_atual.empresa_id IS DISTINCT FROM v_empresa OR
       v_atual.consorcio_id IS DISTINCT FROM v_consorcio)) THEN
    RAISE EXCEPTION 'CHAMADO_FORA_DO_ESCOPO' USING ERRCODE='42501';
  END IF;

  -- Controle de concorrencia: nao sobrescrever outra edicao/status ocorrida
  -- desde a abertura do painel. O cliente deve ler updated_at sem arredondar.
  IF v_atual.updated_at IS DISTINCT FROM p_atualizado_em OR
     v_atual.status IS DISTINCT FROM p_status_esperado THEN
    RAISE EXCEPTION 'VERSAO_DESATUALIZADA_RECARREGUE'
      USING ERRCODE='40001';
  END IF;

  IF v_perfil='empresa' THEN
    v_permitidos:=ARRAY['observacoes','latitude','longitude'];
  ELSIF v_perfil='prefeitura' THEN
    v_permitidos:=ARRAY[
      'bairro','endereco','referencia','area','tipo','qtd','observacoes',
      'solicitante_nome','solicitante_tel','latitude','longitude'];
  ELSE
    v_permitidos:=ARRAY[
      'bairro','endereco','referencia','area','tipo','qtd','observacoes',
      'solicitante_nome','solicitante_tel','prioridade','latitude','longitude'];
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_alteracoes) LOOP
    IF v_key <> ALL(v_permitidos) THEN
      RAISE EXCEPTION 'CAMPO_NAO_AUTORIZADO: %',v_key USING ERRCODE='42501';
    END IF;
    IF jsonb_typeof(p_alteracoes->v_key) NOT IN ('string','number','null') THEN
      RAISE EXCEPTION 'TIPO_DE_CAMPO_INVALIDO: %',v_key USING ERRCODE='22023';
    END IF;
  END LOOP;

  IF (p_alteracoes ? 'latitude') IS DISTINCT FROM
     (p_alteracoes ? 'longitude') THEN
    RAISE EXCEPTION 'COORDENADAS_DEVEM_SER_ATUALIZADAS_JUNTAS'
      USING ERRCODE='22023';
  END IF;
  IF p_alteracoes ? 'latitude' THEN
    IF jsonb_typeof(p_alteracoes->'latitude') NOT IN ('number','null') OR
       jsonb_typeof(p_alteracoes->'longitude') NOT IN ('number','null') THEN
      RAISE EXCEPTION 'COORDENADAS_INVALIDAS' USING ERRCODE='22023';
    END IF;
  END IF;

  v_novo:=v_atual;
  IF p_alteracoes ? 'bairro' THEN
    v_novo.bairro:=nullif(btrim(p_alteracoes->>'bairro'),'');
  END IF;
  IF p_alteracoes ? 'endereco' THEN
    v_novo.endereco:=nullif(btrim(p_alteracoes->>'endereco'),'');
  END IF;
  IF p_alteracoes ? 'referencia' THEN
    v_novo.referencia:=nullif(btrim(p_alteracoes->>'referencia'),'');
  END IF;
  IF p_alteracoes ? 'area' THEN
    v_novo.area:=p_alteracoes->>'area';
  END IF;
  IF p_alteracoes ? 'tipo' THEN
    v_novo.tipo:=btrim(coalesce(p_alteracoes->>'tipo',''));
  END IF;
  IF p_alteracoes ? 'qtd' THEN
    IF jsonb_typeof(p_alteracoes->'qtd')<>'number' OR
       (p_alteracoes->>'qtd') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'QUANTIDADE_INVALIDA' USING ERRCODE='22023';
    END IF;
    v_novo.qtd:=(p_alteracoes->>'qtd')::integer;
  END IF;
  IF p_alteracoes ? 'observacoes' THEN
    v_novo.observacoes:=nullif(btrim(p_alteracoes->>'observacoes'),'');
  END IF;
  IF p_alteracoes ? 'solicitante_nome' THEN
    v_novo.solicitante_nome:=nullif(btrim(p_alteracoes->>'solicitante_nome'),'');
  END IF;
  IF p_alteracoes ? 'solicitante_tel' THEN
    v_novo.solicitante_tel:=nullif(btrim(p_alteracoes->>'solicitante_tel'),'');
  END IF;
  IF p_alteracoes ? 'prioridade' THEN
    v_novo.prioridade:=p_alteracoes->>'prioridade';
  END IF;

  IF p_alteracoes ? 'latitude' THEN
    v_novo.latitude:=(p_alteracoes->>'latitude')::numeric;
    v_novo.longitude:=(p_alteracoes->>'longitude')::numeric;
    v_novo.loc_src:='manual';
  ELSIF v_novo.bairro IS DISTINCT FROM v_atual.bairro OR
        v_novo.endereco IS DISTINCT FROM v_atual.endereco THEN
    -- Endereco mudou: nao reutilizar automaticamente coordenadas antigas.
    v_novo.latitude:=NULL;
    v_novo.longitude:=NULL;
    v_novo.loc_src:='manual';
  END IF;

  IF v_novo.area IS NULL OR v_novo.area NOT IN ('Urbana','Rural')
     OR v_novo.tipo IS NULL OR length(v_novo.tipo) NOT BETWEEN 2 AND 120
     OR v_novo.qtd IS NULL OR v_novo.qtd NOT BETWEEN 1 AND 999
     OR length(coalesce(v_novo.bairro,''))>150
     OR length(coalesce(v_novo.endereco,''))>300
     OR length(coalesce(v_novo.referencia,''))>300
     OR length(coalesce(v_novo.observacoes,''))>2500
     OR length(coalesce(v_novo.solicitante_nome,''))>200
     OR length(coalesce(v_novo.solicitante_tel,''))>40
     OR length(coalesce(v_novo.prioridade,''))>60
     OR (v_novo.latitude IS NULL) IS DISTINCT FROM
        (v_novo.longitude IS NULL)
     OR (v_novo.latitude IS NOT NULL AND
        (v_novo.latitude < -90 OR v_novo.latitude > 90))
     OR (v_novo.longitude IS NOT NULL AND
        (v_novo.longitude < -180 OR v_novo.longitude > 180)) THEN
    RAISE EXCEPTION 'DADOS_DE_CHAMADO_INVALIDOS' USING ERRCODE='22023';
  END IF;

  -- Recalcula SLA somente quando tipo/area mudarem, sem alterar created_at.
  IF v_novo.area IS DISTINCT FROM v_atual.area OR
     v_novo.tipo IS DISTINCT FROM v_atual.tipo THEN
    SELECT CASE WHEN v_novo.area='Rural' THEN sc.rur_prazo ELSE sc.urb_prazo END
      INTO v_sla
      FROM public.sla_configuracoes sc
     WHERE sc.consorcio_id=v_atual.consorcio_id
       AND sc.tipo_problema IN (v_novo.tipo,'PADRAO_GERAL')
     ORDER BY CASE WHEN sc.tipo_problema=v_novo.tipo THEN 0 ELSE 1 END
     LIMIT 1;
    IF NOT FOUND OR v_sla IS NULL OR v_sla < 0 THEN
      RAISE EXCEPTION 'REGRA_SLA_NAO_ENCONTRADA_PARA_NOVO_TIPO_AREA'
        USING ERRCODE='22023';
    END IF;
    -- sla_configuracoes.urb_prazo/rur_prazo ja estao em HORAS,
    -- conforme a tela de SLA e a RPC v19_salvar_sla_padrao.
    -- Nao multiplicar por 24: alteracoes de area/tipo preservam a unidade.
    v_novo.sla_horas:=v_sla;
  END IF;

  SELECT coalesce(array_agg(k ORDER BY k),ARRAY[]::text[])
    INTO v_alterados
    FROM jsonb_object_keys(to_jsonb(v_novo)) AS k
   WHERE to_jsonb(v_novo)->k IS DISTINCT FROM to_jsonb(v_atual)->k
     AND k IN (
       'bairro','endereco','referencia','area','tipo','qtd','observacoes',
       'solicitante_nome','solicitante_tel','prioridade','latitude','longitude',
       'loc_src','sla_horas'
     );

  IF cardinality(v_alterados)=0 THEN
    RETURN jsonb_build_object('ok',true,'alterado',false,'id',v_atual.id,
      'protocolo',v_atual.protocolo,'updated_at',v_atual.updated_at,
      'status',v_atual.status,'sla_horas',v_atual.sla_horas);
  END IF;
  v_alterou_observacoes:=('observacoes'=ANY(v_alterados));
  v_outras_alteracoes:=array_remove(v_alterados,'observacoes');

  UPDATE public.chamados SET
      bairro=v_novo.bairro,endereco=v_novo.endereco,
      referencia=v_novo.referencia,area=v_novo.area,
      tipo=v_novo.tipo,qtd=v_novo.qtd,observacoes=v_novo.observacoes,
      solicitante_nome=v_novo.solicitante_nome,
      solicitante_tel=v_novo.solicitante_tel,
      prioridade=v_novo.prioridade,latitude=v_novo.latitude,
      longitude=v_novo.longitude,loc_src=v_novo.loc_src,
      sla_horas=v_novo.sla_horas,updated_at=clock_timestamp()
   WHERE id=v_atual.id
   RETURNING * INTO v_novo;

  -- O trigger v19_registrar_historico_chamado ja registra alteracoes
  -- de observacoes; aqui registramos SOMENTE os demais campos corrigidos.
  IF cardinality(v_outras_alteracoes)>0 THEN
    INSERT INTO public.chamado_historico
      (chamado_id,status,mensagem,observacao,usuario_nome)
    VALUES
      (v_novo.id,v_novo.status,'Dados do chamado atualizados',
       'Campos: '||array_to_string(v_outras_alteracoes,', '),
       coalesce(nullif(v_usuario_nome,''),'Usuario autenticado'));
  END IF;

  RETURN jsonb_build_object('ok',true,'alterado',true,'id',v_novo.id,
    'protocolo',v_novo.protocolo,'updated_at',v_novo.updated_at,
    'status',v_novo.status,'sla_horas',v_novo.sla_horas,
    'campos_alterados',to_jsonb(v_alterados));
END;
$function$;

REVOKE ALL ON FUNCTION public.v19_editar_dados_chamado(
  uuid,jsonb,timestamptz,text
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v19_editar_dados_chamado(
  uuid,jsonb,timestamptz,text
) TO authenticated;
COMMIT;

SELECT
  'V19_ETAPA_641_RPC_EDICAO_INSTALADA' AS diagnostico,
  has_function_privilege('authenticated',
    'public.v19_editar_dados_chamado(uuid,jsonb,timestamptz,text)',
    'EXECUTE') AS authenticated_executa,
  has_function_privilege('anon',
    'public.v19_editar_dados_chamado(uuid,jsonb,timestamptz,text)',
    'EXECUTE') AS anon_executa,
  (SELECT relrowsecurity FROM pg_class
   WHERE oid='public.chamados'::regclass) AS rls_preservado,
  (SELECT count(*) FROM public.chamados) AS chamados_preservados;
