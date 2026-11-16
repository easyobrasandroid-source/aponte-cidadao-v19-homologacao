-- Aponte Cidadao V19 - ETAPA 607 - Fail-closed idempotencia do portal
-- Fonte: definicao REAL do banco retornada pelo diagnostico 604.
-- Mudanca isolada: validar portal/consorcio/cidade ANTES de devolver
-- resultado de uma chave de requisicao ja processada.
-- FOR SHARE das linhas de configuracao/cidade/consorcio serializa
-- a criacao com uma eventual desativacao do portal.
--
-- Executar manualmente SOMENTE no Supabase V19: xurrhczvyqpwyjemight.
-- Nao habilita flags, nao cria chamado, nao muda usuarios, saldos ou RLS.
-- Se a funcao diferir do diagnostico 604, ABORTAR em vez de sobrescrever.

BEGIN;
SET LOCAL statement_timeout = '30000ms';

DO $preflight$
DECLARE
  v_oid oid := to_regprocedure('public.v19_criar_chamado_publico_privado(uuid,uuid,uuid,text,text,text,text,text,integer,text,text,text,numeric,numeric,text)');
  v_src text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'ETAPA_607_BLOQUEADA: RPC de criacao nao encontrada';
  END IF;
  v_src := pg_catalog.pg_get_functiondef(v_oid);

  -- SHA legivel em MD5: somente como controle de equivalencia da definicao,
  -- nao para proteger senhas ou dados pessoais.
  IF pg_catalog.md5(v_src) <> '437c44c107646708cc76f8deb40f4208' THEN
    RAISE EXCEPTION 'ETAPA_607_BLOQUEADA: funcao SQL diverge do diagnostico 604';
  END IF;
  IF NOT (SELECT p.prosecdef AND p.provolatile='v' FROM pg_catalog.pg_proc p WHERE p.oid=v_oid)
     OR has_function_privilege('anon',v_oid,'EXECUTE')
     OR has_function_privilege('authenticated',v_oid,'EXECUTE')
     OR NOT has_function_privilege('service_role',v_oid,'EXECUTE')
  THEN
    RAISE EXCEPTION 'ETAPA_607_BLOQUEADA: privilegios ou seguranca da RPC divergentes';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.portal_configuracoes
    WHERE portal_ativo IS TRUE OR abertura_portal_ativo IS TRUE
       OR consulta_protocolo_ativo IS TRUE
  ) THEN
    RAISE EXCEPTION 'ETAPA_607_BLOQUEADA: existe portal ativo';
  END IF;
END;
$preflight$;

-- Este bloqueio existe somente durante a breve migracao.
LOCK TABLE public.portal_configuracoes IN SHARE MODE;

-- Definicao completa preserva normalizacao, hash, advisory lock,
-- atribuição unica, SLA, historico, retorno e grants preexistentes.
CREATE OR REPLACE FUNCTION public.v19_criar_chamado_publico_privado(p_chave_requisicao uuid, p_consorcio_id uuid, p_cidade_id uuid, p_tipo text, p_area text, p_bairro text, p_endereco text, p_referencia text, p_qtd integer, p_observacoes text, p_solicitante_nome text, p_solicitante_tel text, p_latitude numeric, p_longitude numeric, p_loc_src text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_nome text;
    v_tel text;
    v_tipo text;
    v_area text;
    v_bairro text;
    v_endereco text;
    v_referencia text;
    v_obs text;
    v_loc_src text;

    v_hash text;
    v_existente record;

    v_cidade_nome text;
    v_empresa_id uuid;
    v_empresa_nome text;
    v_qtd_empresas integer;

    v_chamado_id uuid;
    v_protocolo text;
    v_sla integer;
    v_criado timestamptz;
    v_sla_esperado integer;
BEGIN
    -- 1. Somente a API com papel de serviço pode executar.
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'ACESSO_NAO_AUTORIZADO'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Identificadores obrigatórios.
    IF p_chave_requisicao IS NULL
       OR p_consorcio_id IS NULL
       OR p_cidade_id IS NULL THEN
        RAISE EXCEPTION 'IDENTIFICADORES_INVALIDOS'
            USING ERRCODE = '22023';
    END IF;

    -- 3. Normalização dos dados.
    v_nome := nullif(btrim(p_solicitante_nome), '');
    v_tel := regexp_replace(
        coalesce(p_solicitante_tel, ''),
        '[^0-9]', '', 'g'
    );

    v_tipo := btrim(coalesce(p_tipo, ''));
    v_area := btrim(coalesce(p_area, ''));
    v_bairro := nullif(btrim(p_bairro), '');
    v_endereco := nullif(btrim(p_endereco), '');
    v_referencia := nullif(btrim(p_referencia), '');
    v_obs := nullif(btrim(p_observacoes), '');
    v_loc_src := coalesce(
        nullif(btrim(p_loc_src), ''),
        'manual'
    );

    -- 4. Validação dos dados.
    IF v_nome IS NULL
       OR length(v_nome) NOT BETWEEN 2 AND 120
       OR length(v_tel) NOT BETWEEN 10 AND 13
       OR v_area NOT IN ('Urbana', 'Rural')
       OR v_tipo NOT IN (
           'Lâmpada apagada',
           'Lâmpada piscando',
           'Acesa durante o dia',
           'Lâmpada com defeito',
           'Poste danificado',
           'Outro'
       )
       OR p_qtd IS NULL
       OR p_qtd NOT BETWEEN 1 AND 999
       OR length(coalesce(v_bairro, '')) > 160
       OR length(coalesce(v_endereco, '')) > 300
       OR length(coalesce(v_referencia, '')) > 300
       OR length(coalesce(v_obs, '')) > 500 THEN

        RAISE EXCEPTION 'DADOS_INVALIDOS'
            USING ERRCODE = '22023';
    END IF;

    IF v_endereco IS NULL AND p_latitude IS NULL THEN
        RAISE EXCEPTION 'LOCALIZACAO_OBRIGATORIA'
            USING ERRCODE = '22023';
    END IF;

    IF (p_latitude IS NULL) <> (p_longitude IS NULL)
       OR (
           p_latitude IS NOT NULL
           AND (
               p_latitude < -90
               OR p_latitude > 90
           )
       )
       OR (
           p_longitude IS NOT NULL
           AND (
               p_longitude < -180
               OR p_longitude > 180
           )
       ) THEN
        RAISE EXCEPTION 'COORDENADAS_INVALIDAS'
            USING ERRCODE = '22023';
    END IF;

    IF v_loc_src NOT IN (
        'manual',
        'gps_mobile',
        'address_geocoding',
        'minimap_confirmed'
    ) OR (
        p_latitude IS NULL
        AND v_loc_src <> 'manual'
    ) THEN
        RAISE EXCEPTION 'ORIGEM_LOCALIZACAO_INVALIDA'
            USING ERRCODE = '22023';
    END IF;

    -- 5. Hash dos dados normalizados.
    -- Não armazena dados pessoais na tabela de idempotência.
    v_hash := encode(
        pg_catalog.sha256(
            convert_to(
                jsonb_build_object(
                    'consorcio_id', p_consorcio_id,
                    'cidade_id', p_cidade_id,
                    'tipo', v_tipo,
                    'area', v_area,
                    'bairro', v_bairro,
                    'endereco', v_endereco,
                    'referencia', v_referencia,
                    'qtd', p_qtd,
                    'observacoes', v_obs,
                    'nome', v_nome,
                    'telefone', v_tel,
                    'latitude', p_latitude,
                    'longitude', p_longitude,
                    'loc_src', v_loc_src
                )::text,
                'UTF8'
            )
        ),
        'hex'
    );

    -- 6. Portal, consórcio e município habilitados (inclusive para reenvio idempotente).
    SELECT ci.nome
    INTO v_cidade_nome
    FROM public.cidades ci
    JOIN public.consorcios co
        ON co.id = ci.consorcio_id
    JOIN public.portal_configuracoes pc
        ON pc.consorcio_id = co.id
    WHERE ci.id = p_cidade_id
      AND ci.consorcio_id = p_consorcio_id
      AND ci.status = 'ativo'
      AND co.status = 'ativo'
      AND pc.portal_ativo IS TRUE
      AND pc.abertura_portal_ativo IS TRUE
    FOR SHARE OF ci, co, pc;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'PORTAL_OU_MUNICIPIO_INDISPONIVEL'
            USING ERRCODE = '42501';
    END IF;

    -- 7. Bloqueio transacional por chave de requisição.
    -- Duas solicitações simultâneas com a mesma chave
    -- não podem criar dois chamados.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            p_chave_requisicao::text,
            0
        )
    );

    -- 8. Verifica se a solicitação já foi processada.
    SELECT
        i.consorcio_id,
        i.payload_sha256,
        c.id,
        c.protocolo,
        c.empresa_id,
        c.sla_horas,
        c.created_at
    INTO v_existente
    FROM public.v19_portal_idempotencia i
    JOIN public.chamados c
        ON c.id = i.chamado_id
    WHERE i.chave_requisicao = p_chave_requisicao;

    IF FOUND THEN
        IF v_existente.consorcio_id <> p_consorcio_id
           OR v_existente.payload_sha256 <> v_hash THEN
            RAISE EXCEPTION 'CHAVE_REUTILIZADA_COM_DADOS_DIFERENTES'
                USING ERRCODE = '22023';
        END IF;

        RETURN jsonb_build_object(
            'ok', true,
            'id', v_existente.id,
            'protocolo', v_existente.protocolo,
            'empresa_id', v_existente.empresa_id,
            'sla_horas', v_existente.sla_horas,
            'created_at', v_existente.created_at,
            'reutilizado', true
        );
    END IF;

    -- 9. Exigir uma única empresa ativa responsável.
    SELECT
        count(*)::integer,
        (array_agg(e.id))[1],
        (array_agg(e.nome))[1]
    INTO
        v_qtd_empresas,
        v_empresa_id,
        v_empresa_nome
    FROM public.empresas e
    WHERE e.consorcio_id = p_consorcio_id
      AND e.status = 'ativo'
      AND EXISTS (
          SELECT 1
          FROM public.empresa_cidades ec
          WHERE ec.empresa_id = e.id
            AND ec.cidade_id = p_cidade_id
      );

    IF v_qtd_empresas <> 1 THEN
        RAISE EXCEPTION 'MUNICIPIO_SEM_EMPRESA_UNICA'
            USING ERRCODE = '42501';
    END IF;

    -- 10. Gerar protocolo no servidor.
    v_protocolo :=
        'V19P-' ||
        upper(replace(gen_random_uuid()::text, '-', ''));

    -- 11. Criar o chamado.
    -- O gatilho existente calcula o SLA.
    INSERT INTO public.chamados (
        protocolo,
        consorcio_id,
        cidade_id,
        cidade,
        bairro,
        endereco,
        referencia,
        area,
        latitude,
        longitude,
        loc_src,
        tipo,
        qtd,
        observacoes,
        status,
        prioridade,
        empresa,
        empresa_id,
        origem,
        solicitante_nome,
        solicitante_tel
    )
    VALUES (
        v_protocolo,
        p_consorcio_id,
        p_cidade_id,
        v_cidade_nome,
        v_bairro,
        v_endereco,
        v_referencia,
        v_area,
        p_latitude,
        p_longitude,
        v_loc_src,
        v_tipo,
        p_qtd,
        v_obs,
        'Recebido',
        'Média',
        v_empresa_nome,
        v_empresa_id,
        'Público',
        v_nome,
        v_tel
    )
    RETURNING
        id,
        sla_horas,
        created_at
    INTO
        v_chamado_id,
        v_sla,
        v_criado;

    -- 12. Exigir os prazos homologados.
    v_sla_esperado :=
        CASE
            WHEN v_area = 'Urbana' THEN 48
            ELSE 120
        END;

    IF v_sla IS DISTINCT FROM v_sla_esperado THEN
        RAISE EXCEPTION 'SLA_DIVERGENTE_DA_REGRA'
            USING ERRCODE = '23514';
    END IF;

    -- 13. Histórico da abertura.
    INSERT INTO public.chamado_historico (
        chamado_id,
        status,
        mensagem,
        observacao,
        cor,
        usuario_nome
    )
    VALUES (
        v_chamado_id,
        'Recebido',
        'Chamado aberto',
        'Abertura pública; empresa executora: '
            || v_empresa_nome,
        '#1251A3',
        'Portal público'
    );

    -- 14. Registrar a chave processada.
    INSERT INTO public.v19_portal_idempotencia (
        chave_requisicao,
        consorcio_id,
        payload_sha256,
        chamado_id
    )
    VALUES (
        p_chave_requisicao,
        p_consorcio_id,
        v_hash,
        v_chamado_id
    );

    -- 15. Confirmação sem dados pessoais.
    RETURN jsonb_build_object(
        'ok', true,
        'id', v_chamado_id,
        'protocolo', v_protocolo,
        'consorcio_id', p_consorcio_id,
        'cidade_id', p_cidade_id,
        'empresa_id', v_empresa_id,
        'status', 'Recebido',
        'sla_horas', v_sla,
        'created_at', v_criado,
        'reutilizado', false
    );
END;
$function$;

DO $verificar$
DECLARE
  v_oid oid := to_regprocedure('public.v19_criar_chamado_publico_privado(uuid,uuid,uuid,text,text,text,text,text,integer,text,text,text,numeric,numeric,text)');
  v_src text;
BEGIN
  v_src := pg_catalog.pg_get_functiondef(v_oid);
  IF position('-- 6. Portal, consórcio e município habilitados' IN v_src) = 0
    OR position('-- 7. Bloqueio transacional' IN v_src) = 0
    OR position('-- 8. Verifica se a solicitação' IN v_src) = 0
    OR position('-- 6. Portal, consórcio e município habilitados' IN v_src) >
       position('-- 8. Verifica se a solicitação' IN v_src)
    OR position('FOR SHARE OF ci, co, pc' IN v_src) = 0
    OR has_function_privilege('anon',v_oid,'EXECUTE')
    OR has_function_privilege('authenticated',v_oid,'EXECUTE')
    OR NOT has_function_privilege('service_role',v_oid,'EXECUTE')
  THEN
    RAISE EXCEPTION 'ETAPA_607_BLOQUEADA: verificacao de seguranca falhou';
  END IF;
END;
$verificar$;

SELECT 'V19_ETAPA_607_OK_PORTAL_DESATIVADO' AS diagnostico,
       (SELECT COUNT(*) FROM public.portal_configuracoes
        WHERE portal_ativo OR abertura_portal_ativo OR consulta_protocolo_ativo) AS portais_ativos,
       has_function_privilege('anon',to_regprocedure('public.v19_criar_chamado_publico_privado(uuid,uuid,uuid,text,text,text,text,text,integer,text,text,text,numeric,numeric,text)'),'EXECUTE') AS anon_executa,
       has_function_privilege('service_role',to_regprocedure('public.v19_criar_chamado_publico_privado(uuid,uuid,uuid,text,text,text,text,text,integer,text,text,text,numeric,numeric,text)'),'EXECUTE') AS service_role_executa,
       (SELECT position('FOR SHARE OF ci, co, pc'
                IN pg_catalog.pg_get_functiondef(to_regprocedure('public.v19_criar_chamado_publico_privado(uuid,uuid,uuid,text,text,text,text,text,integer,text,text,text,numeric,numeric,text)'))) > 0)
         AS trava_desativacao_instalada;
COMMIT;
