// Aponte Iluminação V19 — gestão de Rondas.
// Supabase Auth valida o usuário; a RPC SECURITY DEFINER valida perfil e consórcio.
// Não concede SELECT direto a service_role sobre tabelas administrativas.
const ALLOWED_ORIGINS = new Set([
  "https://easyobrasandroid-source.github.io",
  "https://aponte-iluminacao.pages.dev",
  "https://aponteiluminacao.com.br",
  "https://www.aponteiluminacao.com.br",
]);
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const API_ERROR_NAMES = new Set([
  "NAO_AUTENTICADO","PERFIL_NAO_AUTORIZADO","CONSORCIO_NAO_AUTORIZADO",
  "ESCOPO_NAO_AUTORIZADO","DADOS_INVALIDOS","EMAIL_JA_POSSUI_CONTA",
  "RONDA_NAO_ENCONTRADA","RESERVA_NAO_CANCELAVEL","RESERVA_NAO_FINALIZAVEL",
  "AUTH_ID_INVALIDO","AUTH_IDENTIDADE_DIVERGENTE","STATUS_INVALIDO",
  "RONDA_SEM_CONVITE","ACAO_INVALIDA",
]);
const LIMIT = 8_000;
function response(status: number, content: Record<string, unknown>, origin: string | null) {
  return new Response(JSON.stringify(content), {
    status,
    headers: {
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "vary":"Origin",
      ...(origin && ALLOWED_ORIGINS.has(origin) ? {"access-control-allow-origin":origin} : {}),
    },
  });
}
type JsonObject = Record<string, unknown>;
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin))
    return response(403,{ok:false,erro:"ORIGEM_INVALIDA"},origin);
  if (req.method === "OPTIONS")
    return new Response(null,{status:204,headers:{
      "access-control-allow-origin": origin || "https://aponte-iluminacao.pages.dev",
      "access-control-allow-methods":"POST,OPTIONS",
      "access-control-allow-headers":"authorization,apikey,content-type",
      "access-control-max-age":"600",
      "vary":"Origin",
    }});
  if (req.method !== "POST") return response(405,{ok:false,erro:"METODO_INVALIDO"},origin);

  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/,"");
  const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !adminKey) return response(503,{ok:false,erro:"SERVICO_NAO_CONFIGURADO"},origin);
  const bearer = req.headers.get("authorization") || "";
  if (!/^Bearer\s+\S{30,}$/i.test(bearer))
    return response(401,{ok:false,erro:"NAO_AUTENTICADO"},origin);

  // O token do browser deve ser reconhecido pelo Supabase Auth real.
  const verified = await fetch(base+"/auth/v1/user",{
    headers: {apikey:adminKey,Authorization:bearer},cache:"no-store",
  }).catch(()=>null);
  if (!verified?.ok) return response(401,{ok:false,erro:"SESSAO_INVALIDA"},origin);
  const authUser = await verified.json().catch(()=>null);
  if (!UUID.test(String(authUser?.id || "")))
    return response(401,{ok:false,erro:"SESSAO_INVALIDA"},origin);

  let payload: JsonObject;
  try {
    const raw = await req.text();
    if (raw.length > LIMIT) throw new Error("BODY");
    const item = JSON.parse(raw);
    if (!item || Array.isArray(item) || typeof item !== "object") throw new Error("BODY");
    payload = item as JsonObject;
  } catch { return response(400,{ok:false,erro:"DADOS_INVALIDOS"},origin); }

  const action = String(payload.acao || "");
  if (!["listar","criar","status"].includes(action))
    return response(400,{ok:false,erro:"ACAO_INVALIDA"},origin);

  // A role 'authenticated' do token chama exclusivamente esta RPC.
  // A RPC consulta o perfil no banco e revalida escopo para cada ação.
  const actorHeaders = {
    apikey: adminKey,
    Authorization: bearer,
    "content-type":"application/json",
  };
  async function rpc(acao:string,rondaId:string|null,consorcioId:string|null,dados:JsonObject={}):Promise<JsonObject> {
    const resp=await fetch(base+"/rest/v1/rpc/v19_ronda_admin",{
      method:"POST",
      headers:actorHeaders,
      cache:"no-store",
      body:JSON.stringify({
        p_acao:acao,p_ronda_id:rondaId,p_consorcio_id:consorcioId,p_dados:dados,
      }),
    }).catch(()=>null);
    if (!resp) throw new Error("SERVICO_TEMPORARIAMENTE_INDISPONIVEL");
    const result=await resp.json().catch(()=>null);
    if (!resp.ok || !result || result.ok !== true) {
      const code = typeof result?.message === "string" && API_ERROR_NAMES.has(result.message)
        ? result.message
        : resp.status===401 ? "SESSAO_INVALIDA"
        : resp.status===403 ? "PERMISSOES_INDISPONIVEIS"
        : "BANCO_INDISPONIVEL";
      throw new Error(code);
    }
    return result as JsonObject;
  }
  const fail=(e:unknown)=>{
    const error=e instanceof Error?e.message:"SERVICO_TEMPORARIAMENTE_INDISPONIVEL";
    const expected=API_ERROR_NAMES.has(error)||["SESSAO_INVALIDA","PERMISSOES_INDISPONIVEIS"].includes(error);
    console.warn("[V19 Ronda] RPC ou Auth não concluiu:",expected?error:"ERRO_SERVIDOR");
    return response(expected?error==="SESSAO_INVALIDA"?401:403:503,
      {ok:false,erro:expected?error:"SERVICO_TEMPORARIAMENTE_INDISPONIVEL"},origin);
  };

  if (action === "listar") {
    try {return response(200,await rpc("listar",null,null),origin);}
    catch(e) {return fail(e);}
  }

  if (action === "status") {
    const id=String(payload.id||"");
    if (!UUID.test(id) || typeof payload.ativo !== "boolean")
      return response(400,{ok:false,erro:"DADOS_INVALIDOS"},origin);
    try {return response(200,await rpc("status",id,null,{ativo:payload.ativo}),origin);}
    catch(e) {return fail(e);}
  }

  const cons=String(payload.consorcio_id||"");
  const nome=typeof payload.nome==="string"?payload.nome.trim():"";
  const email=typeof payload.email==="string"?payload.email.trim().toLowerCase():"";
  const telefone=typeof payload.telefone==="string"?payload.telefone.replace(/\D/g,""):"";
  if (!UUID.test(cons)||nome.length<2||nome.length>120||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>320||
      telefone.length<10||telefone.length>13)
    return response(400,{ok:false,erro:"DADOS_INVALIDOS"},origin);

  let reserva:JsonObject;
  try {
    reserva=await rpc("reservar",null,cons,{nome,email,telefone});
  } catch(e) {return fail(e);}

  const rondaId=String(reserva.ronda_id||"");
  if (!UUID.test(rondaId))
    return response(503,{ok:false,erro:"RESERVA_NAO_CONFIRMADA"},origin);

  // Convites sempre apontam para origem previamente autorizada no servidor.
  const website=Deno.env.get("V19_RONDA_INVITE_ORIGIN")||"https://aponte-iluminacao.pages.dev";
  if (!ALLOWED_ORIGINS.has(website)) {
    try {await rpc("cancelar_reserva",rondaId,null);}catch(_){}
    return response(503,{ok:false,erro:"REDIRECIONAMENTO_NAO_AUTORIZADO"},origin);
  }
  const callback=website+"/?consorcio_id="+encodeURIComponent(cons)+"&pagina=portal";
  const adminHeaders={apikey:adminKey,Authorization:"Bearer "+adminKey,"content-type":"application/json"};
  const invite=await fetch(base+"/auth/v1/invite?redirect_to="+encodeURIComponent(callback),{
    method:"POST",headers:adminHeaders,cache:"no-store",
    body:JSON.stringify({email}),
  }).catch(()=>null);
  const invited=await invite?.json().catch(()=>null);
  const invitedAuthId=String(invited?.id||invited?.user?.id||"");
  if (!invite?.ok || !UUID.test(invitedAuthId)) {
    // Falha antes de confirmar o convite: cancelar somente nossa reserva.
    try {await rpc("cancelar_reserva",rondaId,null);}catch(_){}
    return response(422,{ok:false,erro:"CONVITE_NAO_ENVIADO"},origin);
  }

  try {
    await rpc("finalizar_convite",rondaId,null,{auth_user_id:invitedAuthId});
    return response(201,{ok:true,convite_enviado:true,ronda_id:rondaId},origin);
  } catch(e) {
    // E-mail pode ter sido enviado; não excluir automaticamente a conta Auth.
    console.error("[V19 Ronda] Convite enviado, vínculo pendente de reconciliação.",
      e instanceof Error?e.message:"ERRO_SERVIDOR");
    return response(503,{ok:false,erro:"CONVITE_ENVIADO_VINCULO_PENDENTE"},origin);
  }
});
