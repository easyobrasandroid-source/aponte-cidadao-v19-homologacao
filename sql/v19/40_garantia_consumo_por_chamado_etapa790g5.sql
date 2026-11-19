-- APONTE CIDADAO V19 / ETAPA 790-G.5
-- Consumo EXCLUSIVO da garantia, vinculado ao chamado e a equipe.
-- Somente Supabase de HOMOLOGACAO V19; V18 INTOCADA.
-- Consumo fisico ocorre APENAS em conclusao atomica da OS de garantia.
-- Nao modifica tabelas de estoque das empresas, nem chamadas empresariais.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

CREATE TABLE IF NOT EXISTS public.v19_garantia_planejamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES public.consorcios(id),
  chamado_id uuid NOT NULL REFERENCES public.chamados(id),
  material_id uuid NOT NULL,
  local_id uuid NOT NULL,
  quantidade integer NOT NULL CHECK (quantidade BETWEEN 1 AND 10000000),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (consorcio_id,material_id)
    REFERENCES public.v19_garantia_materiais(consorcio_id,id),
  FOREIGN KEY (consorcio_id,local_id)
    REFERENCES public.v19_garantia_locais(consorcio_id,id),
  UNIQUE (consorcio_id,chamado_id,material_id,local_id)
);
CREATE INDEX IF NOT EXISTS v19_garantia_plan_chamado_idx
 ON public.v19_garantia_planejamentos(consorcio_id,chamado_id);

CREATE TABLE IF NOT EXISTS public.v19_garantia_consumos_chamados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consorcio_id uuid NOT NULL REFERENCES public.consorcios(id),
  chamado_id uuid NOT NULL REFERENCES public.chamados(id),
  material_id uuid NOT NULL,
  local_id uuid NOT NULL,
  movimento_id uuid NOT NULL UNIQUE REFERENCES public.v19_garantia_movimentos(id),
  quantidade integer NOT NULL CHECK (quantidade BETWEEN 1 AND 10000000),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id),
  usuario_nome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (consorcio_id,material_id)
    REFERENCES public.v19_garantia_materiais(consorcio_id,id),
  FOREIGN KEY (consorcio_id,local_id)
    REFERENCES public.v19_garantia_locais(consorcio_id,id),
  UNIQUE (consorcio_id,chamado_id,material_id,local_id)
);
CREATE INDEX IF NOT EXISTS v19_garantia_consumos_cons_data
 ON public.v19_garantia_consumos_chamados(consorcio_id,created_at DESC);
CREATE INDEX IF NOT EXISTS v19_garantia_consumos_chamado
 ON public.v19_garantia_consumos_chamados(chamado_id);

ALTER TABLE public.v19_garantia_planejamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v19_garantia_consumos_chamados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.v19_garantia_planejamentos,
 public.v19_garantia_consumos_chamados FROM PUBLIC,anon,authenticated;

-- A verificacao e feita novamente pela RPC de conclusao.
-- Apenas locais do tipo equipe sao fonte de material consumido em campo.
CREATE OR REPLACE FUNCTION public.v19_garantia_validar_itens(
 p_consorcio_id uuid,p_itens jsonb
) RETURNS void LANGUAGE plpgsql SET search_path TO ''
AS $fn$
DECLARE
  v_item jsonb; v_material uuid; v_local uuid;
  v_q numeric; v_key text; v_keys text[]:=ARRAY[]::text[];
BEGIN
 IF p_itens IS NULL OR pg_catalog.jsonb_typeof(p_itens)<>'array'
    OR pg_catalog.jsonb_array_length(p_itens)>30 THEN
   RAISE EXCEPTION 'LISTA_MATERIAIS_INVALIDA' USING ERRCODE='22023';
 END IF;
 FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_itens) t(value) LOOP
   IF pg_catalog.jsonb_typeof(v_item)<>'object'
      OR (v_item->>'material_id') IS NULL
      OR (v_item->>'local_id') IS NULL
      OR pg_catalog.jsonb_typeof(v_item->'quantidade')<>'number' THEN
     RAISE EXCEPTION 'ITEM_GARANTIA_INVALIDO' USING ERRCODE='22023';
   END IF;
   BEGIN
     v_material:=(v_item->>'material_id')::uuid;
     v_local:=(v_item->>'local_id')::uuid;
     v_q:=(v_item->>'quantidade')::numeric;
   EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
     RAISE EXCEPTION 'IDENTIFICACAO_OU_QUANTIDADE_INVALIDA' USING ERRCODE='22023';
   END;
   IF v_q IS NULL OR v_q<1 OR v_q>10000000 OR v_q<>trunc(v_q) THEN
      RAISE EXCEPTION 'QUANTIDADE_INTEIRA_POSITIVA_OBRIGATORIA' USING ERRCODE='22023';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.v19_garantia_materiais m
        WHERE m.id=v_material AND m.consorcio_id=p_consorcio_id AND m.ativo) THEN
      RAISE EXCEPTION 'MATERIAL_GARANTIA_INATIVO_OU_OUTRO_CONSORCIO' USING ERRCODE='42501';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.v19_garantia_locais l
        WHERE l.id=v_local AND l.consorcio_id=p_consorcio_id
          AND l.ativo AND l.tipo='equipe') THEN
      RAISE EXCEPTION 'EQUIPE_GARANTIA_INVALIDA_OU_OUTRO_CONSORCIO' USING ERRCODE='42501';
   END IF;
   v_key:=v_material::text||'|'||v_local::text;
   IF v_key=ANY(v_keys) THEN
     RAISE EXCEPTION 'MATERIAL_E_EQUIPE_DUPLICADOS' USING ERRCODE='22023';
   END IF;
   v_keys:=pg_catalog.array_append(v_keys,v_key);
 END LOOP;
END;
$fn$;
REVOKE ALL ON FUNCTION public.v19_garantia_validar_itens(uuid,jsonb)
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.v19_garantia_planejar(
 p_chamado_id uuid,p_atualizado_em timestamptz,p_itens jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
 v_uid uuid;v_nome text;v_perfil text;v_cons uuid;
 v_qtd integer;v_c public.chamados%ROWTYPE;v_item jsonb;
BEGIN
 IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
   RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
 END IF;
 SELECT count(*) INTO v_qtd FROM public.usuarios
 WHERE auth_user_id=auth.uid() AND status='ativo';
 IF v_qtd<>1 THEN
  RAISE EXCEPTION 'PERFIL_ATIVO_UNICO_NAO_ENCONTRADO' USING ERRCODE='42501';
 END IF;
 SELECT id,nome,perfil,consorcio_id INTO v_uid,v_nome,v_perfil,v_cons
 FROM public.usuarios WHERE auth_user_id=auth.uid() AND status='ativo';
 IF v_perfil NOT IN ('master','consorcio','garantia') THEN
   RAISE EXCEPTION 'PERFIL_SEM_ACESSO_A_MATERIAIS_DA_GARANTIA' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_c FROM public.chamados WHERE id=p_chamado_id FOR UPDATE;
 IF NOT FOUND OR (v_perfil<>'master' AND
   (v_cons IS NULL OR v_cons IS DISTINCT FROM v_c.consorcio_id)) THEN
   RAISE EXCEPTION 'CHAMADO_NAO_AUTORIZADO' USING ERRCODE='42501';
 END IF;
 IF p_atualizado_em IS NULL OR v_c.updated_at IS DISTINCT FROM p_atualizado_em THEN
   RAISE EXCEPTION 'VERSAO_DESATUALIZADA_RECARREGUE' USING ERRCODE='40001';
 END IF;
 IF v_c.status<>'Aguardando Garantia LED'
    OR upper(btrim(coalesce(v_c.garantia_tipo,'')))<>'LED'
    OR v_c.completed_at IS NOT NULL THEN
   RAISE EXCEPTION 'CHAMADO_NAO_ESTA_EM_GARANTIA' USING ERRCODE='22023';
 END IF;
 PERFORM public.v19_garantia_validar_itens(v_c.consorcio_id,p_itens);
 DELETE FROM public.v19_garantia_planejamentos
  WHERE consorcio_id=v_c.consorcio_id AND chamado_id=p_chamado_id;
 FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_itens) t(value) LOOP
   INSERT INTO public.v19_garantia_planejamentos
     (consorcio_id,chamado_id,material_id,local_id,quantidade,usuario_id)
   VALUES (v_c.consorcio_id,p_chamado_id,
      (v_item->>'material_id')::uuid,(v_item->>'local_id')::uuid,
      (v_item->>'quantidade')::integer,v_uid);
 END LOOP;
 RETURN pg_catalog.jsonb_build_object('ok',true,'chamado_id',p_chamado_id,
  'itens',pg_catalog.jsonb_array_length(p_itens));
END;
$fn$;

-- Encaminhar e planejar no MESMO COMMIT. Empresas continuam usando o fluxo
-- legado de encaminhamento SEM qualquer acesso ao estoque de garantia.
CREATE OR REPLACE FUNCTION public.v19_encaminhar_garantia_planejada(
 p_chamado_id uuid,p_tipo_defeito text,p_observacao text,
 p_identificado_em timestamptz,p_status_esperado text,
 p_atualizado_em timestamptz,p_itens jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
 v_perfil text;v_cons uuid;v_qtd int;v_resp jsonb;v_planejamento jsonb;
BEGIN
 IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
   RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
 END IF;
 SELECT count(*),max(perfil),max(consorcio_id::text)::uuid
  INTO v_qtd,v_perfil,v_cons FROM public.usuarios
 WHERE auth_user_id=auth.uid() AND status='ativo';
 IF v_qtd<>1 OR v_perfil NOT IN ('master','consorcio') THEN
   RAISE EXCEPTION 'PERFIL_SEM_ACESSO_A_MATERIAIS_DA_GARANTIA' USING ERRCODE='42501';
 END IF;
 -- RPC existente continua responsavel por elegibilidade, SLA e historico.
 v_resp:=public.v19_encaminhar_garantia_led(
  p_chamado_id,p_tipo_defeito,p_observacao,
  p_identificado_em,p_status_esperado,p_atualizado_em
 );
 IF v_resp->>'ok' IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'ENCAMINHAMENTO_NAO_CONFIRMADO';
 END IF;
 v_planejamento:=public.v19_garantia_planejar(
  p_chamado_id,(v_resp->>'updated_at')::timestamptz,p_itens);
 RETURN v_resp||pg_catalog.jsonb_build_object('itens_planejados',
   (v_planejamento->>'itens')::integer);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.v19_garantia_consultar_planejamento(
 p_chamado_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_perfil text;v_cons uuid;v_qtd int;v_ch_cons uuid;
BEGIN
 IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
   RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
 END IF;
 SELECT count(*),max(perfil),max(consorcio_id::text)::uuid
 INTO v_qtd,v_perfil,v_cons FROM public.usuarios
 WHERE auth_user_id=auth.uid() AND status='ativo';
 IF v_qtd<>1 OR v_perfil NOT IN ('master','consorcio','garantia') THEN
   RAISE EXCEPTION 'PERFIL_SEM_ACESSO_A_MATERIAIS_DA_GARANTIA' USING ERRCODE='42501';
 END IF;
 SELECT consorcio_id INTO v_ch_cons FROM public.chamados WHERE id=p_chamado_id;
 IF NOT FOUND OR (v_perfil<>'master' AND
   (v_cons IS NULL OR v_cons IS DISTINCT FROM v_ch_cons)) THEN
   RAISE EXCEPTION 'CHAMADO_NAO_AUTORIZADO' USING ERRCODE='42501';
 END IF;
 RETURN pg_catalog.jsonb_build_object('ok',true,'chamado_id',p_chamado_id,
  'itens',coalesce((SELECT pg_catalog.jsonb_agg(
   pg_catalog.jsonb_build_object('material_id',material_id,
    'local_id',local_id,'quantidade',quantidade) ORDER BY created_at,id)
   FROM public.v19_garantia_planejamentos
   WHERE chamado_id=p_chamado_id AND consorcio_id=v_ch_cons),'[]'::jsonb));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.v19_concluir_garantia_com_consumo(
 p_chamado_id uuid,p_atualizado_em timestamptz,p_itens jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
 v_perfil text;v_cons uuid;v_uid uuid;v_nome text;v_qtd int;
 v_c public.chamados%ROWTYPE;v_item jsonb;v_material uuid;v_local uuid;
 v_quant integer;v_saldo integer;v_mov uuid;v_realizados int:=0;
 v_agora timestamptz;v_nome_material text;v_nome_equipe text;
BEGIN
 IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
   RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
 END IF;
 SELECT count(*) INTO v_qtd FROM public.usuarios
  WHERE auth_user_id=auth.uid() AND status='ativo';
 IF v_qtd<>1 THEN
  RAISE EXCEPTION 'PERFIL_ATIVO_UNICO_NAO_ENCONTRADO' USING ERRCODE='42501';
 END IF;
 SELECT id,nome,perfil,consorcio_id
 INTO v_uid,v_nome,v_perfil,v_cons FROM public.usuarios
 WHERE auth_user_id=auth.uid() AND status='ativo';
 IF v_perfil NOT IN ('master','consorcio','garantia') THEN
   RAISE EXCEPTION 'PERFIL_SEM_ACESSO_A_MATERIAIS_DA_GARANTIA' USING ERRCODE='42501';
 END IF;
 IF p_chamado_id IS NULL OR p_atualizado_em IS NULL THEN
   RAISE EXCEPTION 'CHAMADO_E_VERSAO_OBRIGATORIOS' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_c FROM public.chamados WHERE id=p_chamado_id FOR UPDATE;
 IF NOT FOUND OR (v_perfil<>'master' AND
   (v_cons IS NULL OR v_cons IS DISTINCT FROM v_c.consorcio_id)) THEN
   RAISE EXCEPTION 'CHAMADO_NAO_AUTORIZADO' USING ERRCODE='42501';
 END IF;
 IF v_c.updated_at IS DISTINCT FROM p_atualizado_em THEN
   RAISE EXCEPTION 'VERSAO_DESATUALIZADA_RECARREGUE' USING ERRCODE='40001';
 END IF;
 IF v_c.status<>'Aguardando Garantia LED'
    OR upper(btrim(coalesce(v_c.garantia_tipo,'')))<>'LED'
    OR v_c.completed_at IS NOT NULL OR v_c.sla_pausado IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'CHAMADO_NAO_ESTA_AGUARDANDO_GARANTIA_LED' USING ERRCODE='22023';
 END IF;
 PERFORM public.v19_garantia_validar_itens(v_c.consorcio_id,p_itens);
 -- Mesma trava por consorcio usada na funcao de movimentacao de garantia.
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('v19-garantia-'||v_c.consorcio_id::text,0));
 FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_itens) t(value) LOOP
   v_material:=(v_item->>'material_id')::uuid;
   v_local:=(v_item->>'local_id')::uuid;
   v_quant:=(v_item->>'quantidade')::integer;
   -- Atualizacao atomica, sem saldo negativo. Se QUALQUER item falhar,
   -- a transacao inteira e revertida, inclusive a conclusao do chamado.
   UPDATE public.v19_garantia_saldos s SET
     quantidade=s.quantidade-v_quant,updated_at=clock_timestamp()
    WHERE s.consorcio_id=v_c.consorcio_id
      AND s.material_id=v_material AND s.local_id=v_local
      AND s.quantidade>=v_quant
    RETURNING quantidade INTO v_saldo;
   IF NOT FOUND THEN
     RAISE EXCEPTION 'SALDO_INSUFICIENTE_NA_EQUIPE_DA_GARANTIA'
      USING ERRCODE='22023';
   END IF;
   SELECT nome INTO v_nome_material FROM public.v19_garantia_materiais
      WHERE id=v_material AND consorcio_id=v_c.consorcio_id;
   SELECT nome INTO v_nome_equipe FROM public.v19_garantia_locais
      WHERE id=v_local AND consorcio_id=v_c.consorcio_id;
   INSERT INTO public.v19_garantia_movimentos(
     consorcio_id,material_id,tipo,origem_id,destino_id,quantidade,
     usuario_id,usuario_nome,observacao
   ) VALUES (
     v_c.consorcio_id,v_material,'saida',v_local,NULL,v_quant,
     v_uid,coalesce(nullif(btrim(v_nome),''),'Usuario autenticado'),
     'Consumo GARANTIA no chamado '||v_c.protocolo
   ) RETURNING id INTO v_mov;
   INSERT INTO public.v19_garantia_consumos_chamados(
     consorcio_id,chamado_id,material_id,local_id,movimento_id,
     quantidade,usuario_id,usuario_nome
   ) VALUES (
     v_c.consorcio_id,v_c.id,v_material,v_local,v_mov,v_quant,v_uid,
     coalesce(nullif(btrim(v_nome),''),'Usuario autenticado')
   );
   INSERT INTO public.chamado_historico(
     chamado_id,status,mensagem,observacao,usuario_nome
   ) VALUES (
     v_c.id,'Aguardando Garantia LED',
     'Consumo de material da garantia',
     v_quant::text||'x '||v_nome_material||
     ' | Equipe: '||v_nome_equipe||' | Estoque da garantia | Movimento '||v_mov::text,
     coalesce(nullif(btrim(v_nome),''),'Usuario autenticado')
   );
   v_realizados:=v_realizados+1;
 END LOOP;
 v_agora:=clock_timestamp();
 UPDATE public.chamados
   SET status='Concluído',completed_at=v_agora,
       garantia_user=coalesce(nullif(btrim(v_nome),''),'Usuario autenticado'),
       updated_at=v_agora
   WHERE id=v_c.id AND consorcio_id=v_c.consorcio_id
     AND status='Aguardando Garantia LED' AND completed_at IS NULL;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'CONCLUSAO_GARANTIA_NAO_CONFIRMADA';
 END IF;
 INSERT INTO public.chamado_historico(
   chamado_id,status,mensagem,observacao,usuario_nome
 ) VALUES (
   v_c.id,'Concluído','Garantia LED concluída com controle de estoque',
   'Materiais baixados: '||v_realizados||' posição(ões). '||
   CASE WHEN v_realizados=0 THEN 'Conclusão sem consumo de material.' ELSE
   'Consumos auditados em estoque exclusivo de garantia.' END,
   coalesce(nullif(btrim(v_nome),''),'Usuario autenticado')
 );
 -- Itens planejados sao mantidos para auditoria; a fonte final e a tabela
 -- de consumos, jamais a previsao.
 RETURN pg_catalog.jsonb_build_object(
   'ok',true,'id',v_c.id,'protocolo',v_c.protocolo,
   'status','Concluído','completed_at',v_agora,
   'consumos_registrados',v_realizados,'executor_perfil',v_perfil
 );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.v19_garantia_relatorio_consumos(
 p_consorcio_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
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
    'responsavel',x.usuario_nome,'data_baixa',x.created_at,
    'data_conclusao',x.completed_at
   ) ORDER BY x.created_at DESC)
   FROM (
    SELECT g.id,g.chamado_id,c.protocolo,c.cidade,c.endereco,c.bairro,
      c.garantia_tipo,c.garantia_obs,c.status,c.completed_at,
      m.nome AS material,l.nome AS equipe,g.quantidade,g.usuario_nome,g.created_at
    FROM public.v19_garantia_consumos_chamados g
    JOIN public.chamados c ON c.id=g.chamado_id AND c.consorcio_id=g.consorcio_id
    JOIN public.v19_garantia_materiais m ON m.id=g.material_id AND m.consorcio_id=g.consorcio_id
    JOIN public.v19_garantia_locais l ON l.id=g.local_id AND l.consorcio_id=g.consorcio_id
    WHERE g.consorcio_id=p_consorcio_id
    ORDER BY g.created_at DESC,g.id DESC LIMIT 2000
   ) x
  ),'[]'::jsonb));
END;
$fn$;

REVOKE ALL ON FUNCTION public.v19_garantia_planejar(uuid,timestamptz,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v19_garantia_planejar(uuid,timestamptz,jsonb)
 TO authenticated;
REVOKE ALL ON FUNCTION public.v19_encaminhar_garantia_planejada(
 uuid,text,text,timestamptz,text,timestamptz,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v19_encaminhar_garantia_planejada(
 uuid,text,text,timestamptz,text,timestamptz,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.v19_garantia_consultar_planejamento(uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v19_garantia_consultar_planejamento(uuid)
 TO authenticated;
REVOKE ALL ON FUNCTION public.v19_concluir_garantia_com_consumo(
 uuid,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v19_concluir_garantia_com_consumo(
 uuid,timestamptz,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.v19_garantia_relatorio_consumos(uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v19_garantia_relatorio_consumos(uuid)
 TO authenticated;

COMMIT;

SELECT 'ESTOQUE_GARANTIA_CONSUMO_PREPARADO' AS etapa,
  (SELECT COUNT(*) FROM public.v19_garantia_consumos_chamados) AS consumos_reais,
  (SELECT COUNT(*) FROM public.v19_garantia_planejamentos) AS planejamentos,
  has_function_privilege('anon',
   'public.v19_concluir_garantia_com_consumo(uuid,timestamptz,jsonb)',
   'EXECUTE') AS anon_pode_concluir,
  has_table_privilege('authenticated',
   'public.v19_garantia_consumos_chamados','INSERT') AS cliente_insere_direto;