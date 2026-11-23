/* Aponte Iluminacao V19 — somente interface de acesso Ronda.
   Logon e validacao usam os endpoints atuais. Nenhuma regra do backend muda.
   O cidadao continua usando o formulario publico sem autenticar. */
(function(){
'use strict';
const KEY='v19_ronda_sessao';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const input=id=>document.getElementById(id);
const pageCons=()=>new URLSearchParams(location.search).get('consorcio_id')||'';
let sessao=null,perfil=null,loading=false,recovering=false,modal=null,trigger=null;
function el(tag,parent,text,css){
 const n=document.createElement(tag);
 if(parent)parent.appendChild(n);
 if(text!==undefined&&text!==null)n.textContent=String(text);
 if(css)n.style.cssText=css;
 return n;
}
function setMessage(text,error=false){
 const e=input('v19-ronda-feedback');
 if(!e)return;
 e.textContent=text;
 e.dataset.error=error?'true':'false';
}
function setFields(on){
 const name=input('pub-nome'),phone=input('pub-tel');
 if(!name||!phone)return;
 if(on&&perfil){name.value=perfil.nome;phone.value=perfil.telefone;}
 else{name.value='';phone.value='';}
 name.readOnly=!!on;phone.readOnly=!!on;
 name.title=on?'Identidade confirmada do usuário Ronda':'';
 phone.title=name.title;
}
function view(state){
 const login=input('v19-ronda-login-form'),active=input('v19-ronda-ativo'),recovery=input('v19-ronda-recovery-form');
 if(login)login.hidden=state!=='login';
 if(active)active.hidden=state!=='active';
 if(recovery)recovery.hidden=state!=='recovery';
 if(modal)modal.dataset.view=state;
}
function badge(){
 if(!trigger)return;
 trigger.classList.toggle('is-active',!!perfil);
 const title=trigger.querySelector('.v19-ronda-trigger-title');
 const subtitle=trigger.querySelector('.v19-ronda-trigger-subtitle');
 if(title)title.textContent=perfil?'Ronda ativa':'Acesso Ronda';
 if(subtitle)subtitle.textContent=perfil?'Identidade verificada':'Acesso rápido';
 trigger.setAttribute('aria-label',perfil?'Abrir opções de acesso Ronda autenticado':'Abrir acesso Ronda');
}
function reset(){
 sessao=null;perfil=null;
 try{sessionStorage.removeItem(KEY);}catch(_){}
 setFields(false);badge();view('login');
 setMessage('Para enviar um chamado sem preencher nome e telefone, entre com sua conta Ronda.');
}
async function me(token){
 const r=await fetch(SUPA_URL+'/rest/v1/rpc/v19_ronda_me',{
  method:'POST',cache:'no-store',headers:{
   apikey:SUPA_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'
  },body:'{}'
 });
 if(!r.ok)throw Error('Cadastro Ronda não autorizado.');
 const d=await r.json();
 if(!Array.isArray(d)||d.length!==1||!UUID.test(String(d[0].consorcio_id||''))||
  d[0].consorcio_id!==pageCons())throw Error('Conta Ronda não autorizada para este consórcio.');
 return d[0];
}
async function refresh(){
 if(!sessao)throw Error('Entre novamente como Ronda.');
 if(sessao.expires_at>Date.now()+65000)return sessao.access_token;
 if(!sessao.refresh_token)throw Error('Sessão Ronda expirada.');
 const r=await fetch(SUPA_URL+'/auth/v1/token?grant_type=refresh_token',{
  method:'POST',headers:{apikey:SUPA_KEY,'Content-Type':'application/json'},
  body:JSON.stringify({refresh_token:sessao.refresh_token})
 });
 if(!r.ok)throw Error('Sessão Ronda expirada. Entre novamente.');
 const data=await r.json();
 if(!data.access_token||!data.refresh_token)throw Error('Sessão Ronda inválida.');
 sessao={access_token:data.access_token,refresh_token:data.refresh_token,
  expires_at:Date.now()+(data.expires_in||3600)*1000,consorcio_id:pageCons()};
 try{sessionStorage.setItem(KEY,JSON.stringify(sessao));}catch(_){}
 return sessao.access_token;
}
async function verifiedToken(){
 if(!perfil||!sessao)return null;
 try{
  const token=await refresh();
  perfil=await me(token);setFields(true);badge();
  return token;
 }catch(_){
  reset();throw Error('Sua sessão Ronda expirou ou foi desativada. Entre novamente.');
 }
}
window.v19RondaAccessToken=async()=>verifiedToken();
async function login(event){
 if(event)event.preventDefault();
 if(loading)return;
 const email=input('v19-ronda-email'),password=input('v19-ronda-password');
 if(!email?.value.trim()||!password?.value){setMessage('Informe o e-mail e a senha da conta Ronda.',true);return;}
 if(!SUPA_CONFIGURADO){setMessage('Serviço de autenticação indisponível.',true);return;}
 const submit=input('v19-ronda-submit');
 loading=true;if(submit)submit.disabled=true;
 setMessage('Verificando seu acesso…');
 try{
  const response=await fetch(SUPA_URL+'/auth/v1/token?grant_type=password',{
   method:'POST',cache:'no-store',headers:{apikey:SUPA_KEY,'Content-Type':'application/json'},
   body:JSON.stringify({email:email.value.trim(),password:password.value})
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data?.access_token)throw Error('E-mail ou senha inválidos.');
  const p=await me(data.access_token);
  sessao={access_token:data.access_token,refresh_token:data.refresh_token,
   expires_at:Date.now()+(data.expires_in||3600)*1000,consorcio_id:pageCons()};
  perfil=p;
  try{sessionStorage.setItem(KEY,JSON.stringify(sessao));}catch(_){}
  setFields(true);badge();view('active');
  input('v19-ronda-bemvindo').textContent='Conectado: '+p.nome;
  password.value='';
  setMessage('Identidade confirmada. Continue preenchendo o endereço e o tipo do problema.');
  if(modal?.open)modal.close();
 }catch(e){
  // Nenhum perfil administrativo aceita o formulário Ronda.
  setMessage(e.message==='E-mail ou senha inválidos.'?e.message:'Não foi possível autorizar esta conta Ronda neste consórcio.',true);
 }finally{
  loading=false;if(submit)submit.disabled=false;
 }
}
async function logout(){
 const token=sessao?.access_token;
 reset();
 if(modal?.open)modal.close();
 if(token){
  try{await fetch(SUPA_URL+'/auth/v1/logout',{method:'POST',cache:'no-store',
   headers:{apikey:SUPA_KEY,Authorization:'Bearer '+token}});}
  catch(_){}
 }
}
function recoveryRedirect(){
 const u=new URL(location.pathname,location.origin);
 u.searchParams.set('consorcio_id',pageCons());
 u.searchParams.set('pagina','portal');
 return u.toString();
}
async function requestRecovery(event){
 if(event)event.preventDefault();
 if(recovering)return;
 const email=input('v19-ronda-recovery-email');
 const value=email?.value.trim()||'';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)||value.length>320){
  setMessage('Informe um e-mail válido para receber a recuperação.',true);return;
 }
 if(!SUPA_CONFIGURADO){setMessage('Serviço de recuperação indisponível.',true);return;}
 const btn=input('v19-ronda-recovery-submit');
 recovering=true;if(btn)btn.disabled=true;
 setMessage('Solicitando recuperação de senha…');
 try{
  // Fluxo oficial já existente do Supabase Auth, sem tabela, função ou chave nova.
  // O retorno precisa estar cadastrado na lista de Redirect URLs do projeto Auth.
  const url=SUPA_URL+'/auth/v1/recover?redirect_to='+encodeURIComponent(recoveryRedirect());
  const r=await fetch(url,{
   method:'POST',cache:'no-store',
   headers:{apikey:SUPA_KEY,'Content-Type':'application/json'},
   body:JSON.stringify({email:value})
  });
  if(!r.ok){
   if(r.status===429)throw Error('Muitas solicitações. Aguarde antes de tentar novamente.');
   throw Error('Não foi possível solicitar a recuperação agora. Verifique a configuração do endereço autorizado no Supabase Auth.');
  }
  // Mensagem neutra: não revela se existe conta com esse e-mail.
  setMessage('Se este e-mail estiver cadastrado, você receberá instruções para redefinir a senha.');
 }catch(e){setMessage(e.message||'Falha temporária na solicitação.',true);}
 finally{recovering=false;if(btn)btn.disabled=false;}
}
function openModal(){
 if(!modal)return;
 if(!modal.open){
  modal.showModal();
  trigger?.setAttribute('aria-expanded','true');
  const target=perfil?input('v19-ronda-logout'):input('v19-ronda-email');
  target?.focus();
 }
}
function closeModal(){
 if(modal?.open)modal.close();
}
function build(){
 const root=input('v19-ronda-acesso');
 if(!root||!UUID.test(pageCons()))return;
 root.replaceChildren();
 trigger=el('button',root);
 trigger.id='v19-ronda-trigger';trigger.type='button';
 trigger.className='v19-ronda-trigger';
 trigger.setAttribute('aria-haspopup','dialog');
 trigger.setAttribute('aria-expanded','false');
 const ico=el('span',trigger,'🚶');
 ico.className='v19-ronda-trigger-icon';ico.setAttribute('aria-hidden','true');
 const txt=el('span',trigger);txt.className='v19-ronda-trigger-text';
 const ttl=el('strong',txt,'Acesso Ronda');ttl.className='v19-ronda-trigger-title';
 const sub=el('span',txt,'Acesso rápido');sub.className='v19-ronda-trigger-subtitle';
 const arrow=el('span',trigger,'›');arrow.className='v19-ronda-trigger-arrow';
 trigger.addEventListener('click',openModal);
 modal=el('dialog',root);
 modal.id='v19-ronda-dialog';modal.className='v19-ronda-dialog';
 modal.setAttribute('aria-labelledby','v19-ronda-dialog-title');
 const head=el('div',modal);head.className='v19-ronda-dialog-head';
 const brand=el('div',head);brand.className='v19-ronda-dialog-brand';
 const symbol=el('span',brand,'🚶');symbol.className='v19-ronda-dialog-icon';
 const heading=el('div',brand);
 el('h2',heading,'Acesso Ronda').id='v19-ronda-dialog-title';
 el('p',heading,'Abertura rápida de chamados públicos');
 const close=el('button',head,'✕');
 close.type='button';close.className='v19-ronda-close';close.setAttribute('aria-label','Fechar janela Ronda');
 close.addEventListener('click',closeModal);
 const body=el('div',modal);body.className='v19-ronda-dialog-body';
 const form=el('form',body);
 form.id='v19-ronda-login-form';form.className='v19-ronda-form';form.noValidate=true;
 const field=(parent,title,type,id,placeholder,auto)=>{
  const label=el('label',parent);label.className='v19-ronda-field';
  el('span',label,title);
  const e=el('input',label);e.id=id;e.type=type;e.placeholder=placeholder;
  e.required=true;e.autocomplete=auto;return e;
 };
 field(form,'E-mail Ronda','email','v19-ronda-email','seu.email@exemplo.com','username');
 field(form,'Senha','password','v19-ronda-password','Digite sua senha','current-password');
 const submit=el('button',form,'Entrar como Ronda');
 submit.id='v19-ronda-submit';submit.className='v19-ronda-primary';submit.type='submit';
 form.addEventListener('submit',login);
 const forgot=el('button',form,'Esqueci minha senha');
 forgot.type='button';forgot.className='v19-ronda-forgot';
 forgot.addEventListener('click',()=>{
  input('v19-ronda-recovery-email').value=input('v19-ronda-email').value.trim();
  view('recovery');
  setMessage('Digite seu e-mail Ronda para receber instruções de redefinição de senha.');
  input('v19-ronda-recovery-email').focus();
 });
 const recovery=el('form',body);
 recovery.id='v19-ronda-recovery-form';recovery.className='v19-ronda-form';
 recovery.hidden=true;recovery.noValidate=true;
 el('h3',recovery,'Recuperar minha senha');
 el('p',recovery,'Enviaremos um link de redefinição ao e-mail informado, se estiver cadastrado.');
 field(recovery,'E-mail cadastrado','email','v19-ronda-recovery-email','seu.email@exemplo.com','email');
 const recoverSubmit=el('button',recovery,'Enviar e-mail de recuperação');
 recoverSubmit.id='v19-ronda-recovery-submit';recoverSubmit.type='submit';
 recoverSubmit.className='v19-ronda-primary';
 recovery.addEventListener('submit',requestRecovery);
 const back=el('button',recovery,'Voltar para entrar');
 back.className='v19-ronda-back';back.type='button';
 back.addEventListener('click',()=>{view('login');setMessage('Entre com seu e-mail e senha Ronda.');});
 const active=el('div',body);
 active.id='v19-ronda-ativo';active.className='v19-ronda-active';active.hidden=true;
 el('div',active,'✓ Conta Ronda verificada').className='v19-ronda-active-check';
 el('strong',active,'Ronda ativa').id='v19-ronda-bemvindo';
 el('p',active,'Nome e telefone serão preenchidos automaticamente nos seus chamados deste consórcio.');
 const out=el('button',active,'Sair da conta Ronda');out.type='button';
 out.id='v19-ronda-logout';out.className='v19-ronda-secondary';
 out.addEventListener('click',()=>void logout());
 const feedback=el('p',body,'Para enviar um chamado sem preencher nome e telefone, entre com sua conta Ronda.');
 feedback.id='v19-ronda-feedback';feedback.className='v19-ronda-feedback';
 feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
 const foot=el('p',body,'O cidadão não precisa de login para abrir um chamado.');
 foot.className='v19-ronda-dialog-note';
 modal.addEventListener('close',()=>{
  trigger?.setAttribute('aria-expanded','false');
  trigger?.focus();
 });
 modal.addEventListener('click',e=>{if(e.target===modal)closeModal();});
 badge();view('login');
 try{
  const raw=sessionStorage.getItem(KEY);
  if(raw){
   const candidate=JSON.parse(raw);
   if(candidate?.consorcio_id===pageCons()&&candidate.access_token&&candidate.expires_at>0){
    sessao=candidate;
    void refresh().then(me).then(p=>{
     perfil=p;setFields(true);badge();view('active');
     input('v19-ronda-bemvindo').textContent='Conectado: '+p.nome;
     setMessage('Conta Ronda restaurada com segurança.');
    }).catch(reset);
   }else reset();
  }
 }catch(_){reset();}
}
document.addEventListener('DOMContentLoaded',build,{once:true});
})();