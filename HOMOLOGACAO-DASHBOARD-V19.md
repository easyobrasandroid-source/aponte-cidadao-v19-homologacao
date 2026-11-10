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
