// Aponte Iluminacao: convites Ronda gerenciados apenas por Master/Consorcio.
// Todo privilegio de service_role permanece exclusivamente nesta Edge Function.
const ORIGINS=new Set([
 "https://easyobrasandroid-source.github.io",
 "https://aponte-iluminacao.pages.dev",
 "https://aponteiluminacao.com.br",
 "https://www.aponteiluminacao.com.br"
]);
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function response(status:number,body:Record<string,unknown>,origin:string|null){
 return new Response(JSON.stringify(body),{status,headers:{
  "content-type":"application/json; charset=utf-8","cache-control":"no-store",
  "vary":"Origin",...(origin&&ORIGINS.has(origin)?{"access-control-allow-origin":origin}:{})
 }});
}
const okay=(origin:string|null)=>origin===null||ORIGINS.has(origin);
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin");
 if(!okay(origin))return response(403,{ok:false,erro:"ORIGEM_INVALIDA"},origin);
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{
  "access-control-allow-origin":origin||"https://aponte-iluminacao.pages.dev",
  "access-control-allow-methods":"POST, OPTIONS",
  "access-control-allow-headers":"authorization,apikey,content-type",
  "vary":"Origin","access-control-max-age":"600"
 }});
 if(req.method!=="POST")return response(405,{ok:false,erro:"METODO_INVALIDO"},origin);
 const url=Deno.env.get("SUPABASE_URL");
 const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!service)return response(503,{ok:false,erro:"SERVICO_NAO_CONFIGURADO"},origin);
 const auth=req.headers.get("authorization")||"";
 if(!/^Bearer\s+\S{30,}$/i.test(auth))return response(401,{ok:false,erro:"NAO_AUTENTICADO"},origin);
 const base=url.replace(/\/+$/,"");
 const adminHeaders={"apikey":service,"Authorization":"Bearer "+service,"Content-Type":"application/json"};
 const userResponse=await fetch(base+"/auth/v1/user",{headers:{apikey:service,Authorization:auth},cache:"no-store"}).catch(()=>null);
 if(!userResponse?.ok)return response(401,{ok:false,erro:"SESSAO_INVALIDA"},origin);
 const authUser=await userResponse.json().catch(()=>null);
 if(!UUID.test(String(authUser?.id||"")))return response(401,{ok:false,erro:"SESSAO_INVALIDA"},origin);
 const userQuery=await fetch(base+"/rest/v1/usuarios?select=id,nome,perfil,consorcio_id,status&auth_user_id=eq."+encodeURIComponent(authUser.id)+"&limit=1",
  {headers:adminHeaders,cache:"no-store"}).catch(()=>null);
 if(!userQuery?.ok)return response(503,{ok:false,erro:"PERMISSOES_INDISPONIVEIS"},origin);
 const users=await userQuery.json().catch(()=>[]);
 const actor=Array.isArray(users)?users[0]:null;
 if(!actor||actor.status!=="ativo"||!["master","consorcio"].includes(actor.perfil))
   return response(403,{ok:false,erro:"PERFIL_NAO_AUTORIZADO"},origin);
 let body:Record<string,unknown>;
 try{
 const raw=await req.text();if(raw.length>8000)throw Error("BODY");
 const data=JSON.parse(raw);if(!data||typeof data!=="object"||Array.isArray(data))throw Error("BODY");
 body=data as Record<string,unknown>;
 }catch{return response(400,{ok:false,erro:"DADOS_INVALIDOS"},origin);}
 const action=String(body.acao||"");
 const cons=String(body.consorcio_id||"");
 const can=(id:string)=>actor.perfil==="master"||(UUID.test(id)&&id===actor.consorcio_id);
 const db=async(path:string,method="GET",payload?:unknown)=>{
  const r=await fetch(base+"/rest/v1/"+path,{method,headers:{...adminHeaders,Prefer:"return=representation"},
   ...(payload===undefined?{}:{body:JSON.stringify(payload)}),cache:"no-store"});
  const d=await r.json().catch(()=>[]);
  if(!r.ok)throw Error("BANCO_INDISPONIVEL");
  return d;
 };
 const audit=async(id:string,detail:string)=>{
  await db("auditoria","POST",{consorcio_id:id,usuario_responsavel:actor.nome,
   acao:"V19_RONDA_"+action.toUpperCase(),detalhes:detail});
 };
 try{
  if(action==="listar"){
   const filter=actor.perfil==="master"?"":"&consorcio_id=eq."+encodeURIComponent(actor.consorcio_id);
   const rows=await db("v19_rondas?select=id,nome,email,telefone,consorcio_id,ativo,created_at&order=created_at.desc"+filter);
   const consorcios=await db("consorcios?select=id,nome");
   const names=new Map((consorcios as {id:string;nome:string}[]).map(x=>[x.id,x.nome]));
   return response(200,{ok:true,rondas:(rows as {consorcio_id:string}[]).map((x)=>({...x,consorcio_nome:names.get(x.consorcio_id)||""}))},origin);
  }
  if(action==="criar"){
   const nome=typeof body.nome==="string"?body.nome.trim():"";
   const email=typeof body.email==="string"?body.email.trim().toLowerCase():"";
   const telefone=typeof body.telefone==="string"?body.telefone.replace(/\D/g,""):"";
   if(!UUID.test(cons)||!can(cons)||nome.length<2||nome.length>120||
     !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>320||
     telefone.length<10||telefone.length>13)
     return response(400,{ok:false,erro:"DADOS_INVALIDOS"},origin);
   const consorcios=await db("consorcios?select=id,nome,status&id=eq."+encodeURIComponent(cons));
   if(!consorcios[0]||consorcios[0].status!=="ativo")return response(400,{ok:false,erro:"CONSORCIO_INATIVO"},origin);
   const found=await db("v19_rondas?select=id&email=eq."+encodeURIComponent(email)+"&limit=1");
   if(found.length)return response(409,{ok:false,erro:"EMAIL_JA_CADASTRADO"},origin);
   // O convite usa a pagina oficial (fallback pages.dev). Não confia em URL enviada pelo navegador.
   const originSite=Deno.env.get("V19_RONDA_INVITE_ORIGIN")||"https://aponte-iluminacao.pages.dev";
   if(!ORIGINS.has(originSite))return response(503,{ok:false,erro:"REDIRECIONAMENTO_NAO_AUTORIZADO"},origin);
   const callback=originSite+"/?consorcio_id="+encodeURIComponent(cons)+"&pagina=portal";
   const invite=await fetch(base+"/auth/v1/invite?redirect_to="+encodeURIComponent(callback),{
    method:"POST",headers:adminHeaders,body:JSON.stringify({email}),cache:"no-store"
   });
   const invited=await invite.json().catch(()=>null);
   const authId=invited?.id||invited?.user?.id;
   if(!invite.ok||!UUID.test(String(authId||"")))
     return response(422,{ok:false,erro:"CONVITE_NAO_CONFIRMADO"},origin);
   // Auth e banco nao compartilham transacao distribuida. Falha sinaliza conciliacao.
   try{
    await db("v19_rondas","POST",[{auth_user_id:authId,consorcio_id:cons,nome,email,telefone,ativo:true,criado_por:actor.id}]);
    await audit(cons,"Cadastro com convite; ronda auth "+String(authId));
   }catch{
    return response(503,{ok:false,erro:"CONVITE_ENVIADO_CADASTRO_PENDENTE"},origin);
   }
   return response(201,{ok:true,convite_enviado:true},origin);
  }
  if(action==="status"){
   const id=String(body.id||"");
   if(!UUID.test(id)||typeof body.ativo!=="boolean")return response(400,{ok:false,erro:"DADOS_INVALIDOS"},origin);
   const rows=await db("v19_rondas?select=id,consorcio_id,ativo&id=eq."+encodeURIComponent(id)+"&limit=1");
   const row=rows[0];if(!row)return response(404,{ok:false,erro:"RONDA_NAO_ENCONTRADA"},origin);
   if(!can(row.consorcio_id))return response(403,{ok:false,erro:"ESCOPO_NAO_AUTORIZADO"},origin);
   await db("v19_rondas?id=eq."+encodeURIComponent(id),"PATCH",{ativo:body.ativo,updated_at:new Date().toISOString()});
   await audit(row.consorcio_id,"Usuario "+id+" | ativo "+body.ativo);
   return response(200,{ok:true},origin);
  }
  return response(400,{ok:false,erro:"ACAO_INVALIDA"},origin);
 }catch(e){
  console.error("[V19 ronda] Falha:",e instanceof Error?e.message:"desconhecida");
  return response(503,{ok:false,erro:"SERVICO_TEMPORARIAMENTE_INDISPONIVEL"},origin);
 }
});
