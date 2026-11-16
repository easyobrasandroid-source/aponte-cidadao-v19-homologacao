-- Aponte Cidadao V19 — ETAPA 649
-- Instalar APENAS no Supabase V19 de homologacao.
-- Encaminha a Garantia LED com JWT real, escopo, concorrencia, pausa do SLA
-- e auditoria. Nao modifica os chamados existentes ao instalar.
BEGIN;

CREATE OR REPLACE FUNCTION public.v19_encaminhar_garantia_led(
  p_chamado_id uuid,
  p_tipo_defeito text,
  p_observacao text,
  p_identificado_em timestamptz,
  p_status_esperado text,
  p_atualizado_em timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_perfil text;
  v_uc uuid;
  v_ue uuid;
  v_nome text;
  v_usuarios integer;
  v_chamado public.chamados%ROWTYPE;
  v_tipo text := btrim(coalesce(p_tipo_defeito,''));
  v_obs text := btrim(coalesce(p_observacao,''));
  v_descricao text;
  v_agora timestamptz;
  v_atualizou uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
  END IF;

  SELECT count(*) INTO v_usuarios
    FROM public.usuarios u
   WHERE u.auth_user_id=auth.uid() AND u.status='ativo';
  IF v_usuarios<>1 THEN
    RAISE EXCEPTION 'PERFIL_ATIVO_UNICO_NAO_ENCONTRADO'
      USING ERRCODE='42501';
  END IF;

  SELECT u.perfil,u.consorcio_id,u.empresa_id,u.nome
    INTO v_perfil,v_uc,v_ue,v_nome
    FROM public.usuarios u
   WHERE u.auth_user_id=auth.uid() AND u.status='ativo';

  IF v_perfil NOT IN ('master','consorcio','empresa') THEN
    RAISE EXCEPTION 'PERFIL_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;
  IF p_chamado_id IS NULL OR p_status_esperado IS NULL OR
     p_atualizado_em IS NULL THEN
    RAISE EXCEPTION 'IDENTIFICACAO_OU_VERSAO_OBRIGATORIA'
      USING ERRCODE='22023';
  END IF;

  IF v_tipo NOT IN (
    'LED queimado',
    'Driver defeituoso',
    'Placa controladora com defeito',
    'Luminária com defeito de fábrica',
    'Sensor de presença com defeito',
    'Equipamento dentro do prazo de garantia',
    'Outro defeito de garantia'
  ) OR length(v_obs)>2000 OR
     (v_tipo='Outro defeito de garantia' AND v_obs='') THEN
    RAISE EXCEPTION 'DETALHES_GARANTIA_INVALIDOS' USING ERRCODE='22023';
  END IF;

  -- FOR UPDATE serializa encaminhamento e evita corrida com conclusao/edicao.
  SELECT * INTO v_chamado FROM public.chamados
   WHERE id=p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHAMADO_NAO_ENCONTRADO' USING ERRCODE='42501';
  END IF;
  IF v_chamado.status IS DISTINCT FROM p_status_esperado OR
     v_chamado.updated_at IS DISTINCT FROM p_atualizado_em THEN
    RAISE EXCEPTION 'VERSAO_DESATUALIZADA_RECARREGUE'
      USING ERRCODE='40001';
  END IF;

  IF v_perfil='consorcio' AND
     (v_uc IS NULL OR v_uc IS DISTINCT FROM v_chamado.consorcio_id) THEN
    RAISE EXCEPTION 'CHAMADO_DE_OUTRO_CONSORCIO' USING ERRCODE='42501';
  END IF;
  IF v_perfil='empresa' THEN
    IF v_uc IS NULL OR v_ue IS NULL OR
       v_uc IS DISTINCT FROM v_chamado.consorcio_id OR
       v_ue IS DISTINCT FROM v_chamado.empresa_id OR
       NOT EXISTS (
         SELECT 1 FROM public.empresas e
         JOIN public.empresa_cidades ec ON ec.empresa_id=e.id
         JOIN public.cidades ci ON ci.id=ec.cidade_id
         WHERE e.id=v_ue AND e.consorcio_id=v_uc
           AND e.status='ativo'
           AND ci.id=v_chamado.cidade_id
           AND ci.consorcio_id=v_uc AND ci.status='ativo'
       ) THEN
      RAISE EXCEPTION 'EMPRESA_NAO_AUTORIZADA_AO_CHAMADO'
        USING ERRCODE='42501';
    END IF;
  END IF;

  -- Apenas chamados abertos sem tratamento anterior de garantia.
  IF v_chamado.status NOT IN (
        'Recebido','Em programação','Em execução',
        'Aguard. material','Aguardando material','Em atraso'
     ) OR v_chamado.completed_at IS NOT NULL OR
     nullif(btrim(coalesce(v_chamado.garantia_tipo,'')),'') IS NOT NULL OR
     v_chamado.sla_pausado IS TRUE THEN
    RAISE EXCEPTION 'CHAMADO_NAO_ELEGIVEL_PARA_GARANTIA'
      USING ERRCODE='22023';
  END IF;

  v_agora:=clock_timestamp();
  -- A identificacao pode ser anterior ao encaminhamento, mas nao futura.
  IF p_identificado_em IS NOT NULL AND
     (p_identificado_em<v_chamado.created_at OR
      p_identificado_em>v_agora) THEN
    RAISE EXCEPTION 'DATA_IDENTIFICACAO_INVALIDA' USING ERRCODE='22023';
  END IF;
  IF v_agora<v_chamado.created_at THEN
    RAISE EXCEPTION 'DATA_ENCAMINHAMENTO_INVALIDA' USING ERRCODE='22023';
  END IF;

  v_descricao:='Defeito: '||v_tipo||
    CASE WHEN v_obs<>'' THEN E'\nObservação técnica: '||v_obs ELSE '' END;

  UPDATE public.chamados
     SET status='Aguardando Garantia LED',
         garantia_tipo='LED', -- contrato da RPC v19_concluir_garantia
         garantia_obs=v_descricao,
         garantia_dt=coalesce(p_identificado_em,v_agora),
         garantia_user=coalesce(nullif(btrim(v_nome),''),'Usuario autenticado'),
         sla_pausado=true,
         updated_at=v_agora
   WHERE id=v_chamado.id
     AND status=v_chamado.status
     AND completed_at IS NULL
  RETURNING id INTO v_atualizou;

  IF v_atualizou IS DISTINCT FROM v_chamado.id THEN
    RAISE EXCEPTION 'ENCAMINHAMENTO_NAO_CONFIRMADO'
      USING ERRCODE='40001';
  END IF;

  -- O trigger grava "Status alterado". Este evento detalha a triagem.
  INSERT INTO public.chamado_historico
    (chamado_id,status,mensagem,observacao,usuario_nome)
  VALUES (
    v_chamado.id,
    'Aguardando Garantia LED',
    'Encaminhamento para Garantia LED',
    v_descricao,
    coalesce(nullif(btrim(v_nome),''),'Usuario autenticado')
  );

  RETURN jsonb_build_object(
    'ok',true,
    'id',v_chamado.id,
    'protocolo',v_chamado.protocolo,
    'status','Aguardando Garantia LED',
    'garantia_tipo','LED',
    'sla_pausado',true,
    'updated_at',v_agora,
    'executor_perfil',v_perfil
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.v19_encaminhar_garantia_led(
  uuid,text,text,timestamptz,text,timestamptz
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v19_encaminhar_garantia_led(
  uuid,text,text,timestamptz,text,timestamptz
) TO authenticated;
COMMIT;

SELECT
  'V19_ETAPA_649_RPC_GARANTIA_INSTALADA' AS diagnostico,
  has_function_privilege(
    'authenticated',
    'public.v19_encaminhar_garantia_led(uuid,text,text,timestamptz,text,timestamptz)',
    'EXECUTE'
  ) AS authenticated_executa,
  has_function_privilege(
    'anon',
    'public.v19_encaminhar_garantia_led(uuid,text,text,timestamptz,text,timestamptz)',
    'EXECUTE'
  ) AS anon_executa,
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.chamados'::regclass)
    AS rls_preservado,
  (SELECT count(*) FROM public.chamados) AS chamados_preservados,
  (SELECT count(*) FROM public.chamados WHERE status='Aguardando Garantia LED')
    AS aguardando_garantia;
