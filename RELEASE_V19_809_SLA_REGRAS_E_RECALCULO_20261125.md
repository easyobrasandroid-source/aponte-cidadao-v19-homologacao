# V19 — Etapa 809 — SLA por consórcio, situações especiais e recálculo de abertos (25/11/2026)

## Origem
Edital CISVERDE Processo 066/2024, Pregão 018/2024, TR páginas 182–183 do edital (46–47 do arquivo): 3+ postes consecutivos apagados de noite urbano 48 h (2 dias), 3+ acesos durante o dia urbano 72 h (3 dias), 3+ apagados à noite rural/comunidades 96 h (4 dias). Prazos gerais no documento: 144 h urbano (6 dias), 168 h rural (7 dias). Exceções distintas não são inferidas de um chamado individual, exigem classificação humana.

## Antes da instalação
- CISVERDE regra padrão 48 h urbana / 120 h rural; 32 chamados não arquivados (28 pendentes, 4 concluídos), com tipo "Lâmpada apagada".
- CISCAPARAÓ regra padrão 144 h urbana / 168 h rural; nenhum chamado.
- A função v19_salvar_sla_padrao atualiza apenas configuracao; sla_horas do chamado é congelado no INSERT. A configuração isolada por consórcio já existia.

## Escopo do ajuste
- Regras especiais em `sla_configuracoes` com chaves `SLA3_APAGADOS_URB`, `SLA3_ACESOS_URB`, `SLA3_APAGADOS_RUR` e valores iniciais 48/72/96 h POR CONSÓRCIO; NÃO substituem PADRAO_GERAL.
- Campo `chamados.sla_classificacao` com default `PADRAO_GERAL`, check restritivo; não muda chamado existente na instalação.
- Função `v19_calcular_sla_horas` (interna) preserva precedência de regra específica por tipo, depois geral, exceto quando classificação especial explícita e área compatível.
- Trigger de INSERT mantém horário do servidor e utiliza a função, sem alterar chamada existente.
- RPC authenticated `v19_salvar_sla_especiais`: Master em qualquer consórcio, gestor somente no seu, dias inteiros 1–365, auditoria.
- RPC authenticated `v19_classificar_sla_chamado`: Master ou gestor do próprio consórcio classifica chamado ABERTO (não concluído, não arquivado, não pausado), atualizando somente `sla_classificacao` e `sla_horas`; auditoria com protocolo.
- RPC authenticated `v19_recalcular_sla_abertos`: prévia com `p_aplicar=false`, execução com `p_aplicar=true`, só chamados ativos não concluídos/arquivados/pausados; atualiza somente SLA em horas e registra auditoria por chamado; mantém data da abertura e registros anteriores.
- Frontend `v19-config.js`: formulário das 3 exceções em dias; classificação por chamado; prévia e confirmação de recálculo; só Master e Consórcio. Outros perfis leitura.
- V18 e demais módulos V19 não alterados. Deploy de código apenas via branch exclusiva V19.

## Testes SQL em ROLLBACK
1. Simulação em CISVERDE com geral 6/7 dias: 28 chamados abertos avaliados, 27 alterados após preservar um chamado manualmente classificado com regra de 2 dias; quatro concluídos inalterados.
2. Chamada rural simulada atualizada para 168 h, urbana especial preservada em 48 h.
3. Acesso empresa recusado; gestor CISCAPARAÓ recusado no CISVERDE.
4. 3 regras especiais 48/72/96 h; gestor CISVERDE pode alterar exclusivamente o próprio consórcio; configuração e valores do outro consórcio não mudaram.
5. Todas as transações de teste foram revertidas.

## Cuidados
- Apenas aplicar a atualização de chamados após salvar o prazo geral do consórcio certo e gerar prévia. A instalação da migração não aplica o recálculo automaticamente.
- "3+" depende da declaração do operador na página de SLA; não confundir com a quantidade de luminárias consumidas.
- Mudanças retroativas de metas devem ter respaldo do contrato e das regras administrativas vigentes; a auditoria fica preservada.
