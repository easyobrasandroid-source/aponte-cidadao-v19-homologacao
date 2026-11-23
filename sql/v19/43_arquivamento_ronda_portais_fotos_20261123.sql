-- Aponte Iluminacao V19 | operacoes adicionais | 2026-11-23.
-- Apenas no banco V19; backward-compatible com frontend atual.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='50s';

ALTER TABLE public.chamados
  ADD COLUMN IF NOT EXISTS arquivado_em timestamptz,
  ADD COLUMN IF NOT EXISTS arquivado_por_usuario_id uuid,
  ADD COLUMN IF NOT EXISTS arquivado_por_nome text,
  ADD COLUMN IF NOT EXISTS arquivado_motivo text;
CREATE INDEX IF NOT EXISTS v19_chamados_arquivado_cons_idx
  ON public.chamados (consorcio_id,arquivado_em,created_at DESC);
CREATE INDEX IF NOT EXISTS v19_chamados_arquivado_empresa_idx
  ON public.chamados (empresa_id,arquivado_em,created_at DESC);
COMMENT ON COLUMN public.chamados.arquivado_em IS
  'Exclusao logica reversivel; status original e historico preservados.';

CREATE OR REPLACE FUNCTION public.v19_bloquear_mutacao_arquivado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path='' AS $$
BEGIN
  IF OLD.arquivado_em IS NOT NULL
     AND NEW.arquivado_em IS NOT DISTINCT FROM OLD.arquivado_em
     AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'CHAMADO_ARQUIVADO';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS v19_bloquear_mutacao_arquivado ON public.chamados;
CREATE TRIGGER v19_bloquear_mutacao_arquivado
  BEFORE UPDATE ON public.chamados FOR EACH ROW
  EXECUTE FUNCTION public.v19_bloquear_mutacao_arquivado();
REVOKE ALL ON FUNCTION public.v19_bloquear_mutacao_arquivado() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.v19_gerenciar_arquivamento(
  p_chamado_id uuid,p_acao text,p_atualizado_em timestamptz,p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_user public.usuarios%ROWTYPE;
  v_c public.chamados%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF (select auth.uid()) IS NULL THEN RAISE EXCEPTION 'NAO_AUTENTICADO'; END IF;
  SELECT * INTO v_user FROM public.usuarios
    WHERE auth_user_id=auth.uid() AND status='ativo' LIMIT 1;
  IF NOT FOUND OR v_user.perfil NOT IN ('master','consorcio','empresa') THEN
    RAISE EXCEPTION 'PERFIL_NAO_AUTORIZADO';
  END IF;
  IF p_acao NOT IN ('arquivar','restaurar') OR p_chamado_id IS NULL OR p_atualizado_em IS NULL THEN
    RAISE EXCEPTION 'PARAMETROS_INVALIDOS';
  END IF;
  SELECT * INTO v_c FROM public.chamados WHERE id=p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CHAMADO_NAO_ENCONTRADO'; END IF;
  IF NOT (
    v_user.perfil='master' OR
    (v_user.consorcio_id=v_c.consorcio_id AND
      (v_user.perfil='consorcio' OR (v_user.perfil='empresa' AND
        v_user.empresa_id IS NOT NULL AND v_user.empresa_id=v_c.empresa_id)))
    ) THEN RAISE EXCEPTION 'ESCOPO_NAO_AUTORIZADO'; END IF;
  IF v_c.updated_at IS DISTINCT FROM p_atualizado_em THEN
    RAISE EXCEPTION 'VERSAO_DESATUALIZADA';
  END IF;
  IF p_acao='arquivar' THEN
    IF v_c.arquivado_em IS NOT NULL THEN RAISE EXCEPTION 'CHAMADO_JA_ARQUIVADO'; END IF;
    IF length(trim(coalesce(p_motivo,'')))<3 OR length(p_motivo)>500 THEN
      RAISE EXCEPTION 'MOTIVO_OBRIGATORIO';
    END IF;
    UPDATE public.chamados SET arquivado_em=v_now,
      arquivado_por_usuario_id=v_user.id,arquivado_por_nome=v_user.nome,
      arquivado_motivo=trim(p_motivo),updated_at=v_now
    WHERE id=p_chamado_id;
  ELSE
    IF v_c.arquivado_em IS NULL THEN RAISE EXCEPTION 'CHAMADO_NAO_ARQUIVADO'; END IF;
    UPDATE public.chamados SET arquivado_em=NULL,
      arquivado_por_usuario_id=NULL,arquivado_por_nome=NULL,
      arquivado_motivo=NULL,updated_at=v_now
    WHERE id=p_chamado_id;
  END IF;
  INSERT INTO public.chamado_historico
    (chamado_id,status,mensagem,observacao,usuario_nome,cor)
  VALUES(p_chamado_id,v_c.status,
    CASE WHEN p_acao='arquivar' THEN 'Chamado arquivado' ELSE 'Chamado restaurado' END,
    CASE WHEN p_acao='arquivar' THEN trim(p_motivo)
      ELSE 'Restaurado do arquivo; excluido anteriormente por '||
        coalesce(v_c.arquivado_por_nome,'usuario nao identificado')||
        ': '||coalesce(v_c.arquivado_motivo,'sem motivo') END,
    v_user.nome,'#475569');
  INSERT INTO public.auditoria(consorcio_id,usuario_responsavel,acao,detalhes)
  VALUES(v_c.consorcio_id,v_user.nome,'V19_CHAMADO_'||upper(p_acao),
    'Protocolo '||v_c.protocolo||' | usuario_id '||v_user.id::text);
  RETURN jsonb_build_object('ok',true,'acao',p_acao,'protocolo',v_c.protocolo,
    'arquivado',p_acao='arquivar');
END $$;
REVOKE ALL ON FUNCTION public.v19_gerenciar_arquivamento(uuid,text,timestamptz,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v19_gerenciar_arquivamento(uuid,text,timestamptz,text)
  TO authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.v19_portal_links (
  consorcio_id uuid PRIMARY KEY REFERENCES public.consorcios(id),
  titulo text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  ordem integer NOT NULL DEFAULT 10,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid,
  CONSTRAINT v19_portal_links_titulo CHECK(length(trim(titulo)) BETWEEN 3 AND 90),
  CONSTRAINT v19_portal_links_ordem CHECK(ordem BETWEEN 0 AND 100000)
);
ALTER TABLE public.v19_portal_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v19_portal_links FROM PUBLIC,anon,authenticated;
INSERT INTO public.v19_portal_links(consorcio_id,titulo,ativo,ordem)
SELECT c.id,CASE WHEN lower(c.nome) LIKE '%verde%' THEN 'CISVERDE' ELSE 'CISCAPARAÓ' END,
 true,CASE WHEN lower(c.nome) LIKE '%verde%' THEN 20 ELSE 10 END
FROM public.consorcios c
WHERE c.nome IN ('Ciscaparaó','Cisverde')
ON CONFLICT (consorcio_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.v19_listar_links_portais()
RETURNS TABLE(consorcio_id uuid,titulo text,ordem integer)
LANGUAGE sql SECURITY DEFINER SET search_path='' STABLE AS $$
  SELECT l.consorcio_id,l.titulo,l.ordem
  FROM public.v19_portal_links l
  JOIN public.consorcios c ON c.id=l.consorcio_id AND c.status='ativo'
  JOIN public.portal_configuracoes pc ON pc.consorcio_id=c.id
  WHERE l.ativo AND pc.portal_ativo AND pc.abertura_portal_ativo
  ORDER BY l.ordem,l.titulo
$$;
REVOKE ALL ON FUNCTION public.v19_listar_links_portais() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.v19_listar_links_portais() TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.v19_links_portais_master()
RETURNS TABLE(consorcio_id uuid,titulo text,ativo boolean,ordem integer,nome_consorcio text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.usuarios u WHERE u.auth_user_id=auth.uid()
    AND u.status='ativo' AND u.perfil='master') THEN
    RAISE EXCEPTION 'PERFIL_NAO_AUTORIZADO';
  END IF;
  RETURN QUERY SELECT l.consorcio_id,l.titulo,l.ativo,l.ordem,c.nome
    FROM public.v19_portal_links l JOIN public.consorcios c ON c.id=l.consorcio_id
    ORDER BY l.ordem,l.titulo;
END $$;
REVOKE ALL ON FUNCTION public.v19_links_portais_master() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v19_links_portais_master() TO authenticated;

CREATE OR REPLACE FUNCTION public.v19_gerenciar_link_portal(
  p_consorcio_id uuid,p_titulo text,p_ativo boolean,p_ordem integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid;v_nome text;
BEGIN
  SELECT id,nome INTO v_id,v_nome FROM public.usuarios
    WHERE auth_user_id=auth.uid() AND status='ativo' AND perfil='master';
  IF v_id IS NULL THEN RAISE EXCEPTION 'PERFIL_NAO_AUTORIZADO'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consorcios WHERE id=p_consorcio_id AND status='ativo')
    OR length(trim(coalesce(p_titulo,''))) NOT BETWEEN 3 AND 90
    OR coalesce(p_ordem,-1) NOT BETWEEN 0 AND 100000 OR p_ativo IS NULL THEN
    RAISE EXCEPTION 'DADOS_INVALIDOS';
  END IF;
  INSERT INTO public.v19_portal_links(consorcio_id,titulo,ativo,ordem,atualizado_em,atualizado_por)
  VALUES(p_consorcio_id,trim(p_titulo),p_ativo,p_ordem,now(),v_id)
  ON CONFLICT (consorcio_id) DO UPDATE SET titulo=excluded.titulo,
    ativo=excluded.ativo,ordem=excluded.ordem,
    atualizado_em=now(),atualizado_por=v_id;
  INSERT INTO public.auditoria(consorcio_id,usuario_responsavel,acao,detalhes)
    VALUES(p_consorcio_id,v_nome,'V19_LINK_PORTAL_SALVO',
      'Consorcio '||p_consorcio_id::text||' | ativo '||p_ativo::text);
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.v19_gerenciar_link_portal(uuid,text,boolean,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v19_gerenciar_link_portal(uuid,text,boolean,integer) TO authenticated;

CREATE TABLE IF NOT EXISTS public.v19_rondas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE,
  consorcio_id uuid NOT NULL REFERENCES public.consorcios(id),
  nome text NOT NULL,
  email text NOT NULL,
  telefone text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v19_rondas_nome CHECK(length(trim(nome)) BETWEEN 2 AND 120),
  CONSTRAINT v19_rondas_telefone CHECK(length(regexp_replace(telefone,'\D','','g')) BETWEEN 10 AND 13)
);
CREATE UNIQUE INDEX IF NOT EXISTS v19_rondas_email_idx ON public.v19_rondas(lower(email));
CREATE INDEX IF NOT EXISTS v19_rondas_cons_idx ON public.v19_rondas(consorcio_id,ativo);
ALTER TABLE public.v19_rondas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v19_rondas FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.v19_ronda_me()
RETURNS TABLE(id uuid,consorcio_id uuid,nome text,telefone text,email text)
LANGUAGE sql SECURITY DEFINER SET search_path='' STABLE AS $$
  SELECT r.id,r.consorcio_id,r.nome,r.telefone,r.email
  FROM public.v19_rondas r
  JOIN public.consorcios c ON c.id=r.consorcio_id AND c.status='ativo'
  JOIN public.portal_configuracoes pc ON pc.consorcio_id=c.id
  WHERE r.auth_user_id=auth.uid() AND r.ativo
    AND pc.portal_ativo AND pc.abertura_portal_ativo
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.v19_ronda_me() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v19_ronda_me() TO authenticated;

ALTER TABLE public.chamado_fotos
  ADD COLUMN IF NOT EXISTS excluida_em timestamptz,
  ADD COLUMN IF NOT EXISTS excluida_por uuid,
  ADD COLUMN IF NOT EXISTS excluida_por_nome text;
CREATE INDEX IF NOT EXISTS v19_fotos_ativas_chamado_idx
  ON public.chamado_fotos(chamado_id,excluida_em);

CREATE OR REPLACE FUNCTION public.v19_marcar_foto_excluida(p_foto_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user public.usuarios%ROWTYPE;
  v_f public.chamado_fotos%ROWTYPE;
  v_c public.chamados%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM public.usuarios WHERE auth_user_id=auth.uid()
    AND status='ativo' AND perfil IN ('master','consorcio','empresa');
  IF NOT FOUND THEN RAISE EXCEPTION 'PERFIL_NAO_AUTORIZADO'; END IF;
  SELECT * INTO v_f FROM public.chamado_fotos WHERE id=p_foto_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FOTO_NAO_ENCONTRADA'; END IF;
  SELECT * INTO v_c FROM public.chamados WHERE id=v_f.chamado_id;
  IF NOT FOUND OR v_c.arquivado_em IS NOT NULL OR NOT (
      v_user.perfil='master' OR
      (v_user.consorcio_id=v_c.consorcio_id AND
        (v_user.perfil='consorcio' OR
          (v_user.perfil='empresa' AND v_user.empresa_id=v_c.empresa_id)))
    ) THEN RAISE EXCEPTION 'ESCOPO_NAO_AUTORIZADO'; END IF;
  IF v_f.excluida_em IS NULL THEN
    UPDATE public.chamado_fotos SET excluida_em=now(),excluida_por=v_user.id,
      excluida_por_nome=v_user.nome WHERE id=p_foto_id;
    INSERT INTO public.chamado_historico(chamado_id,status,mensagem,observacao,usuario_nome,cor)
      VALUES(v_c.id,v_c.status,'Fotografia excluída',
       'Tipo '||v_f.tipo||' | referência '||v_f.id::text,v_user.nome,'#64748b');
    INSERT INTO public.auditoria(consorcio_id,usuario_responsavel,acao,detalhes)
      VALUES(v_c.consorcio_id,v_user.nome,'V19_FOTO_EXCLUIDA',
        'Chamado '||v_c.protocolo||' | foto_id '||v_f.id::text);
  END IF;
  RETURN jsonb_build_object('ok',true,'storage_path',v_f.storage_path,
    'ja_excluida',v_f.excluida_em IS NOT NULL,'chamado_id',v_c.id);
END $$;
REVOKE ALL ON FUNCTION public.v19_marcar_foto_excluida(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v19_marcar_foto_excluida(uuid) TO authenticated;

COMMIT;