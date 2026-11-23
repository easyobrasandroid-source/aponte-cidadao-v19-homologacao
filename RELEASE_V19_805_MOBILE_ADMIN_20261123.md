# Aponte Iluminação V19 — Etapa 805: responsividade do painel interno
Data: 23/11/2026

## Defeito reportado
No iPhone, a barra lateral administrativa com ~210 px comprimindo o formulário Novo chamado interno e o Dashboard, com campos, KPIs e conteúdo cortados. CSS institucional #pg-app .sidebar sobrepunha estilos móveis anteriores específicos do Dashboard/Chamados.

## Solução
- Nova folha v19-mobile-admin.css, com regras exclusivamente dentro de media screen max-width 760px (fora: apenas ocultação dos novos controles móveis; preferência por movimento reduzido também limitada ao breakpoint).
- A barra lateral vira gaveta fora da tela, abre via botão ☰ no cabeçalho, fecha por X, área escurecida, seleção de opção ou tecla Escape.
- Conteúdo administrativo usa toda a largura disponível do dispositivo.
- Formulário interno: endereço, número e área em linhas próprias; município/bairro e demais campos sem corte; problemas em duas colunas; botões amplos; cartões da autoria em duas colunas.
- Dashboard: KPIs em duas colunas (uma em smartphones estreitos), filtros reajustados e gráficos encaixados.
- Outros painéis (chamados, estoque, mapa) mantêm rolagem horizontal somente para tabelas ou conteúdo que exigem.
- v19-mobile-admin.js manipula apenas estado visual do menu, sem chamadas de API.
- Código existente de autenticação, abertura de chamados, RLS, RPCs, SLA, estoque, garantia, impressão, relatórios e portal público fica intacto.

## Mudanças no repositório
- index.html: link CSS, markup dos botões e backdrop, carregamento JS e classe no resumo da abertura.
- v19-mobile-admin.css: novo.
- v19-mobile-admin.js: novo.

## QA
- 19 checagens estáticas e comportamentais de JavaScript/camadas de menu aprovadas (abertura, clique fora, navegação, Escape, sintaxe, layout restrito a breakpoint, escopo de portal).
- Não foi possível efetuar teste visual autenticado em navegador iPhone neste ambiente.
- Após publicação: conferir menu no iPhone, Dashboard, Novo chamado, Chamados e se desktop (>=761 px) permanece igual.
- Não gerar chamados de teste na base sem necessidade.

## Reversão
Reverter apenas este PR/commit. Sem migração SQL, alterações em Edge Function ou dados operacionais.
