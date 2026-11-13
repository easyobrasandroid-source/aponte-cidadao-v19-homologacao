-- Aponte Cidadao V19 - ETAPA 545
-- AUTORIZADO: zerar os 2 estoques ficticios de homologacao (35 contratadas,
-- 19 disponiveis). Preservar 11 movimentos historicos, 2 materiais e auditoria.
-- SOMENTE Supabase V19: projeto xurrhczvyqpwyjemight. NUNCA rodar na V18.
--
-- Nao cria um terceiro estoque; nao redistribui saldos entre empresas.
-- Esta etapa zera os saldos antigos e faz copia segura. Fase posterior:
-- substituir RPCs de escrita, restringir RLS, criar saldos por empresa
-- e retirar saldos antigos da operacao. Ate la, NAO operar estoque real.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Backup privado de valores anteriores. Nao fica exposto pelo schema public.
CREATE SCHEMA IF NOT EXISTS v19_backups;
REVOKE ALL ON SCHEMA v19_backups FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS v19_backups.estoques_pre_zeramento_545 (
  estoque_id uuid PRIMARY KEY,
  material_id uuid NOT NULL,
  consorcio_id uuid NOT NULL,
  empresa_id uuid,
  quantidade_contratada numeric NOT NULL,
  quantidade_disponivel numeric NOT NULL,
  updated_at timestamptz NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  motivo text NOT NULL
);
REVOKE ALL ON TABLE v19_backups.estoques_pre_zeramento_545
  FROM PUBLIC, anon, authenticated;

-- Impede corrida com entradas, saidas ou consumo durante a conferencia.
LOCK TABLE public.estoques IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.chamado_materiais IN SHARE MODE;
LOCK TABLE public.movimentacoes IN SHARE MODE;

DO $v19$
DECLARE
  v_exatos integer;
  v_alterados integer;
  v_registros integer;
BEGIN
  -- Reexecutar o arquivo nao gera auditoria duplicada nem mexe nos saldos.
  IF
    (SELECT COUNT(*) FROM public.estoques WHERE empresa_id IS NOT NULL)=0
    AND (SELECT COUNT(*)
         FROM public.estoques
         WHERE id IN (
           '438c3327-1c57-49bc-becb-a7fff9d933e0'::uuid,
           '650d936f-0a65-4fd5-8f44-6a966bf9e612'::uuid
         ) AND empresa_id IS NULL
         AND quantidade_contratada=0 AND quantidade_disponivel=0)=2
    AND (SELECT COUNT(*) FROM v19_backups.estoques_pre_zeramento_545
         WHERE estoque_id IN (
           '438c3327-1c57-49bc-becb-a7fff9d933e0'::uuid,
           '650d936f-0a65-4fd5-8f44-6a966bf9e612'::uuid
         ))=2
  THEN
    RAISE NOTICE 'Etapa 545 ja executada; nenhuma quantidade alterada.';
    RETURN;
  END IF;

  -- Escopo exato conhecido: 2 estoques de teste, sem empresas atribuidas.
  SELECT COUNT(*) INTO v_registros FROM public.estoques;
  IF v_registros<>2 OR EXISTS (
    SELECT 1 FROM public.estoques WHERE empresa_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'PRECONDICAO_545_DIVERGENTE: estoques inesperados';
  END IF;

  SELECT COUNT(*) INTO v_exatos
  FROM public.estoques e
  WHERE
    (e.id='438c3327-1c57-49bc-becb-a7fff9d933e0'::uuid
      AND e.material_id='00f5bf85-7997-4cf7-b248-93266bdf1d6e'::uuid
      AND e.consorcio_id='cf264e88-c591-4098-bd26-1740d19d3752'::uuid
      AND e.empresa_id IS NULL
      AND e.quantidade_contratada=25 AND e.quantidade_disponivel=13)
    OR
    (e.id='650d936f-0a65-4fd5-8f44-6a966bf9e612'::uuid
      AND e.material_id='77f6e4be-c1bb-4e99-9431-f8e1b237cb61'::uuid
      AND e.consorcio_id='cf264e88-c591-4098-bd26-1740d19d3752'::uuid
      AND e.empresa_id IS NULL
      AND e.quantidade_contratada=10 AND e.quantidade_disponivel=6);
  IF v_exatos<>2 THEN
    RAISE EXCEPTION 'PRECONDICAO_545_DIVERGENTE: ids, materiais ou valores mudaram';
  END IF;

  -- Exigir zero consumos ativos; historico permanece intocado.
  IF EXISTS (
    SELECT 1 FROM public.chamado_materiais
    WHERE material_id IN (
      '00f5bf85-7997-4cf7-b248-93266bdf1d6e'::uuid,
      '77f6e4be-c1bb-4e99-9431-f8e1b237cb61'::uuid
    )
  ) THEN
    RAISE EXCEPTION 'PRECONDICAO_545_DIVERGENTE: ha consumos em chamados';
  END IF;

  IF (SELECT COUNT(*) FROM public.movimentacoes
      WHERE consorcio_id='cf264e88-c591-4098-bd26-1740d19d3752'::uuid
        AND material_id IN (
          '00f5bf85-7997-4cf7-b248-93266bdf1d6e'::uuid,
          '77f6e4be-c1bb-4e99-9431-f8e1b237cb61'::uuid
        ))<>11
  THEN
    RAISE EXCEPTION 'PRECONDICAO_545_DIVERGENTE: 11 movimentos alterados';
  END IF;

  -- Backup antes de qualquer UPDATE, mantendo empresa_id NULL por ser teste.
  INSERT INTO v19_backups.estoques_pre_zeramento_545 (
    estoque_id, material_id, consorcio_id, empresa_id,
    quantidade_contratada, quantidade_disponivel, updated_at, motivo
  )
  SELECT
    id, material_id, consorcio_id, empresa_id,
    quantidade_contratada, quantidade_disponivel, updated_at,
    'Etapa 545: ficticio, zeramento autorizado para estoque por empresa'
  FROM public.estoques
  WHERE id IN (
    '438c3327-1c57-49bc-becb-a7fff9d933e0'::uuid,
    '650d936f-0a65-4fd5-8f44-6a966bf9e612'::uuid
  );

  UPDATE public.estoques
  SET quantidade_contratada=0,
      quantidade_disponivel=0,
      updated_at=clock_timestamp()
  WHERE id IN (
    '438c3327-1c57-49bc-becb-a7fff9d933e0'::uuid,
    '650d936f-0a65-4fd5-8f44-6a966bf9e612'::uuid
  ) AND empresa_id IS NULL;
  GET DIAGNOSTICS v_alterados=ROW_COUNT;
  IF v_alterados<>2 THEN
    RAISE EXCEPTION 'ZERAMENTO_NAO_CONFIRMADO: esperado 2; realizado %',v_alterados;
  END IF;

  -- Auditoria por saldo antigo; nao alterar as 11 movimentacoes.
  INSERT INTO public.auditoria (
    consorcio_id, usuario_responsavel, acao, detalhes
  )
  SELECT
    b.consorcio_id,
    'Migracao SQL V19 (zeramento autorizado)',
    'V19_ESTOQUE_FICTICIO_ZERADO',
    'estoque_id='||b.estoque_id||
    '; material_id='||b.material_id||
    '; contratado='||b.quantidade_contratada||'->0'||
    '; disponivel='||b.quantidade_disponivel||'->0'||
    '; backup=v19_backups.estoques_pre_zeramento_545'
  FROM v19_backups.estoques_pre_zeramento_545 b
  WHERE b.estoque_id IN (
    '438c3327-1c57-49bc-becb-a7fff9d933e0'::uuid,
    '650d936f-0a65-4fd5-8f44-6a966bf9e612'::uuid
  );
END
$v19$;
COMMIT;

-- Uma linha para conferir toda a etapa (nao altera banco).
SELECT
  (SELECT COUNT(*) FROM public.estoques) AS registros_estoque,
  (SELECT COALESCE(SUM(quantidade_contratada),0)
     FROM public.estoques) AS contratado_atual,
  (SELECT COALESCE(SUM(quantidade_disponivel),0)
     FROM public.estoques) AS disponivel_atual,
  (SELECT COUNT(*) FROM public.estoques
     WHERE empresa_id IS NOT NULL) AS estoques_empresariais,
  (SELECT COUNT(*) FROM public.movimentacoes) AS movimentacoes_preservadas,
  (SELECT COUNT(*) FROM v19_backups.estoques_pre_zeramento_545
     WHERE estoque_id IN (
       '438c3327-1c57-49bc-becb-a7fff9d933e0'::uuid,
       '650d936f-0a65-4fd5-8f44-6a966bf9e612'::uuid
     )) AS registros_backup;
