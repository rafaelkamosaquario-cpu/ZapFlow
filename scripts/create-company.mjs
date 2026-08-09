// ============================================================================
// Onboarding de uma empresa cliente nova (papel "owner") no ZapFlow.
//
// Uso (na máquina com as variáveis do Supabase configuradas):
//   COMPANY_NAME="RF Pneus" \
//   OWNER_USERNAME="rfpneus" OWNER_PASSWORD="senha-temporaria" OWNER_NAME="Fulano" \
//   ZAPI_INSTANCE_ID="..." ZAPI_INSTANCE_TOKEN="..." ZAPI_CLIENT_TOKEN="..." \
//   PUBLIC_URL="https://frota-bot-production.up.railway.app" \
//   node scripts/create-company.mjs
//
// PUBLIC_URL é opcional — só é usada para imprimir, no final, a URL de
// webhook pronta pra colar no painel da Z-API daquela instância.
//
// O script NUNCA reimprime a senha em texto (só confirma que foi criada).
// ============================================================================
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { supabaseEnabled } from "../db/supabase.js";
import { empresasRepo, usuariosRepo } from "../db/repositories.js";

if (!supabaseEnabled) {
  console.error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY antes de rodar este script.");
  process.exit(1);
}

const {
  COMPANY_NAME,
  OWNER_USERNAME,
  OWNER_PASSWORD,
  OWNER_NAME = "",
  ZAPI_INSTANCE_ID = "",
  ZAPI_INSTANCE_TOKEN = "",
  ZAPI_CLIENT_TOKEN = "",
  PUBLIC_URL = "",
} = process.env;

const obrigatorias = { COMPANY_NAME, OWNER_USERNAME, OWNER_PASSWORD };
const faltando = Object.entries(obrigatorias).filter(([, v]) => !v).map(([k]) => k);
if (faltando.length) {
  console.error(`Faltam variáveis obrigatórias: ${faltando.join(", ")}`);
  process.exit(1);
}

async function run() {
  const existente = await usuariosRepo.findByUsername(OWNER_USERNAME);
  if (existente) {
    console.error(`Já existe um usuário com o username "${OWNER_USERNAME.toLowerCase()}". Escolha outro.`);
    process.exit(1);
  }

  const webhookSecret = crypto.randomBytes(24).toString("hex");
  const empresa = await empresasRepo.create({
    name: COMPANY_NAME,
    zapiInstanceId: ZAPI_INSTANCE_ID,
    zapiInstanceToken: ZAPI_INSTANCE_TOKEN,
    zapiClientToken: ZAPI_CLIENT_TOKEN,
    webhookSecret,
  });

  const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 10);
  const owner = await usuariosRepo.create({
    empresaId: empresa.id,
    username: OWNER_USERNAME,
    passwordHash,
    role: "owner",
    name: OWNER_NAME,
  });

  console.log("\nEmpresa criada com sucesso:");
  console.log(`  Empresa:   ${empresa.name} (id ${empresa.id})`);
  console.log(`  Login:     ${owner.username}`);
  console.log(`  Papel:     ${owner.role}`);
  console.log(`  Máx. vendedores: ${empresa.maxVendedores}`);
  if (PUBLIC_URL) {
    console.log(`\nURL de webhook (colar no painel da Z-API dessa instância, evento "ao receber"):`);
    console.log(`  ${PUBLIC_URL.replace(/\/+$/, "")}/api/webhook/${empresa.id}/${webhookSecret}`);
  } else {
    console.log(`\nSegredo do webhook (monte a URL como {SEU_DOMINIO}/api/webhook/${empresa.id}/${webhookSecret}):`);
    console.log(`  ${webhookSecret}`);
  }
  console.log("\nA senha não é reimpressa aqui — repasse ao cliente pelo canal combinado.\n");
}

run().catch((e) => { console.error("Falha ao criar empresa:", e); process.exit(1); });
