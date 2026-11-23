-- V19 ETAPA 803 — exclusao definitiva restrita ao Master.
-- Exige chamado previamente arquivado, versao do banco e ausencia de
-- movimentos de estoque ou garantia (preserva contabilidade operacional).
-- O arquivo privado em Storage e removido pela Edge, via fila persistente.
-- Nao realiza nenhuma exclusao de dados ao instalar esta migracao.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

CREATE TABLE IF NOT EXISTS public.v19_fotos_pendentes_exclusao_definitiva (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket text NOT NULL DEFAULT 'chamado-fotos',
  storage_path text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  excluido_em timestamptz,
  tentativas integer NOT NULL DEFAULT 0,
  CONSTRAINT v19_fotos_pendentes_bucket_check CHECK (bucket='chamado-fotos'),
  CONSTRAINT v19_fotos_pendentes_storage_path_check CHECK
    (length(trim(storage_path)) BETWEEN 1 AND 800),
  CONSTRAINT v19_fotos_pendentes_chave_unique UNIQUE(bucket,storage_path)
);
ALTER TABLE public.v19_fotos_pendentes_exclusao_definitiva ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.v19_fotos_pendentes_exclusao_definitiva
  FROM PUBLIC,anon,authenticated,service_role;

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
   IF EXISTS(SELECT 1 FROM public.movimentacoes m WHERE m.chamado_id=v_call.id)
      OR EXISTS(SELECT 1 FROM public.chamado_materiais cm WHERE cm.chamado_id=v_call.id)
      OR EXISTS(SELECT 1 FROM public.v19_garantia_consumos_chamados gc WHERE gc.chamado_id=v_call.id)
      OR EXISTS(SELECT 1 FROM public.v19_garantia_planejamentos gp WHERE gp.chamado_id=v_call.id)
   THEN
     RAISE EXCEPTION 'CHAMADO_COM_ESTOQUE_OU_GARANTIA: %',v_call.protocolo;
   END IF;

   -- Registra arquivos para exclusao fisica posterior por Storage API.
   INSERT INTO public.v19_fotos_pendentes_exclusao_definitiva(bucket,storage_path)
   SELECT 'chamado-fotos', f.storage_path
   FROM public.chamado_fotos f
   WHERE f.chamado_id=v_call.id AND length(trim(f.storage_path))>0
   ON CONFLICT(bucket,storage_path) DO UPDATE
      SET excluido_em=NULL;
   GET DIAGNOSTICS v_removed=ROW_COUNT;
   v_photo_count=v_photo_count+v_removed;

   -- Auditoria minimalista permanece, sem nome/telefone/endereco/fotos.
   INSERT INTO public.auditoria
    (consorcio_id,usuario_responsavel,acao,detalhes)
   VALUES (v_call.consorcio_id,v_actor.nome,'V19_CHAMADO_EXCLUIDO_DEFINITIVAMENTE',
    'ID '||v_call.id::text||' | protocolo '||v_call.protocolo||
    ' | master_uid '||v_actor.id::text);

   -- Child tables CASCADE removem fotos (somente metadados), historico
   -- e idempotencia; objetos Storage sao removidos exclusivamente via API.
   DELETE FROM public.chamados WHERE id=v_call.id;
   v_count_deleted=v_count_deleted+1;
 END LOOP;
 IF v_count_deleted<>v_count THEN
   RAISE EXCEPTION 'CHAMADO_INEXISTENTE_OU_ALTERADO';
 END IF;
 RETURN jsonb_build_object('ok',true,'excluidos',v_count_deleted,
    'fotos_enfileiradas',v_photo_count);
END;
$fn$;

REVOKE ALL ON FUNCTION public.v19_exclusao_definitiva_master(text,uuid,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v19_exclusao_definitiva_master(text,uuid,jsonb)
  TO service_role;
COMMIT;