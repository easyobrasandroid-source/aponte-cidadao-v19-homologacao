-- APONTE ILUMINACAO V19 / ETAPA 809
-- SLA especial por consorcio (2/3/4 dias) e recalculo controlado de chamados abertos.
-- A instalacao NAO atualiza chamados existentes nem altera os SLA padrao atuais.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

ALTER TABLE public.chamados
  ADD COLUMN IF NOT EXISTS sla_classificacao text NOT NULL DEFAULT 'PADRAO_GERAL';
ALTER TABLE public.chamados
  ADD CONSTRAINT v19_sla_classificacao_validacao
  CHECK (sla_classificacao IN
    ('PADRAO_GERAL','SLA3_APAGADOS_URB','SLA3_ACESOS_URB','SLA3_APAGADOS_RUR'));

INSERT INTO public.sla_configuracoes
  (consorcio_id,tipo_problema,urb_prazo,urb_unidade,rur_prazo,rur_unidade)
SELECT c.id, x.codigo, x.urb, 'Horas', x.rur, 'Horas'
FROM public.consorcios c
CROSS JOIN (VALUES
 ('SLA3_APAGADOS_URB'::text,48::integer,NULL::integer),
 ('SLA3_ACESOS_URB'::text,72::integer,NULL::integer),
 ('SLA3_APAGADOS_RUR'::text,NULL::integer,96::integer)
) AS x(codigo,urb,rur)
WHERE c.status='ativo'
ON CONFLICT (consorcio_id,tipo_problema) DO NOTHING;

CREATE OR REPLACE FUNCTION public.v19_calcular_sla_horas(
 p_consorcio uuid,p_tipo text,p_area text,p_classificacao text)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO ''
AS $function$
DECLARE v_horas integer;
BEGIN
  IF p_consorcio IS NULL OR p_area NOT IN ('Urbana','Rural') THEN RETURN NULL; END IF;
  IF (p_classificacao IN ('SLA3_APAGADOS_URB','SLA3_ACESOS_URB') AND p_area='Urbana')
    OR (p_classificacao='SLA3_APAGADOS_RUR' AND p_area='Rural') THEN
    SELECT CASE WHEN p_area='Urbana' THEN s.urb_prazo ELSE s.rur_prazo END
      INTO v_horas
    FROM public.sla_configuracoes s
    WHERE s.consorcio_id=p_consorcio
      AND s.tipo_problema=p_classificacao;
    IF v_horas>0 THEN RETURN v_horas; END IF;
  END IF;
  -- Preservar precedencia historica de regra por tipo antes do padrao geral.
  SELECT CASE WHEN p_area='Rural' THEN s.rur_prazo ELSE s.urb_prazo END
    INTO v_horas
  FROM public.sla_configuracoes s
  WHERE s.consorcio_id=p_consorcio
    AND s.tipo_problema IN (p_tipo,'PADRAO_GERAL')
    AND CASE WHEN p_area='Rural' THEN s.rur_prazo ELSE s.urb_prazo END>0
  ORDER BY CASE WHEN s.tipo_problema=p_tipo THEN 0 ELSE 1 END
  LIMIT 1;
  RETURN v_horas;
END;
$function$;
REVOKE ALL ON FUNCTION public.v19_calcular_sla_horas(uuid,text,text,text)
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.v19_sla_na_abertura()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'SLA_TRIGGER_APENAS_INSERT'; END IF;
  IF NEW.consorcio_id IS NULL OR NEW.area NOT IN ('Urbana','Rural') THEN
    RAISE EXCEPTION 'CONSORCIO_OU_AREA_INVALIDA';
  END IF;
  NEW.sla_horas:=public.v19_calcular_sla_horas(
    NEW.consorcio_id,NEW.tipo,NEW.area,NEW.sla_classificacao);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.v19_salvar_sla_especiais(
 p_consorcio_id uuid,p_apagados_urb_dias integer,
 p_acesos_urb_dias integer,p_apagados_rur_dias integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_perfil text;v_consorcio uuid;v_nome text;v_antigos jsonb;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
  END IF;
  SELECT perfil,consorcio_id,nome INTO v_perfil,v_consorcio,v_nome
    FROM public.usuarios WHERE auth_user_id=auth.uid() AND status='ativo' LIMIT 1;
  IF NOT FOUND OR v_perfil NOT IN ('master','consorcio') THEN
    RAISE EXCEPTION 'PERFIL_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;
  IF p_consorcio_id IS NULL OR
    (v_perfil='consorcio' AND v_consorcio IS DISTINCT FROM p_consorcio_id) THEN
    RAISE EXCEPTION 'CONSORCIO_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;
  IF p_apagados_urb_dias IS NULL OR p_acesos_urb_dias IS NULL
     OR p_apagados_rur_dias IS NULL
     OR p_apagados_urb_dias NOT BETWEEN 1 AND 365
     OR p_acesos_urb_dias NOT BETWEEN 1 AND 365
     OR p_apagados_rur_dias NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION 'PRAZO_EM_DIAS_INVALIDO' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.consorcios WHERE id=p_consorcio_id AND status='ativo') THEN
    RAISE EXCEPTION 'CONSORCIO_INATIVO_OU_INEXISTENTE' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_object_agg(s.tipo_problema,
    CASE WHEN s.tipo_problema='SLA3_APAGADOS_RUR' THEN s.rur_prazo ELSE s.urb_prazo END)
    INTO v_antigos FROM public.sla_configuracoes s
    WHERE s.consorcio_id=p_consorcio_id
      AND s.tipo_problema IN ('SLA3_APAGADOS_URB','SLA3_ACESOS_URB','SLA3_APAGADOS_RUR');
  IF (SELECT count(*) FROM public.sla_configuracoes
      WHERE consorcio_id=p_consorcio_id AND tipo_problema
      IN ('SLA3_APAGADOS_URB','SLA3_ACESOS_URB','SLA3_APAGADOS_RUR'))<>3 THEN
    RAISE EXCEPTION 'REGRAS_ESPECIAIS_NAO_PROVISIONADAS';
  END IF;
  UPDATE public.sla_configuracoes
  SET urb_prazo=CASE tipo_problema
        WHEN 'SLA3_APAGADOS_URB' THEN p_apagados_urb_dias*24
        WHEN 'SLA3_ACESOS_URB' THEN p_acesos_urb_dias*24
        ELSE NULL END,
      rur_prazo=CASE WHEN tipo_problema='SLA3_APAGADOS_RUR'
                      THEN p_apagados_rur_dias*24 ELSE NULL END,
      urb_unidade='Horas',rur_unidade='Horas',updated_at=clock_timestamp()
  WHERE consorcio_id=p_consorcio_id AND tipo_problema IN
    ('SLA3_APAGADOS_URB','SLA3_ACESOS_URB','SLA3_APAGADOS_RUR');
  INSERT INTO public.auditoria(consorcio_id,usuario_responsavel,acao,detalhes)
  VALUES(p_consorcio_id,v_nome,'SLA_ESPECIAIS_ALTERADOS',
    'De '||coalesce(v_antigos::text,'{}')||' para urbano_apagados='||
    (p_apagados_urb_dias*24)||'h, urbano_acesos='||(p_acesos_urb_dias*24)||
    'h, rural_apagados='||(p_apagados_rur_dias*24)||'h. Chamados preservados.');
  RETURN jsonb_build_object('ok',true,'consorcio_id',p_consorcio_id,
    'apagados_urb_dias',p_apagados_urb_dias,
    'acesos_urb_dias',p_acesos_urb_dias,
    'apagados_rur_dias',p_apagados_rur_dias);
END;
$function$;

CREATE OR REPLACE FUNCTION public.v19_classificar_sla_chamado(
 p_chamado_id uuid,p_classificacao text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_perfil text;v_consorcio uuid;v_nome text;v_ch public.chamados%ROWTYPE;
        v_horas integer;v_anterior integer;v_classe text;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
  END IF;
  SELECT perfil,consorcio_id,nome INTO v_perfil,v_consorcio,v_nome
    FROM public.usuarios WHERE auth_user_id=auth.uid() AND status='ativo' LIMIT 1;
  IF NOT FOUND OR v_perfil NOT IN ('master','consorcio') THEN
    RAISE EXCEPTION 'PERFIL_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;
  IF p_classificacao NOT IN
    ('PADRAO_GERAL','SLA3_APAGADOS_URB','SLA3_ACESOS_URB','SLA3_APAGADOS_RUR')
    OR p_classificacao IS NULL THEN
    RAISE EXCEPTION 'CLASSIFICACAO_INVALIDA';
  END IF;
  SELECT * INTO v_ch FROM public.chamados WHERE id=p_chamado_id FOR UPDATE;
  IF NOT FOUND OR (v_perfil='consorcio' AND
     v_consorcio IS DISTINCT FROM v_ch.consorcio_id) THEN
    RAISE EXCEPTION 'CHAMADO_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;
  IF v_ch.arquivado_em IS NOT NULL OR v_ch.completed_at IS NOT NULL
     OR v_ch.status IN ('Concluído','Cancelado') OR v_ch.sla_pausado THEN
    RAISE EXCEPTION 'CHAMADO_NAO_ABERTO_PARA_RECLASSIFICACAO';
  END IF;
  IF (p_classificacao IN ('SLA3_APAGADOS_URB','SLA3_ACESOS_URB') AND v_ch.area<>'Urbana')
    OR (p_classificacao='SLA3_APAGADOS_RUR' AND v_ch.area<>'Rural') THEN
    RAISE EXCEPTION 'REGRA_INCOMPATIVEL_COM_AREA';
  END IF;
  v_horas:=public.v19_calcular_sla_horas(
    v_ch.consorcio_id,v_ch.tipo,v_ch.area,p_classificacao);
  IF v_horas IS NULL OR v_horas<1 THEN
    RAISE EXCEPTION 'PRAZO_NAO_CONFIGURADO';
  END IF;
  v_anterior:=v_ch.sla_horas;v_classe:=v_ch.sla_classificacao;
  IF v_classe IS DISTINCT FROM p_classificacao
     OR v_anterior IS DISTINCT FROM v_horas THEN
    UPDATE public.chamados SET sla_classificacao=p_classificacao,sla_horas=v_horas
      WHERE id=p_chamado_id;
    INSERT INTO public.auditoria(consorcio_id,usuario_responsavel,acao,detalhes)
      VALUES(v_ch.consorcio_id,v_nome,'SLA_CHAMADO_RECLASSIFICADO',
        'protocolo='||v_ch.protocolo||' | regra '||coalesce(v_classe,'nula')||
        ' -> '||p_classificacao||' | prazo '||coalesce(v_anterior::text,'nulo')||
        'h -> '||v_horas||'h | abertura original preservada');
  END IF;
  RETURN jsonb_build_object('ok',true,'protocolo',v_ch.protocolo,
    'sla_horas',v_horas,'classificacao',p_classificacao);
END;
$function$;

CREATE OR REPLACE FUNCTION public.v19_recalcular_sla_abertos(
 p_consorcio_id uuid,p_aplicar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_perfil text;v_consorcio uuid;v_nome text;v_ch record;v_horas integer;
        v_total integer:=0;v_mudancas integer:=0;v_sem_regra integer:=0;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
  END IF;
  SELECT perfil,consorcio_id,nome INTO v_perfil,v_consorcio,v_nome
    FROM public.usuarios WHERE auth_user_id=auth.uid() AND status='ativo' LIMIT 1;
  IF NOT FOUND OR v_perfil NOT IN ('master','consorcio') THEN
    RAISE EXCEPTION 'PERFIL_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;
  IF p_consorcio_id IS NULL OR
     (v_perfil='consorcio' AND v_consorcio IS DISTINCT FROM p_consorcio_id) THEN
    RAISE EXCEPTION 'CONSORCIO_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;
  IF p_aplicar IS NULL THEN RAISE EXCEPTION 'PARAMETRO_APLICAR_INVALIDO'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.consorcios WHERE id=p_consorcio_id AND status='ativo') THEN
    RAISE EXCEPTION 'CONSORCIO_INATIVO_OU_INEXISTENTE' USING ERRCODE='42501';
  END IF;
  FOR v_ch IN
    SELECT id,protocolo,tipo,area,sla_classificacao,sla_horas
    FROM public.chamados
    WHERE consorcio_id=p_consorcio_id
      AND arquivado_em IS NULL AND completed_at IS NULL
      AND status NOT IN ('Concluído','Cancelado')
      AND sla_pausado IS FALSE
    ORDER BY id FOR UPDATE
  LOOP
    v_total:=v_total+1;
    v_horas:=public.v19_calcular_sla_horas(
      p_consorcio_id,v_ch.tipo,v_ch.area,v_ch.sla_classificacao);
    IF v_horas IS NULL OR v_horas<1 THEN
      v_sem_regra:=v_sem_regra+1;CONTINUE;
    END IF;
    IF v_horas IS DISTINCT FROM v_ch.sla_horas THEN
      v_mudancas:=v_mudancas+1;
      IF p_aplicar THEN
        UPDATE public.chamados SET sla_horas=v_horas WHERE id=v_ch.id;
        INSERT INTO public.auditoria(consorcio_id,usuario_responsavel,acao,detalhes)
        VALUES(p_consorcio_id,v_nome,'SLA_CHAMADO_RECALCULADO',
          'protocolo='||v_ch.protocolo||' | regra='||v_ch.sla_classificacao||
          ' | prazo '||coalesce(v_ch.sla_horas::text,'nulo')||'h -> '||
          v_horas||'h | data de abertura e historico preservados');
      END IF;
    END IF;
  END LOOP;
  IF p_aplicar THEN
    INSERT INTO public.auditoria(consorcio_id,usuario_responsavel,acao,detalhes)
    VALUES(p_consorcio_id,v_nome,'SLA_RECALCULO_LOTE',
      'Abertos avaliados='||v_total||' | alterados='||v_mudancas||
      ' | sem regra='||v_sem_regra||' | concluídos/arquivados/pausados excluídos');
  END IF;
  RETURN jsonb_build_object('ok',true,'consorcio_id',p_consorcio_id,
    'avaliados',v_total,'alteracoes',v_mudancas,
    'sem_regra',v_sem_regra,'aplicado',p_aplicar);
END;
$function$;

REVOKE ALL ON FUNCTION public.v19_salvar_sla_especiais(uuid,integer,integer,integer)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.v19_classificar_sla_chamado(uuid,text)
  FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.v19_recalcular_sla_abertos(uuid,boolean)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v19_salvar_sla_especiais(uuid,integer,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.v19_classificar_sla_chamado(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.v19_recalcular_sla_abertos(uuid,boolean) TO authenticated;
COMMIT;