-- Aponte Cidadao V19 - ETAPA 613 - Preparacao de ativacao controlada
-- SOMENTE HOMOLOGACAO xurrhczvyqpwyjemight. V18 nao participa.
-- NENHUM PORTAL SERA ATIVADO POR ESTE SQL. Edge permanece desligada.
-- Libera a configuracao real apenas para Master e Consorcio Beta de TESTE.
-- Mantem revogacao de anon e validacao de usuario Auth ativo, sem alterar SLA.

BEGIN;
SET LOCAL statement_timeout = '30000ms';

DO $preflight$
DECLARE
    v_oid oid := to_regprocedure('public.v19_salvar_config_portal(uuid,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text)');
    v_src text;
BEGIN
    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'ETAPA_613_BLOQUEADA: RPC de configuracao ausente';
    END IF;
    v_src := pg_catalog.pg_get_functiondef(v_oid);
    IF position('Bloqueio até homologação dos serviços públicos' IN v_src) = 0
       OR position('p_portal_ativo IS DISTINCT FROM false' IN v_src) = 0
       OR NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid=v_oid)
       OR has_function_privilege('anon',v_oid,'EXECUTE')
       OR NOT has_function_privilege('authenticated',v_oid,'EXECUTE')
       OR has_function_privilege('service_role',v_oid,'EXECUTE')
       OR NOT (
           SELECT 'search_path=""' = ANY(p.proconfig)
                 OR 'search_path=' = ANY(p.proconfig)
           FROM pg_catalog.pg_proc p WHERE p.oid=v_oid
       )
    THEN
        RAISE EXCEPTION 'ETAPA_613_BLOQUEADA: funcao diverge do diagnostico 604';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.portal_configuracoes
        WHERE portal_ativo OR abertura_portal_ativo OR consulta_protocolo_ativo
    ) THEN
        RAISE EXCEPTION 'ETAPA_613_BLOQUEADA: portal ja esta ativo';
    END IF;
END;
$preflight$;

-- Preserva assinatura e permissoes existentes. Nao altera dados.
CREATE OR REPLACE FUNCTION public.v19_salvar_config_portal(p_consorcio_id uuid, p_portal_ativo boolean, p_abertura_portal_ativo boolean, p_consulta_protocolo_ativo boolean, p_gps_obrigatorio boolean, p_mostrar_empresa boolean, p_notificacao_whatsapp boolean, p_telefone_contato text, p_whatsapp_contato text, p_prazo_medio_texto text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_perfil text;
    v_consorcio uuid;
    v_nome_consorcio text;
    v_status_consorcio text;
    v_municipios_elegiveis integer;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Autenticação necessária'
            USING ERRCODE = '42501';
    END IF;

    SELECT u.perfil, u.consorcio_id
    INTO v_perfil, v_consorcio
    FROM public.usuarios u
    WHERE u.auth_user_id = auth.uid()
      AND u.status = 'ativo'
    LIMIT 1;

    IF NOT COALESCE(
        v_perfil = 'master'
        OR (
            v_perfil = 'consorcio'
            AND v_consorcio = p_consorcio_id
        ),
        false
    ) THEN
        RAISE EXCEPTION 'Acesso não autorizado'
            USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.consorcios c
        WHERE c.id = p_consorcio_id
    ) THEN
        RAISE EXCEPTION 'Consórcio não encontrado';
    END IF;

    -- Habilitacao restrita a homologacao BETA; flag de emergencia da Edge Function
    -- permanece independente desta configuracao (PORTAL_INTAKE_ENABLED=false).
    IF p_portal_ativo IS NULL OR p_abertura_portal_ativo IS NULL
       OR p_consulta_protocolo_ativo IS NULL
       OR p_notificacao_whatsapp IS DISTINCT FROM false
    THEN
        RAISE EXCEPTION 'PARAMETROS_PORTAL_INVALIDOS'
            USING ERRCODE = '22023';
    END IF;

    IF p_portal_ativo IS FALSE
       AND (p_abertura_portal_ativo OR p_consulta_protocolo_ativo)
    THEN
        RAISE EXCEPTION 'ATIVACAO_INCONSISTENTE'
            USING ERRCODE = '22023';
    END IF;

    -- GPS obrigatorio so sera liberado quando a RPC de criacao
    -- aplicar a mesma regra no servidor (nao apenas no frontend).
    IF p_abertura_portal_ativo AND COALESCE(p_gps_obrigatorio, false) THEN
        RAISE EXCEPTION 'GPS_OBRIGATORIO_AINDA_NAO_HOMOLOGADO'
            USING ERRCODE = '22023';
    END IF;

    -- A ativacao so pode ser feita por Master, no consorcio Beta de testes.
    -- Consorcio continua autorizado a desligar e salvar outros campos.
    IF p_portal_ativo IS TRUE THEN
        SELECT c.nome, c.status
          INTO v_nome_consorcio, v_status_consorcio
        FROM public.consorcios c
        WHERE c.id = p_consorcio_id;

        IF v_perfil <> 'master'
           OR v_nome_consorcio IS DISTINCT FROM 'TESTE V19 - Consorcio Beta'
           OR v_status_consorcio IS DISTINCT FROM 'ativo'
        THEN
            RAISE EXCEPTION 'ATIVACAO_RESERVADA_AO_MASTER_BETA'
                USING ERRCODE = '42501';
        END IF;

        SELECT count(*)::integer INTO v_municipios_elegiveis
        FROM public.cidades ci
        WHERE ci.consorcio_id = p_consorcio_id
          AND ci.status = 'ativo'
          AND (
              SELECT count(DISTINCT e.id)
              FROM public.empresa_cidades ec
              JOIN public.empresas e
                ON e.id = ec.empresa_id
              WHERE ec.cidade_id = ci.id
                AND e.consorcio_id = p_consorcio_id
                AND e.status = 'ativo'
          ) = 1;

        IF v_municipios_elegiveis < 1 THEN
            RAISE EXCEPTION 'SEM_MUNICIPIO_COM_EMPRESA_UNICA'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    IF length(COALESCE(p_telefone_contato, '')) > 40
       OR length(COALESCE(p_whatsapp_contato, '')) > 40
       OR length(COALESCE(p_prazo_medio_texto, '')) > 150
    THEN
        RAISE EXCEPTION 'Campo excede limite permitido';
    END IF;

    INSERT INTO public.portal_configuracoes (
        consorcio_id,
        portal_ativo,
        abertura_portal_ativo,
        consulta_protocolo_ativo,
        gps_obrigatorio,
        mostrar_empresa,
        notificacao_whatsapp,
        telefone_contato,
        whatsapp_contato,
        prazo_medio_texto,
        updated_at
    )
    VALUES (
        p_consorcio_id,
        p_portal_ativo,
        p_abertura_portal_ativo,
        p_consulta_protocolo_ativo,
        COALESCE(p_gps_obrigatorio, false),
        COALESCE(p_mostrar_empresa, false),
        false,
        NULLIF(btrim(p_telefone_contato), ''),
        NULLIF(btrim(p_whatsapp_contato), ''),
        NULLIF(btrim(p_prazo_medio_texto), ''),
        now()
    )
    ON CONFLICT (consorcio_id)
    DO UPDATE SET
        portal_ativo = EXCLUDED.portal_ativo,
        abertura_portal_ativo = EXCLUDED.abertura_portal_ativo,
        consulta_protocolo_ativo = EXCLUDED.consulta_protocolo_ativo,
        gps_obrigatorio = EXCLUDED.gps_obrigatorio,
        mostrar_empresa = EXCLUDED.mostrar_empresa,
        notificacao_whatsapp = false,
        telefone_contato = EXCLUDED.telefone_contato,
        whatsapp_contato = EXCLUDED.whatsapp_contato,
        prazo_medio_texto = EXCLUDED.prazo_medio_texto,
        updated_at = now();

    RETURN jsonb_build_object(
        'ok', true,
        'consorcio_id', p_consorcio_id
    );
END;
$function$;

DO $verify$
DECLARE
    v_oid oid := to_regprocedure('public.v19_salvar_config_portal(uuid,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text)');
    v_src text := pg_catalog.pg_get_functiondef(v_oid);
BEGIN
    IF position('ATIVACAO_RESERVADA_AO_MASTER_BETA' IN v_src) = 0
       OR position('SEM_MUNICIPIO_COM_EMPRESA_UNICA' IN v_src) = 0
       OR position('GPS_OBRIGATORIO_AINDA_NAO_HOMOLOGADO' IN v_src) = 0
       OR has_function_privilege('anon',v_oid,'EXECUTE')
       OR NOT has_function_privilege('authenticated',v_oid,'EXECUTE')
       OR has_function_privilege('service_role',v_oid,'EXECUTE')
       OR NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid=v_oid)
       OR EXISTS (
           SELECT 1 FROM public.portal_configuracoes
           WHERE portal_ativo OR abertura_portal_ativo OR consulta_protocolo_ativo
       )
    THEN
        RAISE EXCEPTION 'ETAPA_613_BLOQUEADA: verificacao final falhou';
    END IF;
END;
$verify$;

SELECT 'V19_ETAPA_613_CONFIG_BETA_PREPARADA_PORTAIS_DESATIVADOS' AS diagnostico,
       (SELECT count(*) FROM public.portal_configuracoes
        WHERE portal_ativo OR abertura_portal_ativo OR consulta_protocolo_ativo) AS portais_ativos,
       has_function_privilege('anon',to_regprocedure('public.v19_salvar_config_portal(uuid,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text)'),'EXECUTE') AS anon_executa,
       has_function_privilege('authenticated',to_regprocedure('public.v19_salvar_config_portal(uuid,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text)'),'EXECUTE') AS authenticated_executa;
COMMIT;
