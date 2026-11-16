# Aponte Cidadão V19 — Etapa 613 — Portal Beta controlado

**Ambiente exclusivo:** Supabase `xurrhczvyqpwyjemight`, repositório `easyobrasandroid-source/aponte-cidadao-v19-homologacao`. Não alterar a V18.

## Estado anterior comprovado

- Etapa 607: portais ativos = 0, `anon_executa=false`, `service_role_executa=true`, trava de desativação instalada.
- Etapa 606: Alfa 1 possui 2 empresas, Alfa 2 possui 0, Beta 1 possui 1; catálogo público filtra cidades sem empresa ativa única.
- Etapa 612: com `PORTAL_INTAKE_ENABLED=false`, POST com JSON vazio à Edge Function devolveu HTTP 503 e `ABERTURA_EM_HOMOLOGACAO`. **Não houve chamado novo.**
- Segredos exigidos estão cadastrados, porém não é possível conferir seus valores pelo painel nem inferir que o Turnstile está operante apenas por sua presença.
- Consulta pública de protocolo somente por Edge Function (`service_role` após rate limit), de acordo com Etapa 603.

## Alterações deste pacote

1. `sql/v19/28_config_portal_beta_etapa613.sql`: atualiza a RPC `v19_salvar_config_portal` sem ativar flags. Perfis existentes Master ou consórcio do próprio tenant podem salvar campos não públicos e desligar serviços. **Ativar o portal só é permitido a Master no consórcio `TESTE V19 - Consorcio Beta` ativo**, com pelo menos um município ativo com exatamente uma empresa ativa vinculada. Não permite abertura com GPS obrigatório até a checagem também existir no backend, nem notificações WhatsApp ainda não implementadas. Rejeita combinações inconsistentes de flags. Não altera RLS, dados, segredos, `v19_criar_chamado_publico_privado` ou permissões da função.
2. `v19-config.js`: Master pode visualizar os três controles de serviço no consórcio Beta; para outros consórcios/perfis continuam bloqueados. Exige confirmação antes de tentar ativar; salva via RPC, compara os flags com a releitura real do banco e informa resultado. Evita que outro perfil desative acidentalmente um portal ativo apenas por salvar dados de contato. WhatsApp permanece bloqueado.

## Ordem de implantação

1. Revisar e integrar o PR **somente na main da V19**. Nenhum efeito no banco até executar migração.
2. No Supabase V19, executar manualmente `sql/v19/28_config_portal_beta_etapa613.sql`. Esperado: `V19_ETAPA_613_CONFIG_BETA_PREPARADA_PORTAIS_DESATIVADOS` e `portais_ativos=0`.
3. Abrir interface V19 e conferir visualmente controles Master Beta (sem marcar nem salvar ativos). Para não repetir testes, verificar somente esta diferença visual e a ausência de habilitação em Alfa/Consórcio.
4. Confirmar `verify_jwt=false` implantado, consistência Turnstile hostname/action, logs e demais condições de publicação. Não compartilhar nenhum segredo.
5. **Somente mediante autorização explícita**, ativar flags Beta no banco via UI e, em janela controlada, configurar `PORTAL_INTAKE_ENABLED=true`; fazer um único chamado fictício, consulta, idempotência, rate limit e desativação. Depois restaurar flags e Edge para `false` enquanto V19 estiver em homologação.

## Bloqueios de liberação

- Não ativar sem teste real de Turnstile, permissões/URL, rate limit e resposta de consulta.
- Não habilitar Alfa (nenhum município elegível); não atribuir Alfa 1 arbitrariamente a uma das duas empresas.
- Não habilitar GPS obrigatório, pois RPC de criação ainda não exige GPS nesse cenário.
- Não alterar o repositório, Supabase ou publicação da V18.
- A flag da Edge Function é independente das flags de banco: ambas precisam permitir para abrir chamados. A consulta por protocolo exige também a flag correspondente na tabela.

**Este PR NÃO ativa o portal e NÃO solicita implantação de segredos.**
