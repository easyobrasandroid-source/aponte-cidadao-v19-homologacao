# Aponte Cidadão V19 — plano consolidado de fechamento (ETAPA 599)

Data de referência: 16/11/2026. Este plano vale exclusivamente para a V19 de homologação:
- Código: `easyobrasandroid-source/aponte-cidadao-v19-homologacao` (`main` própria).
- Supabase de homologação: `xurrhczvyqpwyjemight`.
- Publicação de teste: `https://easyobrasandroid-source.github.io/aponte-cidadao-v19-homologacao/`.
- **NÃO modificar V18 em produção** (`easyobrasandroid-source/aponte-cidadao`) sem autorização explícita de virada.

## Objetivo operacional

Fechar o sistema **real, não simulado**, com menos testes redundantes e mais garantias:
1. Inspecionar código e contratos da API **antes** de alterar.
2. Implementar correções em **pacotes funcionais completos**, com autorização e auditoria no backend, UI correspondente, logs, tratamento de erro e documentação.
3. Executar testes estáticos/automatizados no pacote e **somente os testes de navegador/Supabase que representem riscos novos ou não comprovados**.
4. Atualizar esta matriz de evidências após cada pacote. **Não repetir PDF, Excel, dashboard, estoque ou convites já homologados sem regressão relevante.**
5. Nunca abrir portal ao público nem substituir V18 automaticamente.

## Onde estamos

As 598 etapas registradas foram decisões, diagnósticos, SQL, código e testes — **não 598 casos independentes**. Na divisão original em oito fases: base (1–3) homologada nos cenários documentados; módulos (4–5) bastante avançados; regressão e aceite (6), publicação (7) e virada controlada (8) ainda pendentes. Não atribuir percentual fictício.

### Matriz de evidências (resumo sem extrapolar)

| Área | Evidência conhecida | Status para liberação |
|---|---|---|
| Autenticação, perfis, RLS, convites e alteração de usuários | Fluxos principais e tentativas de gravação direta bloqueadas, etapas anteriores | **Revalidar** cruzamento entre perfis/organizações e flags da Edge Function de usuários |
| Chamados, SLA 48h urbano/120h rural, conclusão/garantia e dashboard | Fluxos e filtros principais aprovados | **Regressão curta**, inclusive chamado transferido e concorrência |
| Estoque exclusivamente empresarial | Cadastro + saldo inicial, entrada/saída, consumo, edição e estorno confirmados, etapas 578–587; contas master/consórcio só leitura, etapas 588–591 | **Concluído funcionalmente**; pendente testes negativos de ACL/concorrência |
| Relatórios de chamados/SLA e estoque | Filtro segregado, novo SQL 593, dados da interface 595–596, PDF e Excel enviados em 16/11/2026 | **Concluído funcionalmente**; só retestar caso uma alteração afete relatórios |
| Fotografias | Upload e persistência de testes anteriores, Storage privado, RLS/bucket | **Revisar** expiração de URLs, acesso indevido, falha de upload e órfãos |
| Equipes e designação | Módulo/RPC existem; municipalização usual automática; exceção 2 empresas/cidade | **Testes negativos essenciais pendentes**, sem duplicar fluxo normal |
| Portal do cidadão | Código de Edge Function com Turnstile e rate-limit; `PORTAL_INTAKE_ENABLED` desabilitada por padrão; 3 controles de ativação bloqueados no frontend | **P0: NÃO PRONTO**, integrar/homologar fluxo público real e sua consulta antes de ativar |
| GPS/mapas e mobile | GPS/urbano-rural testados em parte | **Verificar casos de falha/permissão e responsividade** |
| Publicação e migração | V18 preservada, V19 isolada | **Não iniciar** sem checklist/backup/rollback/aceite |

## Pacotes de fechamento — mudar o sistema real, sem protótipos descartáveis

### PACOTE A — Segurança consolidada (etapas 599+; prioridade P0)
- **Etapa 599: auditoria read-only** `sql/v19/20_auditoria_integrada_etapa599.sql`. Uma execução produz: RLS por tabela, políticas e privilégios, RPCs expostas ao anônimo, RPCs legadas executáveis, isolamento do estoque, estado do portal, Storage e totais de referência. Não altera dados.
- Depois da auditoria: preparar **uma migração idempotente revisada**, somente se houver falhas comprovadas. Não conceder acesso amplo a `authenticated`; restringir SQL/RPC por vínculo e status ativo.
- Verificações com tokens **reais**, não simular JWT como `postgres`: Master (consulta global, sem escrita empresarial), Consórcio Alfa (sem acesso Beta), Empresas A/B (sem leitura/edição cruzada), prefeitura e anônimo (somente portas públicas habilitadas); revogação/desativação.
- Segurança de chamadas duplicadas/concorrência em operações financeiras de estoque; preservação de `estoque_id` em ajustes de chamado transferido. Nunca testar gravação duplicada após erro ambíguo.
- **Aceite:** nenhuma consulta/gravação indevida e auditoria persistente; somente endpoints explicitamente permitidos.

### PACOTE B — Funcionalidade pública e operações finais (prioridade P0/P1)
- Implementar/homologar o **portal real** de abertura + consulta por protocolo com configuração por consórcio, rate limit, Turnstile, consentimento de dados, proteção contra enumeração, parâmetros válidos e teste de revogação. Não ativar flags antes dos testes; segredo só no Supabase/Edge Function, nunca no GitHub Pages.
- Concluir cenários excepcionais de atribuição (2 empresas/cidade), manutenção de equipes, mapas/GPS e fotos. Toda ação deve registrar auditoria e responder com confirmação da transação.
- Gerar apenas UI **definitiva** para rotinas já aprovadas no banco; não criar botões que simulam gravação.
- **Aceite:** fluxo completo cidadão -> chamado -> execução -> consumo -> conclusão/garantia -> consulta, com logs, autenticação e RLS comprovados.

### PACOTE C — Regressão curta + preparação da virada (prioridade P0)
- Executar roteiro **direcionado** por risco: usuário sem permissão, usuário inativo, empresa/consórcio incorretos, status inválido, concorrência, perda de rede, URL de foto, mobile e dados legados. Reutilizar evidências aprovadas de PDF/Excel e casos normais.
- Verificar produção paralela da V19, variáveis/secrets, URLs, rate limit/monitoramento, backups verificáveis e restauração ensaiada.
- Preparar scripts de migração versionados, plano de rollback, comparação de contagens e aceite explícito; **não substituir nem fazer merge sobre V18 sem ordem do usuário**.

## Sequência para manter rapidez
1. Executar UMA auditoria 599 e receber o resultado. Se não revelar problemas, avançar diretamente ao Portal/Equipes, sem repetir testes.
2. Para cada pacote: **análise estática -> PR V19 -> SQL quando necessário -> 1 teste positivo + testes negativos inéditos -> aceite**. Não alternar entre 10 pequenas correções/testes iguais.
3. Atualizar este plano com: `OK` (evidência), `PENDENTE` (motivo), `BLOQUEADO` (risco) e `NÃO APLICÁVEL`. Marcar anomalia antes de criar nova feature.
4. Fazer checklist final de liberação em lote. Bloqueio P0 impede a virada, não a continuidade do desenvolvimento isolado.

## Regra inegociável
Um clique no frontend **não é prova de autorização**. A autorização deve existir no banco/Edge Function e ser testada com sessão autenticada de cada perfil. `SECURITY DEFINER`, `search_path`, grants e RLS devem ser revisados em conjunto. O SQL Editor `postgres` não substitui uma sessão real.

Atualizações de código e SQL deste plano somente na V19 de homologação. Os próximos testes dependem da auditoria para evitar conjecturas.
