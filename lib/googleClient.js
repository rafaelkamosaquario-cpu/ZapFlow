// ============================================================================
// Cliente Google (OAuth 2.0 + Calendar + Sheets) — chamadas REST diretas via
// axios, sem SDK pesado (mesmo estilo do cliente Z-API embutido em server.js).
//
// PUBLIC_URL precisa ser a URL pública de produção (ex.:
// https://frota-bot-production.up.railway.app) e bater EXATAMENTE com o
// redirect URI cadastrado no Google Cloud Console — nunca derivar isso de
// headers da requisição (Railway fica atrás de proxy; já foi causa de bug
// real em outro projeto usando o mesmo padrão).
// ============================================================================
import crypto from "crypto";
import axios from "axios";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
const REDIRECT_URI = `${PUBLIC_URL}/auth/google/callback`;

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
].join(" ");

export const googleOAuthConfigured = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && PUBLIC_URL);

function stateSecretBuf() {
  return crypto.createHash("sha256").update(process.env.SESSION_SECRET || "dev-only-insecure-secret").digest();
}

/** URL de consentimento do Google, com `state` assinado (nunca confiar em empresaId vindo do cliente sem isso). */
export function buildAuthUrl(empresaId) {
  const exp = Date.now() + 10 * 60 * 1000; // state válido por 10 min
  const payload = `${empresaId}|${exp}`;
  const sig = crypto.createHmac("sha256", stateSecretBuf()).update(payload).digest("hex");
  const state = Buffer.from(`${payload}|${sig}`).toString("base64url");
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    access_type: "offline",
    prompt: "consent", // garante refresh_token mesmo em reconexão
    scope: SCOPES,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Valida e decodifica o `state` do callback. Devolve o empresaId ou null se inválido/expirado. */
export function validarState(state) {
  try {
    const decoded = Buffer.from(String(state), "base64url").toString();
    const parts = decoded.split("|");
    if (parts.length !== 3) return null;
    const [empresaId, expStr, sig] = parts;
    const expect = crypto.createHmac("sha256", stateSecretBuf()).update(`${empresaId}|${expStr}`).digest("hex");
    if (sig !== expect) return null;
    if (Number(expStr) <= Date.now()) return null;
    return empresaId;
  } catch {
    return null;
  }
}

export async function trocarCodigoPorTokens(code) {
  const { data } = await axios.post(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI, grant_type: "authorization_code",
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return data; // { access_token, refresh_token, expires_in, scope, ... }
}

export async function buscarEmailConectado(accessToken) {
  const { data } = await axios.get("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data.email || null;
}

async function renovarAccessToken(refreshToken) {
  const { data } = await axios.post(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      refresh_token: refreshToken, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return data; // { access_token, expires_in, ... } (normalmente sem novo refresh_token)
}

/**
 * Devolve um access token válido, renovando via refresh_token quando o atual
 * já expirou (ou expira no próximo minuto). Não persiste nada — quem chamar
 * decide se salva o token renovado (ver googleRepo em db/repositories.js).
 */
export async function obterAccessTokenValido(conexao) {
  const expira = new Date(conexao.tokenExpiry).getTime();
  if (expira > Date.now() + 60000) {
    return { accessToken: conexao.accessToken, renovado: false };
  }
  const novo = await renovarAccessToken(conexao.refreshToken);
  return {
    accessToken: novo.access_token,
    renovado: true,
    tokenExpiry: new Date(Date.now() + (novo.expires_in || 3600) * 1000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------
export async function listarEventos(accessToken) {
  const agora = new Date().toISOString();
  const { data } = await axios.get("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { timeMin: agora, maxResults: 20, singleEvents: true, orderBy: "startTime" },
  });
  return (data.items || []).map((e) => ({
    id: e.id,
    titulo: e.summary || "(sem título)",
    inicio: e.start?.dateTime || e.start?.date,
    fim: e.end?.dateTime || e.end?.date,
    link: e.htmlLink,
  }));
}

export async function criarEvento(accessToken, { titulo, inicio, fim, descricao }) {
  const { data } = await axios.post(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    { summary: titulo, description: descricao || undefined, start: { dateTime: inicio }, end: { dateTime: fim } },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return { id: data.id, link: data.htmlLink };
}

// ---------------------------------------------------------------------------
// Drive — upload de arquivo avulso (fotos de visita, V2.1). Corpo multipart
// montado na mão (2 partes: metadata JSON + binário), sem SDK.
// ---------------------------------------------------------------------------
export async function uploadArquivo(accessToken, { nome, mimeType, buffer }) {
  const boundary = "zapflow" + crypto.randomBytes(16).toString("hex");
  const metadata = JSON.stringify({ name: nome });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const { data } = await axios.post(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    body,
    {
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      maxBodyLength: Infinity, maxContentLength: Infinity,
    }
  );
  return { id: data.id, url: data.webViewLink };
}

// ---------------------------------------------------------------------------
// Sheets (a planilha criada já fica no Drive do usuário automaticamente —
// escopo drive.file cobre isso sem precisar de nenhuma chamada extra à Drive API)
// ---------------------------------------------------------------------------
export async function criarPlanilha(accessToken, titulo, linhas) {
  const rowData = linhas.map((linha) => ({
    values: linha.map((v) => ({
      userEnteredValue: typeof v === "number" ? { numberValue: v } : { stringValue: String(v ?? "") },
    })),
  }));
  const { data } = await axios.post(
    "https://sheets.googleapis.com/v4/spreadsheets",
    { properties: { title: titulo }, sheets: [{ data: [{ startRow: 0, startColumn: 0, rowData }] }] },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return { url: data.spreadsheetUrl };
}
