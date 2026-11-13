-- APONTE CIDADAO V19 — ETAPA 546
-- Ativacao estrutural de saldos EXCLUSIVAMENTE por empresa no Supabase V19.
-- Executar APOS etapas 538, 541, 542 corrigida e 545 aprovadas.
-- ATENCAO: as RPCs antigas de estoque serao bloqueadas enquanto as novas
-- RPCs e o frontend por empresa sao implementados. NAO operar estoque na
-- interface durante essa transicao. NENHUMA ALTERACAO NA V18.
--
-- PRECONDICOES OBRIGATORIAS:
--   dois estoques anteriores EXATOS zerados (25/13 + 10/6 no backup),
--   11 movimentacoes historicas, nenhum consumo ativo,
--   dois materiais e duas empresas Alfa ativas.
-- A transacao falha e desfaz TUDO se encontrar qualquer divergencia.
--
-- RESULTADO ESPERADO: quatro linhas empresariais com saldo 0,
-- zero linhas sem empresa, 11 movimentos intactos, backup preservado.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

LOCK TABLE public.estoques IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.chamado_materiais IN SHARE MODE;
LOCK TABLE public.movimentacoes IN SHARE MODE;

DO $v19$
DECLARE
  v_materiais integer;
  v_empresas integer;
  v_registros integer;
  v_backup integer;
  v_movimentos integer;
  v_candidatos integer;
  v_consumos integer;
BEGIN
  SELECT COUNT(*) INTO v_registros FROM public.estoques;
  IF v_registros<>2 THEN
    RAISE EXCEPTION 'ETAPA_546_BLOQUEADA: esperado 2 estoques zerados, encontrados %',v_registros;
  END IF;

  SELECT COUNT(*) INTO v_candidatos
  FROM public.estoques s
  WHERE s.empresa_id IS NULL
    AND s.quantidade_contratada=0
    AND s.quantidade_disponivel=0
    AND s.consorcio_id='cf264e88-c591-4098-bd26-1740d19d3752'::uuid
    AND (
      (s.id='438c3327-1c57-49bc-becb-a7fff9d933e0'::uuid
       AND s.material_id='00f5bf85-7997-4cf7-b248-93266bdf1d6e'::uuid)
      OR
      (s.id='650d936f-0a65-4fd5-8f44-6a966bf9e612'::uuid
       AND s.material_id='77f6e4be-c1bb-4e99-9431-f8e1b237cb61'::uuid)
    );
  IF v_candidatos<>2 THEN
    RAISE EXCEPTION 'ETAPA_546_BLOQUEADA: saldos legados inesperados ou nao zerados';
  END IF;

  SELECT COUNT(*) INTO v_backup
  FROM v19_backups.estoques_pre_zeramento_545 b
  WHERE b.consorcio_id='cf264e88-c591-4098-bd26-1740d19d3752'::uuid
    AND (
      (b.estoque_id='438c3327-1c57-49bc-becb-a7fff9d933e0'::uuid
       AND b.material_id='00f5bf85-7997-4cf7-b248-93266bdf1d6e'::uuid
       AND b.quantidade_contratada=25 AND b.quantidade_disponivel=13)
      OR
      (b.estoque_id='650d936f-0a65-4fd5-8f44-6a966bf9e612'::uuid
       AND b.material_id='77f6e4be-c1bb-4e99-9431-f8e1b237cb61'::uuid
       AND b.quantidade_contratada=10 AND b.quantidade_disponivel=6)
    );
  IF v_backup<>2 THEN
    RAISE EXCEPTION 'ETAPA_546_BLOQUEADA: backup da etapa 545 nao confirmado';
  END IF;

  SELECT COUNT(*) INTO v_movimentos FROM public.movimentacoes;
  IF v_movimentos<>11 THEN
    RAISE EXCEPTION 'ETAPA_546_BLOQUEADA: historico alterado (% movimentos)',v_movimentos;
  END IF;

  SELECT COUNT(*) INTO v_consumos FROM public.chamado_materiais;
  IF v_consumos<>0 THEN
    RAISE EXCEPTION 'ETAPA_546_BLOQUEADA: ainda existem % consumos atuais',v_consumos;
  END IF;

  SELECT COUNT(*) INTO v_materiais
  FROM public.materiais m
  WHERE m.status='ativo'
    AND m.consorcio_id='cf264e88-c591-4098-bd26-1740d19d3752'::uuid
    AND m.id IN (
      '00f5bf85-7997-4cf7-b248-93266bdf1d6e'::uuid,
      '77f6e4be-c1bb-4e99-9431-f8e1b237cb61'::uuid
    );
  IF v_materiais<>2 OR (SELECT COUNT(*) FROM public.materiais)<>2 THEN
    RAISE EXCEPTION 'ETAPA_546_BLOQUEADA: catalogo de materiais inesperado';
  END IF;

  SELECT COUNT(*) INTO v_empresas
  FROM public.empresas e
  WHERE e.consorcio_id='cf264e88-c591-4098-bd26-1740d19d3752'::uuid
    AND e.status='ativo'
    AND e.nome IN ('TESTE V19 - Empresa Alfa A','TESTE V19 - Empresa Alfa B');
  IF v_empresas<>2 OR
    (SELECT COUNT(*) FROM public.empresas
      WHERE consorcio_id='cf264e88-c591-4098-bd26-1740d19d3752'::uuid)<>2
  THEN
    RAISE EXCEPTION 'ETAPA_546_BLOQUEADA: empresas Alfa inesperadas';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.estoques'::regclass
      AND conname='estoques_material_id_consorcio_id_key'
  ) THEN
    RAISE EXCEPTION 'ETAPA_546_BLOQUEADA: UNIQUE anterior ja alterada';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='estoques'
      AND indexname='v19_estoques_material_empresa_uniq'
  ) THEN
    RAISE EXCEPTION 'ETAPA_546_BLOQUEADA: indice de unicidade empresarial ausente';
  END IF;
END
$v19$;

-- Revogar primeiro as RPCs antigas, que usavam estoque por consorcio.
-- Senhas e usuarios permanecem inalterados; funcoes nao sao apagadas.
REVOKE EXECUTE ON FUNCTION public.v19_salvar_material(
  uuid,uuid,text,text,numeric,numeric,numeric,numeric
) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.v19_movimentar_estoque(
  uuid,text,numeric,text
) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consumir_material_chamado(
  uuid,uuid,numeric
) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.editar_material_chamado(
  uuid,numeric
) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.remover_material_chamado(
  uuid
) FROM PUBLIC, anon, authenticated;

-- Apagar SOMENTE os dois saldos JA ZERADOS. Os backups e as
-- movimentacoes antigas NAO referenciam estes estoques por estoque_id.
DELETE FROM public.estoques
WHERE empresa_id IS NULL
  AND quantidade_contratada=0
  AND quantidade_disponivel=0
  AND id IN (
    '438c3327-1c57-49bc-becb-a7fff9d933e0'::uuid,
    '650d936f-0a65-4fd5-8f44-6a966bf9e612'::uuid
  );

-- Remover apenas a restricao antiga incompatível com estoque por empresa.
-- Indices de unicidade empresarial e suas FKs permanecem ativos.
ALTER TABLE public.estoques
  DROP CONSTRAINT estoques_material_id_consorcio_id_key;

-- Criar zero para cada combinacao de material e empresa Alfa.
-- Nao redistribui nenhum saldo ficticio.
INSERT INTO public.estoques (
  material_id,consorcio_id,empresa_id,
  quantidade_contratada,quantidade_disponivel
)
SELECT
  m.id,m.consorcio_id,e.id,0::numeric,0::numeric
FROM public.materiais m
JOIN public.empresas e ON e.consorcio_id=m.consorcio_id
WHERE m.status='ativo' AND e.status='ativo'
  AND m.consorcio_id='cf264e88-c591-4098-bd26-1740d19d3752'::uuid
  AND e.nome IN ('TESTE V19 - Empresa Alfa A','TESTE V19 - Empresa Alfa B')
  AND m.id IN (
    '00f5bf85-7997-4cf7-b248-93266bdf1d6e'::uuid,
    '77f6e4be-c1bb-4e99-9431-f8e1b237cb61'::uuid
  );

-- RLS de estoque por vinculo empresarial. Master ve todos; consorcio
-- ve empresas do seu proprio consorcio; empresa ve somente seu saldo.
ALTER POLICY v19_estoques_sel ON public.estoques
USING (
  (SELECT public.v19_perfil_atual())='master'
  OR (
    consorcio_id=(SELECT public.v19_consorcio_atual())
    AND (SELECT public.v19_perfil_atual())='consorcio'
  )
  OR (
    consorcio_id=(SELECT public.v19_consorcio_atual())
    AND empresa_id=(SELECT public.v19_empresa_atual())
    AND (SELECT public.v19_perfil_atual())='empresa'
  )
);

-- Historico de movimentacoes por empresa: movimentacoes legadas ficam
-- visiveis apenas para master/consorcio; empresa ve so movimentos novos
-- associados a seu empresa_id.
ALTER POLICY v19_movimentacoes_sel ON public.movimentacoes
USING (
  (SELECT public.v19_perfil_atual())='master'
  OR (
    consorcio_id=(SELECT public.v19_consorcio_atual())
    AND (SELECT public.v19_perfil_atual())='consorcio'
  )
  OR (
    consorcio_id=(SELECT public.v19_consorcio_atual())
    AND empresa_id=(SELECT public.v19_empresa_atual())
    AND (SELECT public.v19_perfil_atual())='empresa'
  )
);

DO $v19$
BEGIN
  IF (SELECT COUNT(*) FROM public.estoques)<>4
     OR (SELECT COUNT(*) FROM public.estoques WHERE empresa_id IS NULL)<>0
     OR (SELECT COALESCE(SUM(quantidade_contratada),0)
          FROM public.estoques)<>0
     OR (SELECT COALESCE(SUM(quantidade_disponivel),0)
          FROM public.estoques)<>0
     OR (SELECT COUNT(*) FROM public.movimentacoes)<>11
     OR (SELECT COUNT(*) FROM v19_backups.estoques_pre_zeramento_545)<>2
  THEN
    RAISE EXCEPTION 'ETAPA_546_FALHOU: pos-condicoes divergentes';
  END IF;

  INSERT INTO public.auditoria(
    consorcio_id,usuario_responsavel,acao,detalhes
  ) VALUES (
    'cf264e88-c591-4098-bd26-1740d19d3752'::uuid,
    'Migracao SQL V19 (estoque por empresa)',
    'V19_ESTOQUE_EMPRESARIAL_ESTRUTURA',
    'Criados 4 estoques zerados: 2 materiais x 2 empresas Alfa; '||
    '2 saldos legados zerados removidos; 11 movimentacoes preservadas; '||
    '5 RPCs antigas temporariamente bloqueadas.'
  );
END
$v19$;
COMMIT;

-- Verificacao somente leitura. Esperado: 4 / 0 / 4 / 0 / 0 / 11 / 2
SELECT
  (SELECT COUNT(*) FROM public.estoques) AS estoques,
  (SELECT COUNT(*) FROM public.estoques
   WHERE empresa_id IS NULL) AS sem_empresa,
  (SELECT COUNT(*) FROM public.estoques
   WHERE empresa_id IS NOT NULL) AS com_empresa,
  (SELECT COALESCE(SUM(quantidade_contratada),0)
   FROM public.estoques) AS contratado,
  (SELECT COALESCE(SUM(quantidade_disponivel),0)
   FROM public.estoques) AS disponivel,
  (SELECT COUNT(*) FROM public.movimentacoes) AS movimentos,
  (SELECT COUNT(*) FROM v19_backups.estoques_pre_zeramento_545) AS backups;
