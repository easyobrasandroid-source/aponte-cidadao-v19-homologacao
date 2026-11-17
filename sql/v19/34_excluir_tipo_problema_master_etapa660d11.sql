-- V19 ETAPA 660D.11: somente Supabase HOMOLOGACAO xurrhczvyqpwyjemight.
-- Exclusao do CATALOGO por Master; chamados historicos preservados.
-- Executar antes do merge do PR de interface. Pode ser aplicado uma unica vez.
BEGIN;
SET LOCAL statement_timeout='30000ms';

DO $precond$
BEGIN
 IF to_regprocedure('public.v19_gerenciar_tipo_problema(text,uuid,uuid,text,integer)') IS NULL
    OR to_regprocedure('public.v19_guard_tipo_problema_chamado()') IS NULL
    OR to_regclass('public.v19_tipos_problema') IS NULL THEN
   RAISE EXCEPTION 'V19_660D11_CATALOGO_NAO_INSTALADO';
 END IF;
 IF has_function_privilege('anon','public.v19_gerenciar_tipo_problema(text,uuid,uuid,text,integer)'::regprocedure,'EXECUTE')
 THEN RAISE EXCEPTION 'V19_660D11_PERMISSOES_INESPERADAS'; END IF;
END
$precond$;

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
 v_historicos integer := 0;
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
 IF v_acao NOT IN ('criar','editar','ativar','desativar','excluir') THEN
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
   IF v_acao='excluir' THEN
     SELECT count(*) INTO v_historicos
       FROM public.chamados ch
       WHERE ch.consorcio_id=p_consorcio_id AND ch.tipo=v_tipo.nome;
     -- Excluir SOMENTE a opcao do catalogo. Chamados antigos guardam
     -- o texto original em chamados.tipo, sem FK para este registro.
     DELETE FROM public.v19_tipos_problema
      WHERE id=v_tipo.id AND consorcio_id=p_consorcio_id;
   ELSIF v_acao='editar' THEN
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
        '; ativo='||v_tipo.ativo::text||'; ordem='||v_tipo.ordem::text||'; chamados_historicos_preservados='||v_historicos::text);
 RETURN jsonb_build_object('ok',true,'id',v_tipo.id,'consorcio_id',v_tipo.consorcio_id,
   'nome',v_tipo.nome,'ativo',v_tipo.ativo,'ordem',v_tipo.ordem);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.v19_guard_tipo_problema_chamado()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
BEGIN
 IF TG_OP='UPDATE' AND NEW.tipo IS NOT DISTINCT FROM OLD.tipo
   AND NEW.consorcio_id IS NOT DISTINCT FROM OLD.consorcio_id THEN
   RETURN NEW;
 END IF;
 IF NEW.consorcio_id IS NULL OR NEW.tipo IS NULL THEN
   RAISE EXCEPTION 'TIPO_PROBLEMA_NAO_ATIVO_NESTE_CONSORCIO'
      USING ERRCODE='23514';
 END IF;
 -- Bloquear a exclusao de um tipo ate a criacao deste chamado confirmar.
 -- A RPC Master faz SELECT FOR UPDATE na mesma linha antes de excluir;
 -- o lock garante que um tipo removido nao seja aceito por corrida.
 PERFORM 1 FROM public.v19_tipos_problema t
 WHERE t.consorcio_id=NEW.consorcio_id
   AND t.nome=btrim(NEW.tipo) AND t.ativo
 FOR KEY SHARE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'TIPO_PROBLEMA_NAO_ATIVO_NESTE_CONSORCIO'
      USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;

-- Continuam proibidas chamadas anonimas e escrita direta nas tabelas.
REVOKE ALL ON FUNCTION public.v19_gerenciar_tipo_problema(text,uuid,uuid,text,integer)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.v19_gerenciar_tipo_problema(text,uuid,uuid,text,integer)
 TO authenticated;
NOTIFY pgrst,'reload schema';

SELECT 'V19_ETAPA_660D11_EXCLUSAO_MASTER_PREPARADA' AS diagnostico,
 (SELECT count(*) FROM public.v19_tipos_problema) AS tipos_preservados,
 (SELECT count(*) FROM public.chamados) AS chamados_preservados,
 has_function_privilege('anon',
  'public.v19_gerenciar_tipo_problema(text,uuid,uuid,text,integer)'::regprocedure,'EXECUTE')
 AS anon_pode_excluir,
 has_function_privilege('authenticated',
  'public.v19_gerenciar_tipo_problema(text,uuid,uuid,text,integer)'::regprocedure,'EXECUTE')
 AS autenticado_pode_chamar_rpc_que_valida_master;

COMMIT;
