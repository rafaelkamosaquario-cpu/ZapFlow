// ============================================================================
// Backfill seguro de visitas.cliente_id a partir do telefone de contato.
//
// Regra: só associa quando a relação é inequívoca -- existe exatamente um
// cliente, na MESMA empresa da visita, cujo phone_key bate com o telefone
// normalizado da visita. Nunca adivinha, nunca vincula entre empresas.
//
// Como o schema já garante `unique (empresa_id, phone_key)` em `clientes`
// (migration 003), não existe cenário de ambiguidade real (2+ clientes com o
// mesmo telefone na mesma empresa) -- só "achou" ou "não achou".
//
// Uso (na máquina com SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY configuradas):
//   node scripts/backfill-visita-cliente-id.mjs           (roda de verdade)
//   node scripts/backfill-visita-cliente-id.mjs --dry-run (só simula, não grava)
// ============================================================================
import { supabaseEnabled, getClient } from "../db/supabase.js";

if (!supabaseEnabled) {
  console.error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY antes de rodar este script.");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");
const supabase = getClient();

// Mesma lógica canônica usada em server.js (phoneKey) -- duplicada aqui de
// propósito: este script não importa server.js (que sobe um servidor HTTP
// inteiro só de ser importado).
function phoneKey(raw) {
  let d = String(raw || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return "";
  if (!d.startsWith("55") && (d.length === 10 || d.length === 11)) d = "55" + d;
  if (d.startsWith("55") && d.length >= 12) {
    const ddd = d.slice(2, 4);
    let rest = d.slice(4);
    if (rest.length === 9 && rest[0] === "9") rest = rest.slice(1);
    return "55" + ddd + rest;
  }
  return d;
}

async function main() {
  const { data: visitas, error: errV } = await supabase
    .from("visitas")
    .select("id, empresa_id, contato_telefone")
    .is("cliente_id", null)
    .not("contato_telefone", "is", null)
    .neq("contato_telefone", "");
  if (errV) throw errV;

  console.log(`Visitas analisadas (sem cliente_id, com telefone): ${visitas.length}`);
  if (!visitas.length) return;

  // Agrupa por empresa pra carregar os clientes de cada uma só 1 vez.
  const porEmpresa = new Map();
  for (const v of visitas) {
    if (!porEmpresa.has(v.empresa_id)) porEmpresa.set(v.empresa_id, []);
    porEmpresa.get(v.empresa_id).push(v);
  }

  let associadas = 0;
  let naoAssociadas = 0;
  const motivos = { sem_cliente_correspondente: 0 };

  for (const [empresaId, lista] of porEmpresa) {
    const { data: clientes, error: errC } = await supabase
      .from("clientes")
      .select("id, phone_key")
      .eq("empresa_id", empresaId);
    if (errC) throw errC;

    const porPhoneKey = new Map(clientes.map((c) => [c.phone_key, c.id]));

    for (const v of lista) {
      const key = phoneKey(v.contato_telefone);
      const clienteId = key ? porPhoneKey.get(key) : null;
      if (!clienteId) {
        naoAssociadas++;
        motivos.sem_cliente_correspondente++;
        continue;
      }
      if (DRY_RUN) {
        associadas++;
        continue;
      }
      const { error: errU } = await supabase.from("visitas").update({ cliente_id: clienteId }).eq("id", v.id);
      if (errU) {
        console.error(`Falha ao associar visita ${v.id}:`, errU.message);
        naoAssociadas++;
        continue;
      }
      associadas++;
    }
  }

  console.log(`${DRY_RUN ? "[dry-run] " : ""}Associadas: ${associadas}`);
  console.log(`Não associadas: ${naoAssociadas} (motivo: sem cliente correspondente na mesma empresa: ${motivos.sem_cliente_correspondente})`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Erro no backfill:", err.message);
  process.exit(1);
});
