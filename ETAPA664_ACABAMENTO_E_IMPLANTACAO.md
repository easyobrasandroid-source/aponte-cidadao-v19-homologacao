# Aponte Cidadão V19 — Etapa 664 (acabamento operacional)

## Entrega desta etapa (somente V19)
- Removido o aviso laranja alarmista na configuração do portal. As flags reais continuam visíveis nas três opções.
- Link público **real** por consórcio, calculado a partir do GitHub Pages e do UUID do consórcio, com abrir em nova aba e copiar.
- Ao abrir pelo link com `pagina=portal`, carregar diretamente o portal, mesmo havendo login administrativo na outra aba. Todas as requisições públicas seguem sem JWT do administrador.
- Eliminado formulário obsoleto de configuração que simulava salvar, número de telefone fictício e domínio de demonstração no `index.html`.
- Textos operacionais sem referência a homologação, e diagnósticos manuais de SLA ocultos na interface normal (disponíveis apenas via `?diagnostico=1`).
- Migração **versionada mas não executada**: `sql/v19/37_config_portal_multiconsorcio_etapa664.sql`. Substitui a limitação exclusiva ao Master/Beta por autorização Master (qualquer consórcio) e gestor (apenas próprio consórcio). Para ligar o portal, exige consórcio ativo e pelo menos uma cidade ativa com exatamente uma empresa responsável ativa; preserva o bloqueio de WhatsApp não implementado e de GPS obrigatório sem backend.

## Implantação — ordem segura
1. Integrar o PR de acabamento exclusivamente na `main` do repositório `easyobrasandroid-source/aponte-cidadao-v19-homologacao`. A publicação do GitHub Pages segue a configuração do repositório.
2. Abrir o projeto **Supabase V19** `xurrhczvyqpwyjemight`. No SQL Editor executar apenas o arquivo completo `sql/v19/37_config_portal_multiconsorcio_etapa664.sql`.
3. Esperado: resultado `V19_ETAPA_664_CONFIG_CONSORCIOS_OK`, `autenticado_pode_salvar=true`, `anon_pode_salvar=false`. Se houver exceção `DEFINICAO_DIVERGENTE_ABORTAR`, a transação reverte e requer revisão, sem improvisar GRANT.
4. Abrir a tela Config. portal da V19; as flags já salvas do Beta permanecem; copiar/abrir o link público usando a própria tela. No caso de Alfa sem cidade com uma única empresa, o backend **continuará bloqueando** ativação até que haja vínculo operacional legítimo.
5. A Edge Function precisa manter `PORTAL_INTAKE_ENABLED=true`, TURNSTILE, rate-limit e controle de flags; confirmar existência e estado somente com os administradores autorizados. Nenhuma chave deve ir ao GitHub Pages.
6. Não executar nesta etapa o `sql/v19/36_finalizar_corte_idempotencia_etapa66122b.sql` do estoque: a wrapper de consumo de chamado ainda carece da validação dirigida de idempotência. Não reexecutar testes antigos indiscriminadamente.

## Testes/revisões deste pacote
- Parse estático de `index.html` (script inline), `v19-config.js`, `v19.js`, `v19-chamado-estoque.js` e `v19-usuarios-etapa70.js`: sem erros de sintaxe.
- Guardas do SQL conferidos no repositório: SECURITY DEFINER + search_path vazio, isolamento de consórcio, município com empresa única e liberação somente ao autenticado.
- A integração no GitHub não prova execução do SQL, status atual da Edge Function, navegação real ou publicação concluída. Não declarar sistema pronto para substituir V18 com base neste merge.
- **V18 produção permanece intocada.**