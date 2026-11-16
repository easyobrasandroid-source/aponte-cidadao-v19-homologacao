-- APONTE CIDADAO V19 — ETAPA 652
-- Aplicar exclusivamente no Supabase V19. Nenhum chamado e alterado ao instalar.
-- Master pode concluir Garantia LED ou retomar a execucao com SLA compensado.
BEGIN;

-- Intervalos de pausa acumulados, em segundos, sem modificar as 48h/120h
-- contratuais do SLA.
ALTER TABLE public.chamados
  ADD COLUMN IF NOT EXISTS sla_pausa_inicio timestamptz;
ALTER TABLE public.chamados
  ADD COLUMN IF NOT EXISTS sla_pausa_acumulada_segundos bigint NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.chamados'::regclass
       AND conname='v19_sla_pausa_acumulada_nao_negativa'
  ) THEN
    ALTER TABLE public.chamados
      ADD CONSTRAINT v19_sla_pausa_acumulada_nao_negativa
      CHECK (sla_pausa_acumulada_segundos >= 0);
  END IF;
END;
$$;

-- Registrar o momento real de inicio da pausa em todos os futuros
-- encaminhamentos a garantia, inclusive os via RPC ja existente da Etapa 649.
CREATE OR REPLACE FUNCTION public.v19_marcar_inicio_pausa_sla()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF NEW.status='Aguardando Garantia LED'
     AND NEW.sla_pausado IS TRUE
     AND (OLD.status IS DISTINCT FROM NEW.status
          OR OLD.sla_pausado IS DISTINCT FROM NEW.sla_pausado) THEN
    NEW.sla_pausa_inicio:=clock_timestamp();
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.v19_marcar_inicio_pausa_sla()
  FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_v19_marcar_inicio_pausa_sla ON public.chamados;
CREATE TRIGGER trg_v19_marcar_inicio_pausa_sla
BEFORE UPDATE OF status,sla_pausado ON public.chamados
FOR EACH ROW
EXECUTE FUNCTION public.v19_marcar_inicio_pausa_sla();

-- Operacao EXCLUSIVA de Master com JWT real e lock de linha.
CREATE OR REPLACE FUNCTION public.v19_gerenciar_garantia_master(
  p_chamado_id uuid,
  p_acao text,
  p_atualizado_em timestamptz,
  p_status_esperado text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_chamado public.chamados%ROWTYPE;
  v_nome text;
  v_usuarios integer;
  v_agora timestamptz;
  v_inicio timestamptz;
  v_pausa_segundos bigint:=0;
  v_novo_status text;
  v_data_conclusao timestamptz;
  v_registro uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
  END IF;
  SELECT count(*),max(u.nome)
    INTO v_usuarios,v_nome
    FROM public.usuarios u
   WHERE u.auth_user_id=auth.uid()
     AND u.status='ativo' AND u.perfil='master';
  IF v_usuarios<>1 THEN
    RAISE EXCEPTION 'APENAS_MASTER_PODE_EXECUTAR_ESTA_ACAO'
      USING ERRCODE='42501';
  END IF;
  IF p_chamado_id IS NULL OR p_atualizado_em IS NULL OR
     p_status_esperado IS NULL OR p_acao NOT IN ('retomar','concluir')
     OR p_acao IS NULL THEN
    RAISE EXCEPTION 'PARAMETROS_INVALIDOS' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_chamado
    FROM public.chamados
   WHERE id=p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHAMADO_NAO_ENCONTRADO' USING ERRCODE='22023';
  END IF;
  IF v_chamado.updated_at IS DISTINCT FROM p_atualizado_em OR
     v_chamado.status IS DISTINCT FROM p_status_esperado THEN
    RAISE EXCEPTION 'VERSAO_DESATUALIZADA_RECARREGUE'
      USING ERRCODE='40001';
  END IF;
  IF v_chamado.status<>'Aguardando Garantia LED'
     OR upper(btrim(coalesce(v_chamado.garantia_tipo,'')))<>'LED'
     OR v_chamado.completed_at IS NOT NULL
     OR v_chamado.sla_pausado IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'CHAMADO_NAO_ESTA_EM_GARANTIA_LED'
      USING ERRCODE='22023';
  END IF;

  v_agora:=clock_timestamp();
  v_nome:=coalesce(nullif(btrim(v_nome),''),'Administrador Master');

  IF p_acao='retomar' THEN
    -- Chamados que ja estavam aguardando garantia antes desta migracao
    -- nao possuem sla_pausa_inicio: recuperar inicio REAL do historico.
    v_inicio:=v_chamado.sla_pausa_inicio;
    IF v_inicio IS NULL THEN
      SELECT max(h.created_at) INTO v_inicio
        FROM public.chamado_historico h
       WHERE h.chamado_id=v_chamado.id
         AND h.mensagem='Encaminhamento para Garantia LED'
         AND h.status='Aguardando Garantia LED';
    END IF;
    IF v_inicio IS NULL OR v_inicio<v_chamado.created_at OR
       v_inicio>v_agora THEN
      RAISE EXCEPTION 'INICIO_PAUSA_NAO_COMPROVADO'
        USING ERRCODE='22023';
    END IF;
    v_pausa_segundos:=ceil(extract(epoch from(v_agora-v_inicio)))::bigint;
    -- Mantem os dados da triagem no historico (abaixo), mas remove
    -- a garantia ativa para reabilitar o fluxo operacional normal.
    UPDATE public.chamados
       SET status='Em execução',
           sla_pausado=false,
           sla_pausa_inicio=NULL,
           sla_pausa_acumulada_segundos=
             coalesce(v_chamado.sla_pausa_acumulada_segundos,0)+v_pausa_segundos,
           garantia_tipo=NULL,
           garantia_obs=NULL,
           garantia_dt=NULL,
           garantia_user=NULL,
           updated_at=v_agora
     WHERE id=v_chamado.id
    RETURNING id INTO v_registro;
    v_novo_status:='Em execução';
    INSERT INTO public.chamado_historico
      (chamado_id,status,mensagem,observacao,usuario_nome)
    VALUES(
      v_chamado.id,
      'Em execução',
      'Retomada da execução após Garantia LED',
      'Encaminhamento anterior: '||coalesce(v_chamado.garantia_obs,'Sem observacao')||
       E'\nPausa contabilizada: '||v_pausa_segundos::text||' segundos.',
      v_nome
    );
  ELSE
    UPDATE public.chamados
       SET status='Concluído',
           completed_at=v_agora,
           updated_at=v_agora
     WHERE id=v_chamado.id
    RETURNING id,completed_at INTO v_registro,v_data_conclusao;
    v_novo_status:='Concluído';
    INSERT INTO public.chamado_historico
      (chamado_id,status,mensagem,observacao,usuario_nome)
    VALUES(
      v_chamado.id,
      'Concluído',
      'Garantia LED concluída pelo Administrador Master',
      'Conclusão administrativa de chamado em garantia LED.',
      v_nome
    );
  END IF;

  IF v_registro IS DISTINCT FROM v_chamado.id THEN
    RAISE EXCEPTION 'OPERACAO_NAO_CONFIRMADA' USING ERRCODE='40001';
  END IF;
  RETURN jsonb_build_object(
    'ok',true,'id',v_chamado.id,'status',v_novo_status,
    'updated_at',v_agora,'completed_at',v_data_conclusao,
    'sla_pausado',(p_acao='concluir'),
    'pausa_segundos_registrados',v_pausa_segundos
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.v19_gerenciar_garantia_master(
  uuid,text,timestamptz,text
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v19_gerenciar_garantia_master(
  uuid,text,timestamptz,text
) TO authenticated;

COMMIT;

SELECT
  'V19_ETAPA_652_MASTER_GARANTIA_INSTALADA' AS diagnostico,
  has_function_privilege(
    'authenticated',
    'public.v19_gerenciar_garantia_master(uuid,text,timestamptz,text)',
    'EXECUTE'
  ) AS authenticated_executa,
  has_function_privilege(
    'anon',
    'public.v19_gerenciar_garantia_master(uuid,text,timestamptz,text)',
    'EXECUTE'
  ) AS anon_executa,
  (SELECT relrowsecurity FROM pg_class
   WHERE oid='public.chamados'::regclass) AS rls_preservado,
  (SELECT count(*) FROM public.chamados) AS chamados_preservados,
  (SELECT count(*) FROM public.chamados
   WHERE status='Aguardando Garantia LED') AS aguardando_garantia,
  (SELECT count(*) FROM pg_trigger
   WHERE tgrelid='public.chamados'::regclass
     AND tgname='trg_v19_marcar_inicio_pausa_sla'
     AND NOT tgisinternal) AS gatilho_pausa_instalado;
