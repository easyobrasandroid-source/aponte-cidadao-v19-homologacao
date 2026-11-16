# V19 — Etapa 603: fechamento da consulta pública de protocolos

**Aplica-se somente à homologação V19**: projeto Supabase `xurrhczvyqpwyjemight`. V18 não pode ser modificada.

## Resumo de segurança
A auditoria 602 provou:
- `consultar_protocolo(text,uuid)` era `SECURITY DEFINER`, permitida a `anon` e `authenticated`; retorno limitado a protocolo, tipo, status, data e cidade, com flags de portal, mas com acesso direto sem limite de consultas.
- O código da Edge Function `v19-abrir-chamado` aplica rate limit e então chama a RPC **com chave anônima**, permitindo a chamada direta fora da Edge.
- `rls_auto_enable()` é função de um **event trigger** `ensure_rls` que reforça RLS quando novas tabelas são criadas; não removê-lo.
- `v19_listar_municipios_portal(uuid)` é pública intencional e filtra portal/abertura ativos.

## Alteração real
1. `supabase/functions/v19-abrir-chamado/index.ts`: após rate limit, **somente a chamada de consultar_protocolo** usa `serviceRoleKey` presente no servidor. A chamada pública de lista de municípios continua `anon`.
2. `sql/v19/24_consulta_protocolo_somente_edge_etapa603.sql`: revoga EXECUTE de `consultar_protocolo` para PUBLIC/anon/authenticated e concede apenas a service_role. Revoga EXECUTE desnecessário da função de event trigger para os papéis clientes, sem remover/desabilitar `ensure_rls`.
3. Preserva os dois consórcios desativados e os 27 chamados, 6 estoques e 18 movimentos confirmados na etapa 601.

## Ordem obrigatória de implantação
**PASSO A — Publicar a Edge Function atualizada antes da migração SQL.**
- No dashboard V19 abra **Edge Functions → v19-abrir-chamado → Code**. A nova versão completa já está versionada no GitHub; compare o código implantado com o repositório antes de substituí-lo.
- A alteração específica para `consultar_protocolo` remove o `const anonKey=...` do bloco de consulta e troca os headers `apikey` e `authorization` por `serviceRoleKey`. **Não** trocar as chaves do bloco `listar_municipios`.
- Publique via **Deploy updates**, sem mudar `verify_jwt=false`. Como alternativa reprodutível via CLI a partir da raiz do repositório: `supabase functions deploy v19-abrir-chamado --project-ref xurrhczvyqpwyjemight --no-verify-jwt`.
- Não salvar `SUPABASE_SERVICE_ROLE_KEY` no HTML/GitHub. O código lê o segredo somente do ambiente Supabase.
- **Não prosseguir ao SQL** caso não consiga confirmar que a função implantada usa `serviceRoleKey` na consulta.
- Se o dashboard não listar a função ou o código divergir substancialmente, interromper e registrar essa diferença; não criar function paralela.

**PASSO B — SQL V19**
- Execute o arquivo `sql/v19/24_consulta_protocolo_somente_edge_etapa603.sql` inteiro no SQL Editor do projeto V19. Ele é atômico (se alguma condição falhar, reverte).
- Verificar três funções:
  - `consultar_protocolo(text,uuid)`: anon=false, authenticated=false, service_role=true;
  - `rls_auto_enable()`: anon=false, authenticated=false, `ensure_rls` permanece ativo;
  - `v19_listar_municipios_portal(uuid)`: anon=true (catálogo público previsto).
- Ambos os portais permanecem desligados; chamados 27, estoques 6 e movimentos 18 (se não houver operações adicionais entre as etapas).

**PASSO C — Homologação dirigida**
- Sem ativar o portal, verificar que `anon` não consegue chamar `consultar_protocolo` diretamente (403 no PostgREST) e que chamada pública pela Edge retorna modo homologação/desativado.
- Depois que o pacote do portal estiver integralmente instalado e as flags puderem ser habilitadas com segurança, testar **um** protocolo fictício via Edge Function. Não testar portal em consórcio de produção.
- Nunca interpretar um erro de rede como gravação não realizada. Não duplicar envios de chamados.

## Próximos blocos
Concluir portal real, configurações ativáveis mediante autorização segura e limites públicos, depois regressão curta de perfis/atribuições/fotos e checklist de liberação. Não repetir PDF/Excel nem ciclo de estoque sem mudança relevante.

Fonte dos comandos de deploy: documentação Supabase sobre atualização de funções pelo Dashboard e CLI. [Supabase Docs: Edge Functions](https://supabase.com/docs/guides/functions/quickstart-dashboard) · [Supabase CLI](https://supabase.com/docs/reference/cli/supabase-functions).
