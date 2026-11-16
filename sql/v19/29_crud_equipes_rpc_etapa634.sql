-- Aponte Cidadao V19 / ETAPA 634
-- Instalar APENAS no Supabase V19. CRUD seguro via JWT, sem mudar RLS nem o portal.
BEGIN;
CREATE OR REPLACE FUNCTION public.v19_gerenciar_equipe(
  p_acao text, p_equipe_id uuid DEFAULT NULL, p_empresa_id uuid DEFAULT NULL,
  p_nome text DEFAULT NULL, p_tecnico_lider text DEFAULT NULL,
  p_membros integer DEFAULT NULL, p_cidades text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_perfil text; v_uc uuid; v_ue uuid; v_cons uuid;
  v_old public.equipes%ROWTYPE; v_result public.equipes%ROWTYPE;
  v_nome text; v_tecnico text; v_cidades text[];
  v_qty int; v_unique int; v_ids int; v_names int;
  v_acao text := lower(btrim(coalesce(p_acao,'')));
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ACESSO_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;
  SELECT count(*) INTO v_qty FROM public.usuarios u
   WHERE u.auth_user_id=auth.uid() AND u.status='ativo';
  IF v_qty <> 1 THEN
    RAISE EXCEPTION 'PERFIL_ATIVO_UNICO_NAO_ENCONTRADO' USING ERRCODE='42501';
  END IF;
  SELECT u.perfil,u.consorcio_id,u.empresa_id
    INTO v_perfil,v_uc,v_ue FROM public.usuarios u
   WHERE u.auth_user_id=auth.uid() AND u.status='ativo';
  IF v_perfil NOT IN ('master','consorcio','empresa') THEN
    RAISE EXCEPTION 'PERFIL_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;
  IF v_acao NOT IN ('criar','editar','excluir') THEN
    RAISE EXCEPTION 'ACAO_INVALIDA' USING ERRCODE='22023';
  END IF;
  IF v_acao IN ('editar','excluir') THEN
    IF p_equipe_id IS NULL THEN
      RAISE EXCEPTION 'EQUIPE_ID_OBRIGATORIO' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_old FROM public.equipes WHERE id=p_equipe_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'EQUIPE_NAO_ENCONTRADA' USING ERRCODE='22023';
    END IF;
    IF (v_perfil='consorcio' AND v_old.consorcio_id IS DISTINCT FROM v_uc)
       OR (v_perfil='empresa' AND (v_old.consorcio_id IS DISTINCT FROM v_uc
                              OR v_old.empresa_id IS DISTINCT FROM v_ue)) THEN
      RAISE EXCEPTION 'EQUIPE_NAO_AUTORIZADA' USING ERRCODE='42501';
    END IF;
  END IF;
  IF v_acao='excluir' THEN
    DELETE FROM public.equipes WHERE id=v_old.id RETURNING * INTO v_result;
    RETURN jsonb_build_object('ok',true,'acao','excluir',
       'equipe_id',v_result.id,'empresa_id',v_result.empresa_id);
  END IF;

  IF p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'EMPRESA_OBRIGATORIA' USING ERRCODE='22023';
  END IF;
  SELECT e.consorcio_id INTO v_cons FROM public.empresas e
    JOIN public.consorcios co ON co.id=e.consorcio_id
   WHERE e.id=p_empresa_id AND e.status='ativo' AND co.status='ativo'
   FOR SHARE OF e,co;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EMPRESA_OU_CONSORCIO_INATIVO' USING ERRCODE='22023';
  END IF;
  IF (v_perfil='consorcio' AND v_cons IS DISTINCT FROM v_uc)
     OR (v_perfil='empresa' AND (v_cons IS DISTINCT FROM v_uc
                                OR p_empresa_id IS DISTINCT FROM v_ue)) THEN
    RAISE EXCEPTION 'EMPRESA_FORA_DO_ESCOPO' USING ERRCODE='42501';
  END IF;
  IF v_acao='editar' AND v_old.consorcio_id IS DISTINCT FROM v_cons THEN
    RAISE EXCEPTION 'TRANSFERENCIA_ENTRE_CONSORCIOS_NAO_PERMITIDA'
      USING ERRCODE='42501';
  END IF;

  v_nome:=nullif(btrim(coalesce(p_nome,'')),'');
  v_tecnico:=nullif(btrim(coalesce(p_tecnico_lider,'')),'');
  v_cidades:=ARRAY(SELECT btrim(nome)
                     FROM unnest(coalesce(p_cidades,ARRAY[]::text[])) AS t(nome));
  IF v_nome IS NULL OR length(v_nome) NOT BETWEEN 2 AND 120
     OR length(coalesce(v_tecnico,''))>160 OR p_membros IS NULL
     OR p_membros NOT BETWEEN 1 AND 100 OR cardinality(v_cidades)>100
     OR EXISTS(SELECT 1 FROM unnest(v_cidades) AS t(nome)
                 WHERE nome IS NULL OR nome='') THEN
    RAISE EXCEPTION 'DADOS_EQUIPE_INVALIDOS' USING ERRCODE='22023';
  END IF;
  SELECT count(DISTINCT nome)::integer INTO v_unique
    FROM unnest(v_cidades) AS t(nome);
  IF v_unique <> cardinality(v_cidades) THEN
    RAISE EXCEPTION 'MUNICIPIOS_DUPLICADOS' USING ERRCODE='22023';
  END IF;
  SELECT count(DISTINCT c.id)::integer,count(DISTINCT c.nome)::integer
    INTO v_ids,v_names FROM public.cidades c
    JOIN public.empresa_cidades ec ON ec.cidade_id=c.id
   WHERE ec.empresa_id=p_empresa_id AND c.consorcio_id=v_cons
     AND c.status='ativo' AND c.nome=ANY(v_cidades);
  IF v_ids<>cardinality(v_cidades) OR v_names<>cardinality(v_cidades) THEN
    RAISE EXCEPTION 'MUNICIPIOS_NAO_VINCULADOS_A_EMPRESA' USING ERRCODE='42501';
  END IF;

  IF v_acao='criar' THEN
    IF p_equipe_id IS NOT NULL THEN
      RAISE EXCEPTION 'ID_NAO_PERMITIDO_NA_CRIACAO' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.equipes
      (consorcio_id,empresa_id,nome,tecnico_lider,membros,cidades,status)
    VALUES(v_cons,p_empresa_id,v_nome,v_tecnico,p_membros,v_cidades,'ativa')
    RETURNING * INTO v_result;
  ELSE
    UPDATE public.equipes SET empresa_id=p_empresa_id,nome=v_nome,
      tecnico_lider=v_tecnico,membros=p_membros,cidades=v_cidades
    WHERE id=v_old.id RETURNING * INTO v_result;
  END IF;
  RETURN jsonb_build_object('ok',true,'acao',v_acao,
    'equipe_id',v_result.id,'empresa_id',v_result.empresa_id,
    'consorcio_id',v_result.consorcio_id,'nome',v_result.nome);
END;
$fn$;
-- A API exige JWT authenticated; nenhuma escrita direta na tabela foi liberada.
REVOKE ALL ON FUNCTION public.v19_gerenciar_equipe(
 text,uuid,uuid,text,text,integer,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v19_gerenciar_equipe(
 text,uuid,uuid,text,text,integer,text[]) TO authenticated;
COMMIT;
SELECT 'V19_ETAPA_634_RPC_EQUIPES_INSTALADA' AS diagnostico,
 has_function_privilege('authenticated',
  'public.v19_gerenciar_equipe(text,uuid,uuid,text,text,integer,text[])','EXECUTE')
  AS authenticated_executa,
 has_function_privilege('anon',
  'public.v19_gerenciar_equipe(text,uuid,uuid,text,text,integer,text[])','EXECUTE')
  AS anon_executa,
 (SELECT relrowsecurity FROM pg_class WHERE oid='public.equipes'::regclass)
  AS rls_preservado,
 (SELECT count(*) FROM public.equipes) AS total_equipes;
