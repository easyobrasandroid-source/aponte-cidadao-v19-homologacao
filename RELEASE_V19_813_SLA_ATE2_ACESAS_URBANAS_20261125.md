# Aponte Iluminação V19 — Etapa 813: 1 ou 2 lâmpadas acesas durante o dia (urbano), 48h

Data: 25/11/2026. Implementação restrita ao repositório exclusivo V19 e ao Supabase V19.

## Nova regra
- Identificador imutável: `SLA12_ACESOS_URB`.
- Área: **Urbana**.
- Situação: **1 ou 2 lâmpadas acesas durante o dia** (menos de três).
- Prazo inicial para **CISVERDE e CISCAPARAÓ**: **48 horas / 2 dias corridos**.
- Configuração separada por consórcio. Master pode editar ambos; gestor do consórcio pode editar somente o seu.
- Para novos chamados especiais e chamados em aberto, a regra é usada mediante classificação explícita. Não inferir número de lâmpadas pela descrição ou total de materiais. Não classificar nenhum chamado automaticamente na instalação.
- Os demais prazos especiais configurados anteriormente são preservados, inclusive os valores distintos configurados para CISCAPARAÓ.

## Alterações estritamente necessárias
- `sql/v19/52_sla_ate2_acesas_urb_48h_etapa813.sql`: cadastra 48h em ambos os consórcios; atualiza o CHECK de classificação; amplia cálculo de prazo e RPC de classificação existente para esta categoria; cria `v19_salvar_sla_ate2_acesas_urb` como RPC separada (não modifica a assinatura da RPC anterior de três regras), com autenticação, autorização por consórcio, validação e auditoria.
- `v19-config.js`: acrescenta quarto campo, botão próprio de salvamento e nova classificação urbana. Mantém o botão de salvar as 3 regras anteriores e área de ações avançadas recolhida.
- `index.html`: inclui apenas a nova RPC permitida pela lista restrita e atualiza a versão de cache do módulo SLA.
- Não altera estoque, chamados, saldos, perfis, usuários, fotos ou outros módulos da V19; V18 intocada.

## Testes em transação revertida
- Ambas as regras novas criadas com 48h.
- Cálculo urbano especial 48h em CISVERDE e CISCAPARAÓ.
- Configuração geral preservada (144h urbano / 168h rural).
- Outros prazos especiais preservados, incluindo regra urbana de 24h já configurada em CISCAPARAÓ.
- Gestor CISVERDE salva valor 3 dias apenas no próprio consórcio durante a simulação; tentativa cruzada negada.
- Empresa negada por perfil; Master permitido.
- Reclassificação de chamado aberto urbano para nova exceção reconhecida com 48h; operação revertida.
- Sintaxe JS verificada; nova RPC na lista fechada; três prazos anteriores ainda tratados separadamente.

## Conferência manual
Abrir https://aponteiluminacao.com.br, Ctrl+F5, tela SLA, escolher cada consórcio e verificar campo **1 ou 2 lâmpadas acesas durante o dia — urbano** marcado com 2 dias. Não salvar nem classificar chamados reais antes de conferir a tela.