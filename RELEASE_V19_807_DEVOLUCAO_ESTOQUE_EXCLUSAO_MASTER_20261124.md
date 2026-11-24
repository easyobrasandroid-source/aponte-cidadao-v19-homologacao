# V19 — Etapa 807 — Devolução ao estoque na exclusão definitiva Master (24/11/2026)

## Regra operacional
Somente exclusão **definitiva** de chamado previamente arquivado, por Master ativo e após confirmação digitada e declaração de devolução física, gera devolução de materiais. Arquivamento reversível **não** altera saldos.

### Estoque empresarial
- Calcula consumo líquido para cada **estoque de origem**, por material, empresa e consórcio: `consumo - estorno - devolucao`.
- Se o líquido é zero, nada devolve. Se positivo, credita exatamente esse saldo de volta no mesmo estoque e grava lançamento `estorno` na tabela `movimentacoes`, identificado pelo protocolo e por Master.
- Se o líquido for negativo, origem não estiver identificada, houver divergência entre itens atuais e movimentações ou retorno exceder `quantidade_contratada`, bloqueia **toda** a exclusão sem alterar dados.
- Nunca confundir uma operação `devolucao` já registrada por edição de quantidade com novo consumo.

### Garantia LED
- Planejamentos/itens apenas previstos não geram saída nem devolução.
- Baixas efetivamente registradas em `v19_garantia_consumos_chamados` geram nova entrada no **local/equipe da própria baixa**, como `v19_garantia_movimentos.tipo='entrada'`, restaurando quantidade em `v19_garantia_saldos`.
- Registra data e movimento da devolução nos vínculos de consumo. O relatório de consumos sinaliza itens devolvidos por exclusão, preservando rastreabilidade.
- Baixas prévias não são apagadas; saldos só mudam pela nova entrada auditada.

## Invariantes
Mantidas as garantias da etapa 806: Edge autentica JWT real; RPC de `service_role` apenas; valida Master ativo; verifica versões e arquivamento; lotes transacionais; 50 itens máximos; remove fotos reais pela Storage API com fila; auditoria retida; V18 intacta. 
A Edge agora exige `devolucao_confirmada=true` e repassa esse parâmetro à RPC. A RPC valida independentemente. O Master deve confirmar que os materiais retornaram fisicamente ou que lançamentos são testes; não se deve criar estoque fictício.

## Testes revertidos (ROLLBACK)
1. Quatro chamados arquivados existentes: 1 consumo e 1 estorno empresarial (saldo líquido zero), 1 baixa de garantia LED, 2 sem baixa. Exclusão simulada de quatro chamadas devolveu empresa 0 e garantia 1; comprovados saldos, lançamentos e auditoria na transação. ROLLBACK.
2. Alterado estorno de teste para `devolucao 0.25` e saldo simulado para 99.25: remoção simulada do chamado devolveu 0.75 e fechou saldo em 100. ROLLBACK.
3. Requisição sem confirmação física foi recusada. Nenhum chamado real foi apagado.

## Arquivos alterados
- `sql/v19/48_master_exclusao_devolve_estoque_liquido_20261124.sql`
- `supabase/functions/v19-exclusao-definitiva/index.ts`
- `v19-operacoes-novas.js`
- `index.html` (cache v807)
