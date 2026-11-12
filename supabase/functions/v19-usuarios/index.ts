// Aponte Cidadão V19 — Edge Function com gravações TRAVADAS por padrão.
// A implantação inicial serve apenas para testar autenticação e autorização;
// mantenha V19_ENABLE_USUARIO_WRITES ausente/desabilitado até homologação.
// Usa a biblioteca @supabase/server e exige JWT real de usuário.
// Em produção, somente ela conhece a credencial administrativa, nunca o HTML.
import { withSupabase } from "npm:@supabase/server@1";

type DadosUsuario = {
  nome: string;
  email: string;
  perfil: "master" | "consorcio" | "prefeitura" | "empresa" | "garantia";
  consorcio_id: string | null;
  cidade_id: string | null;
  empresa_id: string | null;
  telefone: string | null;
  cpf: string | null;
  cargo: string | null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES = new Set(["master", "consorcio", "prefeitura", "empresa", "garantia"]);
const ORIGINS = new Set([
  "https://easyobrasandroid-source.github.io",
  "http://localhost:3000",
  "http://localhost:5173",
  ...(Deno.env.get("V19_ALLOWED_ORIGINS") || "").split(",").map((s) => s.trim()).filter(Boolean),
]);
function cors(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin && ORIGINS.has(origin)
      ? origin : "https://easyobrasandroid-source.github.io",
    "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    Vary: "Origin",
  };
}
function response(status: number, codigo: string, origin: string | null,
  other: Record<string, unknown> = {}): Response {
  return Response.json({ ok: status >= 200 && status < 300, codigo, ...other }, {
    status, headers: cors(origin),
  });
}
function cleanText(value: unknown, max: number, required = false): string | null {
  if (value == null || value === "") {
    if (required) throw new Error("CAMPO_OBRIGATORIO");
    return null;
  }
  if (typeof value !== "string") throw new Error("CAMPO_INVALIDO");
  const cleaned = value.trim();
  if ((required && !cleaned) || cleaned.length > max)
    throw new Error("CAMPO_INVALIDO");
  return cleaned || null;
}
function cleanUuid(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !UUID.test(value))
    throw new Error("UUID_INVALIDO");
  return value;
}
function parseUsuario(raw: unknown): DadosUsuario {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("USUARIO_INVALIDO");
  const a = raw as Record<string, unknown>;
  const nome = cleanText(a.nome, 250, true)!;
  const email = (cleanText(a.email, 320, true) || "").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("EMAIL_INVALIDO");
  if (typeof a.perfil !== "string" || !ROLES.has(a.perfil))
    throw new Error("PERFIL_INVALIDO");
  return {
    nome, email,
    perfil: a.perfil as DadosUsuario["perfil"],
    consorcio_id: cleanUuid(a.consorcio_id),
    cidade_id: cleanUuid(a.cidade_id),
    empresa_id: cleanUuid(a.empresa_id),
    telefone: cleanText(a.telefone, 50),
    cpf: cleanText(a.cpf, 25),
    cargo: cleanText(a.cargo, 160),
  };
}
const CODIGOS_ESPERADOS = new Set([
  "PARAMETROS_INVALIDOS", "ATOR_NAO_AUTORIZADO", "USUARIO_ID_OBRIGATORIO",
  "USUARIO_NAO_ENCONTRADO", "AUTOALTERACAO_BLOQUEADA", "ALVO_FORA_ESCOPO",
  "DADOS_INVALIDOS", "ESCOPO_NAO_AUTORIZADO", "MASTER_COM_VINCULOS",
  "CONSORCIO_OBRIGATORIO", "CONSORCIO_INVALIDO", "VINCULO_PREFEITURA_INVALIDO",
  "CIDADE_INVALIDA", "CIDADE_INDEVIDA", "EMPRESA_OBRIGATORIA",
  "EMPRESA_INVALIDA", "EMPRESA_INDEVIDA", "RESERVA_NAO_ELEGIVEL",
  "AUTH_EMAIL_DIVERGENTE", "VINCULO_NAO_CONFIRMADO", "RESERVA_NAO_CANCELAVEL",
  "EMAIL_IMUTAVEL", "REBAIXAMENTO_MASTER_BLOQUEADO",
  "STATUS_INVALIDO", "ALTERACAO_STATUS_MASTER_BLOQUEADA", "USUARIO_SEM_AUTH",
  "STATUS_JA_DEFINIDO", "EDICAO_NAO_CONFIRMADA", "STATUS_NAO_CONFIRMADO",
  "CONSORCIO_DO_ATOR_INATIVO", "EMAIL_JA_EXISTE_NO_AUTH",
  "REDIRECT_INVALIDO_RESERVA_PENDENTE", "REDIRECT_CONVITE_NAO_CONFIGURADO",
  "CONVITE_PENDENTE_NAO_EDITAVEL", "STATUS_DE_CONVITE_PENDENTE_IMUTAVEL",
]);
function codigoBanco(error: { message?: string; code?: string } | null): string {
  if (!error) return "FALHA_NO_BANCO";
  if (error.code === "23505") return "REGISTRO_DUPLICADO";
  if (error.code === "23503") return "VINCULO_INVALIDO";
  if (error.code === "23514") return "ESCOPO_INVALIDO";
  return CODIGOS_ESPERADOS.has(error.message || "") ? error.message! : "FALHA_NO_BANCO";
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx): Promise<Response> => {
    const origin = req.headers.get("origin");
    if (origin && !ORIGINS.has(origin))
      return response(403, "ORIGEM_NAO_PERMITIDA", origin);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (req.method !== "POST") return response(405, "METODO_INVALIDO", origin);

    // O wrapper valida o JWT; getUser() também consulta o Auth e evita
    // confiar exclusivamente em um token cujo usuário já foi removido.
    const actorId = ctx.userClaims?.id;
    if (!actorId) return response(401, "NAO_AUTENTICADO", origin);
    const { data: liveAuth, error: liveAuthError } = await ctx.supabase.auth.getUser();
    if (liveAuthError || !liveAuth.user || liveAuth.user.id !== actorId)
      return response(401, "CONTA_AUTH_NAO_CONFIRMADA", origin);

    // Esta consulta usa o token do usuário e RLS; a RPC revalida autorizações
    // e bloqueia a linha do ator em TODAS as operações de escrita.
    const { data: actor, error: actorError } = await ctx.supabase.from("usuarios")
      .select("id,perfil,status").eq("auth_user_id", actorId)
      .eq("status", "ativo").maybeSingle();
    if (actorError || !actor || !["master", "consorcio"].includes(actor.perfil))
      return response(403, "PERFIL_NAO_AUTORIZADO", origin);

    let body: Record<string, unknown>;
    try {
      const text = await req.text();
      if (text.length > 12000) return response(413, "CORPO_MUITO_GRANDE", origin);
      body = JSON.parse(text);
      if (!body || typeof body !== "object" || Array.isArray(body))
        return response(400, "JSON_INVALIDO", origin);
    } catch {
      return response(400, "JSON_INVALIDO", origin);
    }

    const action = body.acao;
    // Consulta de permissões: não escreve nada. Serve ao teste inicial do módulo.
    if (action === "verificar_acesso") {
      return response(200, "ACESSO_ADMIN_CONFIRMADO", origin, {
        perfil: actor.perfil,
        gravacao_habilitada: Deno.env.get("V19_ENABLE_USUARIO_WRITES") === "true",
      });
    }
    if (!["criar", "editar", "alterar_status"].includes(String(action)))
      return response(400, "ACAO_INVALIDA", origin);

    // Trava adicional: após publicar esta função, NENHUMA gravação será
    // permitida até habilitação EXPRESSA no próprio projeto V19.
    if (Deno.env.get("V19_ENABLE_USUARIO_WRITES") !== "true")
      return response(503, "GRAVACAO_DESABILITADA_HOMOLOGACAO", origin);
    let details: DadosUsuario | null = null;
    let userId: string | null = null;
    try {
      if (action === "criar" || action === "editar")
        details = parseUsuario(body.usuario);
      if (action !== "criar") {
        userId = cleanUuid(body.usuario_id);
        if (!userId) return response(400, "USUARIO_ID_OBRIGATORIO", origin);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "DADOS_INVALIDOS";
      return response(400, reason, origin);
    }

    // UNICAMENTE esta RPC possui escrita em usuarios e faz INSERT em auditoria
    // na mesma transação. Nunca usar .from('usuarios').update() aqui.
    const rpc = async (acao: string, id: string | null, dados: Record<string, unknown>,
      authUserId: string | null = null) => {
      const { data, error } = await ctx.supabaseAdmin.rpc("v19_admin_usuario_operar", {
        p_ator_auth_uid: actorId,
        p_acao: acao,
        p_usuario_id: id,
        p_dados: dados,
        p_auth_user_id: authUserId,
      });
      if (error || !data || data.ok !== true)
        throw new Error(codigoBanco(error));
      return data as { ok: true; usuario_id: string; estado: string };
    };

    try {
      if (action === "criar") {
        // Nunca iniciar uma reserva enquanto o redirecionamento de convite
        // não estiver explicitamente configurado e autorizado na V19.
        const callback = Deno.env.get("V19_INVITE_REDIRECT_URL") || "";
        let callbackValida = false;
        try {
          const url = new URL(callback);
          callbackValida = url.protocol === "https:" && ORIGINS.has(url.origin) &&
            (url.origin === "https://easyobrasandroid-source.github.io"
              ? url.pathname.startsWith("/aponte-cidadao-v19-homologacao/")
              : !/\/teste-v18(?:\/|$)/i.test(url.pathname));
        } catch { /* Negar URL inválida */ }
        if (!callbackValida)
          return response(503, "REDIRECT_CONVITE_NAO_CONFIGURADO", origin);

        const reserva = await rpc("reservar", null, details!);
        // A chamada de convite é externa ao Postgres: não há transação
        // distribuída Supabase Auth <-> Postgres. A reserva permanece INATIVA.
        const { data: invite, error: inviteError } = await ctx.supabaseAdmin.auth.admin
          .inviteUserByEmail(details!.email, { redirectTo: callback });
        if (inviteError || !invite.user?.id) {
          // Convite não confirmado. A compensação remove SOMENTE a reserva
          // desvinculada; jamais exclui usuário Auth preexistente.
          try {
            await rpc("cancelar_reserva", reserva.usuario_id, {});
          } catch {
            return response(500, "CONVITE_FALHOU_RESERVA_PENDENTE", origin);
          }
          return response(422, "CONVITE_NAO_ENVIADO", origin);
        }
        try {
          const ligado = await rpc("finalizar_convite", reserva.usuario_id, {}, invite.user.id);
          return response(201, "USUARIO_CRIADO", origin, {
            usuario_id: ligado.usuario_id,
            convite_enviado: true,
            auditoria_confirmada: true,
          });
        } catch {
          // Convite pode ter sido enviado: não fazer delete no Auth.
          // Perfil segue INATIVO sem vínculo, a ser conciliado manualmente.
          return response(500, "VINCULO_PENDENTE_RECONCILIACAO", origin);
        }
      }
      if (action === "editar") {
        const result = await rpc("editar", userId, details!);
        return response(200, "USUARIO_EDITADO", origin, {
          usuario_id: result.usuario_id, auditoria_confirmada: true,
        });
      }
      if (body.status !== "ativo" && body.status !== "inativo")
        return response(400, "STATUS_INVALIDO", origin);
      const result = await rpc("status", userId, { status: body.status });
      return response(200, "STATUS_ATUALIZADO", origin, {
        usuario_id: result.usuario_id, status: result.estado, auditoria_confirmada: true,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "ERRO_INTERNO";
      return response(reason === "FALHA_NO_BANCO" ? 500 : 422,
        CODIGOS_ESPERADOS.has(reason) ||
        ["REGISTRO_DUPLICADO", "VINCULO_INVALIDO", "ESCOPO_INVALIDO"].includes(reason)
          ? reason : "FALHA_NO_BANCO", origin);
    }
  }),
};