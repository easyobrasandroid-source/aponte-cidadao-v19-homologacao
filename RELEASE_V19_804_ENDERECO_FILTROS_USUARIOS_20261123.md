# V19 — Ajustes localizados de endereço, filtros e usuários
Data: 23/11/2026
Branch: `fix/v19-endereco-numero-filtros-usuarios-20261123`
Base: `main` da V19; V18 intocada.

## Alterações
1. Campo visual **Número** separado da rua em chamados internos e no portal público. Aceita números alfanuméricos e S/N; é opcional para endereços sem numeração.
2. **Compatibilidade com as RPCs já homologadas**: o valor informado é persistido como sufixo normalizado do endereço existente (`Rua X, nº 123`). Nenhuma tabela, RPC, trigger, histórico ou política RLS foi alterada. Número é apresentado separadamente na ficha do chamado, impressão por lote, ficha individual, Excel de chamados/SLA e PDF de relatórios. Chamados anteriores sem sufixo permanecem intocados, com número não informado.
3. **Dashboard e Chamados**: municípios passam a vir da tabela `cidades` por meio do catálogo já autorizado pelo RLS, independentemente da existência de chamados. Respeita perfil Master, Consórcio, Prefeitura, Empresa e Garantia. Apenas cidades ativas.
4. **Usuários**: mantida a checagem rigorosa `verificar_acesso`, com código e status HTTP de diagnóstico se falhar. Filtros por consórcio e empresa sobre os usuários autorizados, sem ampliar escopo de RLS.
5. **Edge Function `v19-usuarios`**: foi adicionada a origem `https://aponteiluminacao.com.br` e a variante `www`, mantendo JWT, autenticador, restrição Master/Consórcio e RPC auditada. Versão 17 implantada exclusivamente no Supabase V19.
6. Cache bust `?v=804` somente dos módulos JS modificados.

## Verificações realizadas
- Código JS analisado sintaticamente: sem erros no script inline e nos quatro módulos externos modificados.
- Testes isolados de formatação/extração/validação do número e catálogo: oito verificações aprovadas.
- Banco V19 consultado **somente leitura**: 24 cidades ativas; 39 usuários; 3 chamados não arquivados na consulta de 23/11.
- Edge Function V19 versão 17 confirmada ACTIVE e `verify_jwt=true`.
- Branch comparada com `main`: sem alteração da V18, nem SQL, nem funções de chamado existentes.
- **Pendente**: teste real no navegador com sessão Master, confirmação de HTTP 200 no serviço de usuários, criação controlada de um chamado com número e verificação de exportação. Não fazer testes em lote.

## Publicação
**Não fazer merge automático nem publicar em Cloudflare antes da confirmação funcional.** A branch é a candidata de homologação para revisão/implantação. A função de usuários foi implantada no Supabase V19 sem necessidade de merge.
## Reversão
Frontend: reverter a branch/PR, mantendo a `main` anterior. Edge: restaurar a versão anterior do serviço `v19-usuarios` no Supabase V19, se necessário. Nenhuma migração de banco é necessária.
