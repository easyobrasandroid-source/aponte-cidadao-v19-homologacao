-- Aponte Cidadão V19 — ETAPA 661.22A
-- MIGRACAO DE PREPARACAO: idempotencia de MOVIMENTACAO e CONSUMO empresarial.
-- Executar SOMENTE no Supabase V19: xurrhczvyqpwyjemight.
-- NÃO executar na V18. A V19 deve continuar em homologacao.
-- Esta migracao NÃO revoga as RPCs antigas; a desativacao das assinaturas
-- antigas sera uma etapa posterior, apos migracao/deploy e aceite.
-- Não altera saldos nem movimentacoes existentes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $v19$
BEGIN
  IF to_regprocedure(
      'public.v19_movimentar_estoque_empresa(uuid,uuid,text,numeric,text)'
     ) IS NULL
    OR to_regprocedure(
      'public.v19_consumir_material_chamado_empresa(uuid,uuid,numeric)'
    ) IS NULL
  THEN
    RAISE EXCEPTION 'ETAPA_66122_BLOQUEADA: RPC empresarial anterior ausente';
  END IF;
END
$v19$;

-- A reserva da chave, a movimentacao e o resultado definitivo
-- vivem na mesma transacao PostgreSQL: erro => rollback de todos.
-- Reuso de chave com outro usuario, acao ou parametros: rejeitado.
CREATE TABLE IF NOT EXISTS public.v19_requisicoes_estoque (
  requisicao_id uuid PRIMARY KEY,
  auth_usuario_id uuid NOT NULL,
  operacao text NOT NULL
    CHECK (operacao IN ('movimentar','consumir')),
  parametros jsonb NOT NULL,
  resposta jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  concluida_at timestamptz,
  CONSTRAINT v19_req_estoque_resposta_obj
    CHECK (resposta IS NULL OR jsonb_typeof(resposta)='object')
);
ALTER TABLE public.v19_requisicoes_estoque ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.v19_requisicoes_estoque
  FROM PUBLIC,anon,authenticated;
-- Nenhuma politica RLS para usuarios: leitura/escrita somente pelas
-- wrappers SECURITY DEFINER que conferem auth.uid(), escopo e chave.
COMMENT ON TABLE public.v19_requisicoes_estoque IS
  'V19 661.22: registro transacional privado de idempotencia de estoque; sem acesso direto de clientes.';

CREATE OR REPLACE FUNCTION public.v19_movimentar_estoque_idempotente(
  p_requisicao_id uuid,
  p_material_id uuid,
  p_empresa_id uuid,
  p_tipo text,
  p_quantidade numeric,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_auth uuid := auth.uid();
  v_registro public.v19_requisicoes_estoque%ROWTYPE;
  v_reserva uuid;
  v_params jsonb;
  v_resposta jsonb;
  v_n integer;
  v_empresa_atual uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR v_auth IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
  END IF;
  IF p_requisicao_id IS NULL THEN
    RAISE EXCEPTION 'REQUISICAO_ID_OBRIGATORIO' USING ERRCODE='22023';
  END IF;
  SELECT count(*)
    INTO v_n
  FROM public.usuarios u
  WHERE u.auth_user_id=v_auth AND u.status='ativo'
    AND u.perfil='empresa';
  SELECT u.empresa_id INTO v_empresa_atual
  FROM public.usuarios u
  WHERE u.auth_user_id=v_auth AND u.status='ativo'
    AND u.perfil='empresa'
  LIMIT 1;
  IF v_n<>1 OR v_empresa_atual IS DISTINCT FROM p_empresa_id THEN
    RAISE EXCEPTION 'EMPRESA_DO_ESTOQUE_NAO_PERTENCE_A_CONTA'
      USING ERRCODE='42501';
  END IF;

  v_params:=jsonb_build_object(
    'material_id',p_material_id,'empresa_id',p_empresa_id,
    'tipo',p_tipo,'quantidade',p_quantidade,
    'observacao',p_observacao
  );
  INSERT INTO public.v19_requisicoes_estoque
    (requisicao_id,auth_usuario_id,operacao,parametros)
  VALUES (p_requisicao_id,v_auth,'movimentar',v_params)
  ON CONFLICT (requisicao_id) DO NOTHING
  RETURNING requisicao_id INTO v_reserva;

  IF v_reserva IS NULL THEN
    -- INSERT conflitante em transacao concorrente aguarda commit/rollback.
    -- O SELECT posterior observa a resposta confirmada pela primeira.
    SELECT * INTO v_registro
    FROM public.v19_requisicoes_estoque
    WHERE requisicao_id=p_requisicao_id FOR UPDATE;
    IF NOT FOUND
      OR v_registro.auth_usuario_id IS DISTINCT FROM v_auth
      OR v_registro.operacao IS DISTINCT FROM 'movimentar'
      OR v_registro.parametros IS DISTINCT FROM v_params THEN
      RAISE EXCEPTION 'REQUISICAO_ID_REUTILIZADA_COM_DADOS_DIFERENTES'
        USING ERRCODE='23505';
    END IF;
    IF v_registro.resposta IS NULL THEN
      RAISE EXCEPTION 'REQUISICAO_PENDENTE_RECONCILIACAO'
        USING ERRCODE='40001';
    END IF;
    RETURN v_registro.resposta;
  END IF;

  -- Reutiliza validacoes de autenticacao, empresa, material e saldo
  -- já existentes na RPC homologada. O INSERT de idempotencia, UPDATE,
  -- historico e auditoria fazem parte da MESMA transacao.
  v_resposta:=public.v19_movimentar_estoque_empresa(
    p_material_id,p_empresa_id,p_tipo,p_quantidade,p_observacao
  );
  IF v_resposta IS NULL OR
     v_resposta->'ok' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'MOVIMENTACAO_NAO_CONFIRMADA'
      USING ERRCODE='P0001';
  END IF;
  UPDATE public.v19_requisicoes_estoque
  SET resposta=v_resposta,concluida_at=clock_timestamp()
  WHERE requisicao_id=p_requisicao_id;
  RETURN v_resposta;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.v19_consumir_material_chamado_idempotente(
  p_requisicao_id uuid,
  p_chamado_id uuid,
  p_material_id uuid,
  p_quantidade numeric
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_auth uuid := auth.uid();
  v_registro public.v19_requisicoes_estoque%ROWTYPE;
  v_reserva uuid;
  v_params jsonb;
  v_resposta jsonb;
  v_n integer;
  v_empresa_atual uuid;
  v_consorcio_atual uuid;
  v_chamado_empresa uuid;
  v_chamado_consorcio uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR v_auth IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
  END IF;
  IF p_requisicao_id IS NULL THEN
    RAISE EXCEPTION 'REQUISICAO_ID_OBRIGATORIO' USING ERRCODE='22023';
  END IF;
  SELECT count(*) INTO v_n
  FROM public.usuarios u
  WHERE u.auth_user_id=v_auth AND u.status='ativo'
    AND u.perfil='empresa';
  SELECT u.empresa_id,u.consorcio_id
    INTO v_empresa_atual,v_consorcio_atual
  FROM public.usuarios u
  WHERE u.auth_user_id=v_auth AND u.status='ativo'
    AND u.perfil='empresa'
  LIMIT 1;
  IF v_n<>1 OR v_empresa_atual IS NULL OR v_consorcio_atual IS NULL THEN
    RAISE EXCEPTION 'CONSUMO_EXCLUSIVO_DA_EMPRESA' USING ERRCODE='42501';
  END IF;
  -- Verificar vinculo atual antes de devolver resposta cacheada:
  -- nao revelar dados antigos de chamados transferidos/inacessiveis.
  SELECT ch.empresa_id,ch.consorcio_id
    INTO v_chamado_empresa,v_chamado_consorcio
  FROM public.chamados ch WHERE ch.id=p_chamado_id;
  IF NOT FOUND OR
     v_chamado_empresa IS DISTINCT FROM v_empresa_atual OR
     v_chamado_consorcio IS DISTINCT FROM v_consorcio_atual THEN
    RAISE EXCEPTION 'CHAMADO_NAO_PERTENCE_A_EMPRESA'
      USING ERRCODE='42501';
  END IF;

  v_params:=jsonb_build_object(
    'chamado_id',p_chamado_id,'material_id',p_material_id,
    'quantidade',p_quantidade
  );
  INSERT INTO public.v19_requisicoes_estoque
    (requisicao_id,auth_usuario_id,operacao,parametros)
  VALUES (p_requisicao_id,v_auth,'consumir',v_params)
  ON CONFLICT (requisicao_id) DO NOTHING
  RETURNING requisicao_id INTO v_reserva;

  IF v_reserva IS NULL THEN
    SELECT * INTO v_registro
    FROM public.v19_requisicoes_estoque
    WHERE requisicao_id=p_requisicao_id FOR UPDATE;
    IF NOT FOUND
      OR v_registro.auth_usuario_id IS DISTINCT FROM v_auth
      OR v_registro.operacao IS DISTINCT FROM 'consumir'
      OR v_registro.parametros IS DISTINCT FROM v_params THEN
      RAISE EXCEPTION 'REQUISICAO_ID_REUTILIZADA_COM_DADOS_DIFERENTES'
        USING ERRCODE='23505';
    END IF;
    IF v_registro.resposta IS NULL THEN
      RAISE EXCEPTION 'REQUISICAO_PENDENTE_RECONCILIACAO'
        USING ERRCODE='40001';
    END IF;
    RETURN v_registro.resposta;
  END IF;

  v_resposta:=public.v19_consumir_material_chamado_empresa(
    p_chamado_id,p_material_id,p_quantidade
  );
  IF v_resposta IS NULL OR
     v_resposta->'ok' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'CONSUMO_NAO_CONFIRMADO'
      USING ERRCODE='P0001';
  END IF;
  UPDATE public.v19_requisicoes_estoque
  SET resposta=v_resposta,concluida_at=clock_timestamp()
  WHERE requisicao_id=p_requisicao_id;
  RETURN v_resposta;
END;
$fn$;

REVOKE ALL ON FUNCTION public.v19_movimentar_estoque_idempotente(
  uuid,uuid,uuid,text,numeric,text
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v19_movimentar_estoque_idempotente(
  uuid,uuid,uuid,text,numeric,text
) TO authenticated;
REVOKE ALL ON FUNCTION public.v19_consumir_material_chamado_idempotente(
  uuid,uuid,uuid,numeric
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v19_consumir_material_chamado_idempotente(
  uuid,uuid,uuid,numeric
) TO authenticated;

COMMIT;
-- Disponibilizar novas assinaturas e grants imediatamente no PostgREST.
NOTIFY pgrst, 'reload schema';

-- Diagnostic read-only. Resultado: tabela privada e duas RPCs protegidas.
SELECT
  p.oid::regprocedure::text AS rpc,
  p.prosecdef AS security_definer,
  has_function_privilege('authenticated',p.oid,'EXECUTE') AS auth_pode_executar,
  has_function_privilege('anon',p.oid,'EXECUTE') AS anon_pode_executar,
  (SELECT COUNT(*) FROM public.v19_requisicoes_estoque) AS requisicoes_registradas,
  (SELECT COUNT(*) FROM public.estoques) AS estoques_preservados,
  (SELECT COUNT(*) FROM public.movimentacoes) AS movimentos_preservados
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN (
  'v19_movimentar_estoque_idempotente',
  'v19_consumir_material_chamado_idempotente'
)
ORDER BY rpc;
