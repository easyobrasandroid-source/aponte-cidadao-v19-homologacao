# V19 — ETAPA 806 — Remoção definitiva Master com movimentações preservadas (24/11/2026)

## Alteração solicitada
Master ativo pode excluir definitivamente chamados **arquivados**, inclusive quando houve:
- consumo empresarial seguido de estorno;
- consumos empresariais não estornados;
- consumo de garantia LED;
- planejamento de materiais de garantia;
- itens materiais vinculados ao chamado.

A exclusão de um chamado **não** é um estorno: quantidade contratada, disponível ou saldos da garantia **não mudam**. O ledger original continua registrado com protocolo e referência histórica, embora a FK do chamado removido seja desfeita.

## Segurança
- Preserva arquitetura da ETAPA 803: apenas Edge com JWT verificado, Master ativo conferido pela RPC, serviço com EXECUTE apenas service_role, confirmação EXCLUIR N, versão otimista, até 50 itens, todos previamente arquivados, transação atômica.
- O registro do chamado, histórico administrativo e fotos seguem o fluxo anterior; a fila de limpeza física de fotos permanece.
- Quatro tabelas de movimentos/uso de materiais recebem coluna histórica v19_protocolo_excluido; três passam a aceitar chamado_id NULL *apenas se protocolo histórico estiver preenchido*. Movimentações empresarial já aceita NULL para entradas avulsas e isso é preservado.
- Movimentos, consumo de garantia e planejamentos **não são apagados**; referências ao chamado são removidas transacionalmente, com protocolo preservado.
- Relatório de consumos da garantia passa a incluir lançamentos de chamados excluídos, identificados pelo protocolo e status 'Excluído definitivamente', sem recuperar os dados privados do chamado apagado.
- Auditoria original ampliada com quantidades de lançamentos preservados; nenhuma senha, endereço, telefone ou dados pessoais é copiada.
- Nenhum lançamento ou chamado real é excluído ao aplicar a migração, nem existe ação sem confirmação explícita na interface.
- A V18 não sofre alteração.

## Situação do banco antes da alteração
- 4 chamados arquivados; 1 com consumo empresarial + estorno de 1 unidade; 1 com 1 consumo e 1 planejamento da garantia; 2 sem esses registros.
- Estoque empresarial consumo+estorno saldo 100, sem impacto contábil da exclusão.
- Garantia: a saída de 1 unidade permanece efetiva; equipe executora tinha saldo 0. Esta alteração **não repõe** essa unidade.
- Não excluímos chamados de teste reais automaticamente. Somente o usuário Master pode fazer isso na interface.

## Publicação
- SQL: sql/v19/47_master_exclusao_preservar_livros_estoque_20261124.sql
- Frontend: v19-operacoes-novas.js e index.html (cache v806).
- Edge v19-exclusao-definitiva sem alteração.
