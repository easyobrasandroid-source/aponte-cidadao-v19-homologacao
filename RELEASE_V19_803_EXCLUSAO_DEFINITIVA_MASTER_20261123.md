# Aponte Iluminação V19 — Exclusão definitiva somente Master — 23/11/2026

## Pedido atendido
Em **Chamados excluídos**, o Master pode:
- selecionar um chamado por caixa de seleção;
- marcar todos os **25 chamados exibidos na página**;
- navegar entre páginas e selecionar mais chamados, limitado a 50 por operação;
- clicar em **Excluir definitivamente (N)** e digitar `EXCLUIR N` para confirmar.

Consórcio, Empresa, Prefeitura e Garantia **não** visualizam seleção nem o botão de exclusão definitiva.

## Garantias no servidor
- Edge `v19-exclusao-definitiva` valida JWT no Supabase Auth real.
- RPC `v19_exclusao_definitiva_master` é acessível **somente a service_role**, nunca a anon/authenticated. RPC verifica que a identidade validada pertence a **Master ativo** no banco.
- Apenas protocolos **previamente arquivados**, versão de atualização coincidente e sem movimentos/materiais/planejamentos de estoque ou garantia. Requisições múltiplas são transacionais: falha de qualquer item cancela todo o lote.
- Exclui o registro e filhos com ON DELETE CASCADE (histórico, fotos metadata, idempotência); **não recalcula saldos** de estoque. Mantém um registro mínimo de auditoria com ID/protocolo/operador.
- Caminhos de fotos ficam numa fila privada. A Edge remove os arquivos reais da API de Storage e registra remoções. Se a limpeza falhar, a fila não se perde; botão **Conferir limpeza das fotos** permite repetir. Nunca executar `DELETE FROM storage.objects`.
- Nenhuma exclusão ocorre ao instalar a migração ou publicar a interface.

## Arquivos
- `sql/v19/46_exclusao_definitiva_master_20261123.sql`
- `supabase/functions/v19-exclusao-definitiva/index.ts`
- `v19-operacoes-novas.js`
- `index.html` (apenas invalidação de cache do JS novo)

## Verificações concluídas
- Privileges: `anon=false`, `authenticated=false`, `service_role=true`.
- Não-Master negado; chamado ativo negado; versão antiga negada.
- Teste de exclusão bem-sucedido sobre registro **sintético** criado em uma transação revertida com ROLLBACK; nenhum chamado real foi removido durante o teste.
- Os **2 chamados arquivados existentes** foram preservados.

## Avisos operacionais
1. Exclusão definitiva não pode ser restaurada pela interface; a preservação de registros mínimos de auditoria e eventuais backups é independente.
2. Havendo obrigações legais de guarda, não deve ser utilizada para eliminar dados cuja conservação seja obrigatória.
3. Em caso de arquivo de foto pendente, utilizar **Conferir limpeza das fotos**; não significa falha na remoção do chamado.
4. Antes de clicar em excluir definitivamente num chamado real, revisar protocolo, fotos, vínculos e o motivo.
