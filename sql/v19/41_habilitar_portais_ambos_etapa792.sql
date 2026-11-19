-- APONTE CIDADAO V19 — ETAPA 792.A: Portal publico para CISCAPARAO e CISVERDE
-- Apenas Supabase homologacao xurrhczvyqpwyjemight (nunca V18).
-- Premissas: Edge v23 publicada com Turnstile, rate-limit e flags por consorcio.
-- Operacao reversivel pela interface Master (Config. portal) ou SQL restrito.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $check$
DECLARE v_total integer; v_nome text; v_empresas integer; v_cidade uuid;
BEGIN
 SELECT count(*) INTO v_total FROM public.consorcios
  WHERE nome IN ('Ciscaparaó','Cisverde') AND status='ativo';
 IF v_total<>2 THEN
   RAISE EXCEPTION 'ETAPA792_CONSORCIOS_ATIVOS_DIVERGENTES: %',v_total;
 END IF;
 SELECT count(*) INTO v_total FROM public.portal_configuracoes pc
 JOIN public.consorcios c ON c.id=pc.consorcio_id
 WHERE c.nome IN ('Ciscaparaó','Cisverde');
 IF v_total<>2 THEN RAISE EXCEPTION 'ETAPA792_CONFIG_PORTAL_INCOMPLETA'; END IF;
 FOR v_nome IN SELECT nome FROM public.consorcios
   WHERE nome IN ('Ciscaparaó','Cisverde') AND status='ativo' LOOP
   SELECT count(*) INTO v_total FROM public.v19_tipos_problema tp
   JOIN public.consorcios co ON co.id=tp.consorcio_id
   WHERE co.nome=v_nome AND tp.ativo;
   IF v_total<1 THEN RAISE EXCEPTION 'ETAPA792_SEM_TIPOS_ATIVOS: %',v_nome; END IF;
   SELECT count(*) INTO v_total FROM public.cidades ci
   JOIN public.consorcios co ON co.id=ci.consorcio_id
   WHERE co.nome=v_nome AND ci.status='ativo';
   IF v_total<1 THEN RAISE EXCEPTION 'ETAPA792_SEM_CIDADES_ATIVAS: %',v_nome; END IF;
 END LOOP;
 -- Cada cidade ativa precisa de exatamente uma empresa ativa vinculada:
 -- evita municipio sem destinacao ou chamado enviado a empresa errada.
 FOR v_cidade IN SELECT ci.id FROM public.cidades ci
   JOIN public.consorcios co ON co.id=ci.consorcio_id
   WHERE co.nome IN ('Ciscaparaó','Cisverde') AND ci.status='ativo' LOOP
   SELECT count(DISTINCT e.id) INTO v_empresas FROM public.empresa_cidades ec
   JOIN public.empresas e ON e.id=ec.empresa_id AND e.status='ativo'
   WHERE ec.cidade_id=v_cidade;
   IF v_empresas<>1 THEN
      RAISE EXCEPTION 'ETAPA792_EMPRESA_UNICA_NAO_ATENDIDA_CIDADE: % (% empresas)',v_cidade,v_empresas;
   END IF;
 END LOOP;
END;
$check$;
UPDATE public.portal_configuracoes pc
 SET portal_ativo=true,
     abertura_portal_ativo=true,
     consulta_protocolo_ativo=true,
     gps_obrigatorio=false,
     notificacao_whatsapp=false,
     updated_at=clock_timestamp()
 FROM public.consorcios co
 WHERE co.id=pc.consorcio_id AND co.nome IN ('Ciscaparaó','Cisverde');
-- Campos equivalentes em consorcios permanecem sincronizados para
-- interfaces/rotinas antigas; fonte de verdade do portal é portal_configuracoes.
UPDATE public.consorcios
 SET portal_ativo=true, abertura_portal_ativo=true
 WHERE nome IN ('Ciscaparaó','Cisverde');
COMMIT;
SELECT co.nome AS consorcio,
pc.portal_ativo AS portal,
pc.abertura_portal_ativo AS abertura,
pc.consulta_protocolo_ativo AS consulta,
co.portal_ativo AS portal_consorcio,
co.abertura_portal_ativo AS abertura_consorcio
FROM public.consorcios co
JOIN public.portal_configuracoes pc ON pc.consorcio_id=co.id
WHERE co.nome IN ('Ciscaparaó','Cisverde') ORDER BY co.nome;
