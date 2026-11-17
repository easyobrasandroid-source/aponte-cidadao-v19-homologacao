-- Aponte Cidadao V19 / ETAPA 660C
-- Catálogo de tipos de problema POR CONSORCIO, gerenciamento exclusivo Master.
-- GARANTIA LED NAO E EDITAVEL: fluxo atual de garantia nao muda.
-- SOMENTE no Supabase V19 de homologacao: xurrhczvyqpwyjemight.
-- Executar SOMENTE depois do merge e da publicacao do frontend/Edge desta etapa.
-- A transacao aborta integralmente caso a RPC publica diverja da versao esperada.

BEGIN;
SET LOCAL statement_timeout='30000ms';

DO $guard$
BEGIN
  IF (SELECT count(*) FROM public.consorcios
      WHERE nome IN ('TESTE V19 - Consorcio Alfa','TESTE V19 - Consorcio Beta')) <> 2
  THEN
    RAISE EXCEPTION 'V19_660C_AMBIENTE_INESPERADO: faltam consorcios de homologacao';
  END IF;
  IF to_regprocedure('public.v19_criar_chamado_publico_privado(uuid,uuid,uuid,text,text,text,text,text,integer,text,text,text,numeric,numeric,text)') IS NULL
     OR to_regprocedure('public.v19_criar_chamado_interno(uuid,text,text,text,text,integer,text,uuid,numeric,numeric,text)') IS NULL
     OR to_regprocedure('public.v19_editar_dados_chamado(uuid,jsonb,timestamptz,text)') IS NULL
  THEN
    RAISE EXCEPTION 'V19_660C_BLOQUEADA: faltam RPCs de abertura/edicao';
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS public.v19_tipos_problema (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES public.consorcios(id),
  nome text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 2 AND 120
                           AND nome = btrim(nome)),
  ordem integer NOT NULL DEFAULT 100 CHECK (ordem BETWEEN 0 AND 9999),
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS v19_tipos_problema_consorcio_nome_uq
 ON public.v19_tipos_problema (consorcio_id,lower(nome));

CREATE INDEX IF NOT EXISTS v19_tipos_problema_consorcio_ativos_idx
 ON public.v19_tipos_problema (consorcio_id,ativo,ordem,nome);

ALTER TABLE public.v19_tipos_problema ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.v19_tipos_problema FROM PUBLIC,anon,authenticated;

-- Tipos originais, somente para novas aberturas. Nao cadastrar os tipos
-- de testes historicos (estes continuam preservados nos chamados antigos).
INSERT INTO public.v19_tipos_problema(consorcio_id,nome,ordem)
SELECT c.id,t.nome,t.ordem
FROM public.consorcios c
CROSS JOIN (VALUES
 ('Lâmpada apagada',10),
 ('Lâmpada piscando',20),
 ('Acesa durante o dia',30),
 ('Lâmpada com defeito',40),
 ('Poste danificado',50),
 ('Outro',60)
) AS t(nome,ordem)
ON CONFLICT DO NOTHING;

-- Apenas usuários autenticados ativos e no escopo consultam.
CREATE OR REPLACE FUNCTION public.v19_listar_tipos_problema(
 p_consorcio_id uuid,
 p_incluir_inativos boolean DEFAULT false
)
RETURNS TABLE(id uuid,nome text,ordem integer,ativo boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
 v_perfil text; v_consorcio uuid; v_n integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL
    OR p_consorcio_id IS NULL THEN
   RAISE EXCEPTION 'ACESSO_NAO_AUTORIZADO' USING ERRCODE='42501';
 END IF;
 SELECT count(*) INTO v_n FROM public.usuarios u
 WHERE u.auth_user_id=auth.uid() AND u.status='ativo';
 IF v_n=1 THEN
   SELECT u.perfil,u.consorcio_id INTO v_perfil,v_consorcio
   FROM public.usuarios u
   WHERE u.auth_user_id=auth.uid() AND u.status='ativo';
 END IF;
 IF v_n <> 1 OR v_perfil NOT IN
   ('master','consorcio','prefeitura','empresa','garantia')
    OR (v_perfil <> 'master' AND v_consorcio IS DISTINCT FROM p_consorcio_id)
 THEN
   RAISE EXCEPTION 'CONSORCIO_NAO_AUTORIZADO' USING ERRCODE='42501';
 END IF;
 RETURN QUERY
 SELECT t.id,t.nome,t.ordem,t.ativo
 FROM public.v19_tipos_problema t
 JOIN public.consorcios c ON c.id=t.consorcio_id AND c.status='ativo'
 WHERE t.consorcio_id=p_consorcio_id
   AND (t.ativo OR (v_perfil='master' AND coalesce(p_incluir_inativos,false)))
 ORDER BY t.ordem,t.nome;
END;
$fn$;

REVOKE ALL ON FUNCTION public.v19_listar_tipos_problema(uuid,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.v19_listar_tipos_problema(uuid,boolean)
 TO authenticated;

-- Consultas publicas: apenas Edge Function, papel de serviço,
-- consorcio/portal/abertura ativos; nenhum dado de usuario exposto.
CREATE OR REPLACE FUNCTION public.v19_listar_tipos_portal(p_consorcio_id uuid)
RETURNS TABLE(nome text,ordem integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_consorcio_id IS NULL THEN
   RAISE EXCEPTION 'ACESSO_NAO_AUTORIZADO' USING ERRCODE='42501';
 END IF;
 RETURN QUERY
 SELECT t.nome,t.ordem
 FROM public.v19_tipos_problema t
 JOIN public.consorcios c ON c.id=t.consorcio_id AND c.status='ativo'
 JOIN public.portal_configuracoes pc ON pc.consorcio_id=c.id
 WHERE t.consorcio_id=p_consorcio_id
   AND t.ativo AND pc.portal_ativo IS TRUE
   AND pc.abertura_portal_ativo IS TRUE
 ORDER BY t.ordem,t.nome;
END;
$fn$;
REVOKE ALL ON FUNCTION public.v19_listar_tipos_portal(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.v19_listar_tipos_portal(uuid)
 TO service_role;

-- Gestao exclusiva Master com autorizacao NO SERVIDOR.
CREATE OR REPLACE FUNCTION public.v19_gerenciar_tipo_problema(
 p_acao text, p_consorcio_id uuid,
 p_tipo_id uuid DEFAULT NULL,
 p_nome text DEFAULT NULL,
 p_ordem integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
 v_acao text := lower(btrim(coalesce(p_acao,'')));
 v_usuario_nome text;
 v_qtd integer;
 v_tipo public.v19_tipos_problema%ROWTYPE;
 v_nome text;
 v_ordem integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL THEN
   RAISE EXCEPTION 'ACESSO_NAO_AUTORIZADO' USING ERRCODE='42501';
 END IF;
 SELECT count(*),max(u.nome) INTO v_qtd,v_usuario_nome
 FROM public.usuarios u WHERE u.auth_user_id=auth.uid()
    AND u.status='ativo' AND u.perfil='master';
 IF v_qtd<>1 THEN
   RAISE EXCEPTION 'APENAS_MASTER_ALTERA_TIPOS' USING ERRCODE='42501';
 END IF;
 IF p_consorcio_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.consorcios c
    WHERE c.id=p_consorcio_id AND c.status='ativo'
 ) THEN
   RAISE EXCEPTION 'CONSORCIO_INDISPONIVEL' USING ERRCODE='22023';
 END IF;
 IF v_acao NOT IN ('criar','editar','ativar','desativar') THEN
   RAISE EXCEPTION 'ACAO_INVALIDA' USING ERRCODE='22023';
 END IF;
 IF v_acao='criar' THEN
   IF p_tipo_id IS NOT NULL THEN
     RAISE EXCEPTION 'ID_NAO_PERMITIDO_PARA_CRIAR' USING ERRCODE='22023';
   END IF;
   v_nome:=nullif(btrim(coalesce(p_nome,'')),'');
   v_ordem:=coalesce(p_ordem,100);
   IF v_nome IS NULL OR length(v_nome) NOT BETWEEN 2 AND 120
      OR v_ordem NOT BETWEEN 0 AND 9999
      OR v_nome ~* '(^|[[:space:]])garantia([[:space:]]|$)' THEN
     RAISE EXCEPTION 'TIPO_INVALIDO_OU_GARANTIA_RESERVADA' USING ERRCODE='22023';
   END IF;
   INSERT INTO public.v19_tipos_problema(consorcio_id,nome,ordem)
     VALUES(p_consorcio_id,v_nome,v_ordem) RETURNING * INTO v_tipo;
 ELSE
   SELECT * INTO v_tipo FROM public.v19_tipos_problema
   WHERE id=p_tipo_id AND consorcio_id=p_consorcio_id FOR UPDATE;
   IF NOT FOUND THEN
     RAISE EXCEPTION 'TIPO_NAO_ENCONTRADO_NO_CONSORCIO' USING ERRCODE='42501';
   END IF;
   IF v_acao='editar' THEN
     v_nome:=coalesce(nullif(btrim(p_nome),''),v_tipo.nome);
     v_ordem:=coalesce(p_ordem,v_tipo.ordem);
     IF length(v_nome) NOT BETWEEN 2 AND 120
       OR v_ordem NOT BETWEEN 0 AND 9999
       OR v_nome ~* '(^|[[:space:]])garantia([[:space:]]|$)' THEN
       RAISE EXCEPTION 'TIPO_INVALIDO_OU_GARANTIA_RESERVADA' USING ERRCODE='22023';
     END IF;
     UPDATE public.v19_tipos_problema
       SET nome=v_nome,ordem=v_ordem,atualizado_em=clock_timestamp()
       WHERE id=v_tipo.id RETURNING * INTO v_tipo;
   ELSE
     UPDATE public.v19_tipos_problema
       SET ativo=(v_acao='ativar'),atualizado_em=clock_timestamp()
       WHERE id=v_tipo.id RETURNING * INTO v_tipo;
   END IF;
 END IF;

 INSERT INTO public.auditoria(consorcio_id,usuario_responsavel,acao,detalhes)
 VALUES(p_consorcio_id,coalesce(v_usuario_nome,'Administrador Master'),
        'V19_TIPO_PROBLEMA_'||upper(v_acao),
        'tipo_id='||v_tipo.id::text||'; nome='||v_tipo.nome||
        '; ativo='||v_tipo.ativo::text||'; ordem='||v_tipo.ordem::text);
 RETURN jsonb_build_object('ok',true,'id',v_tipo.id,'consorcio_id',v_tipo.consorcio_id,
   'nome',v_tipo.nome,'ativo',v_tipo.ativo,'ordem',v_tipo.ordem);
END;
$fn$;
REVOKE ALL ON FUNCTION public.v19_gerenciar_tipo_problema(text,uuid,uuid,text,integer)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.v19_gerenciar_tipo_problema(text,uuid,uuid,text,integer)
 TO authenticated;

-- Qualquer criacao ou alteracao de TIPO deve usar um tipo ativo
-- do mesmo consorcio. Updates que nao modificam "tipo" preservam
-- chamados historicos, inclusive tipos antigos/desativados.
CREATE OR REPLACE FUNCTION public.v19_guard_tipo_problema_chamado()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
BEGIN
 IF TG_OP='UPDATE' AND NEW.tipo IS NOT DISTINCT FROM OLD.tipo
   AND NEW.consorcio_id IS NOT DISTINCT FROM OLD.consorcio_id THEN
   RETURN NEW;
 END IF;
 IF NEW.consorcio_id IS NULL OR NEW.tipo IS NULL OR
    NOT EXISTS(
      SELECT 1 FROM public.v19_tipos_problema t
      WHERE t.consorcio_id=NEW.consorcio_id
        AND t.nome=btrim(NEW.tipo) AND t.ativo
    ) THEN
   RAISE EXCEPTION 'TIPO_PROBLEMA_NAO_ATIVO_NESTE_CONSORCIO'
      USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS v19_guard_tipo_problema_chamado
 ON public.chamados;
CREATE TRIGGER v19_guard_tipo_problema_chamado
 BEFORE INSERT OR UPDATE OF tipo,consorcio_id
 ON public.chamados
 FOR EACH ROW EXECUTE FUNCTION public.v19_guard_tipo_problema_chamado();

-- RPC publica possui whitelist fixa. Substituir SOMENTE esta condicao;
-- a validacao real passa a ser transacional no trigger do INSERT.
-- Reenvio idempotente de chamado antigo deve continuar retornando
-- o protocolo anterior, mesmo se o tipo foi inativado posteriormente.
DO $patch_publico$
DECLARE
 v_oid oid := to_regprocedure('public.v19_criar_chamado_publico_privado(uuid,uuid,uuid,text,text,text,text,text,integer,text,text,text,numeric,numeric,text)');
 v_def text;
 v_inicio int;
 v_fim int;
 v_trecho text;
BEGIN
 IF v_oid IS NULL OR NOT (
   SELECT p.prosecdef FROM pg_proc p WHERE p.oid=v_oid
 ) OR has_function_privilege('anon',v_oid,'EXECUTE')
    OR has_function_privilege('authenticated',v_oid,'EXECUTE')
    OR NOT has_function_privilege('service_role',v_oid,'EXECUTE') THEN
   RAISE EXCEPTION 'V19_660C_BLOQUEADA: RPC publica ou privilegios divergentes';
 END IF;
 v_def:=pg_get_functiondef(v_oid);
 v_inicio:=strpos(v_def,'OR v_tipo NOT IN (');
 v_fim:=strpos(v_def,'OR p_qtd IS NULL');
 IF v_inicio=0 OR v_fim<=v_inicio THEN
   RAISE EXCEPTION 'V19_660C_BLOQUEADA: whitelist publica nao encontrada';
 END IF;
 v_trecho:=substr(v_def,v_inicio,v_fim-v_inicio);
 IF v_trecho NOT LIKE '%Lâmpada apagada%'
   OR v_trecho NOT LIKE '%Poste danificado%'
   OR v_trecho NOT LIKE '%Outro%'
   OR v_trecho NOT LIKE '%Lâmpada piscando%' THEN
   RAISE EXCEPTION 'V19_660C_BLOQUEADA: tipos legados publicos divergentes';
 END IF;
 v_def:=left(v_def,v_inicio-1) ||
   'OR length(v_tipo) NOT BETWEEN 2 AND 120 ' || substr(v_def,v_fim);
 EXECUTE v_def;
 IF has_function_privilege('anon',v_oid,'EXECUTE')
   OR has_function_privilege('authenticated',v_oid,'EXECUTE')
   OR NOT has_function_privilege('service_role',v_oid,'EXECUTE') THEN
   RAISE EXCEPTION 'V19_660C_BLOQUEADA: RPC publica perdeu protecao';
 END IF;
END;
$patch_publico$;

NOTIFY pgrst,'reload schema';

SELECT 'V19_ETAPA_660C_CATALOGO_INSTALADO' AS diagnostico,
 (SELECT count(*) FROM public.v19_tipos_problema) AS tipos_totais,
 (SELECT count(*) FROM public.v19_tipos_problema WHERE ativo) AS tipos_ativos,
 (SELECT count(*) FROM public.chamados) AS chamados_preservados,
 (SELECT count(*) FROM public.chamados WHERE status='Aguardando Garantia LED')
   AS garantia_led_preservada,
 has_function_privilege('anon',
  'public.v19_gerenciar_tipo_problema(text,uuid,uuid,text,integer)'::regprocedure,
  'EXECUTE') AS anon_pode_alterar,
 has_function_privilege('authenticated',
  'public.v19_gerenciar_tipo_problema(text,uuid,uuid,text,integer)'::regprocedure,
  'EXECUTE') AS authenticated_pode_chamar_rpc_restrita;

COMMIT;
