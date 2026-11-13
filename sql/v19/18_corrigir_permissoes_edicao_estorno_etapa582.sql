-- APONTE CIDADAO V19 — ETAPA 582
-- Corrige checagem do search_path para ativar edicao e estorno REAIS.
-- Cada empresa administra SOMENTE os materiais e o estoque que lhe pertencem.
-- Master e Consorcio continuam somente LEITURA.
-- As RPCs ja foram instaladas na etapa 569 com SECURITY DEFINER,
-- checagem de usuario ativo/empresa e referencia ao estoque_id de origem.
-- Aceita apenas search_path realmente vazio, codificado como search_path=\n-- ou search_path=\"\" na configuracao do PostgreSQL.\n-- Esta instalacao NAO altera saldos ou historico; apenas permissoes.
-- NUNCA executar em V18. Somente V19 xurrhczvyqpwyjemight.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $guard$
DECLARE
  v_fn record;
  v_body text;
  v_norm text;
BEGIN
  -- Resultado confirmado no teste real 579: 6 estoques, 16 movimentos,
  -- 1 consumo ativo. Bloqueio deliberado se outro teste ja modificou a base.
  IF (SELECT COUNT(*) FROM public.estoques)<>6
    OR (SELECT COUNT(*) FROM public.estoques WHERE empresa_id IS NULL)<>0
    OR (SELECT COUNT(*) FROM public.movimentacoes)<>16
    OR (SELECT COUNT(*) FROM public.chamado_materiais)<>1
    OR NOT has_function_privilege(
      'authenticated',
      'public.v19_consumir_material_chamado_empresa(uuid,uuid,numeric)'::regprocedure,
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'ETAPA_582_BLOQUEADA: estado da homologacao divergiu';
  END IF;

  -- Verificar AS DUAS assinaturas reais e a logica de controle de origem.\n  -- Corrigido na etapa 582: PG grava SET search_path TO '' como search_path=\"\".
  FOR v_fn IN
    SELECT p.oid,p.proname,p.prosrc,p.prosecdef,
      EXISTS(
        SELECT 1 FROM unnest(coalesce(p.proconfig,ARRAY[]::text[])) cfg(config)
        WHERE split_part(cfg.config,'=',1)='search_path'
          AND split_part(cfg.config,'=',2) IN ('','""')
      ) AS searchpath_protegido
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.oid IN (
      to_regprocedure('public.v19_editar_material_chamado_empresa(uuid,numeric)'),
      to_regprocedure('public.v19_remover_material_chamado_empresa(uuid)')
    )
  LOOP
    IF v_fn.prosecdef IS DISTINCT FROM true OR v_fn.searchpath_protegido IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'ETAPA_582_BLOQUEADA: funcao % sem SECURITY DEFINER/search_path',v_fn.proname;
    END IF;
    v_norm:=lower(regexp_replace(v_fn.prosrc,'[[:space:]]+',' ','g'));
    IF position('auth.uid() is null' in v_norm)=0
      OR position('v_user_perfil is distinct from ''empresa''' in v_norm)=0
      OR position('v_user_empresa is distinct from v_estoque_empresa' in v_norm)=0
      OR position('v_user_consorcio is distinct from v_consorcio' in v_norm)=0
      OR position('v_material_empresa is distinct from v_estoque_empresa' in v_norm)=0
      OR position('cm.estoque_id' in v_norm)=0
      OR position('for update' in v_norm)=0
      OR position('v_status is null or v_status not in' in v_norm)=0
    THEN
      RAISE EXCEPTION 'ETAPA_582_BLOQUEADA: funcao % nao assegura origem e titularidade',v_fn.proname;
    END IF;
    IF v_fn.proname='v19_editar_material_chamado_empresa'
      AND position('v_empresa_atual is distinct from v_user_empresa and v_delta>0' in v_norm)=0
    THEN
      RAISE EXCEPTION 'ETAPA_582_BLOQUEADA: edicao aumentaria consumo apos transferencia';
    END IF;
    IF v_fn.proname='v19_remover_material_chamado_empresa'
      AND position('delete from public.chamado_materiais' in v_norm)=0
    THEN
      RAISE EXCEPTION 'ETAPA_582_BLOQUEADA: estorno nao remove item anterior';
    END IF;
  END LOOP;

  IF (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.oid IN (
       to_regprocedure('public.v19_editar_material_chamado_empresa(uuid,numeric)'),
       to_regprocedure('public.v19_remover_material_chamado_empresa(uuid)')
      ))<>2 THEN
    RAISE EXCEPTION 'ETAPA_582_BLOQUEADA: funcoes nao encontradas';
  END IF;

  -- Bloquear tipos desconhecidos de movimento para evitar que a RPC
  -- falhe depois da tentativa. Nao muda restricoes/valores existentes.
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid='public.movimentacoes'::regclass
      AND c.contype='c'
      AND pg_get_constraintdef(c.oid) ILIKE '%tipo%'
      AND (
        pg_get_constraintdef(c.oid) NOT ILIKE '%estorno%'
        OR pg_get_constraintdef(c.oid) NOT ILIKE '%devolucao%'
      )
  ) THEN
    RAISE EXCEPTION 'ETAPA_582_BLOQUEADA: tipos de movimentacao estorno/devolucao nao previstos pela restricao';
  END IF;
END
$guard$;

-- Escrita direta permanece vedada; apenas as funcoes oficiais podem gravar.
REVOKE INSERT,UPDATE,DELETE ON TABLE
  public.materiais,public.estoques,public.movimentacoes,
  public.chamado_materiais
FROM PUBLIC,anon,authenticated;

-- Os endpoints legados nao podem contornar isolamento empresarial.
DO $guard$
DECLARE v_assinatura text;
BEGIN
  FOR v_assinatura IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'consumir_material_chamado','editar_material_chamado',
      'remover_material_chamado','v19_movimentar_estoque','v19_salvar_material'
    )
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC,anon,authenticated',
      v_assinatura
    );
  END LOOP;
END
$guard$;

-- Executar apenas os metodos de empresa com permissao interna estrita.
REVOKE ALL ON FUNCTION public.v19_editar_material_chamado_empresa(
  uuid,numeric
) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.v19_remover_material_chamado_empresa(
  uuid
) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.v19_editar_material_chamado_empresa(
  uuid,numeric
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.v19_remover_material_chamado_empresa(
  uuid
) TO authenticated;

COMMENT ON FUNCTION public.v19_editar_material_chamado_empresa(uuid,numeric)
IS 'V19 etapa 582: somente a empresa proprietaria do estoque original edita consumo; jamais aumentar apos transferencia de chamado.';
COMMENT ON FUNCTION public.v19_remover_material_chamado_empresa(uuid)
IS 'V19 etapa 582: somente a empresa proprietaria do estoque de origem estorna, preservando movimentos, auditoria e historico.';
COMMIT;

-- Conferencia: 3 RPCs empresariais authenticated true, anon false.
-- Saldos e historico NAO mudam durante a instalacao.
SELECT
  p.oid::regprocedure::text AS funcao,
  p.prosecdef AS security_definer,
  has_function_privilege('authenticated',p.oid,'EXECUTE') AS autenticado_pode_executar,
  has_function_privilege('anon',p.oid,'EXECUTE') AS anon_pode_executar,
  (SELECT COUNT(*) FROM public.estoques) AS estoques,
  (SELECT COUNT(*) FROM public.movimentacoes) AS movimentos,
  (SELECT COUNT(*) FROM public.chamado_materiais) AS consumos_ativos
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN (
    'v19_consumir_material_chamado_empresa',
    'v19_editar_material_chamado_empresa',
    'v19_remover_material_chamado_empresa'
  )
ORDER BY funcao;
