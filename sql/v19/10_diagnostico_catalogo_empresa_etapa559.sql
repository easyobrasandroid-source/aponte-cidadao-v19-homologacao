-- APONTE CIDADAO V19 — ETAPA 559
-- DIAGNOSTICO SOMENTE LEITURA: preparar cadastro de materiais por empresa.
-- Cada empresa deve cadastrar e administrar seus proprios materiais e estoques;
-- Master e Consorcio apenas acompanham. V18 INTOCADA.
-- Executar no SQL Editor do Supabase V19 de homologacao.
-- NAO altera tabelas, politicas, quantidades, RPCs ou historico.

SELECT
  (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'coluna',c.column_name,
        'tipo',c.data_type,
        'permite_nulo',c.is_nullable,
        'valor_padrao',c.column_default
      ) ORDER BY c.ordinal_position
    ),'[]'::jsonb)
    FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name='materiais'
  ) AS colunas_materiais,
  (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'nome',con.conname,
        'definicao',pg_get_constraintdef(con.oid)
      ) ORDER BY con.conname
    ),'[]'::jsonb)
    FROM pg_constraint con
    WHERE con.conrelid='public.materiais'::regclass
  ) AS restricoes_materiais,
  (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'indice',idx.indexname,
        'definicao',idx.indexdef
      ) ORDER BY idx.indexname
    ),'[]'::jsonb)
    FROM pg_indexes idx
    WHERE idx.schemaname='public' AND idx.tablename='materiais'
  ) AS indices_materiais,
  (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'politica',pol.policyname,
        'comando',pol.cmd,
        'usando',pol.qual,
        'validacao',pol.with_check,
        'papeis',pol.roles
      ) ORDER BY pol.policyname
    ),'[]'::jsonb)
    FROM pg_policies pol
    WHERE pol.schemaname='public' AND pol.tablename='materiais'
  ) AS rls_materiais,
  (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'nome',t.tgname,
        'definicao',pg_get_triggerdef(t.oid)
      ) ORDER BY t.tgname
    ),'[]'::jsonb)
    FROM pg_trigger t
    WHERE t.tgrelid='public.materiais'::regclass AND NOT t.tgisinternal
  ) AS triggers_materiais,
  (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'material_id',m.id,
        'nome',m.nome,
        'consorcio_id',m.consorcio_id,
        'unidade',m.unidade,
        'status',m.status,
        'estoques',(
          SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
              'estoque_id',s.id,
              'empresa_id',s.empresa_id,
              'contratado',s.quantidade_contratada,
              'disponivel',s.quantidade_disponivel
            ) ORDER BY s.empresa_id
          ),'[]'::jsonb)
          FROM public.estoques s WHERE s.material_id=m.id
        ),
        'movimentos_historicos',(
          SELECT COUNT(*) FROM public.movimentacoes mov
          WHERE mov.material_id=m.id
        )
      ) ORDER BY m.nome
    ),'[]'::jsonb)
    FROM public.materiais m
  ) AS materiais_e_saldos,
  (
    SELECT jsonb_build_object(
      'total_materiais',(SELECT COUNT(*) FROM public.materiais),
      'total_estoques',(SELECT COUNT(*) FROM public.estoques),
      'estoques_sem_empresa',(SELECT COUNT(*) FROM public.estoques WHERE empresa_id IS NULL),
      'movimentos',(SELECT COUNT(*) FROM public.movimentacoes),
      'material_insert_direto_auth',has_table_privilege('authenticated','public.materiais','INSERT'),
      'material_update_direto_auth',has_table_privilege('authenticated','public.materiais','UPDATE')
    )
  ) AS verificacao_geral;
