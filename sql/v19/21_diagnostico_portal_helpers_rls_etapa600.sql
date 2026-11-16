-- APONTE CIDADAO V19 — ETAPA 600
-- Diagnostico complementar UNICO para fechar o pacote A de seguranca.
-- SOMENTE LEITURA. Nao altera portal, funcoes, policies ou dados.
-- Executar SOMENTE no projeto Supabase V19 xurrhczvyqpwyjemight.
-- Retorna uma linha com quatro campos JSON; encaminhar os quatro campos.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30000ms';

WITH
nomes_alvo(nome) AS (
  VALUES
    ('v19_cidade_atual'),
    ('v19_consorcio_atual'),
    ('v19_empresa_atual'),
    ('v19_perfil_atual'),
    ('v19_usuario_atual'),
    ('v19_salvar_config_portal'),
    ('v19_listar_municipios_portal')
),
definicoes AS (
  SELECT n.nome,
    COALESCE(p.oid::regprocedure::text,'NAO_ENCONTRADA') AS assinatura,
    COALESCE(p.prosecdef,false) AS security_definer,
    COALESCE(p.proconfig::text,'') AS configuracoes,
    CASE WHEN p.oid IS NULL THEN NULL
      ELSE has_function_privilege('authenticated',p.oid,'EXECUTE')
    END AS authenticated,
    CASE WHEN p.oid IS NULL THEN NULL
      ELSE has_function_privilege('anon',p.oid,'EXECUTE')
    END AS anon,
    CASE WHEN p.oid IS NULL THEN NULL
      ELSE pg_get_functiondef(p.oid)
    END AS codigo_sql
  FROM nomes_alvo n
  LEFT JOIN pg_proc p ON p.proname=n.nome
    AND p.pronamespace='public'::regnamespace
),
politicas AS (
  SELECT c.relname AS tabela, p.polname AS politica,
     CASE p.polcmd WHEN 'r' THEN 'SELECT'
       WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE'
       WHEN 'd' THEN 'DELETE' ELSE 'ALL' END AS comando,
     pg_get_expr(p.polqual,p.polrelid) AS usando,
     pg_get_expr(p.polwithcheck,p.polrelid) AS validacao
  FROM pg_policy p
  JOIN pg_class c ON c.oid=p.polrelid
  WHERE c.relnamespace='public'::regnamespace
    AND c.relname IN (
      'materiais','estoques','movimentacoes',
      'empresa_cidades','portal_configuracoes',
      'chamados','chamado_fotos'
    )
),
escopo_portal AS (
  SELECT p.consorcio_id, c.nome AS consorcio_nome,
    p.portal_ativo,p.abertura_portal_ativo,
    p.consulta_protocolo_ativo,p.gps_obrigatorio,
    p.notificacao_whatsapp
  FROM public.portal_configuracoes p
  LEFT JOIN public.consorcios c ON c.id=p.consorcio_id
)
SELECT
  'V19_ETAPA_600_READ_ONLY' AS diagnostico,
  (SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.nome,d.assinatura),
    '[]'::jsonb) FROM definicoes d) AS funcoes_criticas,
  (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.tabela,x.politica),
    '[]'::jsonb) FROM politicas x) AS regras_rls,
  (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.consorcio_nome),
    '[]'::jsonb) FROM escopo_portal x) AS flags_portal_por_consorcio;
COMMIT;
