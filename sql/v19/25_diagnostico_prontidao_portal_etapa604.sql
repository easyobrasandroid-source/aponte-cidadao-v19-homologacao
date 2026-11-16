-- Aponte Cidadao V19 — ETAPA 604 — PRONTIDAO REAL DO PORTAL PUBLICO
-- Uma consulta read-only antes da integracao final do portal.
-- Executar SOMENTE no Supabase de HOMOLOGACAO V19: xurrhczvyqpwyjemight.
-- Nao altera flags, RLS, RPCs, usuarios, chamados, saldos ou historico.
-- A implantacao da Edge Function no Supabase nao pode ser provada pelo SQL Editor.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='30000ms';

WITH funcoes_alvo AS (
 SELECT p.oid,
  p.oid::regprocedure::text AS assinatura,
  p.proname AS nome,
  p.prosecdef AS security_definer,
  p.provolatile AS volatilidade,
  p.proconfig AS configuracoes,
  has_function_privilege('anon',p.oid,'EXECUTE') AS anon_executa,
  has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_executa,
  has_function_privilege('service_role',p.oid,'EXECUTE') AS service_role_executa,
  pg_get_functiondef(p.oid) AS definicao_sql
 FROM pg_proc p
 WHERE p.pronamespace='public'::regnamespace
   AND (
     p.proname IN ('v19_criar_chamado_publico_privado',
       'v19_portal_consumir_limite_privado',
       'v19_salvar_config_portal')
     OR p.proname LIKE 'v19_portal_%'
   )
), outras_funcoes AS (
 SELECT p.oid::regprocedure::text AS assinatura,
  p.prosecdef AS security_definer,
  has_function_privilege('anon',p.oid,'EXECUTE') AS anon_executa,
  has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_executa,
  has_function_privilege('service_role',p.oid,'EXECUTE') AS service_role_executa
 FROM pg_proc p
 WHERE p.pronamespace='public'::regnamespace
   AND (p.proname LIKE 'v19_%public%' OR p.proname='consultar_protocolo'
     OR p.proname='v19_listar_municipios_portal'
     OR p.proname='v19_criar_chamado_interno')
), tabelas_alvo AS (
 SELECT n.nspname AS esquema,c.relname AS tabela,c.relrowsecurity AS rls,
   has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
   has_table_privilege('anon',c.oid,'INSERT') AS anon_insert,
   has_table_privilege('anon',c.oid,'UPDATE') AS anon_update,
   has_table_privilege('authenticated',c.oid,'INSERT') AS auth_insert
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p')
   AND (c.relname LIKE '%portal%' OR c.relname LIKE '%limite%'
     OR c.relname LIKE '%rate%' OR c.relname IN ('chamados','chamado_fotos','cidades'))
), triggers_alvo AS (
 SELECT c.relname AS tabela,t.tgname AS gatilho,
   t.tgenabled AS habilitado,
   pg_get_triggerdef(t.oid,true) AS definicao
 FROM pg_trigger t
 JOIN pg_class c ON c.oid=t.tgrelid
 WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace
   AND c.relname IN ('chamados','portal_configuracoes','chamado_fotos')
), colunas_alvo AS (
 SELECT c.table_name AS tabela,c.column_name AS coluna,
   c.data_type AS tipo,c.is_nullable AS anulavel,
   c.column_default AS padrao
 FROM information_schema.columns c
 WHERE c.table_schema='public'
   AND (c.table_name LIKE '%portal%' OR c.table_name LIKE '%limite%'
     OR c.table_name IN ('chamados','portal_configuracoes'))
   AND (c.table_name<>'chamados' OR
    c.column_name IN ('id','protocolo','consorcio_id','cidade_id',
      'empresa_id','origem','chave_requisicao','sla_inicio','sla_prazo',
      'prazo_limite','status','created_at'))
), indices_alvo AS (
 SELECT indexname,tablename,indexdef
 FROM pg_indexes
 WHERE schemaname='public' AND tablename='chamados'
   AND (indexdef ILIKE '%protocolo%'
    OR indexdef ILIKE '%chave_requisicao%'
    OR indexdef ILIKE '%consorcio_id%')
), portais AS (
 SELECT c.nome AS consorcio, p.portal_ativo,p.abertura_portal_ativo,
   p.consulta_protocolo_ativo,p.gps_obrigatorio
 FROM public.portal_configuracoes p
 JOIN public.consorcios c ON c.id=p.consorcio_id
), atrib_especifica AS (
 SELECT c.consorcio_id,c.nome AS municipio,
   count(DISTINCT ec.empresa_id) AS empresas_vinculadas
 FROM public.cidades c
 JOIN public.empresa_cidades ec ON ec.cidade_id=c.id
 GROUP BY c.consorcio_id,c.nome
 HAVING COUNT(DISTINCT ec.empresa_id)>1
)
SELECT
  'V19_ETAPA_604_READ_ONLY' AS diagnostico,
  (SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.assinatura),'[]'::jsonb)
     FROM funcoes_alvo f) AS funcoes_portal,
  (SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.assinatura),'[]'::jsonb)
     FROM outras_funcoes f) AS outras_rpcs_relevantes,
  (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.tabela),'[]'::jsonb)
     FROM tabelas_alvo t) AS tabelas_publicas,
  (SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.tabela,g.gatilho),'[]'::jsonb)
     FROM triggers_alvo g) AS triggers_atuais,
  (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.tabela,c.coluna),'[]'::jsonb)
     FROM colunas_alvo c) AS colunas_portal,
  (SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.indexname),'[]'::jsonb)
     FROM indices_alvo i) AS indices_chamados,
  (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.consorcio),'[]'::jsonb)
     FROM portais p) AS flags_portal,
  (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.municipio),'[]'::jsonb)
     FROM atrib_especifica a) AS municipios_com_multiplas_empresas;
COMMIT;
