/* V19 Etapa 660C: tipos de problema por consórcio. Garantia LED é fixa. */
(function(){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uuid=v=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(String(v||''));
let internoSeq=0,internoCons='',internos=[];
let publicoCons='',publicos=[];
let masterCons='',masterSeq=0,masterBusy=false;
const statusGrid=(id,mensagem)=>{
  const el=document.getElementById(id);
  if(el){el.replaceChildren();const p=document.createElement('p');p.textContent=mensagem;p.style.cssText='font-size:12px;color:var(--gray-500)';el.append(p);}
};
const lerCatalogo=async(consorcio,inativos=false)=>{
  if(!uuid(consorcio))throw new Error('Consórcio inválido para o catálogo.');
  const rows=await sbFetch('rpc/v19_listar_tipos_problema','POST',{
    p_consorcio_id:consorcio,p_incluir_inativos:!!inativos
  });
  if(!Array.isArray(rows))throw new Error('Catálogo de problemas indisponível no banco.');
  if(!rows.every(r=>r && uuid(r.id) && typeof r.nome==='string' && r.nome.length>=2 &&
    r.nome.length<=120 && typeof r.ativo==='boolean' && Number.isInteger(r.ordem)))
    throw new Error('O servidor retornou um catálogo inválido.');
  return rows;
};
function criarBotoes(grupo,items,onSelect){
  grupo.replaceChildren();
  for(const item of items){
    const btn=document.createElement('button');
    btn.type='button';btn.className='prob-opt';
    btn.style.textAlign='left';btn.style.cursor='pointer';
    const nome=document.createElement('span');nome.className='po-name';
    nome.textContent=item;btn.appendChild(nome);
    btn.addEventListener('click',()=>onSelect(btn,item));
    grupo.appendChild(btn);
  }
}
window.v19CarregarTiposInternos=async function(){
  const grid=document.getElementById('intProbGrid');
  if(!grid)return;
  const cidade=document.getElementById('int-cidade')?.value;
  const cons=DB?.cidades?.find(c=>c.id===cidade)?.consorcio_id||'';
  const seq=++internoSeq;
  internoCons='';internos=[];intProb='';
  statusGrid('intProbGrid','Carregando tipos de problema do consórcio…');
  if(!uuid(cons)){
    statusGrid('intProbGrid','Selecione um município para consultar os tipos de problema.');
    return;
  }
  try {
    const rows=(await lerCatalogo(cons)).filter(r=>r.ativo);
    if(seq!==internoSeq||!document.getElementById('intProbGrid'))return;
    if(document.getElementById('int-cidade')?.value!==cidade)return;
    if(!rows.length){
      statusGrid('intProbGrid','Este consórcio não tem tipos ativos. O Master precisa configurar o catálogo.');
      return;
    }
    internoCons=cons;internos=rows.map(r=>r.nome);
    criarBotoes(grid,internos,(btn,nome)=>{
      if(!internos.includes(nome))return;
      selInt(btn,nome);
    });
    const primeiro=grid.querySelector('.prob-opt');
    if(primeiro)selInt(primeiro,internos[0]);
  }catch(e){
    if(seq===internoSeq)statusGrid('intProbGrid','Não foi possível consultar os tipos de problema: '+e.message);
  }
};
window.v19TipoInternoAtivo=(cons,tipo)=>internoCons===cons&&internos.includes(tipo);

window.v19LimparTiposPublicos=function(){
  publicoCons='';publicos=[];pubProb='';
  statusGrid('pubProbGrid','Aguardando catálogo do consórcio…');
};
window.v19PreencherTiposPublicos=function(consorcio,tipos){
  window.v19LimparTiposPublicos();
  if(!uuid(consorcio)||!Array.isArray(tipos)||!tipos.length||
      tipos.length>100||!tipos.every(t=>typeof t==='string'&&t.trim().length>=2&&t.length<=120))
    throw new Error('Tipos de problema indisponíveis para o portal.');
  const grid=document.getElementById('pubProbGrid');
  if(!grid)throw new Error('Formulário público não encontrado.');
  publicoCons=consorcio;
  publicos=[...new Set(tipos)];
  criarBotoes(grid,publicos,(btn,nome)=>{
    if(!publicos.includes(nome))return;
    selPub(btn,nome);
    v19AtualizarBotaoPortal();
  });
  const primeiro=grid.querySelector('.prob-opt');
  if(primeiro)selPub(primeiro,publicos[0]);
};
window.v19TipoPublicoAtivo=function(){
  return publicoCons===(new URLSearchParams(location.search).get('consorcio_id')||'')&&
    publicos.includes(pubProb);
};

// Edição de chamados históricos: mantém o tipo antigo como opção "histórica"
// mesmo que não seja mais permitido selecioná-lo para novas ocorrências.
window.v19CarregarTiposEdicao=async function(c){
  const select=document.getElementById('dw-e-tipo'),bot=document.getElementById('dw-btn-salvar');
  if(!select||!c||!uuid(c.consorcio_id))return;
  const chamadoId=c._supaId;
  select.disabled=true;
  if(bot)bot.disabled=true;
  select.replaceChildren(new Option('Carregando catálogo…',''));
  try{
    const rows=(await lerCatalogo(c.consorcio_id)).filter(r=>r.ativo);
    if(CC?._supaId!==chamadoId||!select.isConnected)return;
    select.replaceChildren();
    const atual=String(c.tipo||'');
    if(atual&&!rows.some(r=>r.nome===atual))
      select.add(new Option(atual+' (tipo histórico, não disponível em novas ocorrências)',atual));
    for(const r of rows)select.add(new Option(r.nome,r.nome));
    if(!select.options.length)throw new Error('Nenhum tipo ativo neste consórcio.');
    select.value=atual;
    if(select.selectedIndex<0)select.selectedIndex=0;
    select.disabled=false;
    if(bot)bot.disabled=false;
  }catch(e){
    if(select.isConnected){
      select.replaceChildren(new Option('Catálogo indisponível; edição bloqueada',''));
      if(bot)bot.disabled=true;
      showToast('Não foi possível carregar os tipos para edição: '+e.message,'erro');
    }
  }
};

function tabelaMaster(rows){
  const tbody=document.getElementById('v19-tipos-master-tbody');
  if(!tbody)return;
  tbody.replaceChildren();
  for(const r of rows){
    const tr=document.createElement('tr');
    const tdName=document.createElement('td');
    tdName.style.padding='8px';
    const nome=document.createElement('input');nome.value=r.nome;nome.maxLength=120;
    nome.style.width='min(300px,100%)';nome.id='v19-tipo-nome-'+r.id;
    tdName.append(nome);
    const tdOrdem=document.createElement('td');tdOrdem.style.padding='8px';
    const ordem=document.createElement('input');ordem.type='number';ordem.min='0';ordem.max='9999';ordem.step='1';
    ordem.value=String(r.ordem);ordem.style.width='82px';ordem.id='v19-tipo-ordem-'+r.id;tdOrdem.append(ordem);
    const tdStatus=document.createElement('td');tdStatus.style.padding='8px';tdStatus.textContent=r.ativo?'Ativo':'Inativo';
    const tdActions=document.createElement('td');tdActions.style.padding='8px';
    const edit=document.createElement('button');edit.className='btn btn-ghost';edit.type='button';
    edit.textContent='Salvar';edit.style.margin='3px';
    edit.onclick=()=>window.v19SalvarTipoMaster('editar',r.id);
    const toggle=document.createElement('button');toggle.className='btn btn-ghost';toggle.type='button';
    toggle.textContent=r.ativo?'Desativar':'Ativar';toggle.style.margin='3px';
    toggle.onclick=()=>window.v19SalvarTipoMaster(r.ativo?'desativar':'ativar',r.id);
    tdActions.append(edit,toggle);
    tr.append(tdName,tdOrdem,tdStatus,tdActions);tbody.append(tr);
  }
}

window.v19TiposMasterPage=async function(b,t,a,consId){
  if(CU?.perfil!=='master'){
    t.textContent='Tipos de problema';a.replaceChildren();
    b.textContent='Somente o Administrador Master pode gerenciar tipos de problema.';
    return;
  }
  t.textContent='Tipos de problema por consórcio';a.replaceChildren();
  b.textContent='Carregando catálogo…';
  const seq=++masterSeq;
  try{
    const cons=await sbSelect('consorcios','select=id,nome,status&order=nome.asc');
    if(!Array.isArray(cons)||!cons.length)throw new Error('Consórcios indisponíveis.');
    const target=uuid(consId)?consId:(uuid(masterCons)?masterCons:cons[0].id);
    if(!cons.some(x=>x.id===target&&x.status==='ativo'))throw new Error('Consórcio não disponível.');
    const rows=await lerCatalogo(target,true);
    if(seq!==masterSeq||t.textContent!=='Tipos de problema por consórcio')return;
    masterCons=target;
    b.innerHTML='<div class="card" style="max-width:920px">'+
      '<p style="font-size:12px;color:var(--gray-600)">Somente o Master pode alterar os tipos. As alterações valem para todas as prefeituras, empresas e o portal do respectivo consórcio. Chamados antigos não são modificados.</p>'+
      '<label style="font-size:12px;font-weight:700">Consórcio</label><select id="v19-master-consorcio" style="margin:6px 0 16px;padding:8px;max-width:100%;width:360px">'+
      cons.filter(c=>c.status==='ativo').map(c=>'<option value="'+esc(c.id)+'"'+(c.id===target?' selected':'')+'>'+esc(c.nome)+'</option>').join('')+
      '</select>'+
      '<div style="padding:12px;margin-bottom:14px;border:1px solid #d1d5db;border-radius:8px">'+
      '<strong>⚡ Garantia LED</strong> — obrigatória e fixa em todos os consórcios. Não permite edição nem desativação. O fluxo de encaminhamento e SLA permanece o mesmo.</div>'+
      '<div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:14px">'+
      '<label>Adicionar tipo<br><input id="v19-tipo-novo" maxlength="120" placeholder="Ex.: Braço quebrado" style="padding:8px;width:250px"></label>'+
      '<label>Ordem<br><input id="v19-tipo-nova-ordem" type="number" min="0" max="9999" step="1" value="100" style="padding:8px;width:85px"></label>'+
      '<button type="button" class="btn btn-save" onclick="v19SalvarTipoMaster(\'criar\')">Adicionar</button></div>'+
      '<div style="overflow:auto"><table><thead><tr><th>Problema</th><th>Ordem</th><th>Situação</th><th>Ações</th></tr></thead><tbody id="v19-tipos-master-tbody"></tbody></table></div>'+
      '<p style="font-size:11px;color:var(--gray-500);margin-top:12px">Desativar oculta o tipo de novas ocorrências, mas preserva chamados e relatórios históricos. Ao renomear, os chamados existentes mantêm o nome anterior.</p></div>';
    document.getElementById('v19-master-consorcio').onchange=e=>{
      if(uuid(e.target.value))window.v19TiposMasterPage(b,t,a,e.target.value);
    };
    tabelaMaster(rows);
  }catch(e){
    if(seq===masterSeq)b.textContent='Não foi possível carregar o catálogo: '+e.message;
  }
};

window.v19SalvarTipoMaster=async function(acao,id){
  if(masterBusy||CU?.perfil!=='master'||!uuid(masterCons))return;
  if(acao!=='criar'&&!uuid(id))return;
  const nome=acao==='criar'?document.getElementById('v19-tipo-novo')?.value?.trim():
    document.getElementById('v19-tipo-nome-'+id)?.value?.trim();
  const rawOrdem=acao==='criar'?document.getElementById('v19-tipo-nova-ordem')?.value:
    document.getElementById('v19-tipo-ordem-'+id)?.value;
  const ordem=Number(rawOrdem);
  if(['criar','editar'].includes(acao)&&(!nome||nome.length<2||nome.length>120||
    !Number.isInteger(ordem)||ordem<0||ordem>9999)){
    showToast('Informe um nome de 2 a 120 caracteres e uma ordem de 0 a 9999.','erro');return;
  }
  if(acao==='desativar'&&!confirm('Desativar este tipo para NOVOS chamados deste consórcio? Os antigos serão preservados.'))return;
  const consorcio=masterCons,sessao=SB_SESSION?.user?.id;
  masterBusy=true;
  try{
    const result=await sbFetch('rpc/v19_gerenciar_tipo_problema','POST',{
      p_acao:acao,p_consorcio_id:consorcio,p_tipo_id:id||null,
      p_nome:['criar','editar'].includes(acao)?nome:null,
      p_ordem:['criar','editar'].includes(acao)?ordem:null
    });
    if(result?.ok!==true||result.consorcio_id!==consorcio||!uuid(result.id))
      throw new Error('O servidor não confirmou a alteração.');
    showToast('✅ Tipo atualizado e confirmado no Supabase.','ok');
    if(SB_SESSION?.user?.id===sessao&&masterCons===consorcio&&
       document.getElementById('topbar-title')?.textContent==='Tipos de problema por consórcio')
      await window.v19TiposMasterPage(document.getElementById('main-body'),
        document.getElementById('topbar-title'),document.getElementById('topbar-actions'),consorcio);
  }catch(e){
    showToast('Não foi possível alterar o catálogo: '+e.message,'erro');
  }finally{masterBusy=false;}
};
})();
