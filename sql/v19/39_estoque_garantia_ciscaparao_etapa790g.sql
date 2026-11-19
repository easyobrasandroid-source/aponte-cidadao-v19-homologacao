-- APONTE CIDADAO V19 — ESTOQUE EXCLUSIVO DA GARANTIA (ETAPA 790-G)
-- Aplicar somente no Supabase V19 de homologacao xurrhczvyqpwyjemight.
-- Tabelas novas. Nao altera public.materiais, public.estoques,
-- public.movimentacoes, public.chamado_materiais nem estoque empresarial.
-- 10 unidades por item no CENTRAL do CISCAPARAO; equipes com zero.
-- Reexecucao nao duplica os saldos da carga inicial.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

CREATE TABLE IF NOT EXISTS public.v19_garantia_locais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES public.consorcios(id),
  nome text NOT NULL CHECK(length(btrim(nome)) BETWEEN 2 AND 120),
  tipo text NOT NULL CHECK(tipo IN ('central','equipe')),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(consorcio_id,id),
  UNIQUE(consorcio_id,nome)
);
CREATE UNIQUE INDEX IF NOT EXISTS v19_garantia_central_unica
  ON public.v19_garantia_locais(consorcio_id) WHERE tipo='central';

CREATE TABLE IF NOT EXISTS public.v19_garantia_materiais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES public.consorcios(id),
  nome text NOT NULL CHECK(length(btrim(nome)) BETWEEN 2 AND 160),
  unidade text NOT NULL DEFAULT 'un' CHECK(length(unidade) BETWEEN 1 AND 15),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(consorcio_id,id),
  UNIQUE(consorcio_id,nome)
);
CREATE TABLE IF NOT EXISTS public.v19_garantia_saldos (
  consorcio_id uuid NOT NULL REFERENCES public.consorcios(id),
  material_id uuid NOT NULL,
  local_id uuid NOT NULL,
  quantidade integer NOT NULL DEFAULT 0 CHECK(quantidade >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(consorcio_id,material_id,local_id),
  FOREIGN KEY(consorcio_id,material_id)
    REFERENCES public.v19_garantia_materiais(consorcio_id,id),
  FOREIGN KEY(consorcio_id,local_id)
    REFERENCES public.v19_garantia_locais(consorcio_id,id)
);
CREATE TABLE IF NOT EXISTS public.v19_garantia_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES public.consorcios(id),
  material_id uuid NOT NULL,
  tipo text NOT NULL CHECK(tipo IN ('entrada_inicial','entrada','saida','transferir')),
  origem_id uuid NULL,
  destino_id uuid NULL,
  quantidade integer NOT NULL CHECK(quantidade BETWEEN 1 AND 10000000),
  operacao_id uuid UNIQUE,
  assinatura text,
  usuario_id uuid NULL REFERENCES public.usuarios(id),
  usuario_nome text NOT NULL,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(consorcio_id,material_id)
    REFERENCES public.v19_garantia_materiais(consorcio_id,id),
  FOREIGN KEY(consorcio_id,origem_id)
    REFERENCES public.v19_garantia_locais(consorcio_id,id),
  FOREIGN KEY(consorcio_id,destino_id)
    REFERENCES public.v19_garantia_locais(consorcio_id,id),
  CONSTRAINT v19_garantia_mov_direcao CHECK (
    (tipo IN ('entrada_inicial','entrada') AND origem_id IS NULL AND destino_id IS NOT NULL)
    OR (tipo='saida' AND origem_id IS NOT NULL AND destino_id IS NULL)
    OR (tipo='transferir' AND origem_id IS NOT NULL AND destino_id IS NOT NULL AND origem_id<>destino_id)
  )
);
CREATE INDEX IF NOT EXISTS v19_garantia_mov_cons_data
  ON public.v19_garantia_movimentos(consorcio_id,created_at DESC);

-- Bloqueio duplo: sem privilegios diretos e com RLS.
-- Apenas SECURITY DEFINER validando JWT consegue consultar/movimentar.
ALTER TABLE public.v19_garantia_locais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v19_garantia_materiais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v19_garantia_saldos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v19_garantia_movimentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v19_garantia_locais, public.v19_garantia_materiais,
  public.v19_garantia_saldos, public.v19_garantia_movimentos
  FROM PUBLIC,anon,authenticated;

-- A RPC exige um unico usuario ativo. O consorcio do JWT prevalece sobre
-- qualquer parametro para Garantia/Consorcio; Master pode selecionar consorcio.
CREATE OR REPLACE FUNCTION public.v19_garantia_consultar(p_consorcio_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_perfil text; v_cons uuid; v_qtd int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
  END IF;
  SELECT count(*) INTO v_qtd FROM public.usuarios
    WHERE auth_user_id=auth.uid() AND status='ativo';
  IF v_qtd<>1 THEN RAISE EXCEPTION 'USUARIO_ATIVO_INVALIDO' USING ERRCODE='42501'; END IF;
  SELECT perfil,consorcio_id INTO v_perfil,v_cons FROM public.usuarios
    WHERE auth_user_id=auth.uid() AND status='ativo';
  IF v_perfil NOT IN ('master','consorcio','garantia') THEN
    RAISE EXCEPTION 'PERFIL_SEM_ACESSO_ESTOQUE_GARANTIA' USING ERRCODE='42501';
  END IF;
  IF p_consorcio_id IS NULL OR
     (v_perfil<>'master' AND
      (v_cons IS NULL OR p_consorcio_id IS DISTINCT FROM v_cons)) THEN
    RAISE EXCEPTION 'CONSORCIO_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.consorcios WHERE id=p_consorcio_id AND status='ativo') THEN
    RAISE EXCEPTION 'CONSORCIO_INATIVO_OU_INEXISTENTE' USING ERRCODE='22023';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'ok',true,'consorcio_id',p_consorcio_id,
    'materiais',COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',m.id,'nome',m.nome,'unidade',m.unidade,'ativo',m.ativo) ORDER BY m.nome)
      FROM public.v19_garantia_materiais m WHERE m.consorcio_id=p_consorcio_id
    ),'[]'::jsonb),
    'locais',COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',l.id,'nome',l.nome,'tipo',l.tipo,'ativo',l.ativo)
        ORDER BY l.tipo,l.nome)
      FROM public.v19_garantia_locais l WHERE l.consorcio_id=p_consorcio_id
    ),'[]'::jsonb),
    'saldos',COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'material_id',s.material_id,'local_id',s.local_id,'quantidade',s.quantidade))
      FROM public.v19_garantia_saldos s WHERE s.consorcio_id=p_consorcio_id
    ),'[]'::jsonb),
    'movimentos',COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',x.id,'tipo',x.tipo,'material_id',x.material_id,
        'origem_id',x.origem_id,'destino_id',x.destino_id,
        'quantidade',x.quantidade,'usuario_nome',x.usuario_nome,
        'observacao',x.observacao,'created_at',x.created_at)
        ORDER BY x.created_at DESC)
      FROM (SELECT * FROM public.v19_garantia_movimentos
            WHERE consorcio_id=p_consorcio_id ORDER BY created_at DESC LIMIT 100) x
    ),'[]'::jsonb)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.v19_garantia_gerenciar(
  p_consorcio_id uuid, p_acao text, p_material_id uuid DEFAULT NULL,
  p_local_origem uuid DEFAULT NULL, p_local_destino uuid DEFAULT NULL,
  p_quantidade integer DEFAULT NULL, p_nome text DEFAULT NULL,
  p_operacao_id uuid DEFAULT NULL, p_observacao text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_perfil text; v_cons uuid; v_user uuid; v_nome_usuario text; v_qtd int;
  v_acao text := lower(btrim(coalesce(p_acao,'')));
  v_id uuid; v_mov uuid; v_sig text; v_old_sig text;
  v_orig integer; v_dest integer; v_nome text:=nullif(btrim(coalesce(p_nome,'')),'');
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
  END IF;
  SELECT count(*) INTO v_qtd FROM public.usuarios
    WHERE auth_user_id=auth.uid() AND status='ativo';
  IF v_qtd<>1 THEN RAISE EXCEPTION 'USUARIO_ATIVO_INVALIDO' USING ERRCODE='42501'; END IF;
  SELECT id,nome,perfil,consorcio_id
    INTO v_user,v_nome_usuario,v_perfil,v_cons FROM public.usuarios
    WHERE auth_user_id=auth.uid() AND status='ativo';
  IF v_perfil NOT IN ('master','consorcio','garantia') THEN
    RAISE EXCEPTION 'PERFIL_SEM_ACESSO_ESTOQUE_GARANTIA' USING ERRCODE='42501';
  END IF;
  IF p_consorcio_id IS NULL OR
     (v_perfil<>'master' AND
       (v_cons IS NULL OR p_consorcio_id IS DISTINCT FROM v_cons)) THEN
    RAISE EXCEPTION 'CONSORCIO_NAO_AUTORIZADO' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.consorcios WHERE id=p_consorcio_id AND status='ativo') THEN
    RAISE EXCEPTION 'CONSORCIO_INATIVO_OU_INEXISTENTE' USING ERRCODE='22023';
  END IF;
  -- Todas as escritas deste consorcio ficam serializadas; saldos sem corrida.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('v19-garantia-'||p_consorcio_id::text,0)
  );
  IF v_acao='material_criar' THEN
    IF v_nome IS NULL OR length(v_nome)>160 THEN
      RAISE EXCEPTION 'NOME_MATERIAL_INVALIDO' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.v19_garantia_materiais(consorcio_id,nome)
      VALUES(p_consorcio_id,v_nome) RETURNING id INTO v_id;
    RETURN pg_catalog.jsonb_build_object('ok',true,'acao',v_acao,'id',v_id);
  ELSIF v_acao='material_excluir' THEN
    IF NOT EXISTS(SELECT 1 FROM public.v19_garantia_materiais
      WHERE id=p_material_id AND consorcio_id=p_consorcio_id AND ativo) THEN
      RAISE EXCEPTION 'MATERIAL_NAO_ENCONTRADO' USING ERRCODE='22023';
    END IF;
    IF EXISTS(SELECT 1 FROM public.v19_garantia_saldos
      WHERE consorcio_id=p_consorcio_id AND material_id=p_material_id AND quantidade>0) THEN
      RAISE EXCEPTION 'ZERAR_SALDOS_ANTES_DE_EXCLUIR_MATERIAL' USING ERRCODE='22023';
    END IF;
    UPDATE public.v19_garantia_materiais SET ativo=false
      WHERE id=p_material_id AND consorcio_id=p_consorcio_id;
    RETURN pg_catalog.jsonb_build_object('ok',true,'acao',v_acao,'id',p_material_id);
  ELSIF v_acao='equipe_criar' THEN
    IF v_nome IS NULL OR length(v_nome)>120 THEN
      RAISE EXCEPTION 'NOME_EQUIPE_INVALIDO' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.v19_garantia_locais(consorcio_id,nome,tipo)
      VALUES(p_consorcio_id,v_nome,'equipe') RETURNING id INTO v_id;
    RETURN pg_catalog.jsonb_build_object('ok',true,'acao',v_acao,'id',v_id);
  ELSIF v_acao='equipe_excluir' THEN
    IF NOT EXISTS(SELECT 1 FROM public.v19_garantia_locais
      WHERE id=p_local_origem AND consorcio_id=p_consorcio_id
        AND tipo='equipe' AND ativo) THEN
      RAISE EXCEPTION 'EQUIPE_NAO_ENCONTRADA' USING ERRCODE='22023';
    END IF;
    IF EXISTS(SELECT 1 FROM public.v19_garantia_saldos
      WHERE consorcio_id=p_consorcio_id AND local_id=p_local_origem AND quantidade>0) THEN
      RAISE EXCEPTION 'ZERAR_EQUIPE_ANTES_DE_EXCLUIR' USING ERRCODE='22023';
    END IF;
    UPDATE public.v19_garantia_locais SET ativo=false
      WHERE id=p_local_origem AND consorcio_id=p_consorcio_id;
    RETURN pg_catalog.jsonb_build_object('ok',true,'acao',v_acao,'id',p_local_origem);
  ELSIF v_acao NOT IN ('entrada','saida','transferir') THEN
    RAISE EXCEPTION 'ACAO_INVALIDA' USING ERRCODE='22023';
  END IF;

  IF p_material_id IS NULL OR p_quantidade IS NULL OR
     p_quantidade NOT BETWEEN 1 AND 10000000 OR p_operacao_id IS NULL OR
     length(coalesce(p_observacao,''))>500 THEN
    RAISE EXCEPTION 'MOVIMENTACAO_INVALIDA' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.v19_garantia_materiais
    WHERE id=p_material_id AND consorcio_id=p_consorcio_id AND ativo) THEN
    RAISE EXCEPTION 'MATERIAL_NAO_AUTORIZADO_OU_INATIVO' USING ERRCODE='42501';
  END IF;
  IF v_acao IN ('saida','transferir') AND
    (p_local_origem IS NULL OR NOT EXISTS(
      SELECT 1 FROM public.v19_garantia_locais
      WHERE id=p_local_origem AND consorcio_id=p_consorcio_id AND ativo)) THEN
    RAISE EXCEPTION 'ORIGEM_INVALIDA' USING ERRCODE='22023';
  END IF;
  IF v_acao IN ('entrada','transferir') AND
    (p_local_destino IS NULL OR NOT EXISTS(
      SELECT 1 FROM public.v19_garantia_locais
      WHERE id=p_local_destino AND consorcio_id=p_consorcio_id AND ativo)) THEN
    RAISE EXCEPTION 'DESTINO_INVALIDO' USING ERRCODE='22023';
  END IF;
  IF (v_acao='transferir' AND p_local_origem=p_local_destino)
     OR (v_acao='entrada' AND p_local_origem IS NOT NULL)
     OR (v_acao='saida' AND p_local_destino IS NOT NULL) THEN
    RAISE EXCEPTION 'DIRECAO_INVALIDA' USING ERRCODE='22023';
  END IF;

  v_sig:=pg_catalog.md5(pg_catalog.concat_ws('|',
    p_consorcio_id::text,v_acao,p_material_id::text,
    coalesce(p_local_origem::text,''),coalesce(p_local_destino::text,''),
    p_quantidade::text,coalesce(p_observacao,'')));
  SELECT id,assinatura INTO v_mov,v_old_sig
    FROM public.v19_garantia_movimentos WHERE operacao_id=p_operacao_id;
  IF FOUND THEN
    IF v_old_sig IS DISTINCT FROM v_sig THEN
      RAISE EXCEPTION 'CHAVE_OPERACAO_REUTILIZADA' USING ERRCODE='22023';
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok',true,'repetida',true,
      'movimento_id',v_mov);
  END IF;

  IF v_acao IN ('saida','transferir') THEN
    INSERT INTO public.v19_garantia_saldos(consorcio_id,material_id,local_id,quantidade)
      VALUES(p_consorcio_id,p_material_id,p_local_origem,0)
      ON CONFLICT DO NOTHING;
    SELECT quantidade INTO v_orig FROM public.v19_garantia_saldos
      WHERE consorcio_id=p_consorcio_id AND material_id=p_material_id
        AND local_id=p_local_origem FOR UPDATE;
    IF v_orig<p_quantidade THEN
      RAISE EXCEPTION 'SALDO_GARANTIA_INSUFICIENTE' USING ERRCODE='22023';
    END IF;
    UPDATE public.v19_garantia_saldos
      SET quantidade=quantidade-p_quantidade,updated_at=clock_timestamp()
      WHERE consorcio_id=p_consorcio_id AND material_id=p_material_id
        AND local_id=p_local_origem;
  END IF;
  IF v_acao IN ('entrada','transferir') THEN
    INSERT INTO public.v19_garantia_saldos(consorcio_id,material_id,local_id,quantidade)
      VALUES(p_consorcio_id,p_material_id,p_local_destino,0)
      ON CONFLICT DO NOTHING;
    SELECT quantidade INTO v_dest FROM public.v19_garantia_saldos
      WHERE consorcio_id=p_consorcio_id AND material_id=p_material_id
        AND local_id=p_local_destino FOR UPDATE;
    IF v_dest>2147483647-p_quantidade THEN
      RAISE EXCEPTION 'LIMITE_QUANTIDADE_EXCEDIDO' USING ERRCODE='22023';
    END IF;
    UPDATE public.v19_garantia_saldos
      SET quantidade=quantidade+p_quantidade,updated_at=clock_timestamp()
      WHERE consorcio_id=p_consorcio_id AND material_id=p_material_id
        AND local_id=p_local_destino;
  END IF;
  INSERT INTO public.v19_garantia_movimentos(
    consorcio_id,material_id,tipo,origem_id,destino_id,quantidade,
    operacao_id,assinatura,usuario_id,usuario_nome,observacao
  ) VALUES (
    p_consorcio_id,p_material_id,v_acao,
    CASE WHEN v_acao='entrada' THEN NULL ELSE p_local_origem END,
    CASE WHEN v_acao='saida' THEN NULL ELSE p_local_destino END,
    p_quantidade,p_operacao_id,v_sig,v_user,
    coalesce(v_nome_usuario,'Usuario autenticado'),nullif(btrim(coalesce(p_observacao,'')),'')
  ) RETURNING id INTO v_mov;
  RETURN pg_catalog.jsonb_build_object('ok',true,'acao',v_acao,
    'movimento_id',v_mov,'quantidade',p_quantidade);
END;
$fn$;

REVOKE ALL ON FUNCTION public.v19_garantia_consultar(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v19_garantia_consultar(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.v19_garantia_gerenciar(
 uuid,text,uuid,uuid,uuid,integer,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v19_garantia_gerenciar(
 uuid,text,uuid,uuid,uuid,integer,text,uuid,text) TO authenticated;

-- Carga inicial: localizar CISCAPARAO por nome, exigindo correspondencia UNICA.
-- Se nao existir, interromper antes do COMMIT sem criar dados em outro consorcio.
DO $seed$
DECLARE
  v_cons uuid; v_count int; v_central uuid; v_material uuid; v_nome text;
BEGIN
  SELECT count(*) INTO v_count FROM public.consorcios
   WHERE pg_catalog.regexp_replace(
     pg_catalog.translate(pg_catalog.lower(nome),
       'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),
     '[^a-z0-9]','','g') LIKE '%ciscaparao%'
   AND status='ativo';
  IF v_count<>1 THEN
    RAISE EXCEPTION 'CARGA_CISCAPARAO_BLOQUEADA: esperado 1 consorcio ativo, encontrado %',v_count;
  END IF;
  SELECT id INTO v_cons FROM public.consorcios
    WHERE pg_catalog.regexp_replace(
      pg_catalog.translate(pg_catalog.lower(nome),
        'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),
      '[^a-z0-9]','','g') LIKE '%ciscaparao%' AND status='ativo'
    LIMIT 1;
  INSERT INTO public.v19_garantia_locais(consorcio_id,nome,tipo)
    VALUES(v_cons,'Central de Garantia','central')
    ON CONFLICT(consorcio_id,nome) DO NOTHING;
  SELECT id INTO v_central FROM public.v19_garantia_locais
    WHERE consorcio_id=v_cons AND tipo='central';
  IF v_central IS NULL THEN RAISE EXCEPTION 'CENTRAL_NAO_CRIADA'; END IF;
  INSERT INTO public.v19_garantia_locais(consorcio_id,nome,tipo)
   VALUES(v_cons,'Equipe Garantia 1','equipe'),
         (v_cons,'Equipe Garantia 2','equipe'),
         (v_cons,'Equipe Garantia 3','equipe')
   ON CONFLICT(consorcio_id,nome) DO NOTHING;

  FOR v_nome IN SELECT unnest(ARRAY[
    'Luminária Serraled 50W (E1)','Luminária Serraled 80W (E1)',
    'Luminária Serraled 100W (E1)','Luminária Serraled 50W (E2)',
    'Luminária Serraled 80W (E2)','Luminária Serraled 100W (E2)',
    'Luminária Luzled 80W','Luminária Luzled 100W'
  ]::text[]) LOOP
    v_material:=NULL;
    INSERT INTO public.v19_garantia_materiais(consorcio_id,nome,unidade)
      VALUES(v_cons,v_nome,'un')
      ON CONFLICT(consorcio_id,nome) DO NOTHING
      RETURNING id INTO v_material;
    IF v_material IS NOT NULL THEN
      INSERT INTO public.v19_garantia_saldos(consorcio_id,material_id,local_id,quantidade)
        VALUES(v_cons,v_material,v_central,10);
      INSERT INTO public.v19_garantia_movimentos(
        consorcio_id,material_id,tipo,origem_id,destino_id,
        quantidade,usuario_nome,observacao
      ) VALUES (
        v_cons,v_material,'entrada_inicial',NULL,v_central,
        10,'Carga inicial autorizada','10 unidades iniciais conforme listagem CISCAPARAÓ'
      );
    END IF;
  END LOOP;
END;
$seed$;

COMMIT;
-- Verificacao sem exibir dados empresariais. Equipes podem ter saldo zero.
SELECT c.nome AS consorcio,
 (SELECT COUNT(*) FROM public.v19_garantia_materiais m
   WHERE m.consorcio_id=c.id AND m.ativo) AS materiais,
 (SELECT COUNT(*) FROM public.v19_garantia_locais l
   WHERE l.consorcio_id=c.id AND l.tipo='equipe' AND l.ativo) AS equipes,
 (SELECT COALESCE(SUM(s.quantidade),0) FROM public.v19_garantia_saldos s
   WHERE s.consorcio_id=c.id) AS unidades_totais
FROM public.consorcios c
WHERE pg_catalog.regexp_replace(
 pg_catalog.translate(pg_catalog.lower(c.nome),
   'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),
 '[^a-z0-9]','','g') LIKE '%ciscaparao%'
AND c.status='ativo';
