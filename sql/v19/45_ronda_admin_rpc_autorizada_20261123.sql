-- V19: Administração de Rondas via RPC autorizada, sem GRANT de SELECT
-- nas tabelas sensíveis à service_role nem autenticação administrativa para Ronda.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '50s';

CREATE OR REPLACE FUNCTION public.v19_ronda_admin(
 p_acao text,
 p_ronda_id uuid DEFAULT NULL,
 p_consorcio_id uuid DEFAULT NULL,
 p_dados jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
 v_actor public.usuarios%ROWTYPE;
 v_ronda public.v19_rondas%ROWTYPE;
 v_nome text;
 v_email text;
 v_telefone text;
 v_auth_text text;
 v_auth_id uuid;
 v_novo_id uuid;
 v_rows jsonb;
 v_ativo boolean;
BEGIN
 IF auth.uid() IS NULL THEN
   RAISE EXCEPTION 'NAO_AUTENTICADO';
 END IF;

 SELECT * INTO v_actor FROM public.usuarios
  WHERE auth_user_id=auth.uid() AND status='ativo'
   AND perfil IN ('master','consorcio')
  LIMIT 1;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'PERFIL_NAO_AUTORIZADO';
 END IF;

 IF p_acao='listar' THEN
   SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC),'[]'::jsonb)
     INTO v_rows
   FROM (
     SELECT r.id,r.consorcio_id,r.nome,r.email,r.telefone,
       r.ativo,r.created_at,c.nome AS consorcio_nome
     FROM public.v19_rondas r
       JOIN public.consorcios c ON c.id=r.consorcio_id
     WHERE v_actor.perfil='master'
       OR (v_actor.consorcio_id IS NOT NULL AND r.consorcio_id=v_actor.consorcio_id)
     ORDER BY r.created_at DESC
   ) t;
   RETURN jsonb_build_object('ok',true,'rondas',v_rows);
 END IF;

 IF p_acao='reservar' THEN
   IF p_consorcio_id IS NULL OR
      (v_actor.perfil='consorcio' AND
       p_consorcio_id IS DISTINCT FROM v_actor.consorcio_id) OR
      NOT EXISTS(SELECT 1 FROM public.consorcios c
        WHERE c.id=p_consorcio_id AND c.status='ativo') THEN
      RAISE EXCEPTION 'CONSORCIO_NAO_AUTORIZADO';
   END IF;
   IF p_dados IS NULL OR jsonb_typeof(p_dados)<>'object' THEN
      RAISE EXCEPTION 'DADOS_INVALIDOS';
   END IF;
   v_nome=trim(coalesce(p_dados->>'nome',''));
   v_email=lower(trim(coalesce(p_dados->>'email','')));
   v_telefone=regexp_replace(coalesce(p_dados->>'telefone',''),'\D','','g');
   IF length(v_nome) NOT BETWEEN 2 AND 120
       OR length(v_email) NOT BETWEEN 5 AND 320
       OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       OR length(v_telefone) NOT BETWEEN 10 AND 13 THEN
     RAISE EXCEPTION 'DADOS_INVALIDOS';
   END IF;
   IF EXISTS(SELECT 1 FROM public.usuarios u WHERE lower(u.email)=v_email)
       OR EXISTS(SELECT 1 FROM auth.users au WHERE lower(au.email)=v_email) THEN
     RAISE EXCEPTION 'EMAIL_JA_POSSUI_CONTA';
   END IF;

   INSERT INTO public.v19_rondas
       (consorcio_id,nome,email,telefone,ativo,criado_por)
   VALUES(p_consorcio_id,v_nome,v_email,v_telefone,false,v_actor.id)
   RETURNING id INTO v_novo_id;
   RETURN jsonb_build_object('ok',true,'ronda_id',v_novo_id,'estado','convite_pendente');
 END IF;

 IF p_acao NOT IN ('cancelar_reserva','finalizar_convite','status') OR p_ronda_id IS NULL THEN
    RAISE EXCEPTION 'ACAO_INVALIDA';
 END IF;
 SELECT * INTO v_ronda FROM public.v19_rondas
   WHERE id=p_ronda_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RONDA_NAO_ENCONTRADA'; END IF;
 IF v_actor.perfil='consorcio'
    AND v_ronda.consorcio_id IS DISTINCT FROM v_actor.consorcio_id THEN
    RAISE EXCEPTION 'ESCOPO_NAO_AUTORIZADO';
 END IF;

 IF p_acao='cancelar_reserva' THEN
   IF v_ronda.auth_user_id IS NOT NULL OR v_ronda.ativo
     OR (v_actor.perfil<>'master'
         AND v_ronda.criado_por IS DISTINCT FROM v_actor.id) THEN
     RAISE EXCEPTION 'RESERVA_NAO_CANCELAVEL';
   END IF;
   DELETE FROM public.v19_rondas WHERE id=v_ronda.id;
   RETURN jsonb_build_object('ok',true,'estado','reserva_cancelada');
 END IF;

 IF p_acao='finalizar_convite' THEN
   IF v_ronda.auth_user_id IS NOT NULL OR v_ronda.ativo
     OR (v_actor.perfil<>'master'
         AND v_ronda.criado_por IS DISTINCT FROM v_actor.id) THEN
     RAISE EXCEPTION 'RESERVA_NAO_FINALIZAVEL';
   END IF;
   v_auth_text=p_dados->>'auth_user_id';
   IF v_auth_text IS NULL OR
      v_auth_text !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
     RAISE EXCEPTION 'AUTH_ID_INVALIDO';
   END IF;
   v_auth_id=v_auth_text::uuid;
   IF NOT EXISTS(SELECT 1 FROM auth.users a
         WHERE a.id=v_auth_id AND lower(a.email)=lower(v_ronda.email))
     OR EXISTS(SELECT 1 FROM public.usuarios u WHERE u.auth_user_id=v_auth_id) THEN
     RAISE EXCEPTION 'AUTH_IDENTIDADE_DIVERGENTE';
   END IF;
   UPDATE public.v19_rondas SET auth_user_id=v_auth_id,ativo=true,updated_at=now()
    WHERE id=v_ronda.id;
   INSERT INTO public.auditoria(consorcio_id,usuario_responsavel,acao,detalhes)
   VALUES(v_ronda.consorcio_id,v_actor.nome,'V19_RONDA_CRIADA',
     'Usuário Ronda '||v_ronda.id::text||' criado por '||v_actor.id::text);
   RETURN jsonb_build_object('ok',true,'estado','ativo');
 END IF;

 IF jsonb_typeof(p_dados->'ativo') <> 'boolean' THEN
   RAISE EXCEPTION 'STATUS_INVALIDO';
 END IF;
 v_ativo=(p_dados->>'ativo')::boolean;
 IF v_ronda.auth_user_id IS NULL AND v_ativo THEN
   RAISE EXCEPTION 'RONDA_SEM_CONVITE';
 END IF;
 UPDATE public.v19_rondas SET ativo=v_ativo,updated_at=now()
   WHERE id=v_ronda.id;
 INSERT INTO public.auditoria(consorcio_id,usuario_responsavel,acao,detalhes)
 VALUES(v_ronda.consorcio_id,v_actor.nome,'V19_RONDA_STATUS',
   'Ronda '||v_ronda.id::text||' ativo='||v_ativo::text);
 RETURN jsonb_build_object('ok',true,'estado',CASE WHEN v_ativo THEN 'ativo' ELSE 'inativo' END);
END;
$func$;

REVOKE ALL ON FUNCTION public.v19_ronda_admin(text,uuid,uuid,jsonb)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v19_ronda_admin(text,uuid,uuid,jsonb)
  TO authenticated;

COMMIT;
