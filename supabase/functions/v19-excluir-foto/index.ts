/* Aponte Iluminacao V19: exclusao de fotografia com auditoria e limpeza Storage.
   O browser nunca recebe a chave service_role. */
const ORIGINS=new Set(["https://easyobrasandroid-source.github.io",
 "https://aponte-iluminacao.pages.dev","https://aponteiluminacao.com.br",
 "https://www.aponteiluminacao.com.br"]);
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const answer=(code:number,data:Record<string,unknown>,origin:string|null)=>
 new Response(JSON.stringify(data),{status:code,headers:{"content-type":"application/json",
  "cache-control":"no-store","vary":"Origin",
  ...(origin&&ORIGINS.has(origin)?{"access-control-allow-origin":origin}:{})}});
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin");
 if(origin&&!ORIGINS.has(origin))return answer(403,{ok:false,erro:"ORIGEM_NAO_PERMITIDA"},origin);
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{
  "access-control-allow-origin":origin||"https://aponte-iluminacao.pages.dev",
  "access-control-allow-methods":"POST,OPTIONS",
  "access-control-allow-headers":"apikey,authorization,content-type",
  "vary":"Origin"
 }});
 if(req.method!=="POST")return answer(405,{ok:false,erro:"METODO_INVALIDO"},origin);
 const base=(Deno.env.get("SUPABASE_URL")||"").replace(/\/+$/,"");
 const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!base||!service)return answer(503,{ok:false,erro:"SERVICO_NAO_CONFIGURADO"},origin);
 const bearer=req.headers.get("authorization")||"";
 if(!/^Bearer\s+\S{30,}$/i.test(bearer))return answer(401,{ok:false,erro:"NAO_AUTENTICADO"},origin);
 let payload:{foto_id?:unknown};
 try{const raw=await req.text();if(raw.length>300)throw Error("size");payload=JSON.parse(raw);}
 catch{return answer(400,{ok:false,erro:"PARAMETROS_INVALIDOS"},origin);}
 if(!UUID.test(String(payload.foto_id||"")))return answer(400,{ok:false,erro:"ID_INVALIDO"},origin);
 const live=await fetch(base+"/auth/v1/user",{headers:{apikey:service,Authorization:bearer},cache:"no-store"}).catch(()=>null);
 if(!live?.ok)return answer(401,{ok:false,erro:"SESSAO_INVALIDA"},origin);
 const authUser=await live.json().catch(()=>null);
 if(!UUID.test(String(authUser?.id||"")))return answer(401,{ok:false,erro:"SESSAO_INVALIDA"},origin);
 // A RPC valida JWT, papel, consorcio, empresa e guarda a auditoria.
 const rpc=await fetch(base+"/rest/v1/rpc/v19_marcar_foto_excluida",{method:"POST",
 headers:{apikey:service,Authorization:bearer,"Content-Type":"application/json"},
 body:JSON.stringify({p_foto_id:payload.foto_id}),cache:"no-store"}).catch(()=>null);
 if(!rpc?.ok)return answer(rpc?.status===403?403:409,
  {ok:false,erro:"EXCLUSAO_NAO_AUTORIZADA_OU_NAO_CONFIRMADA"},origin);
 const row=await rpc.json().catch(()=>null);
 if(row?.ok!==true||typeof row.storage_path!=="string"||
  !/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png|webp)$/i.test(row.storage_path))
  return answer(503,{ok:false,erro:"ARQUIVO_NAO_IDENTIFICADO"},origin);
 const objectPath=row.storage_path.split("/").map(encodeURIComponent).join("/");
 const deleted=await fetch(base+"/storage/v1/object/chamado-fotos/"+objectPath,
  {method:"DELETE",headers:{apikey:service,Authorization:"Bearer "+service},cache:"no-store"}).catch(()=>null);
 if(!deleted||(deleted.status!==404&&!deleted.ok)){
  console.error("[V19 fotos] Arquivo pendente de limpeza (metadados ja excluidos)");
  return answer(502,{ok:false,erro:"FOTO_OCULTA_LIMPEZA_PENDENTE"},origin);
 }
 return answer(200,{ok:true,excluida:true},origin);
});
