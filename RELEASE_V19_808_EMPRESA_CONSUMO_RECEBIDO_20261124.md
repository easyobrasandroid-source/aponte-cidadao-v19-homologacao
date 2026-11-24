# Aponte Iluminação V19 — Etapa 808 — Empresa pode registrar consumo no status Recebido (24/11/2026)

## Diagnóstico
O perfil **Rodrigo**, funcionário Vagalume/CISVERDE, estava autorizado e possuía saldo positivo. A tela de consumo de material não mostrava formulário porque `v19-chamado-estoque.js` só liberava `Em programação`, `Em execução` e `Aguard. material`/`Aguardando material`. As RPCs também negavam `Recebido`. Não decorre dos PRs 105/106, mas de uma regra da etapa 583/575.

## Ajuste pontual
- Permite **Recebido** no formulário de baixa `v19-chamado-estoque.js` e na tela de edição/estorno `v19-chamado-ajustes.js`.
- Alinha as três RPCs `v19_consumir_material_chamado_empresa`, `v19_editar_material_chamado_empresa`, `v19_remover_material_chamado_empresa`.
- Mantém a RPC idempotente (não alterada), titularidade, permissão exclusiva empresa, estoque de origem, saldo, histórico, auditoria e confirmação, demais status, Master e consórcio somente leitura.
- `index.html` somente atualiza versões de cache dos dois módulos.
- Nenhuma modificação na V18.

## Testes executados com ROLLBACK
1. Com contexto de autenticação do Rodrigo, chamado de Espera Feliz alterado para `Recebido` apenas na transação; consumo idempotente de 0,50, edição para 0,75, estorno completo de 0,75; saldo resultante igual ao inicial; transação revertida.
2. Chamado `Concluído` negado com `STATUS_NAO_PERMITE_CONSUMO`.
3. Empresa de outro consórcio negada com `CHAMADO_NAO_PERTENCE_A_EMPRESA`.
4. Master negado com `CONSUMO_EXCLUSIVO_DA_EMPRESA`.

## Arquivos
- `sql/v19/49_empresa_material_status_recebido_20261124.sql`
- `v19-chamado-estoque.js`
- `v19-chamado-ajustes.js`
- `index.html`

**Observação operacional:** "Registrar consumo" é BAIXA REAL do estoque; não é reserva futura. A empresa deve inserir materiais que efetivamente consumiu. O chamado do print já mudou para `Em programação` após a captura.
