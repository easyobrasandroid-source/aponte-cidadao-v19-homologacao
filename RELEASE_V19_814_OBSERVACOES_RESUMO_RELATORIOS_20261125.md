# V19 Etapa 814 — Observações do chamado no Resumo e relatórios (25/11/2026)

## Escopo
- Exibir `chamados.observacoes` como texto de leitura na aba **Resumo** do chamado, após salvar e recarregar a consulta da V19. Campo editável e RPC `v19_editar_dados_chamado` permanecem intactos.
- Incluir a **observação atual completa** do chamado em relatórios **Chamados** e **SLA**, PDF e Excel, preservando quebras de linha e caracteres especiais. Não incluir notas administrativas do histórico ou comentários de garantia como substitutos da observação atual.
- Incluir observações nas fichas da página **Impressão/PDF** (prévia e impressão), sem mexer em filtros, cálculos, cabeçalhos, contagens, permissões ou SLA.
- Impressão individual já apresentava `c.obs` e não foi alterada.
- **Não** acrescentar observações em relatórios exclusivamente de estoque, que não são orientados a chamados.

## Arquivos
- `index.html`: novo texto de observação na aba Resumo, inclusão na ficha de impressão e cache v814.
- `v19-relatorios.js`: coluna Observações do chamado em exportações de Chamados e SLA (Excel) e seção de texto nos PDFs desses relatórios.

## Verificações
- Dados já persistidos em `public.chamados.observacoes`; 40 dos 45 chamados não arquivados tinham texto no levantamento de 25/11/2026.
- Nenhuma migração SQL, deploy de Edge Function ou mutação de dados.
- Sintaxe JS e script inline do index válidos.
- Teste dinâmico de mapeamento para Excel e PDF (Chamados e SLA) preserva texto com acento, quebra de linha, & e sinais HTML.
- Exportação exclusiva de estoque continua sem o campo de observação.
- A V18 permanece intocada.

## Como conferir
1. Entrar em https://aponteiluminacao.com.br e atualizar com Ctrl + F5.
2. Em Chamados, abrir um protocolo com observações, aba Resumo, editar a observação e salvar. Depois do recarregamento do banco, confirmar o texto visível logo abaixo das datas.
3. Em Relatórios, filtrar o protocolo, exportar Chamados em Excel/PDF e conferir a observação completa; repetir para relatório de SLA.
4. Em Impressão/PDF, filtrar e conferir a observação nas fichas. 
