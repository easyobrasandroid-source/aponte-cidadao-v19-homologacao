/* Login Ronda isolado do login administrativo.
   JWT apenas da conta Ronda, confirmado no servidor antes de enviar. */
(function(){
'use strict';
const KEY='v19_ronda_sessao';
const ID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
let sessao=null, perfil=null,loading=false;
const pageCons=()=>new URLSearchParams(location.search).get('consorcio_id')||'';
const input=id=>document.getElementById(id);
function el(tag,parent,text,css){const n=document.createElement(tag);if(parent)parent.appendChild(n);if(text!==undefined)n.textContent=String(text);if(css)n.style.cssText=css;return n;}
function message(text,error){const msg=input('v19-ronda-feedback');if(msg){msg.textContent=text;msg.style.color=error?'#b91c1c':'#166534';}}
function fields(on){
 const name=input('pub-nome'),tel=input('pub-tel');
 if(!name||!tel)return;
 if(on&&perfil){name.value=perfil.nome;tel.value=perfil.telefone;}
 else {name.value='';tel.value='';}
 name.readOnly=!!on;tel.readOnly=!!on;
 name.title=on?'Identidade confirmada do usuário Ronda':'';tel.title=name.title;
}
function reset(){
 sessao=null;perfil=null;
 try{sessionStorage.removeItem(KEY);}catch(_){}
 fields(false);
 const form=input('v19-ronda-login-form'),active=input('v19-ronda-ativo');
 if(form)form.style.display='flex';if(active)active.style.display='none';
 message('Use seu login Ronda para preencher nome e telefone automaticamente.',false);
}
async function me(token){
 const r=await fetch(SUPA_URL+'/rest/v1/rpc/v19_ronda_me',{method:'POST',cache:'no-store',
 headers:{apikey:SUPA_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},
 body:'{}'});
 if(!r.ok)throw Error('Cadastro Ronda não autorizado.');
 const list=await r.json();
 if(!Array.isArray(list)||list.length!==1||!ID.test(String(list[0].consorcio_id||''))||
    list[0].consorcio_id!==pageCons())throw Error('Conta Ronda não autorizada para este consórcio.');
 return list[0];
}
async function refresh(){
 if(!sessao)throw Error('Entre novamente como Ronda.');
 if(sessao.expires_at>Date.now()+65000)return sessao.access_token;
 if(!sessao.refresh_token)throw Error('Sessão de Ronda expirada.');
 const r=await fetch(SUPA_URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',
 headers:{apikey:SUPA_KEY,'Content-Type':'application/json'},
 body:JSON.stringify({refresh_token:sessao.refresh_token})});
 if(!r.ok)throw Error('Sessão de Ronda expirada; entre novamente.');
 const d=await r.json();
 sessao={access_token:d.access_token,refresh_token:d.refresh_token,expires_at:Date.now()+(d.expires_in||3600)*1000,consorcio_id:pageCons()};
 try{sessionStorage.setItem(KEY,JSON.stringify(sessao));}catch(_){}
 return sessao.access_token;
}
async function verifiedToken(){
 if(!perfil || !sessao)return null;
 try{
 const token=await refresh();
 // Verificar o vínculo no servidor em toda requisição, inclusive após desativação.
 perfil=await me(token);
 fields(true);
 return token;
 }catch(e){reset();throw Error('Sessão Ronda inválida ou expirada. Entre novamente.');}
}
window.v19RondaAccessToken=async()=>verifiedToken();
async function login(){
 if(loading)return;const email=input('v19-ronda-email'),password=input('v19-ronda-password');
 if(!email?.value||!password?.value){message('Informe e-mail e senha Ronda.',true);return;}
 loading=true;message('Autenticando conta Ronda…',false);
 try{
 const response=await fetch(SUPA_URL+'/auth/v1/token?grant_type=password',{method:'POST',
 headers:{apikey:SUPA_KEY,'Content-Type':'application/json'},
 body:JSON.stringify({email:email.value.trim(),password:password.value})});
 const body=await response.json().catch(()=>null);
 if(!response.ok||!body?.access_token)throw Error('E-mail ou senha inválidos.');
 const p=await me(body.access_token);
 sessao={access_token:body.access_token,refresh_token:body.refresh_token,
   expires_at:Date.now()+(body.expires_in||3600)*1000,consorcio_id:pageCons()};
 perfil=p;
 try{sessionStorage.setItem(KEY,JSON.stringify(sessao));}catch(_){}
 fields(true);password.value='';
 input('v19-ronda-login-form').style.display='none';
 input('v19-ronda-ativo').style.display='flex';
 input('v19-ronda-bemvindo').textContent='Ronda: '+perfil.nome;
 message('Identidade confirmada. Preencha endereço e problema. O restante do formulário público permanece igual.',false);
 }catch(e){reset();message(e.message||'Falha ao autenticar Ronda.',true);}
 finally{loading=false;}
}
async function logout(){
 if(sessao?.access_token){try{await fetch(SUPA_URL+'/auth/v1/logout',{method:'POST',
 headers:{apikey:SUPA_KEY,Authorization:'Bearer '+sessao.access_token}});}catch(_){}}
 reset();
}
function mount(){
 const at=input('v19-ronda-acesso');if(!at||!ID.test(pageCons()))return;
 at.replaceChildren();
 const panel=el('div',at,null,'border:1px solid #dbe4f0;border-radius:12px;background:#f8fafc;padding:15px;margin:12px 0;');
 const h=el('div',panel,'🚶 Acesso Ronda — abertura rápida','font-size:14px;font-weight:800;color:#164e63;margin-bottom:7px;');
 el('p',panel,'O cidadão pode continuar sem login. O acesso Ronda serve apenas para preencher nome e telefone automaticamente.','font-size:12px;color:#475569;margin:0 0 10px;');
 const f=el('div',panel,null,'display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;');f.id='v19-ronda-login-form';
 const label=(name,type,id,placeholder)=>{
  const wrap=el('label',f,null,'font-size:11px;font-weight:650;display:flex;flex-direction:column;gap:5px;flex:1;min-width:120px;');
  el('span',wrap,name);
  const inpt=el('input',wrap,null,'border:1px solid #cbd5e1;border-radius:7px;padding:9px;width:100%;');
  inpt.id=id;inpt.type=type;inpt.placeholder=placeholder;return inpt;
 };
 label('E-mail Ronda','email','v19-ronda-email','email@exemplo.com');
 const pwd=label('Senha Ronda','password','v19-ronda-password','Senha');
 pwd.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();void login();}});
 const b=el('button',f,'Entrar como Ronda','background:#1251a3;color:white;border:0;padding:10px;border-radius:8px;cursor:pointer;');
 b.type='button';b.addEventListener('click',()=>void login());
 const a=el('div',panel,null,'display:none;gap:12px;align-items:center;flex-wrap:wrap;');
 a.id='v19-ronda-ativo';el('strong',a,'Identidade Ronda confirmada').id='v19-ronda-bemvindo';
 const out=el('button',a,'Sair do acesso Ronda','padding:7px;border:1px solid #cbd5e1;border-radius:7px;background:white;cursor:pointer;');
 out.type='button';out.addEventListener('click',()=>void logout());
 el('div',panel,'Use seu login Ronda para preencher nome e telefone automaticamente.','font-size:11px;color:#475569;margin-top:10px;').id='v19-ronda-feedback';
 try{
 const raw=sessionStorage.getItem(KEY);
 if(raw){
 const val=JSON.parse(raw);
 if(val?.consorcio_id===pageCons()&&val.access_token&&val.expires_at>0){
  sessao=val;void refresh().then(me).then(p=>{
   perfil=p;fields(true);f.style.display='none';a.style.display='flex';
   input('v19-ronda-bemvindo').textContent='Ronda: '+p.nome;
   message('Conta Ronda restaurada com segurança.',false);
  }).catch(()=>reset());
 }else reset();
 }
 }catch(_){reset();}
}
document.addEventListener('DOMContentLoaded',mount,{once:true});
})();
