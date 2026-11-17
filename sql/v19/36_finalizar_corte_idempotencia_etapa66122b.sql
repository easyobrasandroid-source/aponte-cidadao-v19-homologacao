-- Aponte Cidadão V19 — ETAPA 661.22B
-- CORTE CONTROLADO: nao executar ate:
--  1) instalar e confirmar migracao 35_idempotencia_estoque_etapa66122a.sql;
--  2) integrar e publicar frontend V19 atualizado e validar as wrappers reais;
--  3) confirmar que antigas chamadas sao descontinuadas na interface.
-- Depois deste script, clientes com JS antigo receberao erro no estoque e
-- precisarao recarregar a V19. Somente no Supabase V19.
-- Esta migracao NAO modifica nenhum saldo, movimento ou consumo.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $guard$
BEGIN
 IF to_regprocedure(
  'public.v19_movimentar_estoque_idempotente(uuid,uuid,uuid,text,numeric,text)'
 ) IS NULL
 OR to_regprocedure(
  'public.v19_consumir_material_chamado_idempotente(uuid,uuid,uuid,numeric)'
 ) IS NULL
 OR to_regclass('public.v19_requisicoes_estoque') IS NULL
 THEN
  RAISE EXCEPTION 'CORTE_66122B_BLOQUEADO: preparacao de idempotencia ausente';
 END IF;
 IF NOT has_function_privilege(
  'authenticated',
  'public.v19_movimentar_estoque_idempotente(uuid,uuid,uuid,text,numeric,text)'::regprocedure,
  'EXECUTE')
 OR NOT has_function_privilege(
  'authenticated',
  'public.v19_consumir_material_chamado_idempotente(uuid,uuid,uuid,numeric)'::regprocedure,
  'EXECUTE')
 THEN
  RAISE EXCEPTION 'CORTE_66122B_BLOQUEADO: wrappers nao disponiveis';
 END IF;
END
$guard$;

-- Antigos endpoints executáveis por authenticated não garantem
-- idempotência e precisam ser bloqueados após a troca do frontend.
REVOKE ALL ON FUNCTION public.v19_movimentar_estoque_empresa(
 uuid,uuid,text,numeric,text
) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.v19_consumir_material_chamado_empresa(
 uuid,uuid,numeric
) FROM PUBLIC,anon,authenticated;

COMMIT;

SELECT
 p.oid::regprocedure::text AS funcao,
 has_function_privilege('authenticated',p.oid,'EXECUTE')
   AS autenticado_pode_executar,
 has_function_privilege('anon',p.oid,'EXECUTE')
   AS anon_pode_executar
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN (
 'v19_movimentar_estoque_empresa',
 'v19_consumir_material_chamado_empresa',
 'v19_movimentar_estoque_idempotente',
 'v19_consumir_material_chamado_idempotente'
)
ORDER BY funcao;
