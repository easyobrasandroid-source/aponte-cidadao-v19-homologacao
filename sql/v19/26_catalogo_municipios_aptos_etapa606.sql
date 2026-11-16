-- Aponte Cidadao V19 - ETAPA 606
-- Filtra o catalogo de municipios para exibicao publica apenas quando existe
-- exatamente UMA empresa ATIVA do mesmo consorcio vinculada ao municipio.
-- A RPC de criacao ja exige este mesmo requisito. Nao inventar responsavel
-- e nao excluir vinculos validos de cidades com duas empresas.
--
-- Aplicar manualmente SOMENTE no Supabase V19: xurrhczvyqpwyjemight.
-- ALTERA APENAS a definicao da RPC publica de catalogo.
-- Nao altera flags do portal, dados, RLS, saldos nem a V18.
-- Este SQL NAO habilita o portal.

BEGIN;
SET LOCAL statement_timeout = '30000ms';

DO $preflight$
DECLARE
  v_oid oid;
  v_definer boolean;
  v_volatilidade "char";
  v_config text[];
BEGIN
  SELECT p.oid, p.prosecdef, p.provolatile, p.proconfig
    INTO v_oid, v_definer, v_volatilidade, v_config
  FROM pg_catalog.pg_proc p
  WHERE p.oid = to_regprocedure('public.v19_listar_municipios_portal(uuid)');

  IF v_oid IS NULL OR v_definer IS DISTINCT FROM true
     OR v_volatilidade IS DISTINCT FROM 's'
     OR NOT (
       'search_path=""' = ANY(v_config)
       OR 'search_path=' = ANY(v_config)
     )
     OR NOT has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'ETAPA_606_BLOQUEADA: RPC de catalogo divergente do diagnostico 605';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.portal_configuracoes pc
    WHERE pc.portal_ativo IS TRUE
       OR pc.abertura_portal_ativo IS TRUE
       OR pc.consulta_protocolo_ativo IS TRUE
  ) THEN
    RAISE EXCEPTION 'ETAPA_606_BLOQUEADA: portal ativo; nao substituir sem nova auditoria';
  END IF;
END;
$preflight$;

-- Mantem a mesma assinatura, permissoes, SECURITY DEFINER,
-- STABLE e search_path vazio da funcao homologada.
CREATE OR REPLACE FUNCTION public.v19_listar_municipios_portal(
  p_consorcio_id uuid
)
RETURNS TABLE(cidade_id uuid, municipio text, uf text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT c.id AS cidade_id,
         c.nome AS municipio,
         btrim(c.uf::text) AS uf
  FROM public.cidades c
  JOIN public.consorcios co ON co.id = c.consorcio_id
  JOIN public.portal_configuracoes pc ON pc.consorcio_id = c.consorcio_id
  WHERE c.consorcio_id = p_consorcio_id
    AND c.status = 'ativo'
    AND co.status = 'ativo'
    AND pc.portal_ativo IS TRUE
    AND pc.abertura_portal_ativo IS TRUE
    AND (
      SELECT count(DISTINCT e.id)
      FROM public.empresas e
      JOIN public.empresa_cidades ec ON ec.empresa_id = e.id
      WHERE ec.cidade_id = c.id
        AND e.consorcio_id = c.consorcio_id
        AND e.status = 'ativo'
    ) = 1
  ORDER BY c.nome;
$function$;

DO $verify$
DECLARE v_oid oid;
BEGIN
  v_oid := to_regprocedure('public.v19_listar_municipios_portal(uuid)');
  IF NOT has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR (SELECT NOT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid=v_oid)
  THEN
    RAISE EXCEPTION 'ETAPA_606_BLOQUEADA: permissoes ou definicao inesperadas';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.consorcios co
    CROSS JOIN LATERAL public.v19_listar_municipios_portal(co.id) m
    WHERE NOT EXISTS (
      SELECT 1 FROM public.cidades c
      WHERE c.id=m.cidade_id
        AND c.consorcio_id=co.id
        AND c.status='ativo'
        AND (SELECT count(DISTINCT e.id)
             FROM public.empresas e
             JOIN public.empresa_cidades ec ON ec.empresa_id=e.id
             WHERE ec.cidade_id=c.id AND e.consorcio_id=c.consorcio_id
               AND e.status='ativo')=1
    )
  ) THEN
    RAISE EXCEPTION 'ETAPA_606_BLOQUEADA: catalogo retornou municipio inelegivel';
  END IF;
END;
$verify$;

-- Diagnostico de aptidao independente das flags (que permanecem FALSE).
SELECT 'V19_ETAPA_606_OK_PORTAL_DESATIVADO' AS diagnostico,
       COALESCE(jsonb_agg(
         jsonb_build_object(
           'consorcio', co.nome,
           'municipio', c.nome,
           'empresas_ativas', n.total,
           'elegivel_para_abertura', n.total=1
         ) ORDER BY co.nome, c.nome
       ),'[]'::jsonb) AS municipios
FROM public.cidades c
JOIN public.consorcios co ON co.id=c.consorcio_id
CROSS JOIN LATERAL (
  SELECT count(DISTINCT e.id)::integer AS total
  FROM public.empresas e
  JOIN public.empresa_cidades ec ON ec.empresa_id=e.id
  WHERE ec.cidade_id=c.id
    AND e.consorcio_id=c.consorcio_id
    AND e.status='ativo'
) n
WHERE c.status='ativo'
  AND co.status='ativo';
COMMIT;
