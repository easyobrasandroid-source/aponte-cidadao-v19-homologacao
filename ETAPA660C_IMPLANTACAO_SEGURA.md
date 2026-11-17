# Etapa 660C — Catálogo de problemas por consórcio (somente Master)

## Estado
**Código em branch de homologação, NÃO aplicado ao Supabase, nem à main, nem à V18.**
Issue #65. Os testes existentes NÃO devem ser repetidos.

## Decisões finais
- Catálogo de **problemas** separado por consórcio. O Master cadastra, renomeia, ordena e ativa/desativa.
- Todas as prefeituras, empresas e cidadãos do consórcio veem sua lista corrente.
- **Garantia LED permanece fixa**, inalterável e disponível em todos os consórcios. O fluxo de encaminhamento, perfis, status, SLA e motivos específicos atuais não é modificado.
- Tipos desativados/renomeados não alteram chamados antigos. Tipos antigos de testes preservados em relatórios e filtros, mas não aparecem em novas aberturas.
- Nenhuma exclusão física de tipos; RPC de gestão exclusiva Master com auditoria.
- Segurança de novas aberturas: gatilho no banco valida tipo ativo do consórcio; abertura pública e interna têm controles adicionais.

## Mudanças propostas
- `sql/v19/33_catalogo_problemas_master_etapa660c.sql`: tabela, seis tipos iniciais por consórcio, RPCs de listagem privada/pública e gestão Master, trigger para INSERT/UPDATE de tipo, substituição guarded da whitelist pública, rollback em erro (transação).
- `supabase/functions/v19-abrir-chamado/index.ts`: retorna tipos junto a municípios via RPC `service_role` com flags; valida tamanho, delegando autorização final ao banco.
- `index.html`: menu exclusivo Master e formulários por consórcio.
- `v19-tipos.js`: UI Master; listas internas/públicas e histórico.
- `v19-chamado-edicao.js`: lista de tipos ativos na edição, com valor histórico preservado.

## Sequência de implantação SEM interrupção desnecessária
1. Revisar código no PR e certificar-se do **projeto Supabase V19 `xurrhczvyqpwyjemight`**. Executar, **uma só vez**, SQL 33 no projeto V19, com resultado `V19_ETAPA_660C_CATALOGO_INSTALADO`; registrar quantidades e conferir erro ausente. **Não rodar na V18**. O SQL mantém os seis problemas antigos ativos, compatíveis com a UI ainda publicada.
2. Publicar a função Edge `v19-abrir-chamado` atualizada no **Supabase V19**, preservando secrets/config. O merge de GitHub Pages NÃO publica automaticamente essa Edge Function. Não alterar os flags de ativação do portal público.
3. Só então integrar o PR na `main` da **V19 de homologação** e conferir a publicação de GitHub Pages. A V18 permanece intacta.
4. Fazer testes **exclusivos da nova funcionalidade**: Master cria/desativa/reativa tipo em Beta; empresa/prefeitura não consegue editar; tipo só aparece em Beta; abertura interna seleciona item ativo; tipo removido não pode ser usado em novas aberturas; histórico e Garantia LED intactos. A abertura pública pode continuar desligada; não ativar sem autorização específica.

## Cuidados
- A consulta SQL da Etapa 660C.1 mostrou dois consórcios com regra geral de SLA urbana 48h e rural 120h; o pacote não altera esse prazo.
- Tipos fictícios historicamente cadastrados em Alfa ficam no histórico, mas NÃO entram como catálogo inicial.
- Se a pré-condição da RPC pública falhar, a transação SQL deve abortar por completo. Não contornar o bloqueio nem editar a função manualmente sem diagnóstico.
- O código inclui validações estáticas de sintaxe JS, mas **não foi validado operacionalmente**; tratar o PR como implementação em homologação, jamais prontidão de produção por si só.
