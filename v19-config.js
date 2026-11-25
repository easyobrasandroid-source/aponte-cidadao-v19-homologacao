/* Aponte Cidadão V19 — configuração real do portal e prazos por consórcio */
(function(){
'use strict';
const esc=x=>String(x??'').replace(/[&<>"']/g,k=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[k]));
const valid=x=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(String(x||''));
const admin=()=>CU && ['master','consorcio'].includes(CU.perfil);
let consorcios=[], selectedCons='', rules=[], portalRow=null;

async function carregarConsorcios(){
  if(CU?.perfil==='master'){
    const list=await sbSelect('consorcios','select=id,nome&order=nome.asc');
    if(!Array.isArray(list))throw new Error('Consórcios indisponíveis no banco.');
    return list;
  }
  if(!valid(CU?.consorcio_id))throw new Error('Seu perfil não tem consórcio vinculado.');
  const one=await sbSelect('consorcios','select=id,nome&id=eq.'+encodeURIComponent(CU.consorcio_id));
  if(!Array.isArray(one)||one.length!==1)throw new Error('Consórcio não encontrado.');
  return one;
}
function urlPublica(id){
  if(!valid(id))throw new Error('Consórcio inválido.');
  const url=new URL(location.origin+location.pathname);
  url.searchParams.set('consorcio_id',id);url.searchParams.set('pagina','portal');
  return url.href;
}
window.v19CopiarLinkPortal=async function(){
  if(!valid(selectedCons))return;
  const link=urlPublica(selectedCons),campo=document.getElementById('v19-url-publica');
  try{await navigator.clipboard.writeText(link);showToast('Link do portal copiado.','ok');}
  catch(e){if(campo){campo.focus();campo.select();}showToast('Selecione o endereço e copie-o.','aviso');}
};
const escolha=(selected,action)=>'<label style="font-size:12px;font-weight:600">Consórcio: </label>'+
  '<select id="v19-config-cons" onchange="'+action+'(this.value)" style="max-width:320px">'+
  consorcios.map(c=>'<option value="'+esc(c.id)+'" '+(selected===c.id?'selected':'')+'>'+esc(c.nome)+'</option>').join('')+'</select>';

window.v19MudarConsPortal=async function(id){
  if(!valid(id)||!consorcios.some(c=>c.id===id))return;
  selectedCons=id;
  const b=document.getElementById('main-body'),t=document.getElementById('topbar-title'),a=document.getElementById('topbar-actions');
  await window.vConfigPortal(b,t,a,id);
};
window.v19MudarConsSLA=async function(id){
  if(!valid(id)||!consorcios.some(c=>c.id===id))return;
  selectedCons=id;
  await window.vSLA(document.getElementById('main-body'),
    document.getElementById('topbar-title'),document.getElementById('topbar-actions'),id);
};

window.vConfigPortal=async function(b,t,a,consId){
  t.textContent='Configurações do portal público';
  a.innerHTML='';b.innerHTML='<div class="card">Lendo configurações do Supabase…</div>';
  if(!admin()){
    b.innerHTML='<div class="card">Somente Master e Consórcio podem gerenciar o portal.</div>';return;
  }
  try{
    consorcios=await carregarConsorcios();
    const chosen=valid(consId)?consId:valid(selectedCons)?selectedCons:consorcios[0]?.id;
    if(!chosen)throw new Error('Nenhum consórcio disponível.');
    selectedCons=chosen;
    const linkPublico=urlPublica(chosen);
    a.innerHTML='<a class="btn btn-ghost" href="'+esc(linkPublico)+
      '" target="_blank" rel="noopener noreferrer">↗ Abrir portal público</a>';
    const rows=await sbSelect('portal_configuracoes',
      'select=*&consorcio_id=eq.'+encodeURIComponent(chosen)+'&limit=1');
    if(!Array.isArray(rows))throw new Error('Configurações do portal indisponíveis. Contate o administrador.');
    if(t.textContent!=='Configurações do portal público'||!b.isConnected)return;
    portalRow=rows[0]||{consorcio_id:chosen,portal_ativo:false,abertura_portal_ativo:false,
      consulta_protocolo_ativo:false,gps_obrigatorio:false,mostrar_empresa:false,
      notificacao_whatsapp:false,telefone_contato:'',whatsapp_contato:'',prazo_medio_texto:''};
    const podeGerenciar=admin();
    const check=(id,field,label,bloqueado=false)=>'<label style="display:flex;align-items:center;gap:9px;font-size:13px;padding:8px 0">'+
      '<input type="checkbox" id="'+id+'" '+(portalRow[field]?'checked':'')+
      (bloqueado?' disabled title="Sem permissão para editar"':'')+'> '+esc(label)+'</label>';
    b.innerHTML='<div class="card" style="max-width:760px">'+
      '<div style="margin-bottom:18px">'+escolha(chosen,'v19MudarConsPortal')+'</div>'+
      '<h3 style="font-size:15px;margin-bottom:8px">Serviços do portal cidadão</h3>'+
      '<div style="margin:14px 0 18px;padding:12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px">'+
      '<label for="v19-url-publica" style="font-size:12px;font-weight:600;display:block;margin-bottom:7px">Link público deste consórcio</label>'+
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+
      '<input id="v19-url-publica" readonly value="'+esc(linkPublico)+'" style="flex:1;min-width:210px;padding:9px;border:1px solid #CBD5E1;border-radius:7px;font-size:12px">'+
      '<button type="button" class="btn btn-ghost" onclick="v19CopiarLinkPortal()">📋 Copiar link</button></div></div>'+
      check('v19-portal-ativo','portal_ativo','Portal público ativo',!podeGerenciar)+
      check('v19-portal-abertura','abertura_portal_ativo','Permitir abertura de chamados',!podeGerenciar)+
      check('v19-portal-consulta','consulta_protocolo_ativo','Permitir consulta de protocolo',!podeGerenciar)+
      check('v19-portal-gps','gps_obrigatorio','GPS obrigatório para abertura')+
      check('v19-portal-empresa','mostrar_empresa','Exibir a empresa responsável')+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px">'+
        '<label>Telefone de contato<input id="v19-portal-telefone" style="width:100%" maxlength="40" value="'+esc(portalRow.telefone_contato||'')+'"></label>'+
        '<label>WhatsApp de contato<input id="v19-portal-numero" style="width:100%" maxlength="40" value="'+esc(portalRow.whatsapp_contato||'')+'"></label>'+
      '</div><label style="display:block;margin-top:14px">Prazo médio (texto público)<input id="v19-portal-prazo" '+
      'style="display:block;width:100%" maxlength="150" value="'+esc(portalRow.prazo_medio_texto||'')+'"></label>'+
      '<button class="btn btn-save" id="v19-portal-salvar" onclick="v19SalvarPortal()">💾 Salvar configurações</button></div>';
  }catch(e){b.innerHTML='<div class="card" style="color:var(--red)">'+esc(e.message)+'</div>';}
};

window.v19SalvarPortal=async function(){
  if(!admin()||!valid(selectedCons))return;
  const btn=document.getElementById('v19-portal-salvar');
  if(!btn||btn.disabled)return;
  const alvo=selectedCons;
  const sessao=SB_SESSION?.user?.id;
  const g=id=>!!document.getElementById(id)?.checked;
  const v=id=>document.getElementById(id)?.value?.trim()||null;
  const payload={
    p_consorcio_id:alvo,
    p_portal_ativo:g('v19-portal-ativo'),
    p_abertura_portal_ativo:g('v19-portal-abertura'),
    p_consulta_protocolo_ativo:g('v19-portal-consulta'),
    p_gps_obrigatorio:g('v19-portal-gps'),
    p_mostrar_empresa:g('v19-portal-empresa'),
    p_notificacao_whatsapp:false,
    p_telefone_contato:v('v19-portal-telefone'),
    p_whatsapp_contato:v('v19-portal-numero'),
    p_prazo_medio_texto:v('v19-portal-prazo')
  };
  if((payload.p_abertura_portal_ativo||payload.p_consulta_protocolo_ativo)&&!payload.p_portal_ativo){
    showToast('Primeiro marque Portal público ativo; a abertura e consulta dependem desta opção.','erro');return;
  }
  if(payload.p_abertura_portal_ativo&&payload.p_gps_obrigatorio){
    showToast('GPS obrigatório ainda não está homologado para abertura pública.','erro');return;
  }
  if(payload.p_portal_ativo && !portalRow?.portal_ativo &&
     !window.confirm('Ativar este portal para visitantes com o link público?'))return;
  btn.disabled=true;btn.textContent='Salvando…';
  try{
    // Não usar INSERT/PATCH direto: validações e isolamento pertencem à RPC homologada.
    const resp=await sbFetch('rpc/v19_salvar_config_portal','POST',payload);
    if(resp?.ok!==true || resp.consorcio_id!==alvo)
      throw new Error('A RPC não confirmou o salvamento da configuração.');
    // Nunca presumir as flags: confirmar valor REAL lido apos o COMMIT.
    const rows=await sbSelect('portal_configuracoes',
      'select=*&consorcio_id=eq.'+encodeURIComponent(alvo)+'&limit=1');
    if(!Array.isArray(rows)||rows.length!==1||rows[0].consorcio_id!==alvo)
      throw new Error('Salvamento confirmado, mas a consulta de verificação falhou. Atualize a página antes de repetir.');
    if(!!rows[0].portal_ativo!==payload.p_portal_ativo ||
       !!rows[0].abertura_portal_ativo!==payload.p_abertura_portal_ativo ||
       !!rows[0].consulta_protocolo_ativo!==payload.p_consulta_protocolo_ativo ||
       !!rows[0].notificacao_whatsapp)
      throw new Error('A leitura do banco não corresponde às flags solicitadas; confira a configuração antes de tentar novamente.');
    if(selectedCons!==alvo || SB_SESSION?.user?.id!==sessao)return;
    portalRow=rows[0];
    showToast('Configurações do portal salvas com sucesso.','ok');
    const corpo=document.getElementById('main-body'),
      titulo=document.getElementById('topbar-title'),
      acoes=document.getElementById('topbar-actions');
    if(titulo?.textContent==='Configurações do portal público' &&
       corpo && acoes)
      await window.vConfigPortal(corpo,titulo,acoes,alvo);
  }catch(e){
    if(selectedCons===alvo && SB_SESSION?.user?.id===sessao)
      showToast(esc(e.message),'erro');
  }finally{btn.disabled=false;btn.textContent='💾 Salvar configurações';}
};

// Configuração global de SLA. Valores em dias na UI e horas na tabela.
// As verificações efetivas de permissão são realizadas pelo backend.
let slaSaving=false;
let slaChamados=[];
let slaPreview=null;
const slaEspeciais=[
  {codigo:'SLA3_APAGADOS_URB',titulo:'3 ou mais pontos apagados à noite — urbano',campo:'urb_prazo',id:'v19-sla-e1'},
  {codigo:'SLA3_ACESOS_URB',titulo:'3 ou mais pontos acesos durante o dia — urbano',campo:'urb_prazo',id:'v19-sla-e2'},
  {codigo:'SLA3_APAGADOS_RUR',titulo:'3 ou mais pontos apagados à noite — rural/comunidades',campo:'rur_prazo',id:'v19-sla-e3'},
  {codigo:'SLA12_ACESOS_URB',titulo:'1 ou 2 lâmpadas acesas durante o dia — urbano',campo:'urb_prazo',id:'v19-sla-e4'}
];
window.vSLA=async function(b,t,a,consId){
  t.textContent='Configuração de SLA'; a.innerHTML='';
  b.innerHTML='<div class="card">Lendo prazos do Supabase…</div>';
  try{
    // Ferramentas internas de diagnostico nao aparecem no uso diario.
    const modoDiagnostico=new URLSearchParams(location.search).get('diagnostico')==='1';
    consorcios=await carregarConsorcios();
    selectedCons=valid(consId)?consId:(valid(selectedCons)?selectedCons:consorcios[0]?.id);
    if(!selectedCons||!consorcios.some(c=>c.id===selectedCons))
      throw new Error('Consórcio não disponível para este usuário.');
    const rows=await sbSelect('sla_configuracoes',
      'select=*&consorcio_id=eq.'+encodeURIComponent(selectedCons)+'&order=tipo_problema.asc');
    if(!Array.isArray(rows))throw new Error('Configurações de SLA indisponíveis no banco.');
    if(t.textContent!=='Configuração de SLA'||!b.isConnected)return;
    rules=rows;
    const padrao=rows.find(r=>r.tipo_problema==='PADRAO_GERAL');
    const mostrarDias=h=>{
      if(h==null||h==='')return '—';
      const n=Number(h);
      return Number.isFinite(n)?(n/24).toLocaleString('pt-BR',{maximumFractionDigits:2}):'—';
    };
    const row=r=>'<tr>'+
      '<td style="padding:8px">'+esc(r.tipo_problema==='PADRAO_GERAL'?'Padrão geral':(slaEspeciais.find(x=>x.codigo===r.tipo_problema)?.titulo||r.tipo_problema))+'</td>'+
      ['urb_prazo','urb_alerta','rur_prazo','rur_alerta'].map(k=>
        '<td style="padding:8px">'+esc(mostrarDias(r[k]))+'</td>').join('')+
      '</tr>';
    const isEditable=admin()&&!!padrao;
    const input=(id,h,label)=>'<label style="font-size:12px;font-weight:600;display:block">'+esc(label)+
      '<input id="'+id+'" type="number" min="1" max="365" step="1" value="'+
      esc(h==null?'':String(h/24))+'" style="display:block;margin-top:6px;width:125px;max-width:100%;padding:8px">'+
      '</label>';
    const edicao=isEditable?
      '<div style="border-top:1px solid #E5E7EB;padding-top:14px;margin-top:16px">'+
      '<strong style="font-size:13px">Alterar prazos gerais deste consórcio</strong>'+
      '<p style="font-size:12px;color:var(--gray-500)">Afeta a regra padrão para futuros chamados. Não altera automaticamente prazos de chamados já existentes.</p>'+
      '<div style="display:flex;flex-wrap:wrap;gap:14px;margin:12px 0">'+
      input('v19-sla-urb',padrao.urb_prazo,'Prazo urbano (dias corridos)')+
      input('v19-sla-rur',padrao.rur_prazo,'Prazo rural (dias corridos)')+
      '</div>'+
      '<button class="btn btn-save" id="v19-sla-salvar" onclick="v19SalvarSLA()">💾 Salvar prazos gerais</button>'+
      '</div>':
      (!padrao?'<p style="font-size:12px;color:var(--amber);margin-top:14px">Este consórcio ainda não possui uma regra geral de SLA. Os prazos do Consórcio Alfa não são compartilhados. Solicite ao administrador o cadastro da regra geral de SLA para este consórcio.</p>':'')+
      (modoDiagnostico&&!admin()&&padrao?'<div style="border-top:1px solid #E5E7EB;margin-top:16px;padding-top:12px">'+
      '<p style="font-size:12px;color:var(--gray-500)">Homologação V19: este diagnóstico envia valores inválidos (0 dias) para testar se a RPC rejeita seu perfil. Nenhuma regra pode ser salva com esses valores.</p>'+
      '<button class="btn btn-ghost" id="v19-sla-teste-bloqueio" onclick="v19TestarBloqueioSLARPC()">🔒 Testar bloqueio de edição pelo banco</button>'+
      '<div id="v19-sla-resultado-bloqueio" style="font-size:12px;margin-top:8px"></div></div>':'');
    const disponiveis=slaEspeciais.every(x=>rules.some(r=>r.tipo_problema===x.codigo));
    const especiais=isEditable&&disponiveis?
      '<div style="border-top:1px solid #E5E7EB;padding-top:16px;margin-top:16px">'+
      '<strong style="font-size:13px">Prazos especiais: 3 ou mais postes consecutivos</strong>'+
      '<p style="font-size:12px;color:var(--gray-500)">Configure em dias corridos. O sistema não identifica automaticamente se três ou mais postes estão envolvidos; classifique os chamados correspondentes abaixo.</p>'+
      '<div style="display:flex;flex-wrap:wrap;gap:12px;margin:12px 0">'+
      slaEspeciais.slice(0,3).map(x=>{
        const r=rules.find(y=>y.tipo_problema===x.codigo);
        return input(x.id,r?.[x.campo],x.titulo);
      }).join('')+'</div>'+
      '<button class="btn btn-save" id="v19-sla-salvar-especiais" onclick="v19SalvarSLAEspeciais()">💾 Salvar os 3 prazos especiais</button>'+
      '<div style="border-top:1px solid #E5E7EB;padding-top:16px;margin-top:16px">'+
      '<strong style="font-size:13px">1 ou 2 lâmpadas acesas durante o dia — área urbana</strong>'+
      '<p style="font-size:12px;color:var(--gray-500)">Prazo específico para ocorrências confirmadas com menos de 3 lâmpadas acesas durante o dia. A classificação do chamado é manual e não modifica registros antigos automaticamente.</p>'+
      input('v19-sla-e4',rules.find(r=>r.tipo_problema==='SLA12_ACESOS_URB')?.urb_prazo,
        'Prazo urbano (dias corridos)')+
      '<div style="margin-top:12px"><button class="btn btn-save" id="v19-sla-salvar-ate2" onclick="v19SalvarSLAAcesasAte2()">💾 Salvar prazo para 1 ou 2 lâmpadas acesas</button></div>'+
      '</div>'+
      '</div>':'';
    const retro=isEditable?
      '<div style="border-top:1px solid #E5E7EB;padding-top:16px;margin-top:16px">'+
      '<strong style="font-size:13px">Atualizar os chamados já abertos</strong>'+
      '<p style="font-size:12px;color:var(--gray-500)">Após salvar os prazos deste consórcio, gere uma prévia para identificar quantos chamados em aberto precisam de atualização. Concluídos, arquivados ou com SLA pausado por garantia não serão alterados. Data da abertura e histórico preservados.</p>'+
      '<button class="btn btn-ghost" id="v19-sla-prever" onclick="v19PreverRecalculoSLA()">🔎 Prévia da atualização dos chamados</button>'+
      '<div id="v19-sla-retro-resultado" style="font-size:12px;margin:12px 0"></div>'+
      '<button class="btn btn-save" id="v19-sla-aplicar" style="display:none" onclick="v19AplicarRecalculoSLA()">Aplicar atualização nos chamados</button>'+
      '</div>':'';
    const classificacao=isEditable&&disponiveis?
      '<div style="border-top:1px solid #E5E7EB;padding-top:16px;margin-top:16px">'+
      '<strong style="font-size:13px">Classificar um chamado em situação especial</strong>'+
      '<p style="font-size:12px;color:var(--gray-500)">Escolha a regra somente após confirmar a situação no local: 1 ou 2 lâmpadas acesas de dia, ou 3 ou mais pontos consecutivos nas situações específicas. Atualiza apenas o SLA do chamado aberto e registra auditoria; não altera sua abertura.</p>'+
      '<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin:12px 0">'+
      '<label style="font-size:12px">Chamado<select id="v19-sla-chamado" onchange="v19OpcoesClassificacaoSLA()" style="display:block;min-width:240px;max-width:100%;padding:8px"><option value="">Carregando chamados...</option></select></label>'+
      '<label style="font-size:12px">Regra de SLA<select id="v19-sla-classificacao" style="display:block;min-width:240px;max-width:100%;padding:8px"></select></label>'+
      '</div>'+
      '<button class="btn btn-save" id="v19-sla-classificar" onclick="v19ClassificarChamadoSLA()">Aplicar regra a este chamado</button>'+
      '</div>':'';
    // Acoes eventuais nao precisam ocupar a tela do dia a dia.
    // Mantemos as ferramentas para aplicar excecoes e recalcular os prazos no futuro.
    const acoesAvancadas=isEditable?
      '<details id="v19-sla-avancados" style="border-top:1px solid #E5E7EB;margin-top:18px;padding-top:12px">'+
      '<summary style="cursor:pointer;color:#305a86;font-size:13px;font-weight:700;padding:8px 0">'+
      '⚙ Outras ações de SLA (usar somente quando necessário)</summary>'+
      '<p style="font-size:12px;color:var(--gray-500);margin-top:8px">'+
      'Classificar ocorrências especiais (inclusive 1 ou 2 lâmpadas acesas de dia) ou atualizar chamados antigos após mudar prazos.</p>'+
      classificacao+retro+
      '</details>':'';
    b.innerHTML='<div class="card">'+escolha(selectedCons,'v19MudarConsSLA')+
      '<p style="font-size:12px;color:var(--gray-600);margin:14px 0">'+
      '<strong>SLA em dias corridos (24 horas por dia).</strong> Inclui finais de semana e feriados. '+
      'As configurações do banco são guardadas em horas, sem arredondamento de prazo.</p>'+
      '<div style="overflow:auto"><table><thead><tr><th>Tipo de problema</th>'+
      '<th>Urbano (dias)</th><th>Alerta urbano (dias)</th>'+
      '<th>Rural (dias)</th><th>Alerta rural (dias)</th>'+
      '</tr></thead><tbody id="v19-sla-linhas">'+
      (rules.length?rules.map(row).join(''):'<tr><td colspan="5">Nenhuma regra de SLA cadastrada.</td></tr>')+
      '</tbody></table></div>'+edicao+especiais+acoesAvancadas+
      (modoDiagnostico&&CU?.perfil==='consorcio'&&CU.consorcio_id===selectedCons?
        '<div style="border-top:1px solid #E5E7EB;padding-top:12px;margin-top:15px">'+
        '<p style="font-size:12px;color:var(--gray-500)">Homologação de isolamento: o teste tenta editar o Consórcio Beta com valores inválidos (zero dias). Nenhum prazo pode ser alterado com esses valores.</p>'+
        '<button class="btn btn-ghost" id="v19-sla-teste-consorcio" onclick="v19TestarIsolamentoConsorcio()">🔒 Testar bloqueio entre consórcios</button>'+
        '<div id="v19-sla-resultado-consorcio" style="font-size:12px;margin-top:8px"></div>'+
        '</div>':'')+
      '</div>';
    // Cadastro dos chamados é só leitura; erro aqui não impede a tela geral de SLA.
    slaChamados=[];
    slaPreview=null;
    if(isEditable&&disponiveis){
      try{
        const cs=await sbSelect('chamados','select=id,protocolo,area,tipo,status,sla_classificacao,sla_horas&consorcio_id=eq.'+
          encodeURIComponent(selectedCons)+'&arquivado_em=is.null&completed_at=is.null&sla_pausado=eq.false&status=neq.Concluído&order=created_at.desc&limit=250');
        if(Array.isArray(cs)&&selectedCons===(valid(consId)?consId:selectedCons)){
          slaChamados=cs;
          const opt=document.getElementById('v19-sla-chamado');
          if(opt&&b.isConnected){
            opt.innerHTML='<option value="">Selecione o chamado...</option>'+
              cs.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.protocolo)+' · '+
                esc(c.area)+' · '+esc(c.tipo)+' · '+esc(c.status)+'</option>').join('');
            window.v19OpcoesClassificacaoSLA();
          }
        }
      }catch(e){console.warn('[V19] Lista de chamados para classificação SLA:',e);}
    }
  }catch(e){
    b.innerHTML='<div class="card" style="color:var(--red)">'+esc(e.message)+'</div>';
  }
};

// Homologação: teste negativo com entradas invariavelmente inválidas (0 dias).
// A RPC valida perfil ANTES de validar prazos. Se perfil for bloqueado,
// retorna PERFIL_NAO_AUTORIZADO. Mesmo que o controle de perfil falhasse,
// 0 dias seriam barrados por PRAZO_EM_DIAS_INVALIDO antes de qualquer UPDATE.
window.v19TestarBloqueioSLARPC=async function(){
  if(admin()||!valid(selectedCons)||slaSaving)return;
  const btn=document.getElementById('v19-sla-teste-bloqueio');
  const campo=document.getElementById('v19-sla-resultado-bloqueio');
  if(!btn||!campo)return;
  btn.disabled=true;
  campo.textContent='Verificando restrição no Supabase V19…';
  try{
    await sbFetch('rpc/v19_salvar_sla_padrao','POST',{
      p_consorcio_id:selectedCons,p_urb_dias:0,p_rur_dias:0
    });
    campo.textContent='❌ FALHA CRÍTICA: chamada inválida aceita pelo servidor. Não prosseguir.';
    campo.style.color='var(--red)';
  }catch(e){
    const detalhe=String(e.corpo||'')+' '+String(e.message||'');
    if(/PERFIL_NAO_AUTORIZADO|CONSORCIO_NAO_AUTORIZADO/.test(detalhe)){
      campo.textContent='✅ APROVADO: o Supabase recusou a RPC para este perfil.';
      campo.style.color='var(--green)';
    }else{
      campo.textContent='⚠️ Não confirmado: o servidor retornou outro erro. Não interpretar como teste aprovado.';
      campo.style.color='var(--amber)';
      console.warn('[V19] Teste bloqueio SLA inconclusivo:',e);
    }
  }finally{
    btn.disabled=false;
  }
};
// Teste negativo isolado da homologação V19, sem modificar dados:
// Gestor do Consórcio Alfa tenta passar o UUID do Consórcio Beta para a RPC.
// Valores 0/0 são sempre inválidos. O backend deve barrar o consórcio
// ANTES de validar os valores e antes de acessar qualquer regra.
window.v19TestarIsolamentoConsorcio=async function(){
  const betaId='9674d593-7d2b-44da-8d4d-97070bc95aca';
  if(CU?.perfil!=='consorcio'||CU.consorcio_id!==selectedCons||
     !valid(selectedCons)||selectedCons===betaId||slaSaving)return;
  const btn=document.getElementById('v19-sla-teste-consorcio');
  const field=document.getElementById('v19-sla-resultado-consorcio');
  if(!btn||!field)return;
  btn.disabled=true;
  field.textContent='Verificando autorização entre consórcios no Supabase…';
  try{
    await sbFetch('rpc/v19_salvar_sla_padrao','POST',{
      p_consorcio_id:betaId,p_urb_dias:0,p_rur_dias:0
    });
    field.textContent='❌ FALHA CRÍTICA: uma solicitação inválida foi aceita pelo servidor.';
    field.style.color='var(--red)';
  }catch(e){
    const msg=String(e.corpo||'')+' '+String(e.message||'');
    if(/CONSORCIO_NAO_AUTORIZADO/.test(msg)){
      field.textContent='✅ APROVADO: o Supabase bloqueou a edição de outro consórcio.';
      field.style.color='var(--green)';
    }else{
      field.textContent='⚠️ Teste inconclusivo: o servidor respondeu com outro erro. Não considerar aprovado.';
      field.style.color='var(--amber)';
      console.warn('[V19] Diagnóstico isolamento SLA inconclusivo:',e);
    }
  }finally{
    btn.disabled=false;
  }
};
window.v19NovoSLA=function(){
  showToast('🔒 Inclusão de prazos específicos ainda não homologada; use apenas a regra geral.','aviso');
};
window.v19SalvarSLA=async function(){
  if(slaSaving)return;
  if(!admin()||!valid(selectedCons)){
    showToast('🔒 Sem permissão para editar a regra de SLA deste consórcio.','erro');return;
  }
  const padrao=rules.find(r=>r.tipo_problema==='PADRAO_GERAL');
  if(!padrao){
    showToast('🔒 Regra PADRAO_GERAL não cadastrada para este consórcio. Não repita o SQL 59, que configurou somente o Consórcio Alfa.','erro');return;
  }
  const urb=Number(document.getElementById('v19-sla-urb')?.value);
  const rur=Number(document.getElementById('v19-sla-rur')?.value);
  if(!Number.isInteger(urb)||!Number.isInteger(rur)||urb<1||rur<1||urb>365||rur>365){
    showToast('Informe prazos inteiros entre 1 e 365 dias corridos.','erro');return;
  }
  if(!window.confirm('Salvar SLA padrão deste consórcio: '+urb+
    ' dias para urbano e '+rur+' dias para rural? Chamados existentes não serão alterados.'))return;
  const btn=document.getElementById('v19-sla-salvar');
  slaSaving=true;
  if(btn){btn.disabled=true;btn.textContent='Salvando…';}
  try{
    const resultado=await sbFetch('rpc/v19_salvar_sla_padrao','POST',{
      p_consorcio_id:selectedCons,p_urb_dias:urb,p_rur_dias:rur
    });
    if(resultado?.ok!==true || resultado.consorcio_id!==selectedCons ||
       resultado.urb_dias!==urb || resultado.rur_dias!==rur)
      throw new Error('RPC não confirmou os novos prazos; atualize para consultar.');
    const b=document.getElementById('main-body');
    const t=document.getElementById('topbar-title');
    const a=document.getElementById('topbar-actions');
    showToast('✅ Prazos gerais confirmados no Supabase V19.','ok');
    await window.vSLA(b,t,a,selectedCons);
  }catch(e){
    console.error('[V19] salvar SLA geral:',e);
    showToast('❌ SLA não confirmado: '+esc(e.message),'erro');
  }finally{
    slaSaving=false;
    if(btn){btn.disabled=false;btn.textContent='💾 Salvar prazos gerais';}
  }
};

window.v19SalvarSLAEspeciais=async function(){
  if(slaSaving||!admin()||!valid(selectedCons))return;
  const d=slaEspeciais.slice(0,3).map(x=>Number(document.getElementById(x.id)?.value));
  if(d.some(n=>!Number.isInteger(n)||n<1||n>365)){
    showToast('Preencha os três prazos com números inteiros entre 1 e 365 dias.','erro');return;
  }
  if(!confirm('Salvar prazos especiais neste consórcio: '+d.join(', ')+' dias? Chamados antigos serão atualizados somente após sua confirmação na prévia.'))return;
  const id=selectedCons,btn=document.getElementById('v19-sla-salvar-especiais');
  slaSaving=true;if(btn){btn.disabled=true;btn.textContent='Salvando…';}
  try{
    const r=await sbFetch('rpc/v19_salvar_sla_especiais','POST',{
      p_consorcio_id:id,p_apagados_urb_dias:d[0],
      p_acesos_urb_dias:d[1],p_apagados_rur_dias:d[2]
    });
    if(r?.ok!==true||r.consorcio_id!==id)throw new Error('Salvamento não confirmado pelo banco.');
    showToast('✅ Prazos especiais salvos no consórcio.','ok');
    await window.vSLA(document.getElementById('main-body'),document.getElementById('topbar-title'),
      document.getElementById('topbar-actions'),id);
  }catch(e){showToast('❌ Erro no SLA especial: '+esc(e.message),'erro');}
  finally{slaSaving=false;if(btn){btn.disabled=false;btn.textContent='💾 Salvar os 3 prazos especiais';}}
};
window.v19SalvarSLAAcesasAte2=async function(){
  if(slaSaving||!admin()||!valid(selectedCons))return;
  const field=document.getElementById('v19-sla-e4');
  const days=field?.value==null||field.value.trim()===''?NaN:Number(field.value);
  if(!Number.isInteger(days)||days<1||days>365){
    showToast('Informe prazo inteiro entre 1 e 365 dias para 1 ou 2 lâmpadas acesas.','erro');return;
  }
  const id=selectedCons,btn=document.getElementById('v19-sla-salvar-ate2');
  if(!confirm('Salvar para este consórcio o prazo de '+days+' dia(s) em área urbana, quando 1 ou 2 lâmpadas estiverem acesas durante o dia? Nenhum chamado existente será modificado automaticamente.'))return;
  slaSaving=true;if(btn){btn.disabled=true;btn.textContent='Salvando…';}
  try{
    const response=await sbFetch('rpc/v19_salvar_sla_ate2_acesas_urb','POST',
      {p_consorcio_id:id,p_dias:days});
    if(response?.ok!==true||response.consorcio_id!==id||response.sla_horas!==days*24)
      throw new Error('O Supabase não confirmou o prazo solicitado.');
    showToast('✅ SLA para 1 ou 2 lâmpadas acesas salvo: '+days+' dia(s).','ok');
    await window.vSLA(document.getElementById('main-body'),
      document.getElementById('topbar-title'),document.getElementById('topbar-actions'),id);
  }catch(e){showToast('❌ Não foi possível salvar: '+esc(e.message),'erro');}
  finally{slaSaving=false;if(btn){btn.disabled=false;btn.textContent='💾 Salvar prazo para 1 ou 2 lâmpadas acesas';}}
};
window.v19OpcoesClassificacaoSLA=function(){
  const c=slaChamados.find(x=>x.id===document.getElementById('v19-sla-chamado')?.value);
  const dest=document.getElementById('v19-sla-classificacao');
  if(!dest)return;
  const validCodes=c?(c.area==='Rural'?
    ['PADRAO_GERAL','SLA3_APAGADOS_RUR']:
    ['PADRAO_GERAL','SLA3_APAGADOS_URB','SLA3_ACESOS_URB','SLA12_ACESOS_URB']):['PADRAO_GERAL'];
  dest.innerHTML=validCodes.map(key=>'<option value="'+esc(key)+'">'+
    esc(key==='PADRAO_GERAL'?'Prazo geral do chamado':
      (slaEspeciais.find(x=>x.codigo===key)?.titulo||key))+'</option>').join('');
  if(c&&validCodes.includes(c.sla_classificacao))dest.value=c.sla_classificacao;
};
window.v19ClassificarChamadoSLA=async function(){
  if(slaSaving||!admin())return;
  const item=slaChamados.find(x=>x.id===document.getElementById('v19-sla-chamado')?.value);
  const codigo=document.getElementById('v19-sla-classificacao')?.value;
  if(!item||!codigo){showToast('Selecione o chamado e a regra de SLA.','erro');return;}
  if(!confirm('Aplicar '+(slaEspeciais.find(x=>x.codigo===codigo)?.titulo||'prazo geral')+
    ' ao chamado '+item.protocolo+'? Confirme que a ocorrência corresponde à classificação escolhida.'))return;
  slaSaving=true;
  const btn=document.getElementById('v19-sla-classificar');
  if(btn)btn.disabled=true;
  const consId=selectedCons;
  try{
    const r=await sbFetch('rpc/v19_classificar_sla_chamado','POST',{
      p_chamado_id:item.id,p_classificacao:codigo
    });
    if(r?.ok!==true||r.protocolo!==item.protocolo)throw new Error('Classificação não confirmada.');
    showToast('✅ Chamado classificado: '+(r.sla_horas/24)+' dias.','ok');
    await window.vSLA(document.getElementById('main-body'),document.getElementById('topbar-title'),
      document.getElementById('topbar-actions'),consId);
  }catch(e){showToast('❌ Não foi possível aplicar: '+esc(e.message),'erro');}
  finally{slaSaving=false;if(btn)btn.disabled=false;}
};
window.v19PreverRecalculoSLA=async function(){
  if(slaSaving||!admin()||!valid(selectedCons))return;
  const field=document.getElementById('v19-sla-retro-resultado');
  const btn=document.getElementById('v19-sla-aplicar');
  slaPreview=null;if(btn)btn.style.display='none';
  if(field)field.textContent='Calculando atualização dos prazos em aberto no Supabase…';
  try{
    const id=selectedCons;
    const r=await sbFetch('rpc/v19_recalcular_sla_abertos','POST',{
      p_consorcio_id:id,p_aplicar:false
    });
    if(r?.ok!==true||r.consorcio_id!==id||r.aplicado!==false)
      throw new Error('Prévia não confirmada pelo servidor.');
    slaPreview={id,alteracoes:Number(r.alteracoes),avaliados:Number(r.avaliados)};
    if(field)field.textContent=r.avaliados+' chamado(s) aberto(s) avaliados; '+
      r.alteracoes+' terão o prazo atualizado. '+r.sem_regra+
      ' sem regra. Concluídos, arquivados e SLA pausado ficam preservados.';
    if(btn&&r.alteracoes>0)btn.style.display='inline-block';
  }catch(e){
    if(field)field.textContent='Erro ao gerar prévia: '+String(e.message);
  }
};
window.v19AplicarRecalculoSLA=async function(){
  if(slaSaving||!admin()||!slaPreview||slaPreview.id!==selectedCons)return;
  const snapshot=slaPreview;
  slaSaving=true;
  const btn=document.getElementById('v19-sla-aplicar');if(btn)btn.disabled=true;
  try{
    const atual=await sbFetch('rpc/v19_recalcular_sla_abertos','POST',{
      p_consorcio_id:snapshot.id,p_aplicar:false
    });
    if(atual?.ok!==true||Number(atual.alteracoes)!==snapshot.alteracoes||
       Number(atual.avaliados)!==snapshot.avaliados) {
      slaPreview=null;
      throw new Error('A prévia mudou. Gere uma nova antes de aplicar.');
    }
    if(!confirm('Atualizar PRAZOS de '+snapshot.alteracoes+' chamado(s) em aberto do consórcio selecionado? '+
      'Não modifica datas de abertura, chamados concluídos ou histórico.'))return;
    const r=await sbFetch('rpc/v19_recalcular_sla_abertos','POST',{
      p_consorcio_id:snapshot.id,p_aplicar:true
    });
    if(r?.ok!==true||r.aplicado!==true)throw new Error('Reprocessamento não confirmado.');
    showToast('✅ SLA atualizado em '+r.alteracoes+' chamado(s) em aberto.','ok');
    await window.vSLA(document.getElementById('main-body'),document.getElementById('topbar-title'),
      document.getElementById('topbar-actions'),snapshot.id);
  }catch(e){showToast('❌ SLA não atualizado: '+esc(e.message),'erro');}
  finally{slaSaving=false;if(btn)btn.disabled=false;}
};

console.info('[Aponte V19] Edição de SLA padrão somente via RPC autenticada.');
})();