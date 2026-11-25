# V19 – Etapa 812 – Restringir Estoque de Garantia aos gestores autorizados (25/11/2026)

## Escopo aprovado
Apenas UM usuário do perfil **Consórcio** por consórcio pode consultar ou movimentar o **Estoque de Garantia**:
- CISCAPARAÓ: gestor IP `ip@ciscaparao.mg.gov.br` (ID usuário 3425ea1a-e9cc-4709-a225-561b4de4bdd8).
- CISVERDE: gestor `cisverdelicitacao@yahoo.com` (ID 01b267a0-f0c2-471f-a171-3c50fcb59111).
- CISCAPARAÓ / Pesquisa de Satisfação `pesquisasatisfacao40@gmail.com`: bloqueado para informações, planejamento, consumo, movimentação e relatório de estoque de garantia.
- Perfis Master e Garantia continuam autorizados exatamente como antes, com isolamento entre consórcios.
- Perfis Empresa e Prefeitura seguem sem acesso, como antes.

## Implementação
- Função interna `v19_pode_acessar_estoque_garantia()`: confirma usuário único e ativo por `auth.uid()`, perfil e UUID estável do cadastro/consórcio. Não usa metadados alteráveis pelo usuário. EXECUTE negado para roles públicas/anon/authenticated diretamente.
- Proteção adicional em sete RPCs existentes: `v19_garantia_consultar`, `v19_garantia_gerenciar`, `v19_garantia_planejar`, `v19_garantia_consultar_planejamento`, `v19_garantia_relatorio_consumos`, `v19_concluir_garantia_com_consumo`, `v19_encaminhar_garantia_planejada`. Todas mantêm suas regras anteriores de autenticação, transação, RLS e consórcio.
- Frontend: esconde o menu Estoque de Garantia ao gestor Pesquisa de Satisfação, bloqueia chamada direta da rota e remove informações de materiais de garantia nas janelas de chamado, sem alterar funções de chamados, equipes, SLA ou relatórios gerais.
- O gestor sem acesso ao estoque ainda poderá usar os fluxos convencionais de encaminhamento e conclusão da Garantia LED, sem consulta, previsão ou baixa de materiais, sujeitos às regras preexistentes dessas RPCs.
- Branch V19 exclusiva. Nenhuma alteração em V18.

## Teste com transação revertida
- As contas IP e Licitação consultam com sucesso o estoque do próprio consórcio.
- Master e Garantia continuam consultando o estoque.
- Um usuário autorizado não consegue consultar o estoque de outro consórcio.
- `pesquisasatisfacao40@gmail.com` recebe `USUARIO_SEM_ACESSO_ESTOQUE_GARANTIA` nas sete RPCs, inclusive nas tentativas diretas.
- Nenhuma alteração real em chamados, usuários ou saldos durante os testes.

## Referências
- `sql/v19/51_garantia_restringir_gestores_consorcio_etapa812.sql`
- `index.html`
- `v19-estoque-garantia.js`
- `v19-garantia-chamados.js`
