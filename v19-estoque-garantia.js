/* Aponte Cidadão V19 — Etapa 790-G.
   Estoque de garantia totalmente separado do estoque das empresas.
   Acesso: garantia, consorcio e master. Escritas apenas via RPC.
   NUNCA usa public.materiais/estoques/movimentacoes empresariais. */
(function () {
'use strict';
let renderId = 0;
const allowed = new Set(['master','consorcio','garantia']);
const uuid = x => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(x||''));
const fmt = n => Number(n||0).toLocaleString('pt-BR');
function el(tag,parent,txt,css) {
  const n=document.createElement(tag);
  if(txt!==undefined&&txt!==null)n.textContent=String(txt);
  if(css)n.style.cssText=css;
  if(parent)parent.appendChild(n);
  return n;
}
function panel(parent,title,description) {
  const p=el('section',parent,null,
    'background:#fff;border:1px solid #e2e8f0;border-radius:12px;' +
    'padding:16px;margin:12px 0;');
  el('h3',p,title,'margin:0 0 6px;font-size:16px;color:#0f172a;');
  if(description)el('p',p,description,
    'font-size:12px;color:#64748b;margin:0 0 12px;line-height:1.55;');
  return p;
}
function sel(parent,items,label) {
  const wrap=el('label',parent,label,'display:flex;flex-direction:column;gap:6px;' +
    'font-size:12px;font-weight:650;min-width:170px;flex:1;');
  const x=el('select',wrap,null,
    'width:100%;padding:9px;border:1px solid #cbd5e1;border-radius:7px;');
  for(const [value,title] of items) {
    const o=el('option',x,title);o.value=String(value);
  }
  return x;
}
function inp(parent,label,type='text',max=120) {
  const wrap=el('label',parent,label,
    'display:flex;flex-direction:column;gap:6px;font-size:12px;' +
    'font-weight:650;min-width:180px;flex:1;');
  const x=el('input',wrap,null,
    'padding:9px;border:1px solid #cbd5e1;border-radius:7px;');
  x.type=type;
  if(type==='text'){x.maxLength=max;x.autocomplete='off';}
  return x;
}
function btn(parent,text) {
  const b=el('button',parent,text,
    'padding:9px 15px;border:0;background:#1454a1;color:#fff;' +
    'border-radius:8px;font-weight:650;cursor:pointer;');
  b.type='submit';return b;
}
function notify(message,error) {
  if(typeof showToast==='function')showToast(message,error?'erro':'ok');
}

window.v19EstoqueGarantia=function(body,title,actions){
  const seq=++renderId;
  const role=CU?.perfil||'';
  const session=SB_SESSION?.user?.id;
  const ownCons=CU?.consorcio_id||null;
  title.textContent='Estoque de Garantia';
  actions.replaceChildren();
  body.replaceChildren();
  const root=el('div',body,null,'max-width:1220px;margin:0 auto;');
  if(!allowed.has(role)||!session||role!=='master'&&!uuid(ownCons)){
    panel(root,'Acesso restrito',
      'Exclusivo dos perfis Garantia, Consórcio e Master com vínculo válido.');
    return;
  }
  const intro=panel(root,'Estoque exclusivo da garantia',
    'Saldo separado por consórcio e por equipe. Nenhum material ou movimento '+
    'deste módulo utiliza o estoque das empresas executoras.');
  intro.style.borderLeft='4px solid #d69d20';
  const area=el('div',root,null);
  const header=el('div',intro,null,'display:flex;gap:12px;align-items:end;flex-wrap:wrap;');
  let consChoice;
  const refresh=el('button',actions,'↻ Atualizar saldos',
    'padding:9px 12px;background:white;border:1px solid #cbd5e1;' +
    'border-radius:8px;cursor:pointer;');
  refresh.type='button';
  let chosen=uuid(ownCons)?ownCons:null;
  let saving=false;

  const alive=()=>seq===renderId&&document.getElementById('main-body')===body&&
    title.textContent==='Estoque de Garantia' &&
    SB_SESSION?.user?.id===session && CU?.perfil===role;
  const setErr=(e)=>{
    if(!alive())return;
    area.replaceChildren();
    panel(area,'Não foi possível consultar o estoque',
      'O servidor não confirmou os dados: '+String(e?.message||e));
  };
  async function mutation(payload,button){
    if(saving||!alive()||!uuid(chosen))return;
    saving=true;
    if(button)button.disabled=true;
    try {
      const result=await sbFetch('rpc/v19_garantia_gerenciar','POST',
        {p_consorcio_id:chosen,...payload});
      if(result?.ok!==true)
        throw new Error('O servidor não confirmou a operação.');
      if(!alive())return;
      notify('Movimentação ou cadastro confirmado no estoque de garantia.',false);
      await load();
    } catch(e) {
      if(alive()) {
        notify('Operação não confirmada: '+(e?.message||e),true);
        const msg=el('p',area,
          'Não repita uma movimentação com resposta incerta sem consultar o histórico. '+
          String(e?.message||''),
          'font-size:12px;color:#9a3412;padding:6px;');
        msg.setAttribute('role','alert');
      }
    } finally {saving=false;if(button)button.disabled=false;}
  }
  function confirmAction(message,payload,button){
    if(!window.confirm(message))return;
    mutation(payload,button);
  }

  function renderData(data) {
    area.replaceChildren();
    const materiais=(Array.isArray(data.materiais)?data.materiais:[]);
    const locais=(Array.isArray(data.locais)?data.locais:[]);
    const saldos=Array.isArray(data.saldos)?data.saldos:[];
    const historico=Array.isArray(data.movimentos)?data.movimentos:[];
    const currentMat=materiais.filter(m=>m.ativo);
    const currentLoc=locais.filter(l=>l.ativo).sort((a,b)=>
      (a.tipo==='central'?-1:b.tipo==='central'?1:a.nome.localeCompare(b.nome)));
    const teams=currentLoc.filter(l=>l.tipo==='equipe');
    const saldoMap=new Map(saldos.map(s=>[s.material_id+':'+s.local_id,Number(s.quantidade)]));
    const quantity=(m,l)=>saldoMap.get(m+':'+l)||0;
    const matMap=new Map(materiais.map(x=>[x.id,x.nome]));
    const locMap=new Map(locais.map(x=>[x.id,x.nome]));
    const sum=currentMat.reduce((acc,m)=>
      acc+currentLoc.reduce((v,l)=>v+quantity(m.id,l.id),0),0);
    const overview=panel(area,'Saldos por local',
      'Total atual: '+fmt(sum)+' unidades · '+currentMat.length+
      ' materiais ativos · '+teams.length+' equipes ativas.');
    const overflow=el('div',overview,null,'overflow-x:auto;');
    const table=el('table',overflow,null,'width:100%;border-collapse:collapse;font-size:13px;');
    const headerRow=el('tr',el('thead',table));
    const th=(parent,text)=>el('th',parent,text,
      'white-space:nowrap;padding:10px;border-bottom:1px solid #e2e8f0;text-align:left;');
    th(headerRow,'Material');
    currentLoc.forEach(l=>th(headerRow,l.nome+(l.tipo==='central'?' (Central)':'')));
    th(headerRow,'Total');
    const tbody=el('tbody',table);
    for(const m of currentMat) {
      const tr=el('tr',tbody);
      el('td',tr,m.nome,'padding:9px;border-bottom:1px solid #e2e8f0;font-weight:600;');
      for(const l of currentLoc)
        el('td',tr,fmt(quantity(m.id,l.id)),
          'padding:9px;border-bottom:1px solid #e2e8f0;white-space:nowrap;');
      el('td',tr,fmt(currentLoc.reduce((n,l)=>n+quantity(m.id,l.id),0)),
        'padding:9px;border-bottom:1px solid #e2e8f0;font-weight:700;');
    }
    if(!currentMat.length)
      el('tr',tbody).appendChild(el('td',null,'Nenhum material cadastrado.'));

    const movement=panel(area,'Entrada, saída e transferência',
      'Transferências podem ocorrer da central para equipes, entre equipes e de volta à central. '+
      'Cada operação registra responsável, horário, quantidade e origem/destino.');
    if(currentMat.length&&currentLoc.length) {
      const form=el('form',movement,null,
        'display:flex;flex-wrap:wrap;align-items:end;gap:12px;');
      const type=sel(form,[['transferir','Transferir'],['entrada','Adicionar (entrada)'],
        ['saida','Retirar (saída)']],'Operação');
      const mat=sel(form,currentMat.map(x=>[x.id,x.nome]),'Material');
      const orig=sel(form,currentLoc.map(x=>[x.id,x.nome]),'Origem');
      const dest=sel(form,currentLoc.map(x=>[x.id,x.nome]),'Destino');
      const amount=inp(form,'Quantidade (un.)','number');
      amount.min='1';amount.max='10000000';amount.step='1';amount.required=true;
      const obs=inp(form,'Observação (opcional)','text',500);
      const submit=btn(form,'Confirmar movimentação');
      function sync(){orig.parentElement.style.display=type.value==='entrada'?'none':'flex';
        dest.parentElement.style.display=type.value==='saida'?'none':'flex';}
      type.addEventListener('change',sync);sync();
      form.addEventListener('submit',e=>{
        e.preventDefault();
        const q=Number(amount.value);
        if(!Number.isInteger(q)||q<1||q>10000000||!window.crypto?.randomUUID) {
          notify('Informe quantidade inteira válida. A sessão precisa de conexão segura.',true);
          return;
        }
        const source=type.value==='entrada'?null:orig.value;
        const target=type.value==='saida'?null:dest.value;
        if(source&&target&&source===target){
          notify('Origem e destino precisam ser diferentes.',true);return;
        }
        if(!window.confirm('Confirmar '+type.options[type.selectedIndex].text+
          ' de '+q+' unidade(s) de '+mat.options[mat.selectedIndex].text+'?'))return;
        mutation({
          p_acao:type.value,p_material_id:mat.value,p_local_origem:source,
          p_local_destino:target,p_quantidade:q,p_operacao_id:crypto.randomUUID(),
          p_observacao:obs.value.trim()||null
        },submit);
      });
    } else el('p',movement,'Cadastre material e equipe para realizar movimentos.');

    const forms=el('div',area,null,
      'display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:12px;');
    const materialPane=panel(forms,'Adicionar material',
      'Catálogo exclusivo da garantia deste consórcio.');
    const mf=el('form',materialPane,null,'display:flex;gap:10px;flex-wrap:wrap;');
    const mn=inp(mf,'Nome do material','text',160);mn.required=true;
    const mb=btn(mf,'Adicionar material');
    mf.addEventListener('submit',e=>{e.preventDefault();
      mutation({p_acao:'material_criar',p_nome:mn.value.trim()},mb);});
    const teamPane=panel(forms,'Criar equipe de garantia',
      'Cada nova equipe inicia com saldo zero.');
    const tf=el('form',teamPane,null,'display:flex;gap:10px;flex-wrap:wrap;');
    const tn=inp(tf,'Nome da equipe','text',120);tn.required=true;
    const tb=btn(tf,'Criar equipe');
    tf.addEventListener('submit',e=>{e.preventDefault();
      mutation({p_acao:'equipe_criar',p_nome:tn.value.trim()},tb);});
    const removeMaterial=panel(forms,'Excluir material',
      'Somente material com saldo total zero. O histórico será preservado.');
    if(currentMat.length) {
      const f=el('form',removeMaterial,null,'display:flex;gap:10px;flex-wrap:wrap;');
      const choice=sel(f,currentMat.map(x=>[x.id,x.nome]),'Material');
      const b=btn(f,'Excluir material');
      f.addEventListener('submit',e=>{e.preventDefault();
        confirmAction('Excluir este material do catálogo? O histórico será preservado.',
          {p_acao:'material_excluir',p_material_id:choice.value},b);});
    }
    const removeTeam=panel(forms,'Excluir equipe',
      'A equipe precisa devolver ou retirar todos os materiais antes de ser desativada.');
    if(teams.length) {
      const f=el('form',removeTeam,null,'display:flex;gap:10px;flex-wrap:wrap;');
      const choice=sel(f,teams.map(x=>[x.id,x.nome]),'Equipe');
      const b=btn(f,'Excluir equipe');
      f.addEventListener('submit',e=>{e.preventDefault();
        confirmAction('Desativar esta equipe? O histórico será preservado.',
          {p_acao:'equipe_excluir',p_local_origem:choice.value},b);});
    }
    const hist=panel(area,'Últimas movimentações',
      'Até 100 registros, com responsável e data, inclusive carga inicial.');
    const historyScroll=el('div',hist,null,'overflow-x:auto;');
    const ht=el('table',historyScroll,null,'width:100%;font-size:12px;border-collapse:collapse;');
    const hr=el('tr',el('thead',ht));
    ['Data','Material','Operação','Origem → Destino','Quantidade','Responsável','Observação']
      .forEach(x=>th(hr,x));
    const hbody=el('tbody',ht);
    for(const x of historico) {
      const tr=el('tr',hbody);
      let date='—';try{date=new Date(x.created_at).toLocaleString('pt-BR');}catch(_){}
      [date,matMap.get(x.material_id)||'Material histórico',x.tipo,
       (locMap.get(x.origem_id)||'Entrada externa')+' → '+
         (locMap.get(x.destino_id)||'Saída externa'),
       fmt(x.quantidade),x.usuario_nome||'—',x.observacao||'']
       .forEach(v=>el('td',tr,v,
         'padding:8px;border-bottom:1px solid #e2e8f0;white-space:nowrap;'));
    }
    if(!historico.length)el('p',hist,'Ainda não há movimentações registradas.');
    // Relatório exclusivo da garantia, sem acesso a materiais das empresas.
    if(window.v19GarantiaInserirRelatorio)
      window.v19GarantiaInserirRelatorio(area,chosen);
  }

  async function load(){
    if(!alive()||!uuid(chosen))return;
    area.replaceChildren();
    panel(area,'Consultando estoque de garantia','Lendo saldos reais do Supabase V19…');
    try{
      const data=await sbFetch('rpc/v19_garantia_consultar','POST',
        {p_consorcio_id:chosen});
      if(!alive())return;
      if(data?.ok!==true||data.consorcio_id!==chosen)
        throw new Error('A RPC não retornou um estoque válido para o consórcio.');
      renderData(data);
    }catch(e){setErr(e);}
  }
  refresh.addEventListener('click',load);

  (async()=>{
    try{
      if(role==='master'){
        const list=await sbSelect('consorcios','select=id,nome,status&status=eq.ativo&order=nome.asc');
        if(!Array.isArray(list))throw new Error('Consórcios indisponíveis.');
        const opt=list.filter(x=>uuid(x.id)).map(x=>[x.id,x.nome]);
        if(!opt.length)throw new Error('Nenhum consórcio ativo encontrado.');
        chosen=opt.find(x=>/ciscapar[aã]o|ciscaparaó/i.test(x[1]))?.[0]||opt[0][0];
        consChoice=sel(header,opt,'Consórcio');
        consChoice.value=chosen;
        consChoice.addEventListener('change',()=>{
          if(saving)return;
          chosen=consChoice.value;load();
        });
      }else {
        chosen=ownCons;
        el('strong',header,'Consórcio vinculado à conta',
          'font-size:12px;color:#334155;');
      }
      if(alive())await load();
    }catch(e){setErr(e);}
  })();
};
})();