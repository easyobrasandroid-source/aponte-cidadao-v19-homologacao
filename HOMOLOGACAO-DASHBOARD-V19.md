# Homologação do dashboard completo V19 — pacote isolado

**Ambiente:** repositório V19 de homologação, branch `dashboard-v19-pacote-20261110`. A V18 não participa desta alteração.

## Arquitetura e segurança

- Implementação no arquivo independente `v19-dashboard.js`, sem modificar as funções originais de usuários, chamados, SLA, estoque, fotos ou banco.
- A única mudança prevista em `index.html` é a inclusão do script `<script src="./v19-dashboard.js" defer></script>`.
- Só leitura dos chamados já carregados do Supabase, preservando os filtros visuais dos perfis; **o RLS do Supabase continua sendo a segurança efetiva**, sem ser substituído por esse script.
- Não usar valores demonstrativos de SLA, cidades ou estoque como se fossem dados reais.
- Se o renderizador novo falhar, recupera-se o dashboard anterior na sessão.
- Comparação rápida após publicação: acrescentar `?dashboard=legacy` à URL para visualizar o dashboard antigo na mesma versão do código (usar `&dashboard=legacy` se já houver query string).
- Reversão definitiva: remover uma linha de inclusão do script no `index.html`.

## Baseline previamente confirmado no Supabase (10/11/2026)

| Escopo | Chamados | Concluídos | Abertos vencidos | SLA cumprido |
|---|---:|---:|---:|---|
| Master — todos | 21 | 9 | 4 | 100% (1/1) |
| Consórcio Alfa | 14 | 8 | 4 | Não apurável |
| Município Beta 1 | 7 | 1 | 0 | 100% (1/1) |

O percentual de 100% se refere **somente a uma conclusão avaliável**, e não ao conjunto dos nove concluídos. Os valores podem mudar se novos testes alterarem os chamados.

## Roteiro de regressão antes de liberar na branch main

1. **Master:** conferir total/concluídos/atrasos/SLA dentro dos filtros de cidade, 30 dias, 90 dias, mês e histórico completo.
2. **Consórcio Alfa:** conferir que somente seus chamados e municípios sejam exibidos, inclusive gráficos, alertas e tabela por município.
3. **Empresa Alfa A e Empresa Beta A:** conferir isolamento por empresa e dados de SLA. Verificar que nenhuma informação de outra empresa apareça no painel.
4. **Prefeitura Alfa 1:** confirmar filtro fixo pela cidade da prefeitura.
5. **Gráficos:** evolução mensal, status, tipo e municípios devem ter totais conciliáveis com chamados da mesma seleção, sem números fictícios.
6. **SLA:** excluir conclusões sem prazo ou data válida do percentual; mostrar `—` quando não houver denominador; não tratar chamadas abertas sem SLA como vencidas.
7. **Dados vazios, API com erro e consulta limitada:** apresentar avisos claros, não reaproveitar valores antigos indevidamente e indicar resultados potencialmente incompletos ao atingir 500 linhas.
8. **Navegação:** abrir chamados, ver detalhes, concluir ou designar chamado de teste, voltar ao dashboard e confirmar que nada foi quebrado.
9. **Responsividade:** abrir em largura de desktop e celular, verificar se cards, tabela e filtros continuam acessíveis.
10. **Reversão:** comparar painel novo e antigo com `dashboard=legacy` e demonstrar que o original permanece disponível.

## Teste técnico preliminar

- Sintaxe JavaScript validada.
- Cenários simulados de Master, Consórcio, Prefeitura e Empresa passaram (totais, escopo e percentual SLA).
- **Falta** testar o comportamento visual no navegador real e reconfirmar os valores pelo Supabase antes de liberar a nova versão no GitHub Pages.

**Critério de liberação:** integração somente após conferir os resultados acima. O commit na branch de desenvolvimento não publica esta versão no GitHub Pages atualmente configurado para main.

## Melhoria adicional — atalhos nos indicadores (10/11/2026)

- Os quatro cartões principais são botões acessíveis que abrem **Chamados**.
- **Total** transfere o período e o município, sem restringir status.
- **Em programação / execução** filtra somente esses dois estados; não mistura chamados em `Recebido`.
- **Concluídos** filtra exatamente `status = Concluído`.
- **Em atraso (SLA)** utiliza o cálculo `v19StatusSLA` para localizar chamados abertos vencidos, não um status textual persistido.
- O banner de Chamados mostra a origem e o período. Os valores de cidade/status são pré-selecionados no formulário. **Limpar** restaura a lista geral sem filtros.
- Nenhum acesso ao banco, RPC ou operação de escrita foi acrescentado ao dashboard.
- Testes preliminares simulados passaram: todos 14, concluídos 8, programação/execução 0, atrasados 5; janela de 30 dias excluiu 1 registro anterior.
- **Pendente:** confirmar no Codespaces os quatro cliques, contagens, banner, botão Limpar, filtro de mês e o caso de período vazio. Verificar novamente o isolamento por perfil.
- **Fora de escopo neste pacote:** tabela `chamado_fotos` e bucket `chamado-fotos` ausentes no Supabase V19. Esta correção deverá ser conduzida separadamente.

## Etapa 231 — Responsividade mobile (10/11/2026)
- **Primeiro teste em 400 px: falhou visualmente.** Menu de 210 px e indicadores em quatro colunas cortaram os números e gráficos. O Console mostrava dados Supabase carregados, sem erro de requisição visível.
- **Correção isolada implementada na branch:** somente `v19-dashboard.js` foi modificado, em regras CSS condicionais a tela de até 680 px e à presença dos gráficos do dashboard. Menu compacto por ícones, KPIs em duas colunas, gráficos em uma, topo quebrando linhas, sem alterar regras de negócio.
- **Pendente:** recarregar a prévia do Codespaces depois de `git pull --ff-only` e revalidar visualmente em 400 px, especialmente filtros, cartões e gráficos. Não fazer merge antes do teste.
- Nenhum teste funcional 219–230 precisa ser repetido se não houver regressão direta; validar apenas o comportamento mobile afetado.

## Etapa 235 — Novo problema de responsividade na lista de Chamados
- **Teste mobile 400px:** atalho `Concluídos` navegou corretamente para cinco chamados da Empresa Alfa B, mas a lista ficou estreita, pois a regra de menu compacto estava limitada ao dashboard.
- **Correção em branch isolada:** `index.html`, CSS condicionado à presença de `#tbody-ch` em viewport até 680px. Menu compacto, cabeçalho e aviso de filtro responsivos, formulário empilhado.
- Fechamento explícito de `.fbar` após seus filtros, com tabela encapsulada em região `.v19-ch-table-scroll` rolável horizontalmente. Nenhuma lógica de filtros ou RPC foi alterada.
- **Pendente:** `git pull` no Codespaces e teste visual no modo 400px da lista e da rolagem da tabela. O teste anterior da etapa 235 não foi aprovado visualmente.
- Sem integração à `main` antes da confirmação.

## Registro consolidado — etapas 219 a 237 (10/11/2026)
- **Atalhos e filtros:** os quatro cartões do dashboard da Prefeitura Alfa 1, limpar filtros, filtro de outubro sem registros e filtro de novembro com oito concluídos foram confirmados por capturas do navegador.
- **Isolamento visual:** Empresa Alfa A exibiu três concluídos e dois atrasados próprios; Empresa Alfa B, cinco concluídos próprios; o seletor da Prefeitura Alfa 1 não ofereceu Município Beta 1.
- **Reversão de apresentação:** `?dashboard=legacy` mostrou o painel anterior com os mesmos totais da Empresa Alfa B (7, 0, 5, 2). Isso não equivale a reverter um merge.
- **Mobile 400 px, dashboard (etapas 231–234):** corrigidos menu compacto, KPIs em duas colunas, gráficos empilhados; último campo de SLA na tabela de desempenho acessível por rolagem. Aprovado visualmente nos cenários fotografados.
- **Mobile 400 px, Chamados (etapas 235–237):** após correção do layout da lista, filtro Concluídos da Empresa Alfa B exibiu cinco registros; filtros ficaram acessíveis; usuário confirmou a rolagem horizontal até Data/hora, Origem e botão Ver. Não se inferem testes das colunas intermediárias pela última imagem.
- **Pendente para concluir este pacote:** regressão visual pontual da página Chamados em desktop após alteração do `index.html`, revisão final e autorização de merge. Fotos e permissões completas seguem em frentes separadas.
- **Implantação:** PR #1 continua em Draft para `main`; versão publicada e V18 não foram modificadas.

## Etapa 238 — Regressão desktop da tela Chamados (10/11/2026)
- **Aprovada visualmente:** após correção da Etapa 235–237, captura da Empresa Alfa B com filtros em linha, cabeçalho e todas as colunas da tabela visíveis, cinco concluídos, cinco botões Ver, banner de origem preservado.
- Este teste se limita ao cenário apresentado; não implica validação mobile de outros módulos.
- **Status:** pronto para revisão técnica pré-merge; aprovação e integração ainda pendentes. PR #1 permanece Draft na branch isolada, main da V19 e V18 sem modificações.

## Etapa 239 — Regressão do painel de detalhes (10/11/2026)
- **Aprovada no cenário testado:** Empresa Alfa B, filtro Concluídos / Últimos 30 dias; botão Ver abriu painel lateral do primeiro registro, mantendo visíveis os cinco registros filtrados e exibindo empresa, status Concluído, datas de abertura/conclusão e dados do chamado.
- **Nota de UX fora do pacote:** `Tempo total` exibiu `0h de atendimento` para cerca de 8min26s de duração; considerar formatação em minutos quando abaixo de 1h. Não altera os cálculos do dashboard.
- O pacote de dashboard e navegação está **aprovado nos testes funcionais/visuais executados**, com publicação dependente de autorização explícita para merge da branch de homologação. Outros módulos (fotos, usuários, permissões completas) têm homologações separadas e **não estão liberados** por este resultado.
