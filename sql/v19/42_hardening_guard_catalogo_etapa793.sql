-- V19 Etapa 793: hardening pontual da funcao de gatilho do catalogo
-- Aplicar EXCLUSIVAMENTE no Supabase de homologacao V19 xurrhczvyqpwyjemight.
-- Nao altera o codigo do gatilho, chamadas, tabela, RLS, dados nem a V18.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
DO $check$
BEGIN
 IF to_regprocedure('public.v19_guard_tipo_problema_chamado()') IS NULL THEN
   RAISE EXCEPTION 'GUARD_TIPO_PROBLEMA_AUSENTE';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_trigger t
   WHERE t.tgname='v19_guard_tipo_problema_chamado'
     AND t.tgrelid='public.chamados'::regclass
     AND t.tgfoid='public.v19_guard_tipo_problema_chamado()'::regprocedure
     AND t.tgenabled IN ('O','A')
 ) THEN
   RAISE EXCEPTION 'TRIGGER_TIPO_PROBLEMA_NAO_ATIVO';
 END IF;
END;
$check$;
REVOKE EXECUTE ON FUNCTION public.v19_guard_tipo_problema_chamado()
 FROM PUBLIC, anon, authenticated;
COMMIT;
SELECT
 has_function_privilege('anon','public.v19_guard_tipo_problema_chamado()','EXECUTE') AS anon_executa_diretamente,
 has_function_privilege('authenticated','public.v19_guard_tipo_problema_chamado()','EXECUTE') AS autenticado_executa_diretamente,
 (SELECT t.tgenabled FROM pg_trigger t WHERE t.tgname='v19_guard_tipo_problema_chamado'
  AND t.tgrelid='public.chamados'::regclass) AS gatilho_ativo;
