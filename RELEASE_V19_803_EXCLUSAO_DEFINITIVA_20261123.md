# V19 — Excluir definitivamente chamados arquivados (ETAPA 803)

Publicação de **interface e operação exclusivamente Master**. V18 não alterada.

## Fluxo
- Área "Chamados excluídos": selecionar individualmente ou marcar todos **desta página**; paginação de 25 itens.
- Botão "Excluir definitivamente (N)" visível somente para Master, desabilitado até selecionar; primeiro alerta de irreversibilidade e depois digitação obrigatória de `EXCLUIR N`.
- A requisição é enviada a Edge `v19-exclusao-definitiva` com JWT da sessão atual; a Edge valida o JWT na API Auth, verifica Master ativo por RPC de execução exclusiva `service_role`.
- Somente chamados **arquivados** e cuja versão não tenha mudado são elegíveis. Lote é atômico; registros selecionados não são apagados parcialmente.
- Chamados vinculados a **movimentações de estoque, materiais consumidos ou movimentações/planejamento de garantia** são protegidos: operação recusada por risco de inconsistência e perda de rastreabilidade.
- O chamado e seus históricos, anexos de metadados e dados de consulta/idempotência são apagados via FKs CASCADE no banco.
- Fotos físicas são removidas usando a Storage API privada; caso falhe, uma fila protegida permite retentar sem reverter a exclusão já confirmada do registro.
- `auditoria` preserva id, protocolo, consórcio, usuário Master e data; dados de endereço, telefone e fotos não são replicados na auditoria da operação.
- Não é um apagamento de backups e registros de auditoria; antes de usar deve-se considerar as obrigações legais de guarda de registros públicos.

## Segurança
- RLS ativo na fila de imagens, sem SELECT a `anon`, `authenticated` ou `service_role`.
- EXECUTE na nova RPC apenas `service_role`, não `anon` nem `authenticated`. `SECURITY DEFINER` somente nesta função de escopo estreito.
- Edge valida JWT e consulta banco para Master ativo. Não expõe service_role ao navegador.
- Nenhum `DELETE` direto é executado pelo JavaScript no banco.

## Validações
- Migração 46 instalada; Edge V2 ACTIVE; sintaxe frontend verificada.
- Teste de integração **com chamado temporário e foto fictícia em transação ROLLBACK**, verificando remoção em banco, auditoria, fila de fotos, confirmação da fila e recusa de Gestor Consórcio.
- Contagem ao finalizar o teste: **5 chamados reais preservados** e **0 imagens na fila**.
- O teste não apagou fotografias físicas; a rotina de limpeza real deve ser validada quando aplicável sem comprometer dados reais.
