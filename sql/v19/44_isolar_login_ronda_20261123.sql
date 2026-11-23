-- V19 security hardening: one Auth identity cannot be Ronda and internal user.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.v19_impedir_conta_ronda_compartilhada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.auth_user_id IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='v19_rondas' THEN
    IF EXISTS (SELECT 1 FROM public.usuarios u WHERE u.auth_user_id=NEW.auth_user_id)
    THEN RAISE EXCEPTION 'CONTA_INTERNA_NAO_PODE_SER_RONDA'; END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.v19_rondas r WHERE r.auth_user_id=NEW.auth_user_id)
    THEN RAISE EXCEPTION 'CONTA_RONDA_NAO_PODE_SER_INTERNA'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS v19_ronda_separar_auth ON public.v19_rondas;
CREATE TRIGGER v19_ronda_separar_auth BEFORE INSERT OR UPDATE OF auth_user_id
ON public.v19_rondas FOR EACH ROW EXECUTE FUNCTION public.v19_impedir_conta_ronda_compartilhada();
DROP TRIGGER IF EXISTS v19_usuario_separar_ronda ON public.usuarios;
CREATE TRIGGER v19_usuario_separar_ronda BEFORE INSERT OR UPDATE OF auth_user_id
ON public.usuarios FOR EACH ROW EXECUTE FUNCTION public.v19_impedir_conta_ronda_compartilhada();
REVOKE ALL ON FUNCTION public.v19_impedir_conta_ronda_compartilhada() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.v19_ronda_me()
RETURNS TABLE(id uuid,consorcio_id uuid,nome text,telefone text,email text)
LANGUAGE sql SECURITY DEFINER SET search_path='' STABLE AS $$
  SELECT r.id,r.consorcio_id,r.nome,r.telefone,r.email
  FROM public.v19_rondas r
  JOIN public.consorcios c ON c.id=r.consorcio_id AND c.status='ativo'
  JOIN public.portal_configuracoes pc ON pc.consorcio_id=c.id
  WHERE r.auth_user_id=auth.uid() AND r.ativo
    AND pc.portal_ativo AND pc.abertura_portal_ativo
    AND NOT EXISTS(SELECT 1 FROM public.usuarios u WHERE u.auth_user_id=r.auth_user_id)
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.v19_ronda_me() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v19_ronda_me() TO authenticated;
COMMIT;