/* Aponte Cidadao V19 — ETAPA 790-G.5
 * Materiais da garantia em chamados: planejamento no encaminhamento,
 * baixa apenas na conclusao atomica, e relatorio exclusivo da garantia.
 * Nenhum estoque empresarial e alterado por este modulo. */
(function(){
'use strict';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const allowed=new Set(['master','consorcio','garantia']);
const screens={encaminhar:null,concluir:null};
const fmt=n=>Number(n||0).toLocaleString('pt-BR');
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const getCallId=c=>c?._supaId;
const activeFor=(c,phase)=>!!(c && UUID.test(String(getCallId(c)||'')) &&
    allowed.has(CU?.perfil) &&
    (CU?.perfil==='master'||CU?.consorcio_id===c.consorcio_id) &&
    (phase==='concluir'||['master','consorcio'].includes(CU?.perfil)));
function el(t,at,txt,css){
 const n=document.createElement(t);
 if(txt!==undefined&&txt!==null)n.textContent=String(txt);
 if(css)n.style.cssText=css;
 if(at)at.appendChild(n);
 return n;
}
function opt(parent,value,label){
 const o=el('option',parent,label);o.value=value;return o;
}
function box(parent,txt){
 return el('div',parent,txt,'font-size:12px;color:#475569;line-height:1.5;margin-top:8px;');
}
function pick(parent,label,entries){
 const w=el('label',parent,label,'display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:600;flex:1;min-width:125px;');
 const x=el('select',w,null,'width:100%;border:1px solid #cbd5e1;padding:9px;border-radius:7px;');
 for(const [id,name] of entries) opt(x,id,name);return x;
}
function isCurrent(c,phase){
 return getCallId(CC)===getCallId(c)&&screens[phase]?.callId===getCallId(c);
}
function ensureRows(phase){
 const st=screens[phase];
 if(!st?.ready||!isCurrent(st.chamado,phase))throw new Error('Lista de materiais ainda nao foi carregada. Reabra a janela.');
 return st.rows.map(x=>({material_id:x.material_id,local_id:x.local_id,quantidade:x.quantidade}));
}
window.v19GarantiaItensEncaminhamento=function(){
 if(!activeFor(CC,'encaminhar'))return [];
 return ensureRows('encaminhar');
};
window.v19GarantiaItensConclusao=function(){
 if(!activeFor(CC,'concluir'))throw new Error('Este perfil nao pode consumir estoque da garantia.');
 const rows=ensureRows('concluir');
 const noMat=document.getElementById('v19-garantia-sem-consumo');
 if(!rows.length && !noMat?.checked)
   throw new Error('Adicione o material utilizado ou marque explicitamente que nao houve consumo.');
 return rows;
};
window.v19GarantiaCancelarTela=function(phase){
 screens[phase]=null;
};
async function editor(chamado,phase){
 const target=document.getElementById(phase==='encaminhar'
   ?'v19-garantia-encaminhamento-materiais':'v19-garantia-conclusao-materiais');
 if(!target)return;
 target.replaceChildren();
 if(!activeFor(chamado,phase)){target.style.display='none';screens[phase]=null;return;}
 target.style.display='block';
 const state={callId:getCallId(chamado),chamado,phase,ready:false,rows:[],saving:false};
 screens[phase]=state;
 const wrapper=el('div',target,null,'border:1px solid #fcd34d;border-radius:10px;padding:12px;margin-top:14px;background:#fffbeb;');
 el('div',wrapper,phase==='encaminhar'?'⚡ Materiais previstos para a garantia':
   '⚡ Materiais utilizados nesta garantia','font-size:13px;font-weight:800;color:#92400e;');
 box(wrapper,phase==='encaminhar'
  ?'Selecione a equipe, material e quantidade. Esta previsao sera salva com o encaminhamento, sem baixar estoque. A baixa real so acontece ao concluir.'
  :'Selecione de qual equipe sairam os materiais efetivamente utilizados. O estoque sera baixado apenas ao confirmar a conclusao.');
 const msg=box(wrapper,'Consultando estoque de garantia...');
 try{
  const [stock,pre]=await Promise.all([
   sbFetch('rpc/v19_garantia_consultar','POST',{p_consorcio_id:chamado.consorcio_id}),
   phase==='concluir'?sbFetch('rpc/v19_garantia_consultar_planejamento','POST',
      {p_chamado_id:getCallId(chamado)}):Promise.resolve({ok:true,itens:[]})
  ]);
  if(screens[phase]!==state || getCallId(CC)!==getCallId(chamado))return;
  if(stock?.ok!==true||stock.consorcio_id!==chamado.consorcio_id||pre?.ok!==true)
   throw new Error('Retorno do banco nao confirmou o estoque ou a previsao.');
  const items=(stock.materiais||[]).filter(x=>x.ativo);
  const teams=(stock.locais||[]).filter(x=>x.ativo&&x.tipo==='equipe');
  const saldo=new Map((stock.saldos||[]).map(x=>
    [String(x.material_id)+'|'+String(x.local_id),Number(x.quantidade)||0]));
  state.rows=(pre.itens||[]).map(x=>({
    material_id:x.material_id,local_id:x.local_id,quantidade:Number(x.quantidade)
  }));
  const mm=new Map(items.map(x=>[x.id,x.nome]));
  const lm=new Map(teams.map(x=>[x.id,x.nome]));
  msg.textContent=items.length&&teams.length?
    'Selecione os itens abaixo. Equipes sem saldo podem receber materiais por transferencia no modulo Estoque de Garantia.':
    'Nenhum material ou equipe ativo no estoque de garantia deste consorcio.';
  const f=el('div',wrapper,null,'display:flex;gap:9px;flex-wrap:wrap;align-items:end;margin-top:10px;');
  const team=pick(f,'Equipe executora',teams.map(x=>[x.id,x.nome]));
  const material=pick(f,'Material de garantia',items.map(x=>[x.id,x.nome]));
  const qtyW=el('label',f,'Quantidade','display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:600;min-width:85px;flex:0.6;');
  const quantity=el('input',qtyW,null,'width:100%;border:1px solid #cbd5e1;padding:9px;border-radius:7px;');
  quantity.type='number';quantity.min='1';quantity.step='1';quantity.max='10000000';quantity.value='1';
  const add=el('button',f,'+ Adicionar','padding:9px 10px;border:0;border-radius:7px;background:#b45309;color:white;font-size:12px;font-weight:700;cursor:pointer;');
  add.type='button';add.disabled=!teams.length||!items.length;
  const avail=box(wrapper,'');
  const list=el('div',wrapper,null,'margin-top:8px;');
  const notice=box(wrapper,'');
  function availability(){
    const available=saldo.get(material.value+'|'+team.value)||0;
    const planned=state.rows.filter(x=>x.material_id===material.value&&x.local_id===team.value)
      .reduce((a,x)=>a+x.quantidade,0);
    avail.textContent='Saldo atual da equipe para este material: '+fmt(available)+
      ' unidade(s)'+(planned?' | Na lista: '+fmt(planned):'');
  }
  function redraw(){
    list.replaceChildren();
    if(!state.rows.length)el('div',list,'Nenhum material selecionado.',
      'padding:8px;font-size:12px;color:#64748b;');
    state.rows.forEach((x,i)=>{
      const row=el('div',list,null,
        'display:flex;justify-content:space-between;gap:8px;align-items:center;'+
        'padding:8px;border-bottom:1px solid #fde68a;font-size:12px;');
      el('span',row,fmt(x.quantidade)+'× '+(mm.get(x.material_id)||'Material')+
        ' — '+(lm.get(x.local_id)||'Equipe'));
      const del=el('button',row,'Remover',
        'background:transparent;border:0;color:#b91c1c;cursor:pointer;');
      del.type='button';
      del.addEventListener('click',()=>{state.rows.splice(i,1);redraw();});
    });
    if(phase==='concluir'){
      let check=document.getElementById('v19-garantia-sem-consumo');
      if(!check){
        const lbl=el('label',wrapper,null,
          'display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;font-weight:650;');
        check=el('input',lbl);check.id='v19-garantia-sem-consumo';check.type='checkbox';
        el('span',lbl,'Concluir sem consumo de material de garantia');
      }
      check.disabled=state.rows.length>0;
      if(state.rows.length>0)check.checked=false;
    }
    availability();
  }
  for(const s of [team,material])s.addEventListener('change',availability);
  add.addEventListener('click',()=>{
    if(!state.ready||!UUID.test(material.value)||!UUID.test(team.value))return;
    const q=Number(quantity.value);
    if(!Number.isInteger(q)||q<1||q>10000000){
      notice.textContent='Informe quantidade inteira positiva.';return;
    }
    const exists=state.rows.find(x=>x.material_id===material.value&&x.local_id===team.value);
    if(exists){notice.textContent='Este material e equipe ja foram adicionados. Remova para alterar.';return;}
    if(state.rows.length>=30){notice.textContent='Limite de 30 linhas de material.';return;}
    state.rows.push({material_id:material.value,local_id:team.value,quantidade:q});
    notice.textContent='Item adicionado à lista.';
    redraw();
  });
  if(phase==='concluir'){
    const save=el('button',wrapper,'💾 Salvar previsão sem concluir chamado',
      'margin-top:10px;padding:9px 12px;background:white;border:1px solid #d97706;'+
      'border-radius:7px;color:#92400e;font-size:12px;font-weight:700;cursor:pointer;');
    save.type='button';
    save.addEventListener('click',async()=>{
      if(!state.ready||state.saving)return;
      if(!window.confirm('Salvar apenas a previsao de materiais? Nenhum estoque sera baixado e o chamado nao sera concluido.'))return;
      state.saving=true;save.disabled=true;
      try{
        const res=await sbFetch('rpc/v19_garantia_planejar','POST',{
          p_chamado_id:getCallId(chamado),p_atualizado_em:chamado.updated_at,
          p_itens:ensureRows('concluir')
        });
        if(res?.ok!==true)throw new Error('A previsao nao foi confirmada pelo servidor.');
        notice.textContent='✅ Previsão salva. O estoque ainda não foi baixado.';
        showToast('Previsão de garantia salva, sem baixa de estoque.','ok');
      }catch(e){notice.textContent='Falha ao salvar previsao: '+String(e.message);
        showToast('Previsão não confirmada: '+e.message,'erro');}
      finally{state.saving=false;save.disabled=false;}
    });
  }
  state.ready=true;redraw();
 }catch(e){
  state.ready=false;
  msg.textContent='Não foi possível consultar o estoque de garantia: '+String(e?.message||e);
 }
}
window.v19GarantiaPrepararEncaminhamento=c=>editor(c,'encaminhar');
window.v19GarantiaPrepararConclusao=c=>editor(c,'concluir');

// Relatorio exclusivo da garantia, acoplado ao fim da pagina de estoque.
window.v19GarantiaInserirRelatorio=async function(root,consorcioId){
 if(!root||!UUID.test(String(consorcioId||''))||!allowed.has(CU?.perfil))return;
 const session=SB_SESSION?.user?.id;
 const role=CU?.perfil;
 if(role!=='master'&&CU?.consorcio_id!==consorcioId)return;
 const section=el('section',root,null,
   'background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:12px 0;');
 el('h3',section,'📋 Relatório de materiais utilizados em chamados de garantia',
   'font-size:16px;margin:0 0 8px;color:#0f172a;');
 const description=box(section,'Fonte: baixas efetivas do estoque de garantia vinculadas a protocolos. Sem movimentações empresariais.');
 const content=el('div',section,'Consultando baixas por chamado...',
   'font-size:12px;color:#64748b;margin-top:10px;');
 try{
  const data=await sbFetch('rpc/v19_garantia_relatorio_consumos','POST',
      {p_consorcio_id:consorcioId});
  if(!section.isConnected||SB_SESSION?.user?.id!==session||CU?.perfil!==role)return;
  if(data?.ok!==true||data.consorcio_id!==consorcioId||!Array.isArray(data.consumos))
    throw new Error('A consulta não confirmou o relatório de garantia.');
  content.replaceChildren();
  const records=data.consumos;
  const filters=el('div',content,null,
    'display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin:12px 0;');
  const fromW=el('label',filters,'De',
    'font-size:12px;display:flex;flex-direction:column;gap:4px;');
  const from=el('input',fromW);from.type='date';from.style.cssText='padding:8px;border:1px solid #cbd5e1;border-radius:7px;';
  const toW=el('label',filters,'Até',
    'font-size:12px;display:flex;flex-direction:column;gap:4px;');
  const to=el('input',toW);to.type='date';to.style.cssText=from.style.cssText;
  const eqs=[...new Set(records.map(r=>r.equipe).filter(Boolean))].sort();
  const mats=[...new Set(records.map(r=>r.material).filter(Boolean))].sort();
  const selEq=pick(filters,'Equipe',[['','Todas as equipes'],...eqs.map(s=>[s,s])]);
  const selMat=pick(filters,'Material',[['','Todos os materiais'],...mats.map(s=>[s,s])]);
  const run=el('div',content,null,'margin:10px 0;font-weight:600;font-size:12px;color:#334155;');
  const actions=el('div',content,null,'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;');
  const exp=el('button',actions,'⬇ Exportar para Excel (CSV)',
    'padding:9px 11px;border:1px solid #cbd5e1;background:white;border-radius:7px;cursor:pointer;');
  exp.type='button';
  const pdf=el('button',actions,'🖨 Imprimir / salvar PDF',
    'padding:9px 11px;border:1px solid #cbd5e1;background:white;border-radius:7px;cursor:pointer;');
  pdf.type='button';
  const tableWrap=el('div',content,null,'overflow-x:auto;');
  const table=el('table',tableWrap,null,'width:100%;font-size:12px;border-collapse:collapse;');
  const headers=['Data da baixa','Protocolo','Município','Endereço','Equipe','Material',
    'Qtd.','Responsável','Defeito / observação técnica','Status','Conclusão'];
  const head=el('tr',el('thead',table));
  for(const h of headers)el('th',head,h,
    'text-align:left;white-space:nowrap;padding:8px;border-bottom:2px solid #e2e8f0;');
  const body=el('tbody',table);
  const dateFmt=x=>x?new Date(x).toLocaleString('pt-BR'):'—';
  const datarow=x=>[
    dateFmt(x.data_baixa),x.protocolo,x.municipio,
    [x.endereco,x.bairro].filter(Boolean).join(' / '),
    x.equipe,x.material,x.quantidade,x.responsavel,x.garantia_obs||'—',x.status_chamado,dateFmt(x.data_conclusao)
  ];
  let filtered=[];
  function draw(){
    filtered=records.filter(x=>{
      const dt=String(x.data_baixa||'').slice(0,10);
      return (!from.value||dt>=from.value)&&(!to.value||dt<=to.value)&&
       (!selEq.value||x.equipe===selEq.value)&&
       (!selMat.value||x.material===selMat.value);
    });
    const total=filtered.reduce((n,x)=>n+Number(x.quantidade||0),0);
    const protocols=new Set(filtered.map(x=>x.chamado_id)).size;
    run.textContent=fmt(filtered.length)+' baixas registradas · '+
      fmt(total)+' unidades consumidas · '+fmt(protocols)+' chamados atendidos'+
      (records.length===2000?' · Limite de 2.000 registros; consultar período completo no banco.':'');
    body.replaceChildren();
    for(const r of filtered){
      const tr=el('tr',body);
      datarow(r).forEach((cell,i)=>el('td',tr,cell,
        'padding:8px;border-bottom:1px solid #e2e8f0;'+
        (i===1?'font-weight:700;':'')+'white-space:nowrap;'));
    }
    if(!filtered.length)el('td',el('tr',body),'Nenhum consumo de garantia para os filtros selecionados.',
      'padding:12px;color:#64748b;');
  }
  for(const i of [from,to,selEq,selMat])i.addEventListener('change',draw);
  function exportRows(){
    return [headers,...filtered.map(datarow)];
  }
  function cellSafe(x){
    let s=String(x??'');
    if(/^[=+\-@\t\r]/.test(s))s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  }
  exp.addEventListener('click',()=>{
    const txt='\uFEFF'+exportRows().map(x=>x.map(cellSafe).join(';')).join('\r\n');
    const url=URL.createObjectURL(new Blob([txt],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;
    a.download='estoque-garantia-consumos-'+consorcioId+'.csv';
    a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  pdf.addEventListener('click',()=>{
    const pop=window.open('','_blank');
    if(!pop){showToast('Permita pop-ups para imprimir o relatório.','aviso');return;}
    const html='<html><head><meta charset="utf-8"><title>Relatório de garantia</title>'+
     '<style>body{font-family:Arial,sans-serif;padding:20px;font-size:11px}'+
     'table{border-collapse:collapse;width:100%}th,td{padding:5px;border:1px solid #bbb;text-align:left}'+
     'th{background:#eee}h1{font-size:17px}@page{size:A4 landscape;margin:12mm}</style></head><body>'+
     '<h1>Estoque de Garantia — baixas por chamado</h1>'+
     '<p>'+escape(run.textContent)+'</p><table><thead><tr>'+
     headers.map(h=>'<th>'+escape(h)+'</th>').join('')+'</tr></thead><tbody>'+
     filtered.map(x=>'<tr>'+datarow(x).map(y=>'<td>'+escape(y)+'</td>').join('')+'</tr>').join('')+
     '</tbody></table></body></html>';
    pop.document.open();pop.document.write(html);pop.document.close();
    pop.focus();pop.print();
  });
  draw();
 }catch(e){
  content.textContent='Relatório de garantia indisponível: '+String(e.message||e);
 }
};

// Consulta de material da garantia na aba Materiais do chamado.
window.v19GarantiaMostrarConsumoChamado=async function(chamado){
 const target=document.getElementById('dw-garantia-materiais-chamado');
 if(!target)return;
 target.replaceChildren();
 if(!chamado||!allowed.has(CU?.perfil)||
    (CU?.perfil!=='master'&&CU?.consorcio_id!==chamado.consorcio_id))return;
 if(chamado.garantia_tipo!=='LED'&&chamado.status!=='Aguardando Garantia LED')return;
 el('h4',target,'⚡ Materiais da garantia',
   'font-size:13px;margin:16px 0 8px;border-top:1px solid #e2e8f0;padding-top:12px;');
 const msg=el('p',target,'Consultando consumos da garantia...',
   'font-size:12px;color:#64748b;');
 try{
  const r=await sbFetch('rpc/v19_garantia_relatorio_consumos','POST',
    {p_consorcio_id:chamado.consorcio_id});
  if(!target.isConnected||getCallId(CC)!==getCallId(chamado))return;
  if(r?.ok!==true||!Array.isArray(r.consumos))throw new Error('Consulta nao confirmada.');
  const rows=r.consumos.filter(x=>x.chamado_id===getCallId(chamado));
  if(!rows.length){msg.textContent='Nenhum material da garantia consumido neste chamado.';return;}
  msg.textContent='Consumos efetivamente baixados do estoque exclusivo da garantia:';
  for(const x of rows){
    el('p',target,fmt(x.quantidade)+'× '+x.material+' | '+x.equipe+
      ' | '+new Date(x.data_baixa).toLocaleString('pt-BR')+' | '+x.responsavel,
      'padding:6px;font-size:12px;border-bottom:1px solid #e2e8f0;');
  }
 }catch(e){msg.textContent='Nao foi possivel carregar os consumos da garantia: '+String(e.message||e);}
};
})();
