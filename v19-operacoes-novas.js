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
async function viewArchive(){
 const c=ctx();if(!c.body||!rolesArq.has(CU?.perfil))return;
 c.title.textContent='Chamados excluídos';c.actions.replaceChildren();c.body.replaceChildren();
 const panel=block(c.body);title(panel,'🗃 Chamados excluídos / arquivados',
 'Os chamados arquivados não entram em contagens operacionais, relatórios ou mapas. Você pode restaurá-los. Nenhum dado de estoque é estornado automaticamente.');
 const summary=elem('div',panel,'Consultando registros…','font-size:12px;color:#475569;margin-bottom:12px;');
 const listing=elem('div',panel);
 try{
 const data=await loadArchived();
 if(!Array.isArray(data))throw new Error('Lista de excluídos indisponível.');
 const current=CU?.id;
 if(!current)return;
 summary.textContent='Total de excluídos visíveis para seu perfil: '+data.length+(data.length>=500?' (limite de exibição: 500)':'');
 if(!data.length){elem('p',listing,'Nenhum chamado arquivado.','font-size:12px;color:#64748b;');return;}
 for(const x of data){
  const can=CU.perfil==='master'||(CU.consorcio_id===x.consorcio_id&&
    (CU.perfil==='consorcio'||CU.empresa_id===x.empresa_id));
  if(!can)continue;
  const row=elem('div',listing,null,'padding:13px 3px;border-top:1px solid #e2e8f0;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;');
  const box=elem('div',row,null,'flex:1;min-width:200px;');
  elem('div',box,x.protocolo+' — '+x.cidade,'font-size:13px;font-weight:800;');
  elem('div',box,x.tipo+' | '+x.status,'font-size:12px;color:#475569;margin-top:4px;');
  elem('div',box,'Arquivado em '+new Date(x.arquivado_em).toLocaleString('pt-BR')+
   ' por '+(x.arquivado_por_nome||'Usuário')+' | Motivo: '+(x.arquivado_motivo||'Não informado'),
   'font-size:11px;color:#64748b;margin-top:5px;');
  button(row,'↩ Restaurar',()=>void changeArchive({_supaId:x.id,protocolo:x.protocolo,
    consorcio_id:x.consorcio_id,empresa_id:x.empresa_id,updated_at:x.updated_at},'restaurar'),'solid');
 }
 }catch(e){summary.textContent='Não foi possível consultar os excluídos.';err(panel,e);}
}
async function loginPublicLinks(){
 const root=document.getElementById('v19-links-publicos');if(!root)return;
 root.replaceChildren();
 const label=elem('div',root,'Abrir chamado pelo consórcio','font-size:12px;font-weight:750;margin:12px 0 8px;');
 try{
  if(!SUPA_CONFIGURADO)throw Error('Serviço indisponível.');
  const r=await fetch(SUPA_URL+'/rest/v1/rpc/v19_listar_links_portais',
   {method:'POST',cache:'no-store',headers:{apikey:SUPA_KEY,Authorization:'Bearer '+SUPA_KEY,'Content-Type':'application/json'},body:'{}'});
  if(!r.ok)throw Error('Links indisponíveis.');
  const rows=await r.json();
  if(!Array.isArray(rows))throw Error('Formato inválido.');
  const wrap=elem('div',root,null,'display:flex;flex-wrap:wrap;justify-content:center;gap:8px;');
  rows.forEach(x=>{
    if(!UUID.test(x.consorcio_id))return;
    const a=elem('a',wrap,x.titulo,'padding:10px 12px;border-radius:8px;border:1px solid #cbd5e1;color:#1251a3;font-size:12px;font-weight:800;text-decoration:none;');
    a.href=location.pathname+'?consorcio_id='+encodeURIComponent(x.consorcio_id)+'&pagina=portal';
  });
  if(!wrap.children.length)label.textContent='Portais públicos indisponíveis no momento.';
 }catch(e){label.textContent='Não foi possível listar os portais. Use o link fornecido pelo consórcio.';}
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
