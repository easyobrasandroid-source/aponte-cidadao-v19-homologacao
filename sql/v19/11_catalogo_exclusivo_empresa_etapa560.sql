-- APONTE CIDADAO V19 — ETAPA 560
-- Cadastro de NOVOS materiais exclusivos da empresa proprietaria.
-- Master e Consorcio somente leem. NENHUMA ALTERACAO NA V18.
-- Executar SOMENTE Supabase V19: xurrhczvyqpwyjemight.
-- APOS etapa 558 e diagnostico 559.
--
-- COMPATIBILIDADE: os 2 materiais antigos permanecem SEM empresa_id,
-- pois seus 4 saldos e 13 movimentos ja existentes usam aqueles IDs.
-- Materiais novos terao empresa_id OBRIGATORIO na RPC de criacao;
-- somente o seu proprietario pode ve-los como empresa.
-- Estoque empresarial novo e criado com 0 contratado / 0 disponivel.
-- Este arquivo NAO movimenta saldos nem modifica os registros anteriores.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $v19$
BEGIN
  IF to_regprocedure('public.v19_listar_estoques_por_empresa(uuid)') IS NULL
     OR to_regprocedure('public.v19_movimentar_estoque_empresa(uuid,uuid,text,numeric,text)') IS NULL
     OR (SELECT COUNT(*) FROM public.materiais) <> 2
     OR (SELECT COUNT(*) FROM public.estoques) <> 4
     OR (SELECT COUNT(*) FROM public.estoques WHERE empresa_id IS NULL) <> 0
     OR (SELECT COUNT(*) FROM public.movimentacoes) <> 13
  THEN
    RAISE EXCEPTION 'ETAPA_560_BLOQUEADA: base anterior mudou; revisar antes de continuar';
  END IF;
END
$v19$;

ALTER TABLE public.materiais
  ADD COLUMN IF NOT EXISTS empresa_id uuid;

-- Protecao de empresa e consorcio consistentes.
DO $v19$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.materiais'::regclass
      AND conname='v19_materiais_empresa_consorcio_fk'
  ) THEN
    ALTER TABLE public.materiais
      ADD CONSTRAINT v19_materiais_empresa_consorcio_fk
      FOREIGN KEY (empresa_id,consorcio_id)
      REFERENCES public.empresas(id,consorcio_id);
  END IF;
END
$v19$;

-- O mesmo nome pode existir em empresas diferentes. Nomes duplicados
-- ativos dentro da propria empresa sao bloqueados.
CREATE UNIQUE INDEX IF NOT EXISTS v19_materiais_empresa_nome_ativo_uniq
  ON public.materiais(empresa_id,lower(btrim(nome)))
  WHERE empresa_id IS NOT NULL AND status='ativo';

CREATE INDEX IF NOT EXISTS v19_materiais_empresa_idx
  ON public.materiais(empresa_id,consorcio_id)
  WHERE empresa_id IS NOT NULL;

COMMENT ON COLUMN public.materiais.empresa_id IS
  'V19: empresa proprietaria do cadastro. NULL apenas para os 2 materiais historicos compartilhados pre-migracao.';

-- Empresas leem somente materiais que criaram OU os 2 materiais historicos
-- para os quais ja possuem um registro real de estoque. Nao listar
-- materiais privados de outra empresa, mesmo no mesmo consorcio.
-- Consorcio e Master preservam leitura conforme escopo.
ALTER POLICY v19_materiais_sel ON public.materiais
USING (
  (SELECT public.v19_perfil_atual())='master'
  OR (
    consorcio_id=(SELECT public.v19_consorcio_atual())
    AND (SELECT public.v19_perfil_atual())='consorcio'
  )
  OR (
    consorcio_id=(SELECT public.v19_consorcio_atual())
    AND (SELECT public.v19_perfil_atual())='empresa'
    AND (
      empresa_id=(SELECT public.v19_empresa_atual())
      OR (
        empresa_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.estoques s
          WHERE s.material_id=materiais.id
            AND s.consorcio_id=materiais.consorcio_id
            AND s.empresa_id=(SELECT public.v19_empresa_atual())
        )
      )
    )
  )
);

-- LISTAGEM: uma linha somente quando o estoque realmente pertence
-- aquela empresa. Nao multiplicar novos materiais pelo numero de
-- empresas do consorcio, e nao criar saldos "virtuais" entre empresas.
-- A assinatura de retorno permanece compativel com a tela atual.
CREATE OR REPLACE FUNCTION public.v19_listar_estoques_por_empresa(
  p_consorcio_id uuid DEFAULT NULL
)
RETURNS TABLE (
  material_id uuid, material_nome text, unidade text, consorcio_id uuid,
  empresa_id uuid, empresa_nome text, estoque_id uuid,
  quantidade_contratada numeric, quantidade_disponivel numeric,
  estoque_minimo numeric, preco_unitario numeric, saldo_legado boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER SET search_path TO ''
AS $v19$
DECLARE
  v_perfil text;
  v_consorcio uuid;
  v_empresa uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
  END IF;

  v_perfil:=public.v19_perfil_atual();
  v_consorcio:=public.v19_consorcio_atual();
  v_empresa:=public.v19_empresa_atual();
  IF v_perfil IS NULL OR v_perfil NOT IN ('master','consorcio','empresa') THEN
    RAISE EXCEPTION 'PERFIL_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;
  IF (v_perfil='consorcio' AND v_consorcio IS NULL)
     OR (v_perfil='empresa' AND (v_consorcio IS NULL OR v_empresa IS NULL)) THEN
    RAISE EXCEPTION 'VINCULO_INVALIDO' USING ERRCODE='42501';
  END IF;
  IF p_consorcio_id IS NOT NULL AND v_perfil<>'master'
     AND p_consorcio_id IS DISTINCT FROM v_consorcio THEN
    RAISE EXCEPTION 'CONSORCIO_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  SELECT
    m.id,m.nome::text,m.unidade::text,m.consorcio_id,
    emp.id,emp.nome::text,s.id,
    s.quantidade_contratada,s.quantidade_disponivel,
    m.estoque_minimo,m.preco_unitario,false
  FROM public.materiais m
  JOIN public.estoques s
    ON s.material_id=m.id AND s.consorcio_id=m.consorcio_id
       AND s.empresa_id IS NOT NULL
  JOIN public.empresas emp
    ON emp.id=s.empresa_id AND emp.consorcio_id=s.consorcio_id
       AND emp.status='ativo'
  WHERE m.status='ativo'
    AND (m.empresa_id IS NULL OR m.empresa_id=emp.id)
    AND (p_consorcio_id IS NULL OR m.consorcio_id=p_consorcio_id)
    AND (
      v_perfil='master'
      OR (v_perfil='consorcio' AND m.consorcio_id=v_consorcio)
      OR (v_perfil='empresa' AND m.consorcio_id=v_consorcio
         AND emp.id=v_empresa)
    );
END
$v19$;

REVOKE ALL ON FUNCTION public.v19_listar_estoques_por_empresa(uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v19_listar_estoques_por_empresa(uuid)
  TO authenticated;

-- CADASTRAR: empresa autenticada ativa cria seu proprio material, e
-- simultaneamente a unica posicao de estoque com valores ZERO.
-- A RPC nao recebe empresa_id/consorcio_id do navegador; sao derivados
-- do usuario autenticado no banco. Master/Consorcio nao podem gravar.
CREATE OR REPLACE FUNCTION public.v19_criar_material_empresa(
  p_nome text,
  p_unidade text DEFAULT 'Un.',
  p_estoque_minimo numeric DEFAULT 0,
  p_preco_unitario numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $v19$
DECLARE
  v_usuario_id uuid;
  v_usuario_nome text;
  v_empresa uuid;
  v_consorcio uuid;
  v_material uuid;
  v_estoque uuid;
  v_nome text;
  v_unidade text;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
  END IF;

  v_nome:=btrim(coalesce(p_nome,''));
  v_unidade:=btrim(coalesce(p_unidade,''));
  IF length(v_nome)<2 OR length(v_nome)>120
    OR length(v_unidade)<1 OR length(v_unidade)>20
    OR p_estoque_minimo IS NULL OR p_estoque_minimo<0
    OR p_estoque_minimo>9999999999
    OR round(p_estoque_minimo,2)<>p_estoque_minimo
    OR p_preco_unitario IS NULL OR p_preco_unitario<0
    OR p_preco_unitario>9999999999
    OR round(p_preco_unitario,2)<>p_preco_unitario
  THEN
    RAISE EXCEPTION 'DADOS_DE_MATERIAL_INVALIDOS' USING ERRCODE='22023';
  END IF;

  SELECT u.id,u.nome,u.empresa_id,u.consorcio_id
  INTO v_usuario_id,v_usuario_nome,v_empresa,v_consorcio
  FROM public.usuarios u
  WHERE u.auth_user_id=auth.uid() AND u.status='ativo'
    AND u.perfil='empresa'
  LIMIT 1;
  IF NOT FOUND OR v_empresa IS NULL OR v_consorcio IS NULL THEN
    RAISE EXCEPTION 'CADASTRO_DE_MATERIAL_EXCLUSIVO_DA_EMPRESA'
      USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.empresas e
    JOIN public.consorcios c
      ON c.id=e.consorcio_id AND c.status='ativo'
    WHERE e.id=v_empresa AND e.consorcio_id=v_consorcio
      AND e.status='ativo'
  ) THEN
    RAISE EXCEPTION 'EMPRESA_OU_CONSORCIO_INATIVO'
      USING ERRCODE='42501';
  END IF;

  -- O indice unico impede que dois usuarios da mesma empresa
  -- cadastrem simultaneamente o mesmo nome ativo.
  INSERT INTO public.materiais(
    consorcio_id,empresa_id,nome,unidade,
    estoque_minimo,preco_unitario,status
  ) VALUES (
    v_consorcio,v_empresa,v_nome,v_unidade,
    p_estoque_minimo,p_preco_unitario,'ativo'
  )
  RETURNING id INTO v_material;

  INSERT INTO public.estoques(
    material_id,consorcio_id,empresa_id,
    quantidade_contratada,quantidade_disponivel
  ) VALUES (
    v_material,v_consorcio,v_empresa,0,0
  ) RETURNING id INTO v_estoque;

  INSERT INTO public.auditoria(
    consorcio_id,usuario_responsavel,acao,detalhes
  ) VALUES (
    v_consorcio,v_usuario_nome,'V19_MATERIAL_EMPRESA_CRIADO',
    'empresa_id='||v_empresa||
    '; material_id='||v_material||
    '; estoque_id='||v_estoque||
    '; nome='||v_nome
  );

  RETURN jsonb_build_object(
    'ok',true,'material_id',v_material,
    'estoque_id',v_estoque,'empresa_id',v_empresa,
    'consorcio_id',v_consorcio,
    'nome',v_nome,
    'quantidade_contratada',0,'quantidade_disponivel',0
  );
END
$v19$;

REVOKE ALL ON FUNCTION public.v19_criar_material_empresa(
  text,text,numeric,numeric
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v19_criar_material_empresa(
  text,text,numeric,numeric
) TO authenticated;
COMMENT ON FUNCTION public.v19_criar_material_empresa(
  text,text,numeric,numeric
) IS 'V19 etapa 560: somente empresa ativa cadastra material proprio e cria saldo empresarial 0 em transacao.';

-- Camada de escrita permanece exclusivamente via RPC.
REVOKE INSERT,UPDATE,DELETE ON TABLE public.materiais,public.estoques
  FROM PUBLIC,anon,authenticated;

-- Confirmacao estrutural, ainda dentro da transacao (sem alterar saldos).
DO $v19$
BEGIN
  IF (SELECT COUNT(*) FROM public.materiais)<>2
    OR (SELECT COUNT(*) FROM public.materiais WHERE empresa_id IS NOT NULL)<>0
    OR (SELECT COUNT(*) FROM public.estoques)<>4
    OR (SELECT COUNT(*) FROM public.movimentacoes)<>13
  THEN
    RAISE EXCEPTION 'ETAPA_560_FALHOU: saldos/catalogo anteriores alterados';
  END IF;
END
$v19$;
COMMIT;

-- Consulta final SEM escrita, esperados 2 / 0 / 4 / 13 / true / false.
SELECT
  (SELECT COUNT(*) FROM public.materiais) AS materiais,
  (SELECT COUNT(*) FROM public.materiais
    WHERE empresa_id IS NOT NULL) AS materiais_exclusivos,
  (SELECT COUNT(*) FROM public.estoques) AS estoques,
  (SELECT COUNT(*) FROM public.movimentacoes) AS movimentos,
  has_function_privilege('authenticated',
    'public.v19_criar_material_empresa(text,text,numeric,numeric)'::regprocedure,
    'EXECUTE') AS authenticated_pode_invocar_criacao,
  has_function_privilege('anon',
    'public.v19_criar_material_empresa(text,text,numeric,numeric)'::regprocedure,
    'EXECUTE') AS anon_pode_invocar_criacao;
