/* Aponte Iluminacao V19 | arquivo de chamados, portais e cadastro Ronda.
   Apenas UI; autorizacoes efetivas na RPC e na Edge. */
(function(){
'use strict';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const rolesArq=new Set(['master','consorcio','empresa']);
const rolesRonda=new Set(['master','consorcio']);
const color={bg:'#f8fafc',line:'#e2e8f0'};
function elem(tag,parent,text,style){const a=document.createElement(tag);if(parent)parent.appendChild(a);if(text!==undefined && text!==null)a.textContent=String(text);if(style)a.style.cssText=style;return a;}
function button(parent,label,click,kind='ghost'){const b=elem('button',parent,label,'padding:9px 14px;border-radius:8px;cursor:pointer;font-weight:700;font-size:12px;'+
 (kind==='danger'?'background:#fff;border:1px solid #fda4af;color:#be123c;':
  kind==='solid'?'background:#1251a3;color:#fff;border:1px solid #1251a3;':'background:#fff;border:1px solid #cbd5e1;color:#334155;'));
b.type='button';b.addEventListener('click',click);return b;}
function textField(parent,title,type='text',value='',placeholder=''){const w=elem('label',parent,null,'display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:650;flex:1;min-width:145px;');elem('span',w,title);const e=elem('input',w,null,'padding:9px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;');e.type=type;e.value=value||'';e.placeholder=placeholder;return e;}
function block(parent){return elem('div',parent,null,'background:white;border:1px solid '+color.line+';border-radius:12px;padding:16px;margin:12px 0;');}
function title(parent,label,subtitle){elem('h3',parent,label,'font-size:18px;font-weight:800;margin:0 0 8px;');if(subtitle)elem('p',parent,subtitle,'font-size:12px;color:#64748b;line-height:1.5;margin:0 0 15px;');}
function err(parent,e){elem('p',parent,String(e?.message||e),'font-size:12px;color:#b91c1c;margin-top:8px;');}
const ctx=()=>({body:document.getElementById('main-body'),title:document.getElementById('topbar-title'),actions:document.getElementById('topbar-actions')});
function canArchive(c){return !!CU&&rolesArq.has(CU.perfil)&&!!c?._supaId&&
 (CU.perfil==='master'||(CU.consorcio_id===c.consorcio_id &&
 (CU.perfil==='consorcio'||CU.empresa_id===c.empresa_id)));}
function loadArchived(){return sbFetch('chamados?arquivado_em=not.is.null&select=id,protocolo,consorcio_id,empresa_id,cidade,tipo,status,arquivado_em,arquivado_por_nome,arquivado_motivo,updated_at&order=arquivado_em.desc&limit=500');}
async function changeArchive(c,action){
 if(!canArchive(c))return;
 const archive=action==='arquivar';
 const reason=archive?window.prompt('Informe o motivo do arquivamento do protocolo '+c.protocolo+' (obrigatório):',''):null;
 if(archive&&(reason===null||reason.trim().length<3))return;
 if(!window.confirm((archive?'Arquivar':'Restaurar')+' o chamado '+c.protocolo+'? O histórico e os materiais serão preservados.'))return;
 try{
 const result=await sbFetch('rpc/v19_gerenciar_arquivamento','POST',
 {p_chamado_id:c._supaId,p_acao:action,p_atualizado_em:c.updated_at,p_motivo:reason});
 if(result?.ok!==true)throw new Error('A operação não foi confirmada no banco.');
 // Invalidar respostas GET iniciadas ANTES da operacao confirmada.
 window.v19InvalidarConsultaChamados?.();
 // Retirar imediatamente da memoria local; nao depende de nova rede.
 if(archive){
   DB.chamados=DB.chamados.filter(item=>item._supaId!==c._supaId);
   atualizarBadgeChamados();
 }
 closeDrawer();
 // Buscar novamente do banco; a view tambem inicia uma consulta fresca.
 const atualizado=await carregarChamadosDoBanco();
 if(!atualizado)showToast('Operação concluída; listagem será sincronizada novamente.','aviso');
 else showToast(archive?'Chamado arquivado com histórico preservado.':'Chamado restaurado.','ok');
 if(archive)showView('chamados');else showView('excluidos');
 }catch(e){showToast('Não foi possível '+(archive?'arquivar':'restaurar')+': '+String(e.message||e),'erro');}
}
window.v19AcoesChamadoArquivo=function(c){
 const foot=document.querySelector('#drawer .dw-footer');
 if(!foot)return;
 let b=document.getElementById('v19-arquivar-chamado');
 if(!b){b=button(foot,'🗃 Arquivar chamado',()=>{if(CC)void changeArchive(CC,'arquivar');},'danger');b.id='v19-arquivar-chamado';}
 b.style.display=canArchive(c)?'':'none';
};
async function v19MasterExcluirPermanentemente(itens){
 if(CU?.perfil!=='master'||!SB_SESSION?.access_token)return;
 if(!Array.isArray(itens)||!itens.length||itens.length>50)return;
 const count=itens.length,frase='EXCLUIR '+count;
 const aviso='ATENÇÃO: você está prestes a EXCLUIR DEFINITIVAMENTE '+count+
   (count===1?' chamado arquivado.':' chamados arquivados.')+
   '\n\nOs chamados, históricos e anexos vinculados serão removidos e não poderão ser restaurados pela interface.'+
   '\n\nO SISTEMA DEVOLVERÁ AUTOMATICAMENTE ao estoque original (empresa ou equipe de garantia) somente a quantidade efetivamente consumida e ainda não estornada. Material já estornado NÃO será devolvido novamente. Planejamentos não geram devolução.'+
   '\n\nCONFIRME SOMENTE SE OS MATERIAIS FORAM REALMENTE DEVOLVIDOS AO ESTOQUE FÍSICO (ou se eram lançamentos de teste). Se foram usados e não retornaram, cancele e regularize antes da exclusão.'+
   '\n\nRegistros mínimos de auditoria são preservados. Fotos podem exigir limpeza física posterior.'+
   '\n\nConfira se não existe obrigação legal de conservação antes de prosseguir.';
 if(!window.confirm(aviso))return;
 const digitado=window.prompt('Para confirmar a exclusão irreversível, digite exatamente:\n'+frase,'');
 if(digitado!==frase){if(digitado!==null)showToast('Confirmação não corresponde. Nenhum chamado foi excluído.','aviso');return;}
 try{
  const res=await fetch(SUPA_URL+'/functions/v1/v19-exclusao-definitiva',{
   method:'POST',cache:'no-store',credentials:'omit',
   headers:{'Content-Type':'application/json',apikey:SUPA_KEY,
    Authorization:'Bearer '+SB_SESSION.access_token},
   body:JSON.stringify({acao:'excluir',confirmacao:frase,
    devolucao_confirmada:true,
    itens:itens.map(x=>({id:x.id,updated_at:x.updated_at}))})
  });
  const data=await res.json().catch(()=>null);
  if(!res.ok||data?.ok!==true||Number(data.excluidos)!==count){
   const code=String(data?.erro||'ERRO_DESCONHECIDO');
   const messages={
    PERFIL_MASTER_OBRIGATORIO:'Apenas o Master ativo pode excluir definitivamente.',
    CHAMADO_NAO_ARQUIVADO:'Um dos chamados não está arquivado. Nenhum foi excluído.',
    VERSAO_DESATUALIZADA:'A lista foi alterada por outra pessoa. Atualize antes de excluir.',
    CHAMADO_INEXISTENTE_OU_ALTERADO:'Um dos chamados foi alterado ou já não existe. Nenhum foi excluído.',
    DEVOLUCAO_FISICA_NAO_CONFIRMADA:'Confirme que os materiais retornaram ao estoque antes de excluir.',
    MOVIMENTACAO_EMPRESA_SEM_ORIGEM_VALIDA:'Existe lançamento de material sem estoque de origem identificado. Nenhum chamado foi excluído; regularize o lançamento.',
    MOVIMENTACAO_EMPRESA_INCONSISTENTE:'O histórico de consumo e estorno está inconsistente. Nenhum chamado foi excluído.',
    ITEM_MATERIAL_E_MOVIMENTACAO_DIVERGENTES:'Quantidade do item não confere com histórico de movimentações. Nenhum chamado foi excluído.',
    DEVOLUCAO_EXCEDE_ESTOQUE_CONTRATADO:'A devolução ultrapassaria o limite do estoque contratado. Verifique se o material já foi reposto manualmente. Nenhum chamado foi excluído.',
    GARANTIA_JA_DEVOLVIDA:'Esse material de garantia já foi devolvido; confira os lançamentos.',
    SALDO_GARANTIA_FORA_LIMITE:'O saldo de garantia não comporta a devolução. Nenhum chamado foi excluído.',
    PARAMETROS_INVALIDOS:'Seleção inválida. Atualize e tente novamente.'
   };
   throw Error(messages[code]||'O servidor não confirmou a exclusão. Nenhum novo envio será feito automaticamente.');
  }
  window.v19InvalidarConsultaChamados?.();
  await carregarChamadosDoBanco();
  showToast(count+' chamado(s) excluído(s) definitivamente. Materiais devolvidos: '+
   Number(data.devolvido_empresa||0)+' ao estoque empresarial e '+
   Number(data.devolvido_garantia||0)+' ao estoque de garantia.'+
   (Number(data.fotos_pendentes)>0?' Há arquivos de foto pendentes de limpeza.':''),'ok');
  await viewArchive();
 }catch(e){
  showToast('Exclusão definitiva não confirmada: '+String(e.message||e),'erro');
 }
}
async function v19MasterLimparFotosPendentes(){
 if(CU?.perfil!=='master'||!SB_SESSION?.access_token)return;
 try{
  const r=await fetch(SUPA_URL+'/functions/v1/v19-exclusao-definitiva',{
   method:'POST',cache:'no-store',credentials:'omit',
   headers:{'Content-Type':'application/json',apikey:SUPA_KEY,
    Authorization:'Bearer '+SB_SESSION.access_token},
   body:JSON.stringify({acao:'limpar_pendentes'})
  });
  const j=await r.json().catch(()=>null);
  if(!r.ok||j?.ok!==true)throw Error(j?.erro||'Serviço indisponível');
  showToast(Number(j.fotos_pendentes)>0?
   'Ainda há '+Number(j.fotos_pendentes)+' arquivo(s) de foto pendente(s) de limpeza.':
   'Não existem arquivos de fotos pendentes de limpeza.','ok');
 }catch(e){showToast('Falha ao conferir limpeza das fotos: '+String(e.message||e),'erro');}
}
async function viewArchive(){
 const c=ctx();if(!c.body||!rolesArq.has(CU?.perfil))return;
 const master=CU.perfil==='master';
 c.title.textContent='Chamados excluídos';c.actions.replaceChildren();c.body.replaceChildren();
 const panel=block(c.body);panel.classList.add('v19-arquivo');
 title(panel,'🗃 Chamados excluídos / arquivados',
  'Os chamados arquivados não entram em contagens operacionais, relatórios ou mapas. Você pode restaurá-los. Nenhum dado de estoque é estornado automaticamente.');
 const summary=elem('div',panel,'Consultando registros…',
  'font-size:12px;color:#475569;margin-bottom:12px;');
 const toolbar=elem('div',panel,null,'display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:12px 0;');
 const listing=elem('div',panel);
 try{
  const data=await loadArchived();
  if(!Array.isArray(data))throw new Error('Lista de excluídos indisponível.');
  if(!CU?.id)return;
  const permitted=data.filter(x=>CU.perfil==='master'||(CU.consorcio_id===x.consorcio_id&&
     (CU.perfil==='consorcio'||CU.empresa_id===x.empresa_id)));
  summary.textContent='Total de excluídos visíveis para seu perfil: '+permitted.length+
    (data.length>=500?' (exibindo os 500 registros mais recentes)':'');
  if(!permitted.length){
   elem('p',listing,'Nenhum chamado arquivado.','font-size:12px;color:#64748b;');
   return;
  }
  const pageSize=25;
  let page=0;
  const selected=new Set();
  const left=elem('div',toolbar,null,
    'display:flex;gap:10px;align-items:center;flex-wrap:wrap;');
  const right=elem('div',toolbar,null,
    'display:flex;gap:9px;align-items:center;flex-wrap:wrap;');
  let selectedCount=null,deleteBtn=null;
  if(master){
   const selectAll=elem('label',left,null,
    'display:flex;gap:8px;align-items:center;font-size:12px;color:#234873;font-weight:700;cursor:pointer;');
   const check=elem('input',selectAll);check.type='checkbox';
   check.id='v19-todos-arquivados';check.style.cssText='width:17px;height:17px;accent-color:#1453a2;cursor:pointer;';
   elem('span',selectAll,'Marcar todos nesta página');
   selectedCount=elem('strong',left,'0 selecionados',
    'font-size:12px;color:#4b6482;padding:5px 9px;background:#eef5fc;border-radius:9px;');
   deleteBtn=button(right,'Excluir definitivamente (0)',
    ()=>void v19MasterExcluirPermanentemente(permitted.filter(x=>selected.has(x.id))),
    'danger');
   deleteBtn.id='v19-excluir-definitivamente';
   deleteBtn.disabled=true;deleteBtn.style.opacity='.55';
   const cleanBtn=button(right,'Conferir limpeza das fotos',
    ()=>void v19MasterLimparFotosPendentes(),'ghost');
   cleanBtn.title='Verificar se existem arquivos de fotos pendentes da remoção física';
   check.addEventListener('change',()=>{
    const current=permitted.slice(page*pageSize,(page+1)*pageSize);
    for(const x of current){if(check.checked)selected.add(x.id);else selected.delete(x.id);}
    render();
   });
  }
  const pager=elem('div',panel,null,
   'display:flex;justify-content:flex-end;align-items:center;gap:10px;flex-wrap:wrap;margin:13px 0 4px;');
  function render(){
   listing.replaceChildren();pager.replaceChildren();
   const paged=permitted.slice(page*pageSize,(page+1)*pageSize);
   for(const x of paged){
    const row=elem('div',listing,null,'padding:13px 4px;border-top:1px solid #e2e8f0;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;');
    if(master){
      const cb=elem('input',row);cb.type='checkbox';cb.checked=selected.has(x.id);
      cb.setAttribute('aria-label','Selecionar '+x.protocolo);
      cb.style.cssText='width:18px;height:18px;accent-color:#1453a2;cursor:pointer;';
      cb.addEventListener('change',()=>{
       if(cb.checked)selected.add(x.id);else selected.delete(x.id);
       render();
      });
    }
    const box=elem('div',row,null,'flex:1;min-width:200px;');
    elem('div',box,x.protocolo+' — '+x.cidade,'font-size:13px;font-weight:800;');
    elem('div',box,x.tipo+' | '+x.status,'font-size:12px;color:#475569;margin-top:4px;');
    elem('div',box,'Arquivado em '+new Date(x.arquivado_em).toLocaleString('pt-BR')+
      ' por '+(x.arquivado_por_nome||'Usuário')+' | Motivo: '+(x.arquivado_motivo||'Não informado'),
      'font-size:11px;color:#64748b;margin-top:5px;');
    button(row,'↩ Restaurar',()=>void changeArchive({_supaId:x.id,protocolo:x.protocolo,
      consorcio_id:x.consorcio_id,empresa_id:x.empresa_id,updated_at:x.updated_at},'restaurar'),'solid');
   }
   if(master){
    selectedCount.textContent=selected.size+' selecionado(s)';
    deleteBtn.textContent='🗑 Excluir definitivamente ('+selected.size+')';
    deleteBtn.disabled=selected.size===0||selected.size>50;
    deleteBtn.style.opacity=deleteBtn.disabled?'.55':'1';
    const check=document.getElementById('v19-todos-arquivados');
    if(check){
     check.checked=paged.length>0&&paged.every(x=>selected.has(x.id));
     check.indeterminate=paged.some(x=>selected.has(x.id))&&!check.checked;
    }
   }
   const pages=Math.ceil(permitted.length/pageSize);
   const prev=button(pager,'← Anterior',()=>{page=Math.max(0,page-1);render();});
   prev.disabled=page===0;
   elem('span',pager,'Página '+(page+1)+' de '+pages,
    'font-size:12px;color:#475569;');
   const next=button(pager,'Próxima →',()=>{page=Math.min(pages-1,page+1);render();});
   next.disabled=page>=pages-1;
  }
  if(master){
    elem('p',panel,'Exclusão definitiva: somente Master. Selecione um ou mais chamados arquivados. A remoção é irreversível na interface e exige confirmação digitada. Na exclusão definitiva Master, o saldo líquido ainda consumido retorna automaticamente ao estoque original. Estornos existentes são respeitados. A saída e a devolução ficam auditadas. Confirme que o material retornou fisicamente antes de excluir.',
      'font-size:11px;color:#9f1239;margin:12px 0;line-height:1.6;');
  }
  render();
 }catch(e){summary.textContent='Não foi possível consultar os excluídos.';err(panel,e);}
}
async function loginPublicLinks(){
 const root=document.getElementById('v19-links-publicos');if(!root)return;
 root.replaceChildren();
 // Apresentação recolhida por padrão; consulta pública e rotas de consórcios preservadas.
 const menu=elem('details',root);menu.className='v19-consorcios-menu';
 const summary=elem('summary',menu,'Consórcios');
 summary.setAttribute('aria-label','Mostrar consórcios com portal público');
 const wrap=elem('div',menu);wrap.className='v19-consorcios-list';
 const empty=message=>{wrap.replaceChildren();const p=elem('p',wrap,message);p.className='v19-empty-links';};
 empty('Carregando consórcios disponíveis…');
 try{
  if(!SUPA_CONFIGURADO)throw Error('Serviço indisponível.');
  const r=await fetch(SUPA_URL+'/rest/v1/rpc/v19_listar_links_portais',
   {method:'POST',cache:'no-store',headers:{apikey:SUPA_KEY,Authorization:'Bearer '+SUPA_KEY,'Content-Type':'application/json'},body:'{}'});
  if(!r.ok)throw Error('Links indisponíveis.');
  const rows=await r.json();
  if(!Array.isArray(rows))throw Error('Formato inválido.');
  wrap.replaceChildren();
  rows.forEach(x=>{
    if(!UUID.test(x.consorcio_id))return;
    const a=elem('a',wrap,x.titulo);
    a.href=location.pathname+'?consorcio_id='+encodeURIComponent(x.consorcio_id)+'&pagina=portal';
  });
  if(!wrap.children.length)empty('Nenhum portal público está disponível neste momento.');
 }catch(e){empty('Não foi possível carregar os consórcios. Utilize o endereço fornecido pelo consórcio.');}
}

async function viewLinks(){
 if(CU?.perfil!=='master')return;
 const c=ctx();c.title.textContent='Links dos portais públicos';c.actions.replaceChildren();c.body.replaceChildren();
 const panel=block(c.body);title(panel,'🔗 Links do portal — somente Master',
   'Gerencie nomes, ordem e exibição dos botões da tela de login. A página de abertura de chamados e as configurações do consórcio não são modificadas.');
 try{
  const [links,all]=await Promise.all([
    sbFetch('rpc/v19_links_portais_master','POST',{}),
    sbSelect('consorcios','select=id,nome,status&order=nome.asc')
  ]);
  if(!Array.isArray(links)||!Array.isArray(all))throw Error('Catálogo indisponível.');
  const map=new Map(links.map(x=>[x.consorcio_id,x]));
  for(const cons of all.filter(x=>x.status==='ativo')){
    const obj=map.get(cons.id),card=block(panel);
    title(card,cons.nome);
    const flex=elem('div',card,null,'display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;');
    const name=textField(flex,'Nome exibido', 'text',obj?.titulo||cons.nome);
    name.maxLength=90;
    const order=textField(flex,'Ordem','number',obj?.ordem??10);order.min='0';order.max='100000';
    const check=elem('label',flex,null,'display:flex;gap:8px;align-items:center;font-size:12px;');
    const cb=elem('input',check);cb.type='checkbox';cb.checked=obj?.ativo===true;
    elem('span',check,'Exibir na página de login');
    button(card,'💾 Salvar link',async()=>{
      try{
        const response=await sbFetch('rpc/v19_gerenciar_link_portal','POST',{
         p_consorcio_id:cons.id,p_titulo:name.value.trim(),p_ativo:cb.checked,p_ordem:Number(order.value)
        });
        if(response?.ok!==true)throw Error('Operação não confirmada');
        showToast('Link atualizado.','ok');
        loginPublicLinks();
      }catch(e){showToast('Erro ao salvar: '+e.message,'erro');}
    },'solid');
  }
 }catch(e){err(panel,e);}
}
function authHeaders(){return {'Content-Type':'application/json',apikey:SUPA_KEY,
 Authorization:'Bearer '+String(SB_SESSION?.access_token||'')};}
async function rondeFetch(body){
 if(!SB_SESSION?.access_token)throw Error('Faça login novamente.');
 const r=await fetch(SUPA_URL+'/functions/v1/v19-rondas',
   {method:'POST',cache:'no-store',headers:authHeaders(),body:JSON.stringify(body)});
 const x=await r.json().catch(()=>null);
 if(!r.ok||x?.ok!==true)throw Error(x?.erro||'Operação de Ronda não confirmada.');
 return x;
}
async function viewRondas(){
 if(!rolesRonda.has(CU?.perfil))return;
 const c=ctx();c.title.textContent='Usuários Ronda';c.actions.replaceChildren();c.body.replaceChildren();
 const panel=block(c.body);title(panel,'🚶 Acesso Ronda — portal público',
   'Cadastre fiscais que só podem abrir chamados públicos. A conta não dá acesso ao painel administrativo. O usuário receberá convite por e-mail para definir sua senha.');
 const f=elem('div',panel,null,'display:flex;gap:12px;flex-wrap:wrap;');
 const name=textField(f,'Nome completo');const email=textField(f,'E-mail para convite','email');
 const tel=textField(f,'Telefone com DDD','tel');
 const con=elem('label',f,null,'display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:650;min-width:180px;');
 elem('span',con,'Consórcio');const select=elem('select',con,null,'padding:9px;border:1px solid #cbd5e1;border-radius:8px;');
 let catalogs=[];
 try{
  const cs=await sbSelect('consorcios','select=id,nome,status&order=nome.asc');
  if(!Array.isArray(cs))throw Error('Consórcios indisponíveis');
  catalogs=cs.filter(x=>x.status==='ativo'&&
    (CU.perfil==='master'||CU.consorcio_id===x.id));
  for(const v of catalogs){const o=elem('option',select,v.nome);o.value=v.id;}
 }catch(e){err(panel,e);}
 const notices=elem('div',panel,null,'font-size:12px;margin:8px 0;');
 button(panel,'✉ Enviar convite Ronda',async()=>{
   if(!UUID.test(select.value)||name.value.trim().length<2||!email.value.includes('@')||
     tel.value.replace(/\D/g,'').length<10){notices.textContent='Informe nome, e-mail válido, telefone com DDD e consórcio.';return;}
   if(!confirm('Enviar convite de acesso Ronda para '+email.value.trim()+'?'))return;
   try{
    const ans=await rondeFetch({acao:'criar',consorcio_id:select.value,nome:name.value.trim(),
      email:email.value.trim(),telefone:tel.value.replace(/\D/g,'')});
    notices.textContent='Convite solicitado. O destinatário deverá definir sua senha pelo e-mail recebido.';
    if(ans.convite_enviado!==true)throw Error('Servidor não confirmou envio.');
    await listRondas(panel);
   }catch(e){notices.textContent='Falha no convite: '+e.message;}
 },'solid');
 await listRondas(panel);
}
async function listRondas(panel){
 let list=document.getElementById('v19-lista-rondas');
 if(!list){list=block(panel);list.id='v19-lista-rondas';}
 list.replaceChildren();title(list,'Usuários Ronda cadastrados');
 try{
  const x=await rondeFetch({acao:'listar'});
  const arr=x.rondas||[];
  if(!arr.length){elem('p',list,'Nenhum usuário Ronda cadastrado.','font-size:12px;color:#64748b;');return;}
  for(const r of arr){
    const line=elem('div',list,null,'display:flex;align-items:center;gap:12px;justify-content:space-between;padding:10px 0;border-top:1px solid #e2e8f0;flex-wrap:wrap;');
    const left=elem('div',line,null,'flex:1;min-width:200px;');
    elem('strong',left,r.nome+' ('+r.email+')');
    elem('div',left,'Telefone: '+r.telefone+' · '+(r.consorcio_nome||'Consórcio')+' · '+(r.ativo?'Ativo':'Inativo'),
      'font-size:11px;color:#64748b;margin-top:3px;');
    button(line,r.ativo?'Desativar':'Ativar',async()=>{
      if(!confirm((r.ativo?'Desativar':'Ativar')+' usuário '+r.nome+'?'))return;
      try{await rondeFetch({acao:'status',id:r.id,ativo:!r.ativo});await listRondas(panel);}
      catch(e){showToast('Falha: '+e.message,'erro');}
    });
  }
 }catch(e){err(list,e);}
}
function injectMenus(){
 const sidebar=document.querySelector('#pg-app .sb-nav');if(!sidebar)return;
 const menus=[
  {id:'v19-nav-excluidos',label:'🗃 Chamados excluídos',view:'excluidos',test:()=>rolesArq.has(CU?.perfil)},
  {id:'v19-nav-rondas',label:'🚶 Usuários Ronda',view:'rondas',test:()=>rolesRonda.has(CU?.perfil)},
  {id:'v19-nav-links',label:'🔗 Links públicos',view:'linkspublicos',test:()=>CU?.perfil==='master'}
 ];
 for(const spec of menus){
  let b=document.getElementById(spec.id);
  if(!b){b=elem('div',sidebar,spec.label,'padding:11px 15px;cursor:pointer;font-size:12px;');
   b.className='sbi';b.id=spec.id;
   b.addEventListener('click',()=>showView(spec.view,b));}
  b.style.display=spec.test()?'flex':'none';
 }
}
const originalSetup=window.setupUI;
if(typeof originalSetup==='function')window.setupUI=function(u){originalSetup(u);injectMenus();};
const originalView=window.showView;
if(typeof originalView==='function')window.showView=function(view,el){
 if(!['excluidos','rondas','linkspublicos'].includes(view))return originalView(view,el);
 document.querySelectorAll('.sbi').forEach(x=>x.classList.remove('on'));if(el)el.classList.add('on');
 if(view==='excluidos')return void viewArchive();
 if(view==='rondas')return void viewRondas();
 return void viewLinks();
};
window.v19ArquivarChamadoAtual=()=>{if(CC)void changeArchive(CC,'arquivar');};
document.addEventListener('DOMContentLoaded',()=>{void loginPublicLinks();});
})();
