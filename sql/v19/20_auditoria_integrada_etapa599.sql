-- Aponte Cidadao V19 — ETAPA 599: AUDITORIA INTEGRADA, SOMENTE LEITURA.
-- NAO altera permissoes, RLS, funcoes, dados ou estados do portal.
-- Executar SOMENTE em xurrhczvyqpwyjemight, NUNCA no banco V18.
-- O retorno e UMA linha com resumos JSON; copiar e enviar ao ChatGPT.
-- PostgreSQL SQL Editor opera com privilegio administrativo; esta
-- auditoria NAO comprova por si so que um JWT de outro perfil sera bloqueado.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '45000ms';

WITH
relacoes_alvo AS (
  SELECT unnest(ARRAY[
    'usuarios','consorcios','cidades','empresas','empresa_cidades',
    'equipes','chamados','chamado_historico','chamado_fotos',
    'materiais','estoques','movimentacoes','chamado_materiais',
    'portal_configuracoes'
  ]) AS tabela
),
politicas_por_tabela AS (
  SELECT a.tabela,
    c.oid,
    c.relrowsecurity AS rls_ativo,
    (SELECT COUNT(*) FROM pg_policy p WHERE p.polrelid=c.oid) AS qtd_politicas,
    (SELECT COALESCE(jsonb_agg(
      jsonb_build_object('nome',p.polname,'comando',
      CASE p.polcmd
        WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
        WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
        WHEN '*' THEN 'ALL' ELSE p.polcmd::text END)
      ORDER BY p.polname),'[]'::jsonb)
     FROM pg_policy p WHERE p.polrelid=c.oid) AS politicas
  FROM relacoes_alvo a
  LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||a.tabela)
),
rpcs AS (
  SELECT p.oid,p.proname,p.prosecdef,
         p.oid::regprocedure::text AS assinatura,
         has_function_privilege('anon',p.oid,'EXECUTE') AS anon_exec,
         has_function_privilege('authenticated',p.oid,'EXECUTE') AS auth_exec,
         EXISTS(
           SELECT 1 FROM unnest(COALESCE(p.proconfig,ARRAY[]::text[])) cfg(x)
           WHERE split_part(cfg.x,'=',1)='search_path'
             AND split_part(cfg.x,'=',2) IN ('','""')
         ) AS search_path_vazio
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND (
    p.proname LIKE 'v19_%' OR p.proname IN (
      'consumir_material_chamado','editar_material_chamado',
      'remover_material_chamado'
    ))
),
resumo AS (
  SELECT
    (SELECT jsonb_build_object(
      'usuarios_ativos',(SELECT COUNT(*) FROM public.usuarios WHERE status='ativo'),
      'consorcios',(SELECT COUNT(*) FROM public.consorcios),
      'empresas',(SELECT COUNT(*) FROM public.empresas),
      'chamados',(SELECT COUNT(*) FROM public.chamados),
      'estoques_empresariais',(SELECT COUNT(*) FROM public.estoques WHERE empresa_id IS NOT NULL),
      'estoques_sem_empresa',(SELECT COUNT(*) FROM public.estoques WHERE empresa_id IS NULL),
      'materiais',(SELECT COUNT(*) FROM public.materiais),
      'movimentacoes',(SELECT COUNT(*) FROM public.movimentacoes),
      'movimentos_legados_sem_estoque',(SELECT COUNT(*) FROM public.movimentacoes WHERE estoque_id IS NULL),
      'consumos_ativos',(SELECT COUNT(*) FROM public.chamado_materiais),
      'fotos_registradas',(SELECT COUNT(*) FROM public.chamado_fotos)
    )) AS contagens,
    (SELECT jsonb_agg(jsonb_build_object(
        'tabela',x.tabela,'existe',x.oid IS NOT NULL,
        'rls',COALESCE(x.rls_ativo,false),
        'politicas',x.qtd_politicas,
        'definicoes',x.politicas,
        'anon_select',CASE WHEN x.oid IS NULL THEN NULL
          ELSE has_table_privilege('anon',x.oid,'SELECT') END,
        'anon_insert',CASE WHEN x.oid IS NULL THEN NULL
          ELSE has_table_privilege('anon',x.oid,'INSERT') END,
        'auth_update_direto',CASE WHEN x.oid IS NULL THEN NULL
          ELSE has_table_privilege('authenticated',x.oid,'UPDATE') END,
        'auth_insert_direto',CASE WHEN x.oid IS NULL THEN NULL
          ELSE has_table_privilege('authenticated',x.oid,'INSERT') END
      ) ORDER BY x.tabela)
     FROM politicas_por_tabela x) AS rls_e_grants,
    (SELECT COALESCE(jsonb_agg(
       jsonb_build_object(
         'funcao',x.assinatura,'security_definer',x.prosecdef,
         'search_path_vazio',x.search_path_vazio,
         'authenticated',x.auth_exec,'anon',x.anon_exec
       ) ORDER BY x.assinatura),'[]'::jsonb)
     FROM rpcs x WHERE x.proname IN (
       'v19_consumir_material_chamado_empresa',
       'v19_editar_material_chamado_empresa',
       'v19_remover_material_chamado_empresa',
       'v19_movimentar_estoque_empresa',
       'v19_criar_material_empresa_com_saldo',
       'v19_listar_estoques_por_empresa',
       'v19_relatorio_estoque_empresarial',
       'v19_registrar_foto',
       'v19_designar_empresa_chamado',
       'v19_assumir_chamado',
       'v19_listar_disponiveis'
     )) AS rpcs_criticas,
    (SELECT jsonb_build_object(
      'quantidade',(SELECT COUNT(*) FROM rpcs),
      'anon_pode_executar',(SELECT COALESCE(jsonb_agg(assinatura ORDER BY assinatura),'[]'::jsonb)
         FROM rpcs WHERE anon_exec),
      'legadas_autenticado',(SELECT COALESCE(jsonb_agg(assinatura ORDER BY assinatura),'[]'::jsonb)
         FROM rpcs
         WHERE auth_exec AND proname IN (
           'consumir_material_chamado','editar_material_chamado',
           'remover_material_chamado','v19_salvar_material',
           'v19_movimentar_estoque'
         )),
      'definer_sem_search_path_vazio',(SELECT COALESCE(jsonb_agg(assinatura ORDER BY assinatura),'[]'::jsonb)
         FROM rpcs WHERE prosecdef AND NOT search_path_vazio)
    )) AS possiveis_riscos_rpc,
    (SELECT jsonb_build_object(
      'posicoes_sem_empresa_ou_vinculo',
        COUNT(*) FILTER(WHERE s.empresa_id IS NULL OR e.id IS NULL
           OR e.consorcio_id IS DISTINCT FROM s.consorcio_id),
      'materiais_exclusivos_em_empresa_diferente',
        COUNT(*) FILTER(WHERE m.empresa_id IS NOT NULL
          AND m.empresa_id IS DISTINCT FROM s.empresa_id),
      'saldos_negativos',COUNT(*) FILTER(
          WHERE s.quantidade_contratada<0 OR s.quantidade_disponivel<0)
    ) FROM public.estoques s
        LEFT JOIN public.empresas e ON e.id=s.empresa_id
        LEFT JOIN public.materiais m ON m.id=s.material_id
    ) AS integridade_estoques,
    (SELECT jsonb_build_object(
      'consorcios_configurados',COUNT(*),
      'portal_ativo',COUNT(*) FILTER(WHERE portal_ativo IS TRUE),
      'abertura_ativa',COUNT(*) FILTER(WHERE abertura_portal_ativo IS TRUE),
      'consulta_protocolo_ativa',COUNT(*) FILTER(WHERE consulta_protocolo_ativo IS TRUE)
    ) FROM public.portal_configuracoes) AS portal,
    (SELECT jsonb_build_object(
      'bucket_existe',COUNT(*)>0,
      'bucket_publico',COALESCE(bool_or(public),false),
      'politicas_storage_objects',(SELECT COUNT(*)
         FROM pg_policy p WHERE p.polrelid=to_regclass('storage.objects'))
    ) FROM storage.buckets WHERE id='chamado-fotos') AS storage_fotos
)
SELECT
  'V19_ETAPA_599_READ_ONLY' AS auditoria,
  contagens,integridade_estoques,portal,storage_fotos,
  possiveis_riscos_rpc,rpcs_criticas,rls_e_grants
FROM resumo;
COMMIT;
