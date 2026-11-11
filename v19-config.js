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
    const rows=await sbSelect('portal_configuracoes',
      'select=*&consorcio_id=eq.'+encodeURIComponent(chosen)+'&limit=1');
    if(!Array.isArray(rows))throw new Error('A tabela portal_configuracoes não está disponível. Aplique o pacote V19 em homologação.');
    if(t.textContent!=='Configurações do portal público'||!b.isConnected)return;
    portalRow=rows[0]||{consorcio_id:chosen,portal_ativo:false,abertura_portal_ativo:false,
      consulta_protocolo_ativo:false,gps_obrigatorio:false,mostrar_empresa:false,
      notificacao_whatsapp:false,telefone_contato:'',whatsapp_contato:'',prazo_medio_texto:''};
    const check=(id,field,label,bloqueado=false)=>'<label style="display:flex;align-items:center;gap:9px;font-size:13px;padding:8px 0">'+
      '<input type="checkbox" id="'+id+'" '+(portalRow[field]?'checked':'')+
      (bloqueado?' disabled title="Ativação pendente de homologação"':'')+'> '+esc(label)+
      (bloqueado?' <span style="font-size:11px;color:var(--gray-500)">(em homologação)</span>':'')+'</label>';
    b.innerHTML='<div class="card" style="max-width:760px">'+
      '<div style="margin-bottom:18px">'+escolha(chosen,'v19MudarConsPortal')+'</div>'+
      '<h3 style="font-size:15px;margin-bottom:8px">Serviços do portal cidadão</h3>'+
      check('v19-portal-ativo','portal_ativo','Portal público ativo',true)+
      check('v19-portal-abertura','abertura_portal_ativo','Permitir abertura de chamados',true)+
      check('v19-portal-consulta','consulta_protocolo_ativo','Permitir consulta de protocolo',true)+
      check('v19-portal-gps','gps_obrigatorio','GPS obrigatório para abertura')+
      check('v19-portal-empresa','mostrar_empresa','Exibir a empresa responsável')+
      check('v19-portal-whatsapp','notificacao_whatsapp','Notificações por WhatsApp (integração pendente)',true)+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px">'+
        '<label>Telefone de contato<input id="v19-portal-telefone" style="width:100%" maxlength="40" value="'+esc(portalRow.telefone_contato||'')+'"></label>'+
        '<label>WhatsApp de contato<input id="v19-portal-numero" style="width:100%" maxlength="40" value="'+esc(portalRow.whatsapp_contato||'')+'"></label>'+
      '</div><label style="display:block;margin-top:14px">Prazo médio (texto público)<input id="v19-portal-prazo" '+
      'style="display:block;width:100%" maxlength="150" value="'+esc(portalRow.prazo_medio_texto||'')+'"></label>'+
      '<p style="font-size:11px;color:var(--gray-500);margin:14px 0">Salvar grava somente os campos permitidos pela RPC no Supabase V19. '+
      'Ativação do portal, abertura de chamados, consulta pública e notificações WhatsApp permanecem bloqueadas até homologação.</p>'+
      '<button class="btn btn-save" id="v19-portal-salvar" onclick="v19SalvarPortal()">💾 Salvar configurações</button></div>';
  }catch(e){b.innerHTML='<div class="card" style="color:var(--red)">'+esc(e.message)+'</div>';}
};

window.v19SalvarPortal=async function(){
  if(!admin()||!valid(selectedCons))return;
  const btn=document.getElementById('v19-portal-salvar');
  if(btn?.disabled)return;
  const g=id=>!!document.getElementById(id)?.checked;
  const v=id=>document.getElementById(id)?.value?.trim()||null;
  const payload={
    p_consorcio_id:selectedCons,
    p_portal_ativo:g('v19-portal-ativo'),
    p_abertura_portal_ativo:g('v19-portal-abertura'),
    p_consulta_protocolo_ativo:g('v19-portal-consulta'),
    p_gps_obrigatorio:g('v19-portal-gps'),
    p_mostrar_empresa:g('v19-portal-empresa'),
    p_notificacao_whatsapp:g('v19-portal-whatsapp'),
    p_telefone_contato:v('v19-portal-telefone'),
    p_whatsapp_contato:v('v19-portal-numero'),
    p_prazo_medio_texto:v('v19-portal-prazo')
  };
  btn.disabled=true;btn.textContent='Salvando…';
  try{
    // Não usar INSERT/PATCH direto: validações e isolamento pertencem à RPC homologada.
    const resp=await sbFetch('rpc/v19_salvar_config_portal','POST',payload);
    if(resp?.ok!==true || resp.consorcio_id!==selectedCons)
      throw new Error('A RPC não confirmou o salvamento da configuração.');
    portalRow={
      consorcio_id:selectedCons,
      portal_ativo:false,abertura_portal_ativo:false,consulta_protocolo_ativo:false,
      gps_obrigatorio:payload.p_gps_obrigatorio,
      mostrar_empresa:payload.p_mostrar_empresa,
      notificacao_whatsapp:false,
      telefone_contato:payload.p_telefone_contato,
      whatsapp_contato:payload.p_whatsapp_contato,
      prazo_medio_texto:payload.p_prazo_medio_texto,
      updated_at:new Date().toISOString()
    };
    showToast('✅ Configurações confirmadas no banco.','ok');
  }catch(e){showToast(esc(e.message),'erro');}
  finally{btn.disabled=false;btn.textContent='💾 Salvar configurações';}
};

// Configuração global de SLA. Valores em dias na UI e horas na tabela.
// As verificações efetivas de permissão são realizadas pelo backend.
let slaSaving=false;
window.vSLA=async function(b,t,a,consId){
  t.textContent='Configuração de SLA'; a.innerHTML='';
  b.innerHTML='<div class="card">Lendo prazos do Supabase…</div>';
  try{
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
      '<td style="padding:8px">'+esc(r.tipo_problema==='PADRAO_GERAL'?'Padrão geral':r.tipo_problema)+'</td>'+
      ['urb_prazo','urb_alerta','rur_prazo','rur_alerta'].map(k=>
        '<td style="padding:8px">'+esc(mostrarDias(r[k]))+'</td>').join('')+
      '</tr>';
    const isEditable=admin()&&!!padrao;
    const input=(id,h,label)=>'<label style="font-size:12px;font-weight:600;display:block">'+esc(label)+
      '<input id="'+id+'" type="number" min="1" max="365" step="1" value="'+
      esc(h==null?'':String(h/24))+'" style="margin-top:5px;width:125px;max-width:100%;padding:8px">'+
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
      (!padrao?'<p style="font-size:12px;color:var(--amber);margin-top:14px">Este consórcio ainda não possui uma regra geral de SLA. Os prazos do Consórcio Alfa não são compartilhados. Cadastre uma regra própria deste consórcio por procedimento de homologação específico.</p>':'')+
      (!admin()&&padrao?'<div style="border-top:1px solid #E5E7EB;margin-top:16px;padding-top:12px">'+
      '<p style="font-size:12px;color:var(--gray-500)">Homologação V19: este diagnóstico envia valores inválidos (0 dias) para testar se a RPC rejeita seu perfil. Nenhuma regra pode ser salva com esses valores.</p>'+
      '<button class="btn btn-ghost" id="v19-sla-teste-bloqueio" onclick="v19TestarBloqueioSLARPC()">🔒 Testar bloqueio de edição pelo banco</button>'+
      '<div id="v19-sla-resultado-bloqueio" style="font-size:12px;margin-top:8px"></div></div>':'');
    b.innerHTML='<div class="card">'+escolha(selectedCons,'v19MudarConsSLA')+
      '<p style="font-size:12px;color:var(--gray-600);margin:14px 0">'+
      '<strong>SLA em dias corridos (24 horas por dia).</strong> Inclui finais de semana e feriados. '+
      'As configurações do banco são guardadas em horas, sem arredondamento de prazo.</p>'+
      '<div style="overflow:auto"><table><thead><tr><th>Tipo de problema</th>'+
      '<th>Urbano (dias)</th><th>Alerta urbano (dias)</th>'+
      '<th>Rural (dias)</th><th>Alerta rural (dias)</th>'+
      '</tr></thead><tbody id="v19-sla-linhas">'+
      (rules.length?rules.map(row).join(''):'<tr><td colspan="5">Nenhuma regra de SLA cadastrada.</td></tr>')+
      '</tbody></table></div>'+edicao+
      (CU?.perfil==='consorcio'&&CU.consorcio_id===selectedCons?
        '<div style="border-top:1px solid #E5E7EB;padding-top:12px;margin-top:15px">'+
        '<p style="font-size:12px;color:var(--gray-500)">Homologação de isolamento: o teste tenta editar o Consórcio Beta com valores inválidos (zero dias). Nenhum prazo pode ser alterado com esses valores.</p>'+
        '<button class="btn btn-ghost" id="v19-sla-teste-consorcio" onclick="v19TestarIsolamentoConsorcio()">🔒 Testar bloqueio entre consórcios</button>'+
        '<div id="v19-sla-resultado-consorcio" style="font-size:12px;margin-top:8px"></div>'+
        '</div>':'')+
      '</div>';
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
console.info('[Aponte V19] Edição de SLA padrão somente via RPC autenticada.');
})();