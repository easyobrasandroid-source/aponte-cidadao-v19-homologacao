-- APONTE CIDADAO V19 — ETAPA 602: EXPOSICAO DE RPCs PUBLICAS
-- Auditoria de codigo REAL do banco, exclusivamente read-only.
-- Executar apenas em xurrhczvyqpwyjemight (homologacao V19).
-- Nao usar na V18. Nao invoca nem altera as funcoes.
--
-- Analisa as duas rotinas anon adicionais identificadas na etapa 601.
-- consultar_protocolo pode ser chamada diretamente via PostgREST,
-- ignorando o rate limit da Edge Function: verificar antes de liberar portal.
-- rls_auto_enable pode ser funcao de event trigger ou de administracao:
-- somente o tipo/codigo real determina se oferece risco.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30000ms';

WITH nomes(assinatura) AS (
  VALUES
   ('public.consultar_protocolo(text,uuid)'),
   ('public.rls_auto_enable()'),
   ('public.v19_listar_municipios_portal(uuid)')
),
funcoes AS (
 SELECT
   n.assinatura AS buscada,
   p.oid,
   p.oid::regprocedure::text AS encontrada,
   pg_get_userbyid(p.proowner) AS proprietario,
   l.lanname AS linguagem,
   p.prokind AS tipo_rotina,
   CASE WHEN p.oid IS NULL THEN NULL ELSE pg_get_function_result(p.oid) END AS retorno,
   p.prosecdef AS security_definer,
   p.proconfig AS configuracoes,
   p.proacl::text AS acl_explicita,
   CASE WHEN p.oid IS NULL THEN NULL
       ELSE has_function_privilege('anon',p.oid,'EXECUTE') END AS anon_exec,
   CASE WHEN p.oid IS NULL THEN NULL
       ELSE has_function_privilege('authenticated',p.oid,'EXECUTE') END AS authenticated_exec,
   CASE WHEN p.oid IS NULL THEN NULL
       ELSE has_function_privilege('service_role',p.oid,'EXECUTE') END AS service_role_exec,
   CASE WHEN p.oid IS NULL THEN NULL
       ELSE pg_get_functiondef(p.oid) END AS codigo_sql
 FROM nomes n
 LEFT JOIN pg_proc p ON p.oid=to_regprocedure(n.assinatura)
 LEFT JOIN pg_language l ON l.oid=p.prolang
),
gatilhos_evento AS (
 SELECT e.evtname AS nome,e.evtevent AS evento,e.evtenabled AS habilitado,
        e.evtfoid::regprocedure::text AS funcao,
        COALESCE(array_to_string(e.evttags,','),'TODOS') AS comandos
 FROM pg_event_trigger e
 WHERE e.evtfoid=to_regprocedure('public.rls_auto_enable()')
),
gatilhos_tabela AS (
 SELECT t.tgname AS nome,t.tgenabled AS habilitado,
        t.tgrelid::regclass::text AS tabela
 FROM pg_trigger t
 WHERE t.tgfoid=to_regprocedure('public.rls_auto_enable()')
   AND NOT t.tgisinternal
),
portal AS (
 SELECT c.nome AS consorcio,p.portal_ativo,
   p.abertura_portal_ativo,p.consulta_protocolo_ativo
 FROM public.portal_configuracoes p
 JOIN public.consorcios c ON c.id=p.consorcio_id
)
SELECT
 'V19_ETAPA_602_READ_ONLY' AS diagnostico,
 (SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.buscada),
  '[]'::jsonb) FROM funcoes f) AS definicoes_rpcs,
 (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.nome),
  '[]'::jsonb) FROM gatilhos_evento x) AS gatilhos_evento,
 (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.nome),
  '[]'::jsonb) FROM gatilhos_tabela x) AS gatilhos_tabela,
 (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.consorcio),
  '[]'::jsonb) FROM portal x) AS flags_portal,
 (SELECT jsonb_build_object(
   'anon_uso_public',has_schema_privilege('anon','public','USAGE'),
   'authenticated_uso_public',has_schema_privilege('authenticated','public','USAGE')
 )) AS acesso_schema;
COMMIT;
