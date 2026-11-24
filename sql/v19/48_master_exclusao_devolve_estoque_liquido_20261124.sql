-- ETAPA 807 V19: exclusao definitiva Master com estorno liquido automatico e rastreavel.
-- Nao modifica saldos nem apaga chamados ao aplicar a migracao.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
ALTER TABLE public.v19_garantia_consumos_chamados
 ADD COLUMN IF NOT EXISTS v19_devolucao_exclusao_em timestamptz;
ALTER TABLE public.v19_garantia_consumos_chamados
 ADD COLUMN IF NOT EXISTS v19_movimento_devolucao_id uuid;
ALTER TABLE public.v19_garantia_consumos_chamados
 ADD CONSTRAINT v19_garantia_consumos_devolucao_fk
 FOREIGN KEY(v19_movimento_devolucao_id) REFERENCES public.v19_garantia_movimentos(id);

CREATE OR REPLACE FUNCTION public.v19_exclusao_definitiva_master(
  p_acao text,
  p_actor_auth_id uuid,
  p_dados jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $fn$
DECLARE
 v_actor public.usuarios%ROWTYPE;
 v_call public.chamados%ROWTYPE;
 v_item jsonb;
 v_id uuid;
 v_versao timestamptz;
 v_count integer;
 v_count_deleted integer:=0;
 v_photo_count integer:=0;
 v_all uuid[]:='{}'::uuid[];
 v_result jsonb;
 v_removed integer;
 v_paths jsonb;
 v_one text;
 v_ref text;
 v_movimentos integer:=0;
 v_materiais integer:=0;
 v_garantias integer:=0;
 v_planejamentos integer:=0;
 v_estoque record;
 v_garantia record;
 v_mov_retorno uuid;
 v_saldo numeric;
 v_emp_total numeric:=0;
 v_gar_total integer:=0;
BEGIN
 IF p_actor_auth_id IS NULL THEN
   RAISE EXCEPTION 'NAO_AUTENTICADO';
 END IF;
 SELECT * INTO v_actor FROM public.usuarios
 WHERE auth_user_id=p_actor_auth_id AND perfil='master' AND status='ativo'
 ORDER BY created_at LIMIT 1;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'PERFIL_MASTER_OBRIGATORIO';
 END IF;
 IF p_acao='pendentes' THEN
   SELECT COALESCE(jsonb_agg(to_jsonb(z)),'[]'::jsonb) INTO v_paths
   FROM (SELECT id,bucket,storage_path
         FROM public.v19_fotos_pendentes_exclusao_definitiva
         WHERE excluido_em IS NULL ORDER BY criado_em LIMIT 100) z;
   RETURN jsonb_build_object('ok',true,'pendentes',v_paths);
 END IF;
 IF p_acao='confirmar_arquivos' THEN
   IF jsonb_typeof(p_dados->'ids')<>'array'
     OR jsonb_array_length(p_dados->'ids')>100 THEN
     RAISE EXCEPTION 'PARAMETROS_INVALIDOS';
   END IF;
   FOR v_item IN SELECT value FROM jsonb_array_elements(p_dados->'ids') LOOP
     v_one=trim(both '"' from v_item::text);
     IF v_one !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
       RAISE EXCEPTION 'ID_ARQUIVO_INVALIDO';
     END IF;
     UPDATE public.v19_fotos_pendentes_exclusao_definitiva
        SET excluido_em=clock_timestamp(),tentativas=tentativas+1
        WHERE id=v_one::uuid AND excluido_em IS NULL;
     GET DIAGNOSTICS v_removed=ROW_COUNT;
     v_count_deleted=v_count_deleted+v_removed;
   END LOOP;
   RETURN jsonb_build_object('ok',true,'confirmados',v_count_deleted);
 END IF;

 IF p_acao<>'excluir' OR jsonb_typeof(p_dados->'itens')<>'array'
   OR jsonb_array_length(p_dados->'itens') NOT BETWEEN 1 AND 50 THEN
   RAISE EXCEPTION 'PARAMETROS_INVALIDOS';
 END IF;
 v_count=jsonb_array_length(p_dados->'itens');

 -- A frase e uma barreira adicional contra exclusao acidental via API.
 IF p_dados->>'confirmacao' IS DISTINCT FROM ('EXCLUIR '||v_count::text) THEN
   RAISE EXCEPTION 'CONFIRMACAO_OBRIGATORIA';
 END IF;
 IF p_dados->'devolucao_confirmada' IS DISTINCT FROM 'true'::jsonb THEN
   RAISE EXCEPTION 'DEVOLUCAO_FISICA_NAO_CONFIRMADA';
 END IF;

 FOR v_item IN SELECT value FROM jsonb_array_elements(p_dados->'itens') LOOP
   IF jsonb_typeof(v_item)<>'object' OR
     coalesce(v_item->>'id','') !~*
       '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR
     coalesce(v_item->>'updated_at','') !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
     RAISE EXCEPTION 'ITENS_INVALIDOS';
   END IF;
   v_id=(v_item->>'id')::uuid;
   IF v_id=ANY(v_all) THEN RAISE EXCEPTION 'ITENS_DUPLICADOS'; END IF;
   v_all=array_append(v_all,v_id);
 END LOOP;

 -- Bloqueia todos os registros em ordem fixa para reduzir deadlocks.
 FOR v_call IN
   SELECT * FROM public.chamados
    WHERE id=ANY(v_all) ORDER BY id FOR UPDATE
 LOOP
   SELECT item.value INTO v_item
   FROM jsonb_array_elements(p_dados->'itens') item(value)
   WHERE (item.value->>'id')::uuid=v_call.id
   LIMIT 1;
   v_versao=(v_item->>'updated_at')::timestamptz;
   IF v_call.updated_at IS DISTINCT FROM v_versao THEN
     RAISE EXCEPTION 'VERSAO_DESATUALIZADA';
   END IF;
   IF v_call.arquivado_em IS NULL THEN
     RAISE EXCEPTION 'CHAMADO_NAO_ARQUIVADO';
   END IF;
   -- Contabilidade empresarial: devolver somente consumo - estorno - devolucao.
   IF EXISTS (SELECT 1 FROM public.movimentacoes m WHERE m.chamado_id=v_call.id
     AND (m.tipo NOT IN ('consumo','estorno','devolucao')
       OR m.estoque_id IS NULL OR m.empresa_id IS NULL)) THEN
     RAISE EXCEPTION 'MOVIMENTACAO_EMPRESA_SEM_ORIGEM_VALIDA';
   END IF;
   -- Item atual deve corresponder ao saldo do livro de movimentos.
   IF EXISTS (
     SELECT 1 FROM
       (SELECT estoque_id,material_id,sum(quantidade) qtd
          FROM public.chamado_materiais WHERE chamado_id=v_call.id
          GROUP BY estoque_id,material_id) it
     LEFT JOIN
       (SELECT estoque_id,material_id,
         sum(CASE tipo WHEN 'consumo' THEN quantidade
                      WHEN 'estorno' THEN -quantidade
                      WHEN 'devolucao' THEN -quantidade ELSE 0 END) qtd
          FROM public.movimentacoes WHERE chamado_id=v_call.id
          GROUP BY estoque_id,material_id) mov
     ON mov.estoque_id=it.estoque_id AND mov.material_id=it.material_id
     WHERE it.estoque_id IS NULL OR mov.qtd IS DISTINCT FROM it.qtd
   ) THEN RAISE EXCEPTION 'ITEM_MATERIAL_E_MOVIMENTACAO_DIVERGENTES'; END IF;
   FOR v_estoque IN
     SELECT estoque_id,empresa_id,material_id,consorcio_id,
       sum(CASE tipo WHEN 'consumo' THEN quantidade
                    WHEN 'estorno' THEN -quantidade
                    WHEN 'devolucao' THEN -quantidade ELSE 0 END) saldo_liquido
     FROM public.movimentacoes WHERE chamado_id=v_call.id
     GROUP BY estoque_id,empresa_id,material_id,consorcio_id
     ORDER BY estoque_id,material_id
   LOOP
     IF v_estoque.consorcio_id IS DISTINCT FROM v_call.consorcio_id
        OR v_estoque.saldo_liquido<0 THEN
       RAISE EXCEPTION 'MOVIMENTACAO_EMPRESA_INCONSISTENTE';
     END IF;
     IF v_estoque.saldo_liquido>0 THEN
       UPDATE public.estoques SET
         quantidade_disponivel=quantidade_disponivel+v_estoque.saldo_liquido,
         updated_at=clock_timestamp()
       WHERE id=v_estoque.estoque_id AND empresa_id=v_estoque.empresa_id
         AND consorcio_id=v_call.consorcio_id AND material_id=v_estoque.material_id
         AND quantidade_disponivel+v_estoque.saldo_liquido<=quantidade_contratada
       RETURNING quantidade_disponivel INTO v_saldo;
       IF NOT FOUND THEN RAISE EXCEPTION 'DEVOLUCAO_EXCEDE_ESTOQUE_CONTRATADO'; END IF;
       INSERT INTO public.movimentacoes
         (consorcio_id,empresa_id,estoque_id,material_id,chamado_id,tipo,
          quantidade,usuario_id,usuario_nome,origem,observacao,v19_protocolo_excluido)
       VALUES
         (v_call.consorcio_id,v_estoque.empresa_id,v_estoque.estoque_id,
          v_estoque.material_id,NULL,'estorno',v_estoque.saldo_liquido,
          v_actor.id,v_actor.nome,'estorno_exclusao_definitiva_master',
          'Devolucao por exclusao definitiva Master: '||v_call.protocolo,
          v_call.protocolo);
       v_emp_total:=v_emp_total+v_estoque.saldo_liquido;
       INSERT INTO public.auditoria(consorcio_id,usuario_responsavel,acao,detalhes)
       VALUES(v_call.consorcio_id,v_actor.nome,'V19_MASTER_ESTORNO_POR_EXCLUSAO',
         'protocolo '||v_call.protocolo||' | estoque '||v_estoque.estoque_id||
         ' | material '||v_estoque.material_id||' | qtd '||v_estoque.saldo_liquido||
         ' | saldo final '||v_saldo);
     END IF;
   END LOOP;

   -- Estoque de garantia: a previsao nao altera saldo.
   -- Baixas reais sao devolvidas na propria equipe (local_id).
   IF EXISTS (SELECT 1 FROM public.v19_garantia_consumos_chamados
              WHERE chamado_id=v_call.id) THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('v19-garantia-'||v_call.consorcio_id::text,0));
   END IF;
   FOR v_garantia IN
     SELECT id,consorcio_id,material_id,local_id,quantidade,
            v19_devolucao_exclusao_em
     FROM public.v19_garantia_consumos_chamados WHERE chamado_id=v_call.id
     ORDER BY id FOR UPDATE
   LOOP
     IF v_garantia.v19_devolucao_exclusao_em IS NOT NULL THEN
       RAISE EXCEPTION 'GARANTIA_JA_DEVOLVIDA';
     END IF;
     IF v_garantia.consorcio_id IS DISTINCT FROM v_call.consorcio_id THEN
       RAISE EXCEPTION 'GARANTIA_CONSORCIO_DIVERGENTE';
     END IF;
     INSERT INTO public.v19_garantia_saldos
       (consorcio_id,material_id,local_id,quantidade)
     VALUES
       (v_call.consorcio_id,v_garantia.material_id,
        v_garantia.local_id,v_garantia.quantidade)
     ON CONFLICT (consorcio_id,material_id,local_id) DO UPDATE
       SET quantidade=public.v19_garantia_saldos.quantidade+EXCLUDED.quantidade,
           updated_at=clock_timestamp()
       WHERE public.v19_garantia_saldos.quantidade<=2147483647-EXCLUDED.quantidade
     RETURNING quantidade INTO v_saldo;
     IF NOT FOUND THEN RAISE EXCEPTION 'SALDO_GARANTIA_FORA_LIMITE'; END IF;
     INSERT INTO public.v19_garantia_movimentos
       (consorcio_id,material_id,tipo,origem_id,destino_id,
        quantidade,usuario_id,usuario_nome,observacao)
     VALUES
       (v_call.consorcio_id,v_garantia.material_id,'entrada',NULL,
        v_garantia.local_id,v_garantia.quantidade,
        v_actor.id,v_actor.nome,
        'ESTORNO POR EXCLUSAO DEFINITIVA MASTER: '||v_call.protocolo)
     RETURNING id INTO v_mov_retorno;
     UPDATE public.v19_garantia_consumos_chamados
        SET v19_devolucao_exclusao_em=clock_timestamp(),
            v19_movimento_devolucao_id=v_mov_retorno
      WHERE id=v_garantia.id;
     v_gar_total:=v_gar_total+v_garantia.quantidade;
     INSERT INTO public.auditoria(consorcio_id,usuario_responsavel,acao,detalhes)
     VALUES(v_call.consorcio_id,v_actor.nome,'V19_MASTER_ESTORNO_GARANTIA_EXCLUSAO',
       'protocolo '||v_call.protocolo||' | material '||v_garantia.material_id||
       ' | equipe '||v_garantia.local_id||' | qtd '||v_garantia.quantidade||
       ' | movimento '||v_mov_retorno);
   END LOOP;

   -- O Master pode excluir mesmo apos consumo/estorno de material.
   -- O saldo remanescente foi devolvido e auditado. Movimentos historicos persistem.
   -- Todas as linhas sao bloqueadas/transacionadas com a exclusao do chamado.
   UPDATE public.movimentacoes
      SET chamado_id=NULL, v19_protocolo_excluido=v_call.protocolo
    WHERE chamado_id=v_call.id;
   GET DIAGNOSTICS v_movimentos=ROW_COUNT;
   UPDATE public.chamado_materiais
      SET chamado_id=NULL, v19_protocolo_excluido=v_call.protocolo
    WHERE chamado_id=v_call.id;
   GET DIAGNOSTICS v_materiais=ROW_COUNT;
   UPDATE public.v19_garantia_consumos_chamados
      SET chamado_id=NULL, v19_protocolo_excluido=v_call.protocolo
    WHERE chamado_id=v_call.id;
   GET DIAGNOSTICS v_garantias=ROW_COUNT;
   UPDATE public.v19_garantia_planejamentos
      SET chamado_id=NULL, v19_protocolo_excluido=v_call.protocolo
    WHERE chamado_id=v_call.id;
   GET DIAGNOSTICS v_planejamentos=ROW_COUNT;
   -- Proibir apagamento involuntario das tabelas de movimento.
   -- As operacoes acima nao mexem em estoques, saldos ou historico financeiro.

   -- Registra arquivos para exclusao fisica posterior por Storage API.
   INSERT INTO public.v19_fotos_pendentes_exclusao_definitiva(bucket,storage_path)
   SELECT 'chamado-fotos', f.storage_path
   FROM public.chamado_fotos f
   WHERE f.chamado_id=v_call.id AND length(trim(f.storage_path))>0
     AND NOT EXISTS(
       SELECT 1 FROM public.chamado_fotos outro
       WHERE outro.storage_path=f.storage_path
         AND outro.chamado_id <> ALL(v_all)
     )
   ON CONFLICT(bucket,storage_path) DO UPDATE
      SET excluido_em=NULL;
   GET DIAGNOSTICS v_removed=ROW_COUNT;
   v_photo_count=v_photo_count+v_removed;

   -- Auditoria minimalista permanece, sem nome/telefone/endereco/fotos.
   INSERT INTO public.auditoria
    (consorcio_id,usuario_responsavel,acao,detalhes)
   VALUES (v_call.consorcio_id,v_actor.nome,'V19_CHAMADO_EXCLUIDO_DEFINITIVAMENTE',
    'ID '||v_call.id::text||' | protocolo '||v_call.protocolo||
    ' | master_uid '||v_actor.id::text||
    ' | mov='||v_movimentos||' | itens='||v_materiais||
    ' | garantia='||v_garantias||' | planejamento='||v_planejamentos||
    ' | retorno_empresa='||v_emp_total||' | retorno_garantia='||v_gar_total);

   -- Child tables CASCADE removem fotos (somente metadados), historico
   -- e idempotencia; objetos Storage sao removidos exclusivamente via API.
   DELETE FROM public.chamados WHERE id=v_call.id;
   v_count_deleted=v_count_deleted+1;
 END LOOP;
 IF v_count_deleted<>v_count THEN
   RAISE EXCEPTION 'CHAMADO_INEXISTENTE_OU_ALTERADO';
 END IF;
 RETURN jsonb_build_object('ok',true,'excluidos',v_count_deleted,
    'devolvido_empresa',v_emp_total,'devolvido_garantia',v_gar_total,
    'fotos_enfileiradas',v_photo_count);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.v19_garantia_relatorio_consumos(p_consorcio_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_perfil text;v_cons uuid;v_qtd int;
BEGIN
 IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
   RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
 END IF;
 SELECT count(*),max(perfil),max(consorcio_id::text)::uuid
  INTO v_qtd,v_perfil,v_cons FROM public.usuarios
 WHERE auth_user_id=auth.uid() AND status='ativo';
 IF v_qtd<>1 OR v_perfil NOT IN ('master','consorcio','garantia') THEN
   RAISE EXCEPTION 'PERFIL_SEM_ACESSO_RELATORIO_GARANTIA' USING ERRCODE='42501';
 END IF;
 IF p_consorcio_id IS NULL OR (v_perfil<>'master' AND
   (v_cons IS NULL OR v_cons IS DISTINCT FROM p_consorcio_id)) THEN
   RAISE EXCEPTION 'CONSORCIO_NAO_AUTORIZADO' USING ERRCODE='42501';
 END IF;
 RETURN pg_catalog.jsonb_build_object('ok',true,'consorcio_id',p_consorcio_id,
  'consumos',coalesce((
   SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',x.id,'chamado_id',x.chamado_id,'protocolo',x.protocolo,
    'municipio',x.cidade,'endereco',x.endereco,'bairro',x.bairro,
    'garantia_tipo',x.garantia_tipo,'garantia_obs',x.garantia_obs,
    'status_chamado',x.status,
    'material',x.material,'equipe',x.equipe,'quantidade',x.quantidade,
    'devolvido_por_exclusao',x.devolvido_por_exclusao,
    'responsavel',x.usuario_nome,'data_baixa',x.created_at,
    'data_conclusao',x.completed_at
   ) ORDER BY x.created_at DESC)
   FROM (
    SELECT g.id,g.chamado_id,coalesce(c.protocolo,g.v19_protocolo_excluido) AS protocolo,
      c.cidade,c.endereco,c.bairro,
      c.garantia_tipo,c.garantia_obs,
      CASE WHEN c.id IS NULL AND g.v19_devolucao_exclusao_em IS NOT NULL
      THEN 'Excluído definitivamente - material devolvido'
      WHEN c.id IS NULL THEN 'Excluído definitivamente' ELSE c.status END AS status,c.completed_at,
      m.nome AS material,l.nome AS equipe,g.quantidade,g.usuario_nome,g.created_at,
      (g.v19_devolucao_exclusao_em IS NOT NULL) AS devolvido_por_exclusao
    FROM public.v19_garantia_consumos_chamados g
    LEFT JOIN public.chamados c ON c.id=g.chamado_id AND c.consorcio_id=g.consorcio_id
    JOIN public.v19_garantia_materiais m ON m.id=g.material_id AND m.consorcio_id=g.consorcio_id
    JOIN public.v19_garantia_locais l ON l.id=g.local_id AND l.consorcio_id=g.consorcio_id
    WHERE g.consorcio_id=p_consorcio_id
    ORDER BY g.created_at DESC,g.id DESC LIMIT 2000
   ) x
  ),'[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.v19_exclusao_definitiva_master(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v19_exclusao_definitiva_master(text,uuid,jsonb) TO service_role;
COMMIT;
