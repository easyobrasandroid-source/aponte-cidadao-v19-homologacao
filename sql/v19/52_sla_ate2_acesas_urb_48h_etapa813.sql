-- V19 ETAPA 813 | Prazo especial 1 ou 2 lampadas acesas durante o dia - URBANO = 48 h.
-- Aplica como regra individualizada para CISVERDE e CISCAPARAO, sem tocar as regras anteriores.
-- Nenhum chamado existente e reclassificado ou recalculado nesta implantacao.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
INSERT INTO public.sla_configuracoes
 (consorcio_id,tipo_problema,urb_prazo,urb_unidade,rur_prazo,rur_unidade)
SELECT c.id,'SLA12_ACESOS_URB',48,'Horas',NULL,'Horas'
FROM public.consorcios c WHERE c.status='ativo'
ON CONFLICT (consorcio_id,tipo_problema) DO NOTHING;
ALTER TABLE public.chamados DROP CONSTRAINT v19_sla_classificacao_validacao;
ALTER TABLE public.chamados ADD CONSTRAINT v19_sla_classificacao_validacao
 CHECK (sla_classificacao IN ('PADRAO_GERAL','SLA3_APAGADOS_URB',
 'SLA3_ACESOS_URB','SLA3_APAGADOS_RUR','SLA12_ACESOS_URB'));
CREATE OR REPLACE FUNCTION public.v19_calcular_sla_horas(p_consorcio uuid, p_tipo text, p_area text, p_classificacao text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE v_horas integer;
BEGIN
  IF p_consorcio IS NULL OR p_area NOT IN ('Urbana','Rural') THEN RETURN NULL; END IF;
  IF (p_classificacao IN ('SLA3_APAGADOS_URB','SLA3_ACESOS_URB','SLA12_ACESOS_URB') AND p_area='Urbana')
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

CREATE OR REPLACE FUNCTION public.v19_classificar_sla_chamado(p_chamado_id uuid, p_classificacao text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
    ('PADRAO_GERAL','SLA3_APAGADOS_URB','SLA3_ACESOS_URB','SLA3_APAGADOS_RUR','SLA12_ACESOS_URB')
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
  IF (p_classificacao IN ('SLA3_APAGADOS_URB','SLA3_ACESOS_URB','SLA12_ACESOS_URB') AND v_ch.area<>'Urbana')
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
CREATE OR REPLACE FUNCTION public.v19_salvar_sla_ate2_acesas_urb(
 p_consorcio_id uuid,p_dias integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_perfil text; v_consorcio uuid; v_nome text; v_anterior integer;
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
  IF p_dias IS NULL OR p_dias NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION 'PRAZO_EM_DIAS_INVALIDO' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.consorcios
       WHERE id=p_consorcio_id AND status='ativo') THEN
    RAISE EXCEPTION 'CONSORCIO_INATIVO_OU_INEXISTENTE' USING ERRCODE='42501';
  END IF;
  SELECT urb_prazo INTO v_anterior FROM public.sla_configuracoes
    WHERE consorcio_id=p_consorcio_id AND tipo_problema='SLA12_ACESOS_URB'
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REGRA_ESPECIAL_NAO_PROVISIONADA' USING ERRCODE='22023';
  END IF;
  IF v_anterior IS DISTINCT FROM p_dias*24 THEN
    UPDATE public.sla_configuracoes
    SET urb_prazo=p_dias*24,updated_at=clock_timestamp()
    WHERE consorcio_id=p_consorcio_id AND tipo_problema='SLA12_ACESOS_URB';
    INSERT INTO public.auditoria(consorcio_id,usuario_responsavel,acao,detalhes)
    VALUES(p_consorcio_id,v_nome,'SLA_ATE2_ACESAS_URB_ALTERADO',
      'Regra 1 ou 2 pontos acesos durante o dia - urbano: '||
      coalesce(v_anterior::text,'nulo')||'h -> '||(p_dias*24)::text||
      'h; nenhum chamado existente alterado');
  END IF;
  RETURN jsonb_build_object('ok',true,'consorcio_id',p_consorcio_id,
    'dias',p_dias,'sla_horas',p_dias*24);
END;
$function$;
REVOKE ALL ON FUNCTION public.v19_salvar_sla_ate2_acesas_urb(uuid,integer)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v19_salvar_sla_ate2_acesas_urb(uuid,integer)
  TO authenticated;
COMMIT;
