-- APONTE CIDADAO V19 — ETAPA 563
-- Material de empresa com quantidade inicial opcional no proprio cadastro.
-- Apenas a propria empresa pode cadastrar e adicionar seu saldo.
-- Master e Consorcio somente visualizam.
-- Criacao + entrada inicial + historico acontecem NA MESMA TRANSACAO.
-- Se houver erro na entrada, o cadastro inteiro e revertido.
-- Quantidade inicial 0: cria material/estoque zerados SEM movimento ficticio.
-- Nao altera os materiais existentes, saldos nem historico na instalacao.
-- EXECUTAR SOMENTE Supabase V19: xurrhczvyqpwyjemight. V18 INTOCADA.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Reutilizar as funcoes de criacao e movimentacao ja homologadas,
-- mantendo em um ponto so a validacao de empresa/consorcio/usuario.
DO $guard$
BEGIN
  IF to_regprocedure('public.v19_criar_material_empresa(text,text,numeric,numeric)') IS NULL
     OR to_regprocedure('public.v19_movimentar_estoque_empresa(uuid,uuid,text,numeric,text)') IS NULL
     OR (SELECT COUNT(*) FROM public.estoques WHERE empresa_id IS NULL)>0
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='materiais'
         AND column_name='empresa_id'
     )
  THEN
    RAISE EXCEPTION 'ETAPA_563_BLOQUEADA: migracao empresarial incompleta';
  END IF;
END
$guard$;

-- Funcao nova, sem sobrecarregar a funcao de 4 parametros. O cadastro
-- anterior continua compativel, mas a tela passara a usar esta versao.
CREATE OR REPLACE FUNCTION public.v19_criar_material_empresa_com_saldo(
  p_nome text,
  p_unidade text,
  p_estoque_minimo numeric,
  p_preco_unitario numeric,
  p_quantidade_inicial numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $v19$
DECLARE
  v_criacao jsonb;
  v_entrada jsonb;
  v_material_id uuid;
  v_empresa_id uuid;
  v_estoque_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
  END IF;

  -- Estoque pode iniciar zerado, mas nunca negativo nem fracionario
  -- alem de duas casas decimais, mantendo o limite do livro de movimentos.
  IF p_quantidade_inicial IS NULL OR p_quantidade_inicial < 0
     OR p_quantidade_inicial > 9999999999
     OR round(p_quantidade_inicial,2) <> p_quantidade_inicial THEN
    RAISE EXCEPTION 'QUANTIDADE_INICIAL_INVALIDA' USING ERRCODE='22023';
  END IF;

  -- A propria funcao v19_criar_material_empresa exige perfil empresa
  -- com status ativo e deriva empresa e consorcio da conta autenticada.
  -- Cria material + estoque com saldos zero e auditoria de cadastro.
  v_criacao := public.v19_criar_material_empresa(
    p_nome,p_unidade,p_estoque_minimo,p_preco_unitario
  );
  IF v_criacao IS NULL OR v_criacao->>'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'CADASTRO_EMPRESARIAL_NAO_CONFIRMADO';
  END IF;

  v_material_id := (v_criacao->>'material_id')::uuid;
  v_empresa_id := (v_criacao->>'empresa_id')::uuid;
  v_estoque_id := (v_criacao->>'estoque_id')::uuid;
  IF v_material_id IS NULL OR v_empresa_id IS NULL OR v_estoque_id IS NULL THEN
    RAISE EXCEPTION 'CADASTRO_EMPRESARIAL_INCOMPLETO';
  END IF;

  IF p_quantidade_inicial > 0 THEN
    -- A RPC de movimentacao confere outra vez usuario ativo,
    -- perfil empresa e titularidade real do estoque, aplica locks,
    -- atualiza contratado/disponivel e grava uma ENTRADA no livro.
    v_entrada := public.v19_movimentar_estoque_empresa(
      v_material_id,
      v_empresa_id,
      'entrada',
      p_quantidade_inicial,
      'Entrada inicial no cadastro empresarial V19'
    );

    IF v_entrada IS NULL OR v_entrada->>'ok' IS DISTINCT FROM 'true'
       OR (v_entrada->>'empresa_id')::uuid IS DISTINCT FROM v_empresa_id
       OR (v_entrada->>'estoque_id')::uuid IS DISTINCT FROM v_estoque_id
       OR (v_entrada->>'material_id')::uuid IS DISTINCT FROM v_material_id
       OR (v_entrada->>'novo_saldo')::numeric IS DISTINCT FROM p_quantidade_inicial
       OR (v_entrada->>'contratado')::numeric IS DISTINCT FROM p_quantidade_inicial
    THEN
      RAISE EXCEPTION 'ENTRADA_INICIAL_NAO_CONFIRMADA: cadastro revertido';
    END IF;
  END IF;

  RETURN v_criacao || jsonb_build_object(
    'quantidade_contratada',p_quantidade_inicial,
    'quantidade_disponivel',p_quantidade_inicial,
    'movimentacao_inicial_registrada',p_quantidade_inicial>0
  );
END
$v19$;

REVOKE ALL ON FUNCTION public.v19_criar_material_empresa_com_saldo(
  text,text,numeric,numeric,numeric
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v19_criar_material_empresa_com_saldo(
  text,text,numeric,numeric,numeric
) TO authenticated;
COMMENT ON FUNCTION public.v19_criar_material_empresa_com_saldo(
  text,text,numeric,numeric,numeric
) IS 'V19 563: somente empresa ativa cria material proprio com quantidade inicial 0 ou positiva; entrada, saldo e auditoria na mesma transacao.';

COMMIT;

-- Somente verificacao; nenhum material e criado nesta instalacao.
SELECT
  p.oid::regprocedure::text AS funcao,
  p.prosecdef AS security_definer,
  has_function_privilege('authenticated',p.oid,'EXECUTE')
    AS autenticado_pode_invocar,
  has_function_privilege('anon',p.oid,'EXECUTE')
    AS anon_pode_invocar,
  (SELECT COUNT(*) FROM public.materiais) AS materiais,
  (SELECT COUNT(*) FROM public.estoques) AS estoques,
  (SELECT COUNT(*) FROM public.movimentacoes) AS movimentos
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname='v19_criar_material_empresa_com_saldo';
