-- V19 / ETAPA 776
-- Nova RPC autentica para nome/telefone opcionais do solicitante.
-- Mantem a RPC antiga, a autoria via auth.uid(), a atribuicao automatica e o SLA.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.v19_criar_chamado_interno_com_solicitante(
  p_cidade_id uuid,
  p_tipo text,
  p_area text DEFAULT 'Urbana',
  p_bairro text DEFAULT NULL,
  p_endereco text DEFAULT NULL,
  p_qtd integer DEFAULT 1,
  p_observacoes text DEFAULT NULL,
  p_empresa_id uuid DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_loc_src text DEFAULT 'manual',
  p_solicitante_nome text DEFAULT NULL,
  p_solicitante_tel text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
  v_resultado jsonb;
  v_chamado_id uuid;
  v_nome text := NULLIF(BTRIM(p_solicitante_nome), '');
  v_telefone text := NULLIF(BTRIM(p_solicitante_tel), '');
BEGIN
  IF auth.uid() IS NULL
     OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE = '42501';
  END IF;

  IF LENGTH(COALESCE(v_nome, '')) > 200
     OR LENGTH(COALESCE(v_telefone, '')) > 40 THEN
    RAISE EXCEPTION 'SOLICITANTE_INVALIDO' USING ERRCODE = '22023';
  END IF;

  -- A rotina antiga continua sendo a autoridade para autorizacao,
  -- empresa, municipio, protocolo, SLA, autor e historico.
  v_resultado := public.v19_criar_chamado_interno(
    p_cidade_id => p_cidade_id,
    p_tipo => p_tipo,
    p_area => p_area,
    p_bairro => p_bairro,
    p_endereco => p_endereco,
    p_qtd => p_qtd,
    p_observacoes => p_observacoes,
    p_empresa_id => p_empresa_id,
    p_latitude => p_latitude,
    p_longitude => p_longitude,
    p_loc_src => p_loc_src
  );

  IF v_resultado IS NULL
     OR (v_resultado ->> 'ok') IS DISTINCT FROM 'true'
     OR (v_resultado ->> 'id') IS NULL THEN
    RAISE EXCEPTION 'CHAMADO_NAO_CONFIRMADO';
  END IF;

  v_chamado_id := (v_resultado ->> 'id')::uuid;

  -- Mesma transacao: qualquer erro desfaz tambem a abertura.
  -- Nao modifica autoria, status, empresa, SLA ou historico.
  IF v_nome IS NOT NULL OR v_telefone IS NOT NULL THEN
    UPDATE public.chamados c
       SET solicitante_nome = v_nome,
           solicitante_tel = v_telefone
     WHERE c.id = v_chamado_id
       AND c.origem = 'Interno'
       AND c.aberto_por_usuario_id = (
         SELECT u.id
         FROM public.usuarios u
         WHERE u.auth_user_id = auth.uid()
           AND u.status = 'ativo'
         LIMIT 1
       );

    IF NOT FOUND THEN
      RAISE EXCEPTION 'AUTOR_ABERTURA_NAO_CONFERIDO'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN v_resultado;
END;
$func$;

REVOKE ALL ON FUNCTION
public.v19_criar_chamado_interno_com_solicitante(
 uuid,text,text,text,text,integer,text,uuid,numeric,numeric,text,text,text
) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION
public.v19_criar_chamado_interno_com_solicitante(
 uuid,text,text,text,text,integer,text,uuid,numeric,numeric,text,text,text
) TO authenticated;

COMMIT;

SELECT
  'ETAPA 776 - RESULTADO' AS verificacao,
  has_function_privilege(
    'authenticated',
    'public.v19_criar_chamado_interno_com_solicitante(uuid,text,text,text,text,integer,text,uuid,numeric,numeric,text,text,text)',
    'EXECUTE'
  ) AS autenticado_pode_executar,
  has_function_privilege(
    'anon',
    'public.v19_criar_chamado_interno_com_solicitante(uuid,text,text,text,text,integer,text,uuid,numeric,numeric,text,text,text)',
    'EXECUTE'
  ) AS anonimo_pode_executar,
  has_function_privilege(
    'authenticated',
    'public.v19_criar_chamado_interno(uuid,text,text,text,text,integer,text,uuid,numeric,numeric,text)',
    'EXECUTE'
  ) AS funcao_antiga_preservada,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.chamados'::regclass
      AND tgname = 'v19_autor_abertura_interna'
      AND tgenabled = 'O'
      AND NOT tgisinternal
  ) AS gatilho_autoria_ativo,
  (SELECT COUNT(*) FROM public.usuarios WHERE status = 'ativo') AS usuarios_ativos;
