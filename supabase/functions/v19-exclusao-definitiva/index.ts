// Aponte Iluminacao V19: exclusao definitiva de chamados arquivados.
// Exclusivamente MASTER ativo; JWT real verificado no Supabase Auth.
// Dados excluidos em transacao via RPC restrita a service_role.
// Exclusao fisica de fotos feita pela Storage API (nunca DELETE em storage.objects).
const ORIGENS=new Set([
 "https://aponteiluminacao.com.br",
 "https://www.aponteiluminacao.com.br",
 "https://aponte-iluminacao.pages.dev",
 "https://easyobrasandroid-source.github.io",
]);
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const MAX_BODY=24000;
function response(status:number,payload:Record<string,unknown>,origin:string|null){
 return new Response(JSON.stringify(payload),{status,headers:{
  "content-type":"application/json;charset=utf-8",
  "cache-control":"no-store",
  "vary":"Origin",
  ...(origin&&ORIGENS.has(origin)?{"access-control-allow-origin":origin}:{})
 }});
}
function looksSafePath(path:string){
 return !!path&&path.length<=800&&!path.startsWith("/")&&
  !path.split("/").some(x=>!x||x==="."||x==="..")&&!path.includes("\\");
}
function statusForCode(code:string){
 if(code==="PERFIL_MASTER_OBRIGATORIO")return 403;
 if(code==="NAO_AUTENTICADO"||code==="SESSAO_INVALIDA")return 401;
 if(["VERSAO_DESATUALIZADA","CHAMADO_NAO_ARQUIVADO","CHAMADO_INEXISTENTE_OU_ALTERADO","CHAMADO_COM_ESTOQUE_OU_GARANTIA","DEVOLUCAO_EXCEDE_ESTOQUE_CONTRATADO",
 "MOVIMENTACAO_EMPRESA_INCONSISTENTE","ITEM_MATERIAL_E_MOVIMENTACAO_DIVERGENTES"].some(k=>code.startsWith(k)))return 409;
 return 400;
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin");
 if(origin&&!ORIGENS.has(origin))return response(403,{ok:false,erro:"ORIGEM_INVALIDA"},origin);
 if(req.method==="OPTIONS"){
  return new Response(null,{status:204,headers:{
   "access-control-allow-origin":origin||"https://aponteiluminacao.com.br",
   "access-control-allow-methods":"POST, OPTIONS",
   "access-control-allow-headers":"authorization,apikey,content-type",
   "access-control-max-age":"600",
   "vary":"Origin",
  }});
 }
 if(req.method!=="POST")return response(405,{ok:false,erro:"METODO_INVALIDO"},origin);
 const base=(Deno.env.get("SUPABASE_URL")||"").replace(/\/+$/,"");
 const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!base||!service)return response(503,{ok:false,erro:"SERVICO_INDISPONIVEL"},origin);
 const bearer=req.headers.get("authorization")||"";
 if(!/^Bearer\s+\S{30,}$/i.test(bearer))
  return response(401,{ok:false,erro:"NAO_AUTENTICADO"},origin);
 let actorId="";
 try{
  const check=await fetch(base+"/auth/v1/user",{
   headers:{apikey:service,Authorization:bearer},cache:"no-store",
   signal:AbortSignal.timeout(9000)
  });
  if(!check.ok)return response(401,{ok:false,erro:"SESSAO_INVALIDA"},origin);
  const body=await check.json();
  if(!UUID.test(body?.id||""))return response(401,{ok:false,erro:"SESSAO_INVALIDA"},origin);
  actorId=body.id;
 }catch(_){return response(503,{ok:false,erro:"VALIDACAO_TEMPORARIAMENTE_INDISPONIVEL"},origin);}
 let payload:Record<string,unknown>={};
 try{
  const str=await req.text();
  if(str.length>MAX_BODY)throw Error("CORPO_MUITO_GRANDE");
  const data=JSON.parse(str);
  if(!data||Array.isArray(data)||typeof data!=="object")throw Error("INVALIDO");
  payload=data;
 }catch(_){return response(400,{ok:false,erro:"DADOS_INVALIDOS"},origin);}

 const acao=String(payload.acao||"");
 if(acao!=="excluir"&&acao!=="limpar_pendentes")
  return response(400,{ok:false,erro:"ACAO_INVALIDA"},origin);

 const itens=payload.itens;
 if(acao==="excluir"){
  if(!Array.isArray(itens)||itens.length<1||itens.length>50
   ||!itens.every(x=>x&&typeof x==="object"&&!Array.isArray(x)
      &&UUID.test(String(x.id||""))&&typeof x.updated_at==="string"
      &&x.updated_at.length>=10)
   ||payload.confirmacao!==("EXCLUIR "+itens.length)
   ||payload.devolucao_confirmada!==true)
   return response(400,{ok:false,erro:"PARAMETROS_INVALIDOS"},origin);
 }

 const rpcHeaders={
  apikey:service,Authorization:"Bearer "+service,
  "content-type":"application/json"
 };
 async function rpc(mode:string,data:Record<string,unknown>):Promise<Record<string,any>>{
  const resp=await fetch(base+"/rest/v1/rpc/v19_exclusao_definitiva_master",{
   method:"POST",cache:"no-store",headers:rpcHeaders,
   body:JSON.stringify({p_acao:mode,p_actor_auth_id:actorId,p_dados:data}),
   signal:AbortSignal.timeout(20000)
  });
  const parsed=await resp.json().catch(()=>null);
  if(!resp.ok||parsed?.ok!==true){
   const message=String(parsed?.message||parsed?.erro||"FALHA_AO_CONFIRMAR");
   throw new Error(message);
  }
  return parsed;
 }
 let result:Record<string,any>={ok:true,excluidos:0};
 try{
  if(acao==="excluir")
   result=await rpc("excluir",{itens,confirmacao:payload.confirmacao,
    devolucao_confirmada:true});
  else await rpc("pendentes",{});
 }catch(e){
  const raw=String(e instanceof Error?e.message:e);
  const known=[
    "PERFIL_MASTER_OBRIGATORIO","NAO_AUTENTICADO","VERSAO_DESATUALIZADA",
    "CHAMADO_NAO_ARQUIVADO","CHAMADO_INEXISTENTE_OU_ALTERADO",
    "CHAMADO_COM_ESTOQUE_OU_GARANTIA","PARAMETROS_INVALIDOS",
    "DEVOLUCAO_FISICA_NAO_CONFIRMADA","MOVIMENTACAO_EMPRESA_SEM_ORIGEM_VALIDA",
    "MOVIMENTACAO_EMPRESA_INCONSISTENTE","ITEM_MATERIAL_E_MOVIMENTACAO_DIVERGENTES",
    "DEVOLUCAO_EXCEDE_ESTOQUE_CONTRATADO","GARANTIA_JA_DEVOLVIDA",
    "GARANTIA_CONSORCIO_DIVERGENTE","SALDO_GARANTIA_FORA_LIMITE",
    "ITENS_INVALIDOS","ITENS_DUPLICADOS","CONFIRMACAO_OBRIGATORIA"
  ];
  const error=known.find(k=>raw.startsWith(k))||"OPERACAO_NAO_REALIZADA";
  console.warn("[V19 Exclusao definitiva] Erro:",error);
  return response(statusForCode(error),{ok:false,erro:error},origin);
 }

 // Evita perder o caminho fisico caso o Storage falhe depois da exclusao SQL.
 // A fila persiste no banco para tentativas subsequentes.
 let okPhotos=0,failed=0,pending=0;
 try{
  const task=await rpc("pendentes",{});
  const jobs=(Array.isArray(task.pendentes)?task.pendentes:[]) as Array<Record<string,unknown>>;
  const confirmations:string[]=[];
  for(let offset=0;offset<jobs.length;offset+=8){
   const group=jobs.slice(offset,offset+8);
   const outcome=await Promise.allSettled(group.map(async job=>{
    const id=String(job.id||"");
    const path=String(job.storage_path||"");
    if(!UUID.test(id)||job.bucket!=="chamado-fotos"||!looksSafePath(path))
     throw Error("PATH_INVALIDO");
    const encoded=path.split("/").map(encodeURIComponent).join("/");
    const res=await fetch(base+"/storage/v1/object/chamado-fotos/"+encoded,{
     method:"DELETE",cache:"no-store",
     headers:{apikey:service,Authorization:"Bearer "+service},
     signal:AbortSignal.timeout(9000)
    });
    if(!res.ok&&res.status!==404)
     throw Error("STORAGE_ERRO_"+res.status);
    return id;
   }));
   outcome.forEach(out=>{if(out.status==="fulfilled"){confirmations.push(out.value);okPhotos++;}
     else {failed++;console.warn("[V19] Foto pendente de limpeza:",String(out.reason).slice(0,120));}});
  }
  if(confirmations.length){
   await rpc("confirmar_arquivos",{ids:confirmations});
  }
  const state=await rpc("pendentes",{});
  pending=Array.isArray(state.pendentes)?state.pendentes.length:0;
 }catch(e){
  pending=Math.max(pending,1);
  console.warn("[V19] Limpeza fisica pendente de nova tentativa:",String(e).slice(0,120));
 }
 return response(200,{ok:true,excluidos:Number(result.excluidos)||0,
  devolvido_empresa:Number(result.devolvido_empresa)||0,
  devolvido_garantia:Number(result.devolvido_garantia)||0,
  fotos_removidas:okPhotos,fotos_pendentes:pending,
  aviso:pending?"FOTOS_PENDENTES_DE_LIMPEZA":null},origin);
});