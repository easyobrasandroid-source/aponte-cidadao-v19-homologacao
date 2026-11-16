-- APONTE CIDADAO V19 — ETAPA 603 — FECHAMENTO DA CONSULTA PUBLICA
--
-- A Edge Function v19-abrir-chamado aplica rate-limit e usa service_role
-- para a RPC consultar_protocolo. Na Etapa 602 foi comprovado que
-- anon podia chamar essa RPC diretamente e contornar o rate-limit.
--
-- ORDEM OBRIGATORIA:
--   1) PUBLICAR a Edge Function alterada no Supabase V19.
--   2) EXECUTAR este SQL no editor SOMENTE da V19.
--   3) VERIFICAR anon=false/service_role=true e portais desativados.
-- O SQL NAO ativa portais, NAO modifica saldos e NAO reescreve RPCs.
-- V18 NUNCA DEVE SER ALTERADA.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30000ms';

DO $guard$
DECLARE
  v_lookup oid;
  v_rls oid;
  v_municipios oid;
  v_src text;
BEGIN
  IF (SELECT COUNT(*) FROM public.portal_configuracoes)<>2
    OR EXISTS (
      SELECT 1 FROM public.portal_configuracoes
      WHERE portal_ativo IS DISTINCT FROM false
        OR abertura_portal_ativo IS DISTINCT FROM false
        OR consulta_protocolo_ativo IS DISTINCT FROM false
    )
  THEN
    RAISE EXCEPTION 'ETAPA_603_BLOQUEADA: algum portal nao esta desativado';
  END IF;

  v_lookup:=to_regprocedure('public.consultar_protocolo(text,uuid)');
  v_rls:=to_regprocedure('public.rls_auto_enable()');
  v_municipios:=to_regprocedure('public.v19_listar_municipios_portal(uuid)');

  IF v_lookup IS NULL OR v_rls IS NULL OR v_municipios IS NULL THEN
    RAISE EXCEPTION 'ETAPA_603_BLOQUEADA: funcao esperada ausente';
  END IF;

  SELECT lower(regexp_replace(p.prosrc,'[[:space:]]+',' ','g'))
    INTO v_src
  FROM pg_proc p
  WHERE p.oid=v_lookup
    AND p.prokind='f'
    AND p.prosecdef IS TRUE
    AND p.provolatile='s'
    AND EXISTS (
      SELECT 1 FROM unnest(COALESCE(p.proconfig,ARRAY[]::text[])) x(cfg)
      WHERE split_part(x.cfg,'=',1)='search_path'
        AND split_part(x.cfg,'=',2) IN ('','""')
    );
  IF v_src IS NULL
    OR position('pc.portal_ativo is true' in v_src)=0
    OR position('pc.consulta_protocolo_ativo is true' in v_src)=0
    OR position('c.consorcio_id = p_consorcio_id' in v_src)=0
    OR position('c.origem = ''público''' in v_src)=0
  THEN
    RAISE EXCEPTION 'ETAPA_603_BLOQUEADA: consulta de protocolo alterada ou sem escopo';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid=v_rls AND p.prosecdef IS TRUE
      AND p.prorettype='pg_catalog.event_trigger'::regtype
      AND EXISTS (
        SELECT 1 FROM unnest(COALESCE(p.proconfig,ARRAY[]::text[])) x(cfg)
        WHERE split_part(x.cfg,'=',1)='search_path'
          AND replace(split_part(x.cfg,'=',2),' ','')='pg_catalog'
      )
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_event_trigger t
    WHERE t.evtfoid=v_rls AND t.evtname='ensure_rls'
      AND t.evtenabled='O'
  ) THEN
    RAISE EXCEPTION 'ETAPA_603_BLOQUEADA: gatilho ensure_rls inesperado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid=v_municipios AND p.prosecdef IS TRUE
      AND has_function_privilege('anon',p.oid,'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'ETAPA_603_BLOQUEADA: catalogo publico de municipios divergente';
  END IF;
END
$guard$;

-- Consulta de protocolo SOMENTE via Edge Function, apos rate-limit.
-- Nao ha consulta direta via PostgREST para anon ou usuario autenticado.
REVOKE ALL ON FUNCTION public.consultar_protocolo(text,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consultar_protocolo(text,uuid)
  TO service_role;

-- Funcao de EVENT TRIGGER nao e endpoint de cliente.
-- Remover EXECUTE generico sem apagar ou desabilitar o gatilho ensure_rls.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()
  FROM PUBLIC,anon,authenticated;

-- Garantias atomicas: impossivel deixar anon acessando a consulta.
DO $guard$
BEGIN
 IF has_function_privilege('anon',
    'public.consultar_protocolo(text,uuid)'::regprocedure,'EXECUTE')
    OR has_function_privilege('authenticated',
    'public.consultar_protocolo(text,uuid)'::regprocedure,'EXECUTE')
    OR NOT has_function_privilege('service_role',
    'public.consultar_protocolo(text,uuid)'::regprocedure,'EXECUTE')
 THEN
   RAISE EXCEPTION 'ETAPA_603_BLOQUEADA: permissao indevida da consulta';
 END IF;
 IF has_function_privilege('anon',
    'public.rls_auto_enable()'::regprocedure,'EXECUTE')
    OR has_function_privilege('authenticated',
    'public.rls_auto_enable()'::regprocedure,'EXECUTE')
 THEN
   RAISE EXCEPTION 'ETAPA_603_BLOQUEADA: funcao do gatilho ainda publica';
 END IF;
 IF NOT has_function_privilege('anon',
    'public.v19_listar_municipios_portal(uuid)'::regprocedure,'EXECUTE')
    OR NOT EXISTS(
      SELECT 1 FROM pg_event_trigger t
      WHERE t.evtname='ensure_rls' AND t.evtenabled='O'
        AND t.evtfoid='public.rls_auto_enable()'::regprocedure
    )
 THEN
   RAISE EXCEPTION 'ETAPA_603_BLOQUEADA: catalogo ou evento RLS indisponivel';
 END IF;
END
$guard$;
COMMIT;

SELECT
  p.oid::regprocedure::text AS funcao,
  pg_get_function_result(p.oid) AS retorno,
  has_function_privilege('anon',p.oid,'EXECUTE') AS anon_pode_executar,
  has_function_privilege('authenticated',p.oid,'EXECUTE') AS autenticado_pode_executar,
  has_function_privilege('service_role',p.oid,'EXECUTE') AS service_role_pode_executar,
  (SELECT COUNT(*) FROM pg_event_trigger t
   WHERE t.evtname='ensure_rls' AND t.evtenabled='O'
     AND t.evtfoid='public.rls_auto_enable()'::regprocedure) AS gatilhos_rls_preservados,
  (SELECT COUNT(*) FROM public.portal_configuracoes
   WHERE portal_ativo OR abertura_portal_ativo OR consulta_protocolo_ativo)
    AS portais_ativos,
  (SELECT COUNT(*) FROM public.chamados) AS chamados,
  (SELECT COUNT(*) FROM public.estoques) AS estoques,
  (SELECT COUNT(*) FROM public.movimentacoes) AS movimentos
FROM pg_proc p
WHERE p.oid IN (
   'public.consultar_protocolo(text,uuid)'::regprocedure,
   'public.rls_auto_enable()'::regprocedure,
   'public.v19_listar_municipios_portal(uuid)'::regprocedure
)
ORDER BY funcao;
