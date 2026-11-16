-- APONTE CIDADAO V19 — ETAPA 601, PACOTE A
-- Endurecimento nao destrutivo das cinco funcoes de contexto e
-- desativacao preventiva dos tres servicos publicos do Consorcio Beta TESTE.
-- Apenas V19 de homologacao: xurrhczvyqpwyjemight. NUNCA V18.
-- Esta migracao NAO apaga chamados, usuarios, materiais, estoques, fotos
-- ou historico. Nao altera o codigo das funcoes (somente search_path).
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30000ms';

DO $guard$
DECLARE
  v_nom text;
  v_func record;
  v_found integer:=0;
  v_beta uuid:='9674d593-7d2b-44da-8d4d-97070bc95aca'::uuid;
  v_alfa uuid:='cf264e88-c591-4098-bd26-1740d19d3752'::uuid;
BEGIN
  -- Evitar alteracoes caso a estrutura ou os vinculos tenham mudado.
  IF (SELECT COUNT(*) FROM public.portal_configuracoes)<>2
     OR NOT EXISTS (
       SELECT 1 FROM public.consorcios c
       WHERE c.id=v_beta AND c.nome='TESTE V19 - Consorcio Beta')
     OR NOT EXISTS (
       SELECT 1 FROM public.consorcios c
       WHERE c.id=v_alfa AND c.nome='TESTE V19 - Consorcio Alfa')
  THEN RAISE EXCEPTION 'ETAPA_601_BLOQUEADA: consorcios divergentes';
  END IF;

  PERFORM 1 FROM public.portal_configuracoes pc
  WHERE pc.consorcio_id=v_beta FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ETAPA_601_BLOQUEADA: configuracao Beta ausente';
  END IF;

  IF NOT EXISTS (
     SELECT 1 FROM public.portal_configuracoes pc
     WHERE pc.consorcio_id=v_alfa
       AND pc.portal_ativo IS FALSE
       AND pc.abertura_portal_ativo IS FALSE
       AND pc.consulta_protocolo_ativo IS FALSE
  ) THEN
    RAISE EXCEPTION 'ETAPA_601_BLOQUEADA: Alfa nao esta desativado';
  END IF;

  -- Os cinco corpos foram conferidos na etapa 600: usam public.usuarios
  -- e auth.uid() explicitamente, logo independem de public no search_path.
  FOR v_nom IN
    SELECT unnest(ARRAY[
       'v19_cidade_atual','v19_consorcio_atual',
       'v19_empresa_atual','v19_perfil_atual','v19_usuario_atual'
    ])
  LOOP
    SELECT p.oid,p.prosecdef,p.prosrc,p.proconfig
      INTO v_func
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=v_nom
        AND p.pronargs=0;
    IF NOT FOUND OR v_func.prosecdef IS NOT TRUE
       OR position('public.usuarios' in lower(v_func.prosrc))=0
       OR position('auth.uid()' in lower(v_func.prosrc))=0
       OR position('status=' in lower(v_func.prosrc))=0
    THEN
      RAISE EXCEPTION 'ETAPA_601_BLOQUEADA: funcao % alterada ou ausente',v_nom;
    END IF;
    v_found:=v_found+1;
  END LOOP;

  IF v_found<>5 THEN
    RAISE EXCEPTION 'ETAPA_601_BLOQUEADA: faltam funcoes de contexto';
  END IF;
END
$guard$;

-- SOMENTE cinco definers auxiliares: codigo, grants e assinaturas intactos.
ALTER FUNCTION public.v19_cidade_atual() SET search_path TO '';
ALTER FUNCTION public.v19_consorcio_atual() SET search_path TO '';
ALTER FUNCTION public.v19_empresa_atual() SET search_path TO '';
ALTER FUNCTION public.v19_perfil_atual() SET search_path TO '';
ALTER FUNCTION public.v19_usuario_atual() SET search_path TO '';

-- Fail closed: desligar APENAS os tres servicos publicos do Beta teste.
-- Manter preferencia de GPS/contatos, demais consorcios e historico.
UPDATE public.portal_configuracoes
SET portal_ativo=false,
    abertura_portal_ativo=false,
    consulta_protocolo_ativo=false,
    updated_at=now()
WHERE consorcio_id='9674d593-7d2b-44da-8d4d-97070bc95aca'::uuid
  AND (portal_ativo IS DISTINCT FROM false
    OR abertura_portal_ativo IS DISTINCT FROM false
    OR consulta_protocolo_ativo IS DISTINCT FROM false);

-- Validacao dentro da mesma transacao. Qualquer divergencia faz ROLLBACK.
DO $guard$
DECLARE v_count int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.portal_configuracoes
    WHERE portal_ativo IS TRUE OR abertura_portal_ativo IS TRUE
       OR consulta_protocolo_ativo IS TRUE
  ) THEN
    RAISE EXCEPTION 'ETAPA_601_BLOQUEADA: existe portal ativo';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN (
       'v19_cidade_atual','v19_consorcio_atual','v19_empresa_atual',
       'v19_perfil_atual','v19_usuario_atual'
    )
    AND p.prosecdef
    AND EXISTS (
      SELECT 1 FROM unnest(coalesce(p.proconfig,ARRAY[]::text[])) x(cfg)
      WHERE split_part(x.cfg,'=',1)='search_path'
        AND split_part(x.cfg,'=',2) IN ('','""')
    );
  IF v_count<>5 THEN
    RAISE EXCEPTION 'ETAPA_601_BLOQUEADA: search_path nao endurecido';
  END IF;
END
$guard$;
COMMIT;

-- Resultado resumido, somente leitura, sem dados pessoais.
SELECT
  'V19_ETAPA_601' AS pacote,
  (SELECT jsonb_agg(
    jsonb_build_object(
      'consorcio',c.nome,'portal_ativo',p.portal_ativo,
      'abertura_ativa',p.abertura_portal_ativo,
      'consulta_ativa',p.consulta_protocolo_ativo
    ) ORDER BY c.nome)
   FROM public.portal_configuracoes p
   JOIN public.consorcios c ON c.id=p.consorcio_id) AS portal,
  (SELECT jsonb_agg(jsonb_build_object(
    'funcao',x.proname,'security_definer',x.prosecdef,
    'search_path',x.proconfig,
    'anon_executa',has_function_privilege('anon',x.oid,'EXECUTE')
  ) ORDER BY x.proname)
   FROM pg_proc x
   WHERE x.pronamespace='public'::regnamespace
     AND x.proname IN (
       'v19_cidade_atual','v19_consorcio_atual',
       'v19_empresa_atual','v19_perfil_atual','v19_usuario_atual'
     )) AS helpers,
  (SELECT jsonb_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text)
   FROM pg_proc p
   WHERE p.pronamespace='public'::regnamespace
     AND has_function_privilege('anon',p.oid,'EXECUTE')
  ) AS todas_rpcs_publicas_executaveis_por_anon,
  (SELECT COUNT(*) FROM public.estoques) AS estoques,
  (SELECT COUNT(*) FROM public.movimentacoes) AS movimentos,
  (SELECT COUNT(*) FROM public.chamados) AS chamados;
