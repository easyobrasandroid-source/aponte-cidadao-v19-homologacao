/**
 * Aponte Cidadão V19 — API de abertura pública (homologação).
 *
 * DESATIVADA POR PADRÃO. Somente funciona com:
 *  - PORTAL_INTAKE_ENABLED=true
 *  - TURNSTILE_SECRET_KEY: chave secreta do Cloudflare Turnstile
 *  - PORTAL_RATE_LIMIT_PEPPER: segredo aleatório >= 32 caracteres
 *  - SUPABASE_SERVICE_ROLE_KEY: chave legada somente do servidor (injetada pelo Supabase)
 *
 * A configuração de portal no PostgreSQL TAMBÉM deve permitir a abertura.
 * NÃO colocar as chaves de serviço ou Turnstile secret no GitHub Pages.
 *
 * Segurança: CORS é uma restrição de navegador, não autenticação. A verificação
 * de Turnstile, o limitador e a RPC privada validam as solicitações.
 */

const ALLOWED_ORIGIN = "https://easyobrasandroid-source.github.io";
const EXPECTED_TURNSTILE_HOSTNAME = "easyobrasandroid-source.github.io";
const TURNSTILE_ACTION = "v19_abrir_chamado";
const MAX_BODY_BYTES = 12_000;
const MAX_REQUESTS_PER_WINDOW = 5;
const WINDOW_MINUTES = 15;

type JsonRecord = Record<string, unknown>;

function reply(status: number, data: JsonRecord, origin: string | null): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "vary": "Origin",
    "x-content-type-options": "nosniff",
  });
  if (origin === ALLOWED_ORIGIN) {
    headers.set("access-control-allow-origin", ALLOWED_ORIGIN);
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function corsPreflight(origin: string | null): Response {
  if (origin !== ALLOWED_ORIGIN) return reply(403, { ok: false, erro: "ORIGEM_INVALIDA" }, origin);
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": ALLOWED_ORIGIN,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, apikey, authorization, x-client-info",
      "access-control-max-age": "600",
      "vary": "Origin",
    },
  });
}

function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function uuid(value: unknown): string | null {
  const s = asText(value);
  return s && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s) ? s : null;
}

function normalizePhone(value: unknown): string {
  return (asText(value) ?? "").replace(/[^0-9]/g, "");
}

function nullableText(value: unknown): string | null {
  return value == null ? null : asText(value);
}

function numericOrNull(value: unknown): number | null | undefined {
  if (value == null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clientAddress(req: Request): string {
  // Cabeçalhos de encaminhamento podem ser falsificados se o proxy não os
  // normalizar. O rate-limit por IP é apenas uma camada auxiliar.
  const cf = req.headers.get("cf-connecting-ip");
  if (cf && cf.length <= 64) return cf;
  const real = req.headers.get("x-real-ip");
  if (real && real.length <= 64) return real;
  const xff = req.headers.get("x-forwarded-for");
  if (xff && xff.length <= 1024) {
    // Último endereço tende a ser o proxy mais próximo; não assumimos
    // que ele seja confiável sem validar a infraestrutura de borda.
    const parts = xff.split(",").map((part) => part.trim());
    if (parts.length) return parts[parts.length - 1].slice(0, 64);
  }
  return "origem-nao-identificada";
}

async function keyedHash(secret: string, subject: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const raw = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(subject),
  ));
  return Array.from(raw, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function callRpc(
  supabaseUrl: string,
  serviceRoleKey: string,
  functionName: string,
  payload: JsonRecord,
): Promise<{ status: number; data: JsonRecord | null }> {
  const response = await fetch(
    supabaseUrl.replace(/\/+$/, "") + "/rest/v1/rpc/" + functionName,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: "Bearer " + serviceRoleKey,
        "content-type": "application/json",
        "cache-control": "no-store",
      },
      body: JSON.stringify(payload),
    },
  );
  const data: unknown = await response.json().catch(() => null);
  return {
    status: response.status,
    data: data && typeof data === "object" && !Array.isArray(data)
      ? data as JsonRecord
      : null,
  };
}

async function verifyTurnstile(token: string, secret: string): Promise<boolean> {
  const form = new URLSearchParams({
    secret,
    response: token,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: form,
        signal: controller.signal,
      },
    );
    if (!response.ok) return false;
    const result = await response.json() as JsonRecord;
    return result.success === true &&
      result.hostname === EXPECTED_TURNSTILE_HOSTNAME &&
      result.action === TURNSTILE_ACTION;
  } finally {
    clearTimeout(timeout);
  }
}

function payloadFrom(input: JsonRecord): JsonRecord | null {
  const requestKey = uuid(input.chave_requisicao);
  const consortium = uuid(input.consorcio_id);
  const city = uuid(input.cidade_id);
  const name = asText(input.solicitante_nome);
  const phone = normalizePhone(input.solicitante_tel);
  const type = asText(input.tipo);
  const area = asText(input.area);
  const amount = input.qtd;
  const lat = numericOrNull(input.latitude);
  const lng = numericOrNull(input.longitude);
  const loc = nullableText(input.loc_src) ?? "manual";
  const bairro = nullableText(input.bairro);
  const endereco = nullableText(input.endereco);
  const referencia = nullableText(input.referencia);
  const observacoes = nullableText(input.observacoes);
  if (!requestKey || !consortium || !city ||
      !name || name.trim().length < 2 || name.length > 120 ||
      phone.length < 10 || phone.length > 13 ||
      !type || ![
        "Lâmpada apagada", "Lâmpada piscando", "Acesa durante o dia",
        "Lâmpada com defeito", "Poste danificado", "Outro",
      ].includes(type) ||
      (area !== "Urbana" && area !== "Rural") ||
      typeof amount !== "number" || !Number.isInteger(amount) || amount < 1 || amount > 999 ||
      [bairro, endereco, referencia, observacoes].some((x) => x === null ? false : typeof x !== "string") ||
      (bairro?.length ?? 0) > 160 ||
      (endereco?.length ?? 0) > 300 ||
      (referencia?.length ?? 0) > 300 ||
      (observacoes?.length ?? 0) > 500 ||
      lat === undefined || lng === undefined ||
      (lat === null) !== (lng === null) ||
      (lat !== null && (lat < -90 || lat > 90)) ||
      (lng !== null && (lng < -180 || lng > 180)) ||
      !["manual", "gps_mobile", "address_geocoding", "minimap_confirmed"].includes(loc)
  ) return null;

  return {
    p_chave_requisicao: requestKey,
    p_consorcio_id: consortium,
    p_cidade_id: city,
    p_tipo: type,
    p_area: area,
    p_bairro: bairro,
    p_endereco: endereco,
    p_referencia: referencia,
    p_qtd: amount,
    p_observacoes: observacoes,
    p_solicitante_nome: name,
    p_solicitante_tel: phone,
    p_latitude: lat,
    p_longitude: lng,
    p_loc_src: loc,
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return corsPreflight(origin);
  if (req.method !== "POST") return reply(405, { ok: false, erro: "METODO_INVALIDO" }, origin);
  if (origin !== ALLOWED_ORIGIN) return reply(403, { ok: false, erro: "ORIGEM_INVALIDA" }, origin);

  // Corte de emergência independente da configuração do banco.
  if (Deno.env.get("PORTAL_INTAKE_ENABLED") !== "true") {
    return reply(503, { ok: false, erro: "ABERTURA_EM_HOMOLOGACAO" }, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY");
  const pepper = Deno.env.get("PORTAL_RATE_LIMIT_PEPPER");
  if (!supabaseUrl || !serviceRoleKey || !turnstileSecret || !pepper || pepper.length < 32) {
    return reply(503, { ok: false, erro: "SERVICO_NAO_CONFIGURADO" }, origin);
  }

  const mediaType = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return reply(415, { ok: false, erro: "FORMATO_INVALIDO" }, origin);
  }

  try {
    // Limite antes de alocar o corpo inteiro. Nunca confiar apenas no
    // Content-Length, que pode estar ausente ou ser informado incorretamente.
    const advertisedSize = Number(req.headers.get("content-length") ?? 0);
    if (advertisedSize > MAX_BODY_BYTES) {
      return reply(413, { ok: false, erro: "REQUISICAO_MUITO_GRANDE" }, origin);
    }
    if (!req.body) return reply(400, { ok: false, erro: "DADOS_INVALIDOS" }, origin);
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return reply(413, { ok: false, erro: "REQUISICAO_MUITO_GRANDE" }, origin);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return reply(400, { ok: false, erro: "DADOS_INVALIDOS" }, origin);
    }
    const body = parsed as JsonRecord;

    // Catálogo público por consórcio: usa SOMENTE a RPC já autorizada para
    // visitantes, que respeita os flags de ativação do portal no banco.
    // Não exige Turnstile porque não cria chamados nem expõe dados pessoais.
    if (body.acao === "listar_municipios") {
      const consortiumId = uuid(body.consorcio_id);
      if (!consortiumId) return reply(400, { ok: false, erro: "CONSORCIO_INVALIDO" }, origin);
      const response = await fetch(
        supabaseUrl.replace(/\/+$/, "") + "/rest/v1/rpc/v19_listar_municipios_portal",
        {
          method: "POST",
          headers: {
            apikey: serviceRoleKey,
            authorization: "Bearer " + serviceRoleKey,
            "content-type": "application/json",
            "cache-control": "no-store",
          },
          body: JSON.stringify({ p_consorcio_id: consortiumId }),
        },
      );
      if (!response.ok) {
        return reply(503, { ok: false, erro: "CATALOGO_INDISPONIVEL" }, origin);
      }
      const rows: unknown = await response.json().catch(() => null);
      if (!Array.isArray(rows)) {
        return reply(503, { ok: false, erro: "CATALOGO_INDISPONIVEL" }, origin);
      }
      const municipios = rows
        .filter((r): r is JsonRecord =>
          r !== null && typeof r === "object" && !Array.isArray(r) &&
          uuid((r as JsonRecord).cidade_id) !== null &&
          typeof (r as JsonRecord).municipio === "string")
        .slice(0, 500)
        .map((r) => ({
          cidade_id: r.cidade_id,
          municipio: r.municipio,
          uf: typeof r.uf === "string" ? r.uf : "",
        }));
      return reply(200, { ok: true, municipios }, origin);
    }

    const turnstileToken = asText(body.turnstile_token);
    if (!turnstileToken || turnstileToken.length > 2048) {
      return reply(400, { ok: false, erro: "VERIFICACAO_HUMANA_OBRIGATORIA" }, origin);
    }
    const payload = payloadFrom(body);
    if (!payload) return reply(400, { ok: false, erro: "DADOS_INVALIDOS" }, origin);

    // Limites aplicados ANTES de gastar uma verificação do Turnstile.
    // Hash com HMAC evita armazenar IP e telefone em texto claro.
    const ipHash = await keyedHash(pepper, "ip:" + clientAddress(req));
    const phoneHash = await keyedHash(pepper, "tel:" + String(payload.p_solicitante_tel));

    for (const key of [ipHash, phoneHash]) {
      const limit = await callRpc(
        supabaseUrl,
        serviceRoleKey,
        "v19_portal_consumir_limite_privado",
        {
          p_chave_hash: key,
          p_janela_minutos: WINDOW_MINUTES,
          p_max_tentativas: MAX_REQUESTS_PER_WINDOW,
        },
      );
      if (limit.status !== 200 || limit.data?.permitido !== true) {
        if (limit.status === 200 && limit.data?.permitido === false) {
          return reply(429, { ok: false, erro: "MUITAS_TENTATIVAS" }, origin);
        }
        return reply(503, { ok: false, erro: "CONTROLE_DE_ACESSO_INDISPONIVEL" }, origin);
      }
    }

    const humanVerified = await verifyTurnstile(turnstileToken, turnstileSecret);
    if (!humanVerified) {
      return reply(403, { ok: false, erro: "VERIFICACAO_HUMANA_RECUSADA" }, origin);
    }

    // Nunca passar credenciais ao navegador; PostgREST recebe service_role
    // exclusivamente desta Edge Function. A RPC confere flags do portal,
    // atribuição única, SLA, histórico e idempotência transacional.
    const created = await callRpc(
      supabaseUrl,
      serviceRoleKey,
      "v19_criar_chamado_publico_privado",
      payload,
    );
    if (created.status !== 200 || created.data?.ok !== true) {
      // Nenhuma mensagem de erro SQL ou detalhes pessoais são expostos.
      return reply(409, { ok: false, erro: "CHAMADO_NAO_REGISTRADO" }, origin);
    }

    return reply(200, {
      ok: true,
      protocolo: created.data.protocolo,
      status: created.data.status,
      sla_horas: created.data.sla_horas,
      reutilizado: created.data.reutilizado === true,
    }, origin);
  } catch (error) {
    // Não registrar tokens, credenciais ou conteúdo pessoal em logs.
    console.error("[V19 portal] Falha interna:", error instanceof Error ? error.name : "desconhecida");
    return reply(503, { ok: false, erro: "SERVICO_TEMPORARIAMENTE_INDISPONIVEL" }, origin);
  }
});
