-- V19 Etapa 812: selecionar os gestores de consorcio autorizados a estoque de garantia.
-- Apenas contas IP (CISCAPARAO) e Licitacao (CISVERDE), sem alterar permissoes de Master/Garantia.
-- Aplica-se a TODAS as RPCs de consulta, movimentacao, planejamento, baixa e relatorio.
-- Nenhum UPDATE/DELETE/INSERT de dados operacionais, nenhuma alteracao em V18.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';

CREATE OR REPLACE FUNCTION public.v19_pode_acessar_estoque_garantia()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $guard$
  SELECT
    (SELECT count(*) FROM public.usuarios u
       WHERE u.auth_user_id=(SELECT auth.uid()) AND u.status='ativo')=1
    AND EXISTS(
       SELECT 1 FROM public.usuarios u
       WHERE u.auth_user_id=(SELECT auth.uid()) AND u.status='ativo'
       AND (
         u.perfil IN ('master','garantia')
         OR (
           u.perfil='consorcio'
           AND (
             (u.id='3425ea1a-e9cc-4709-a225-561b4de4bdd8'::uuid
              AND u.consorcio_id='8fb9ffc2-9b36-43d2-8809-c6f26a943db3'::uuid)
             OR
             (u.id='01b267a0-f0c2-471f-a171-3c50fcb59111'::uuid
              AND u.consorcio_id='73cc692f-d184-488c-b289-b73f774a303d'::uuid)
           )
         )
       )
    );
$guard$;
REVOKE ALL ON FUNCTION public.v19_pode_acessar_estoque_garantia() FROM PUBLIC,anon,authenticated;

-- v19_concluir_garantia_com_consumo
CREATE OR REPLACE FUNCTION public.v19_concluir_garantia_com_consumo(p_chamado_id uuid, p_atualizado_em timestamp with time zone, p_itens jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_perfil text;v_cons uuid;v_uid uuid;v_nome text;v_qtd int;
 v_c public.chamados%ROWTYPE;v_item jsonb;v_material uuid;v_local uuid;
 v_quant integer;v_saldo integer;v_mov uuid;v_realizados int:=0;
 v_agora timestamptz;v_nome_material text;v_nome_equipe text;
BEGIN
 IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
   RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
 END IF;
 IF NOT public.v19_pode_acessar_estoque_garantia() THEN
   RAISE EXCEPTION 'USUARIO_SEM_ACESSO_ESTOQUE_GARANTIA'
     USING ERRCODE='42501';
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
$function$;

-- v19_encaminhar_garantia_planejada
CREATE OR REPLACE FUNCTION public.v19_encaminhar_garantia_planejada(p_chamado_id uuid, p_tipo_defeito text, p_observacao text, p_identificado_em timestamp with time zone, p_status_esperado text, p_atualizado_em timestamp with time zone, p_itens jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_perfil text;v_cons uuid;v_qtd int;v_resp jsonb;v_planejamento jsonb;
BEGIN
 IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
   RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
 END IF;
 IF NOT public.v19_pode_acessar_estoque_garantia() THEN
   RAISE EXCEPTION 'USUARIO_SEM_ACESSO_ESTOQUE_GARANTIA'
     USING ERRCODE='42501';
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
$function$;

-- v19_garantia_consultar
CREATE OR REPLACE FUNCTION public.v19_garantia_consultar(p_consorcio_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_perfil text; v_cons uuid; v_qtd int;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
  END IF;
 IF NOT public.v19_pode_acessar_estoque_garantia() THEN
   RAISE EXCEPTION 'USUARIO_SEM_ACESSO_ESTOQUE_GARANTIA'
     USING ERRCODE='42501';
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
$function$;

-- v19_garantia_consultar_planejamento
CREATE OR REPLACE FUNCTION public.v19_garantia_consultar_planejamento(p_chamado_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_perfil text;v_cons uuid;v_qtd int;v_ch_cons uuid;
BEGIN
 IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
   RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
 END IF;
 IF NOT public.v19_pode_acessar_estoque_garantia() THEN
   RAISE EXCEPTION 'USUARIO_SEM_ACESSO_ESTOQUE_GARANTIA'
     USING ERRCODE='42501';
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
$function$;

-- v19_garantia_gerenciar
CREATE OR REPLACE FUNCTION public.v19_garantia_gerenciar(p_consorcio_id uuid, p_acao text, p_material_id uuid DEFAULT NULL::uuid, p_local_origem uuid DEFAULT NULL::uuid, p_local_destino uuid DEFAULT NULL::uuid, p_quantidade integer DEFAULT NULL::integer, p_nome text DEFAULT NULL::text, p_operacao_id uuid DEFAULT NULL::uuid, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_perfil text; v_cons uuid; v_user uuid; v_nome_usuario text; v_qtd int;
  v_acao text := lower(btrim(coalesce(p_acao,'')));
  v_id uuid; v_mov uuid; v_sig text; v_old_sig text;
  v_orig integer; v_dest integer; v_nome text:=nullif(btrim(coalesce(p_nome,'')),'');
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
  END IF;
 IF NOT public.v19_pode_acessar_estoque_garantia() THEN
   RAISE EXCEPTION 'USUARIO_SEM_ACESSO_ESTOQUE_GARANTIA'
     USING ERRCODE='42501';
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
$function$;

-- v19_garantia_planejar
CREATE OR REPLACE FUNCTION public.v19_garantia_planejar(p_chamado_id uuid, p_atualizado_em timestamp with time zone, p_itens jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_uid uuid;v_nome text;v_perfil text;v_cons uuid;
 v_qtd integer;v_c public.chamados%ROWTYPE;v_item jsonb;
BEGIN
 IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
   RAISE EXCEPTION 'NAO_AUTENTICADO' USING ERRCODE='42501';
 END IF;
 IF NOT public.v19_pode_acessar_estoque_garantia() THEN
   RAISE EXCEPTION 'USUARIO_SEM_ACESSO_ESTOQUE_GARANTIA'
     USING ERRCODE='42501';
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
$function$;

-- v19_garantia_relatorio_consumos
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
 IF NOT public.v19_pode_acessar_estoque_garantia() THEN
   RAISE EXCEPTION 'USUARIO_SEM_ACESSO_ESTOQUE_GARANTIA'
     USING ERRCODE='42501';
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
COMMIT;
