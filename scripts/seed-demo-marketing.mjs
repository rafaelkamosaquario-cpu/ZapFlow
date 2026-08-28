// ============================================================================
// Popula uma empresa DEMO ("Loja Modelo ZapFlow") com dados 100% fictícios,
// coerentes entre si, para screenshots/vídeos/apresentações de marketing.
//
// NUNCA toca na empresa real -- cria uma empresa nova, isolada, sem
// credencial de Z-API (zapi_instance_id/token ficam vazios de propósito,
// então nenhum código deste projeto consegue chamar a Z-API de verdade para
// essa empresa, mesmo que algum fluxo tentasse). Nenhum Google conectado,
// nenhuma chamada à OpenAI é feita aqui.
//
// Uso:
//   node scripts/seed-demo-marketing.mjs --dry-run
//   node scripts/seed-demo-marketing.mjs --confirm
//   node scripts/seed-demo-marketing.mjs --clear        (remove SÓ a empresa demo, ver seção CLEAR)
//
// Idempotência: se a empresa "Loja Modelo ZapFlow" já existir, o script
// recusa rodar de novo com --confirm (evita duplicar dados a cada
// execução) -- rode --clear antes se quiser regenerar do zero.
//
// v2 (esta versão): corrige 3 problemas achados na validação visual real da
// v1 contra o Dashboard/Radar de produção --
//   1) Clientes "Negociando" importados/preenchidos ganhavam datas de última
//      interação sempre antigas (>= 10 dias), disparando a regra de Radar
//      "negociação parada" (limiar de 5 dias) em quase todos eles de uma vez
//      -- Radar chegou a mostrar 29 itens em vez dos ~9-12 esperados. Agora
//      só fica "parado" quem tem próxima ação futura definida; todo o resto
//      recebe interação recente.
//   2) Visitas com resultado "Proposta solicitada" cujo cliente não tem
//      próxima ação também disparavam Radar ("nenhum retorno programado") --
//      agora qualquer visita nesse resultado sem próxima ação ganha uma
//      automaticamente (data futura, nunca hoje/atrasada, pra não inflar o
//      Radar nem a KPI de Ações pendentes).
//   3) A conversa "vitrine" da Auto Peças Avenida tinha a mensagem de saída
//      (nossa resposta) com minuto aleatório, que às vezes ficava ANTES da
//      mensagem de entrada do cliente por sorteio -- fazendo o cliente
//      aparecer como "aguardando resposta" mesmo já tendo sido respondido.
//      Agora a saída é sempre calculada como entrada + 15min, deterministicamente.
// ============================================================================
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { supabaseEnabled, getClient } from "../db/supabase.js";
import { empresasRepo, usuariosRepo, clientesRepo, campanhasRepo, destinatariosRepo, mensagensRepo, respostasRepo, metricasRepo, modelosRepo, automacaoRegrasRepo, configuracoesIaRepo, conversasRepo, contatosRepo } from "../db/repositories.js";

const EMPRESA_NOME = "Loja Modelo ZapFlow";
const MODO = process.argv.includes("--confirm") ? "confirm" : process.argv.includes("--clear") ? "clear" : "dry-run";
const RADAR_NEGOCIACAO_PARADA_DIAS = 5; // mesmo valor de server.js -- mantém sincronizado

if (!supabaseEnabled) {
  console.error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY antes de rodar este script.");
  process.exit(1);
}

// ----------------------------------------------------------------------------
// Telefones fictícios: DDD "00" NÃO EXISTE no Brasil (DDDs reais vão de 11 a
// 99) -- garante estruturalmente que nenhum desses números é discável/
// endereçável de verdade, mesmo que algo tentasse enviar. Formato real
// brasileiro (55 + DDD + 9 + 8 dígitos), só o DDD é inválido de propósito.
// ----------------------------------------------------------------------------
let seqTelefone = 1;
function telefoneDemo() {
  return `550090${String(seqTelefone++).padStart(6, "0")}`;
}

// Tudo em UTC de propósito: "hoje" pro servidor é sempre
// `new Date().toISOString().slice(0,10)` (ver hojeStr em server.js), que é a
// data em UTC, não a data local de quem roda este script. Construir essas
// datas com setDate/setHours (métodos LOCAIS do Date) pode ancorar o "dia"
// errado sempre que o horário local cair perto da virada UTC -- em fuso
// negativo (ex.: Brasília, UTC-3) isso acontece todo dia depois das ~21h
// local. Usando setUTCDate/setUTCHours o resultado bate com o servidor
// não importa o horário nem o fuso de quem rodar o script.
const HOJE = new Date();
function diasAtras(n, h = 10, m) {
  const d = new Date(HOJE);
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(h, m ?? Math.floor(Math.random() * 60), 0, 0);
  return d;
}
function horasAtras(h, m = 0) {
  const d = new Date(HOJE);
  d.setUTCHours(d.getUTCHours() - h, d.getUTCMinutes() - m, 0, 0);
  return d;
}
function diasNaFrente(n, h = 10, m = 0) {
  const d = new Date(HOJE);
  d.setUTCDate(d.getUTCDate() + n);
  d.setUTCHours(h, m, 0, 0);
  return d;
}
const iso10 = (d) => d.toISOString().slice(0, 10);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pickPeso = (pares) => { // [[valor,peso], ...]
  const total = pares.reduce((a, [, p]) => a + p, 0);
  let r = Math.random() * total;
  for (const [v, p] of pares) { if ((r -= p) <= 0) return v; }
  return pares[0][0];
};

// ----------------------------------------------------------------------------
// Vendedores demo
// ----------------------------------------------------------------------------
const VENDEDORES = [
  { chave: "joao", nome: "João Martins", perfil: "vendedor experiente" },
  { chave: "carla", nome: "Carla Souza", perfil: "boa taxa de acompanhamento" },
  { chave: "lucas", nome: "Lucas Ferreira", perfil: "algumas pendências (mostra valor do Radar)" },
];

const TAGS = ["Cliente antigo", "Orçamento", "Promoção", "VIP", "Retorno", "Pós-venda", "Atacado", "Varejo"];

// Respostas rápidas (Item de Respostas Rápidas)
const TEMPLATES = [
  { name: "Apresentação", message: "Olá! Obrigado pelo contato. Como posso ajudar?" },
  { name: "Formas de pagamento", message: "Trabalhamos com Pix, cartão e outras condições conforme a compra." },
  { name: "Horário", message: "Nosso horário de atendimento é de segunda a sexta, das 8h às 18h." },
  { name: "Localização", message: "Posso te enviar nossa localização por aqui." },
  { name: "Enviar orçamento", message: "Vou preparar seu orçamento e retorno em seguida." },
  { name: "Agradecimento", message: "Obrigado pela preferência! Qualquer dúvida, estamos à disposição." },
];

// Automações prontas (criar_followup ativas; enviar_mensagem sempre INATIVA
// nesta base demo -- nunca deve haver risco de disparo real).
const AUTOMACOES = [
  { nome: "Cliente respondeu", ativa: true, gatilhoTipo: "mudanca_etapa", gatilhoValor: "Respondeu", acaoTipo: "criar_followup", acaoTexto: "Dar retorno pro cliente que respondeu", acaoDias: 1 },
  { nome: "Proposta solicitada", ativa: true, gatilhoTipo: "resultado_visita", gatilhoValor: "Proposta solicitada", acaoTipo: "criar_followup", acaoTexto: "Acompanhar a proposta enviada", acaoDias: 2 },
  { nome: "Retornar depois (rede de segurança)", ativa: true, gatilhoTipo: "resultado_visita", gatilhoValor: "Retornar depois", acaoTipo: "criar_followup", acaoTexto: "Retornar contato com o cliente", acaoDias: 3 },
  { nome: "Agradecimento pós-venda", ativa: false, gatilhoTipo: "mudanca_etapa", gatilhoValor: "Fechado", acaoTipo: "enviar_mensagem", acaoTexto: "Olá {{nome}}! Muito obrigado pela confiança 🙏", acaoDias: null },
];

const MOTIVOS_VISITA = ["Prospecção", "Apresentação", "Negociação", "Pós-venda", "Cobrança"];
const TIPOS_LOJA = ["Mercado", "Loja", "Auto Peças", "Farmácia", "Distribuidora", "Papelaria", "Padaria", "Pet Shop", "Restaurante", "Oficina", "Materiais de Construção", "Móveis", "Ótica", "Salão", "Barbearia", "Confecções"];
const COMPLEMENTOS_LOJA = ["Central", "Popular", "Bom Preço", "São José", "Nova Esperança", "do Bairro", "Modelo", "Express", "Ideal", "Real", "Progresso", "Estrela", "União", "Boa Vista", "do Centro", "Parque das Flores"];

// ============================================================================
// MONTAGEM DO PLANO (em memória, determinístico o bastante para --dry-run e
// --confirm baterem no mesmo formato -- os valores exatos variam por serem
// aleatórios, mas a estrutura e as garantias abaixo não).
// ============================================================================
function montarPlano() {
  const clientes = [];
  const porNome = new Map();
  function addCliente(def) {
    const c = { id: crypto.randomUUID(), key: telefoneDemo(), tags: [], ...def };
    clientes.push(c);
    porNome.set(c.nome, c);
    return c;
  }

  // --- Clientes-herói: cada um cobre um pedaço específico da história comercial ---
  const mercadoBomPreco = addCliente({
    nome: "Mercado Bom Preço", stage: "Respondeu", vendedorChave: "joao", tags: ["Orçamento"],
    lastSentAt: diasAtras(10), lastReplyAt: diasAtras(9),
    proximaAcao: { texto: "Enviar proposta", data: iso10(HOJE), hora: "14:00", responsavelChave: "joao" },
  });
  const autoPecasAvenida = addCliente({
    nome: "Auto Peças Avenida", stage: "Negociando", vendedorChave: "carla", tags: ["Cliente antigo", "Retorno"],
    lastSentAt: diasAtras(31), lastReplyAt: diasAtras(30),
    proximaAcao: { texto: "Ligar para confirmar pedido", data: iso10(diasAtras(2)), hora: "09:00", responsavelChave: "carla" },
  });
  const casaDasTintas = addCliente({
    nome: "Casa das Tintas", stage: "Fechado", vendedorChave: "lucas", tags: ["Varejo"],
    lastSentAt: diasAtras(6), lastReplyAt: diasAtras(5),
    proximaAcao: { texto: "Retornar orçamento", data: iso10(diasNaFrente(1)), hora: "10:00", responsavelChave: "lucas" },
  });
  const constrularMateriais = addCliente({
    nome: "Constrular Materiais", stage: "Negociando", vendedorChave: "joao", tags: ["Atacado"],
    lastSentAt: diasAtras(4), lastReplyAt: diasAtras(3),
    proximaAcao: { texto: "Agendar nova visita", data: iso10(diasNaFrente(3)), hora: "09:30", responsavelChave: "joao" },
  });
  // "Proposta sem próximo passo" -- interação recente de propósito (só o
  // resultado da visita, mais abaixo, dispara o Radar; não deve também cair
  // na regra de "negociação parada" por coincidência de datas antigas).
  const clinicaVida = addCliente({ nome: "Clínica Vida", stage: "Negociando", vendedorChave: "lucas", lastSentAt: diasAtras(3), lastReplyAt: diasAtras(2) });
  const petShopAmigo = addCliente({ nome: "Pet Shop Amigo", stage: "Contatado", vendedorChave: "joao", lastSentAt: diasAtras(3), lastReplyAt: diasAtras(2) });
  const restauranteDoBairro = addCliente({
    nome: "Restaurante do Bairro", stage: "Negociando", vendedorChave: "joao", tags: ["Cliente antigo"],
    lastSentAt: diasAtras(65), lastReplyAt: diasAtras(63),
    proximaAcao: { texto: "Follow-up de relacionamento", data: iso10(diasNaFrente(5)), hora: "11:00", responsavelChave: "joao" },
  });
  const oficinaSaoJose = addCliente({
    nome: "Oficina São José", stage: "Fechado", vendedorChave: "carla", tags: ["Pós-venda"],
    lastSentAt: diasAtras(95), lastReplyAt: diasAtras(92),
    proximaAcao: { texto: "Checar satisfação pós-venda", data: iso10(diasNaFrente(10)), hora: "14:00", responsavelChave: "carla" },
  });
  addCliente({ nome: "Distribuidora Central", stage: "Perdido", vendedorChave: null, tags: ["Atacado"], lastSentAt: diasAtras(120), lastReplyAt: diasAtras(115) });
  addCliente({ nome: "Farmácia Popular Modelo", stage: "Respondeu", vendedorChave: null, tags: ["VIP"], lastSentAt: diasAtras(4), lastReplyAt: diasAtras(3) });
  const carlosAndrade = addCliente({
    nome: "Carlos Andrade Materiais", stage: "Negociando", vendedorChave: "lucas",
    lastSentAt: diasAtras(3), lastReplyAt: diasAtras(2),
    proximaAcao: { texto: "Confirmar entrega", data: iso10(diasAtras(1)), hora: "11:00", responsavelChave: "lucas" },
  });

  // --- 7 clientes "aguardando resposta" (mesmo sinal usado pela KPI Conversas e pelo Radar) ---
  const AGUARDANDO_DEF = [
    { nome: "Panificadora Central", vend: "joao", horasAtras: 0.6, texto: "Vi a promoção, ainda está valendo?" },
    { nome: "Loja Ideal", vend: "carla", horasAtras: 2, texto: "Bom dia! Vocês entregam na região central?" },
    { nome: "Mercado São Lucas", vend: "lucas", horasAtras: 5, texto: "Oi, ainda tenho interesse! Pode me passar mais detalhes?" },
    { nome: "Ponto do Eletricista", vend: "joao", horasAtras: 20, texto: "Oi! Vi a mensagem, pode me dar mais informações?" },
    { nome: "Papelaria Ideal", vend: "carla", horasAtras: 30, texto: "Ainda dá pra fechar no valor combinado?" },
    { nome: "Salão do Centro", vend: "lucas", horasAtras: 40, texto: "Qual o prazo de entrega?" },
    { nome: "Móveis do Centro", vend: "joao", horasAtras: 3, texto: "Oi, vocês têm esse item em estoque?" },
  ];
  const aguardando = AGUARDANDO_DEF.map((d) => addCliente({
    nome: d.nome, stage: "Respondeu", vendedorChave: d.vend, lastReplyAt: horasAtras(d.horasAtras), lastSentAt: diasAtras(1),
    semRespostaTexto: d.texto, semRespostaHoras: d.horasAtras,
  }));

  // --- 50 "Importados — Prospecção Agosto": funil próprio pra mostrar a tela de Clientes cheia ---
  const usados = new Set(clientes.map((c) => c.nome));
  function nomeUnico() { let n; do { n = `${pick(TIPOS_LOJA)} ${pick(COMPLEMENTOS_LOJA)}`; } while (usados.has(n)); usados.add(n); return n; }

  const TAG_IMPORT = "Importados — Prospecção Agosto";
  const IMPORT_PLAN = [
    ...Array(14).fill("Novo"), ...Array(16).fill("Contatado"), ...Array(7).fill("Respondeu"),
    ...Array(8).fill("Negociando"), ...Array(5).fill("Fechado"),
  ];
  const importados = IMPORT_PLAN.map((stage) => {
    const temInteracao = stage !== "Novo";
    const vendedorChave = ["Respondeu", "Negociando", "Fechado"].includes(stage) ? pick(["joao", "carla", "lucas"]) : (Math.random() < 0.4 ? pick(["joao", "carla", "lucas"]) : null);
    // "Negociando" sem próxima ação precisa de interação RECENTE (dentro do
    // limiar de negociação parada) -- senão todo lote de importados negociando
    // dispara o Radar de uma vez só. Os demais estágios usam a janela normal
    // de "prospecção de agosto" (10-15 dias), coerente com o nome da tag.
    const [diasEnvio, diasResposta] = stage === "Negociando" ? [1 + Math.floor(Math.random() * 3), 1 + Math.floor(Math.random() * 3)] : [12 + Math.floor(Math.random() * 4), 10 + Math.floor(Math.random() * 4)];
    return addCliente({
      nome: nomeUnico(), stage, vendedorChave, tags: [TAG_IMPORT], origem: "manual",
      lastSentAt: diasAtras(diasEnvio),
      lastReplyAt: temInteracao ? diasAtras(diasResposta) : null,
    });
  });

  // --- preenchimento do funil geral até bater o total sugerido -------------
  const FUNIL_ALVO = { Novo: 38, Contatado: 46, Respondeu: 31, Negociando: 22, Fechado: 17, Perdido: 9 };
  const jaAlocado = {};
  for (const c of clientes) jaAlocado[c.stage] = (jaAlocado[c.stage] || 0) + 1;

  // Bloco de "clientes parados" com dias de inatividade específicos, pra
  // fazer os pills de reativação (7/15/30/60/90) baterem com contagem
  // cumulativa decrescente. NUNCA aplicado a "Negociando" (ver comentário
  // acima) -- só Contatado/Respondeu/Fechado ficam "parados" por design.
  const DIAS_INATIVIDADE = [...Array(11).fill(8), ...Array(8).fill(18), ...Array(6).fill(35), ...Array(3).fill(65), ...Array(3).fill(95)];
  let idxIn = 0;
  for (const [stage, alvo] of Object.entries(FUNIL_ALVO)) {
    const faltam = alvo - (jaAlocado[stage] || 0);
    for (let i = 0; i < faltam; i++) {
      const vendedorChave = stage === "Novo" ? null : (["Respondeu", "Negociando"].includes(stage) ? pick(["joao", "carla", "lucas"]) : pick([null, "joao", "carla", "lucas"]));
      let lastSentAt, lastReplyAt;
      if (stage !== "Negociando" && idxIn < DIAS_INATIVIDADE.length && ["Fechado", "Contatado", "Respondeu"].includes(stage)) {
        const dias = DIAS_INATIVIDADE[idxIn++];
        lastSentAt = diasAtras(dias + 1);
        lastReplyAt = ["Respondeu", "Fechado"].includes(stage) ? diasAtras(dias) : null;
      } else if (stage === "Negociando") {
        // Recente sempre -- evita disparo em massa da regra "negociação parada".
        const diasRecente = 1 + Math.floor(Math.random() * 4);
        lastSentAt = diasAtras(diasRecente + 1);
        lastReplyAt = diasAtras(diasRecente);
      } else {
        const dr = pickPeso([[1, 3], [2, 3], [3, 2], [4, 2], [5, 1]]);
        lastSentAt = diasAtras(dr + 1);
        lastReplyAt = stage === "Novo" || stage === "Contatado" ? null : diasAtras(dr);
      }
      addCliente({ nome: nomeUnico(), stage, vendedorChave, tags: Math.random() < 0.3 ? [pick(TAGS)] : [], lastSentAt, lastReplyAt });
    }
  }

  return { clientes, porNome, aguardando, heroes: { mercadoBomPreco, autoPecasAvenida, casaDasTintas, constrularMateriais, clinicaVida, petShopAmigo, restauranteDoBairro, oficinaSaoJose, carlosAndrade } };
}

// ----------------------------------------------------------------------------
// Campanhas demo -- respondentes escolhidos por etapa ATUAL do CRM, pra que
// o cruzamento "CRM após campanha" (GET /api/schedules/:id) saia verdadeiro,
// nunca hardcoded.
//
// Importante sobre o preenchimento (destinatários que NÃO respondem a ESTA
// campanha): o próprio server.js calcula "quem respondeu" como "qualquer
// contato desta lista que tenha QUALQUER resposta registrada desde que esta
// campanha começou" -- não é limitado a respostas causadas por ela
// especificamente. Se o preenchimento reaproveitar um cliente que só vai
// responder a uma campanha MAIS NOVA (enviada depois desta), a resposta dele
// tem timestamp >= o início desta campanha e conta errado aqui também.
// O inverso é seguro: reaproveitar o respondente de uma campanha MAIS ANTIGA
// como preenchimento de uma mais nova não infla nada, porque a resposta dele
// é anterior ao início da campanha nova. Por isso `montarCampanhasPlano`
// processa as campanhas da mais antiga pra mais nova e vai acumulando um
// `safePool` (começa só com Novo/Contatado, que nunca respondem a nada, e
// cresce com os respondentes de cada campanha já processada).
// ----------------------------------------------------------------------------
function montarCampanha(clientes, safePool, { nome, diasAtrasCampanha, alvoEnviados, falhas, respondentesPorStage }) {
  const id = crypto.randomUUID();
  const startedAt = diasAtras(diasAtrasCampanha, 9).getTime();
  const finishedAt = startedAt + alvoEnviados * 4000;
  const createdAt = startedAt - 60000;

  const respondentesAlvo = [];
  for (const [stage, n] of Object.entries(respondentesPorStage)) {
    const pool = clientes.filter((c) => c.stage === stage && !c._usadoCampanha).slice(0, n);
    for (const c of pool) { c._usadoCampanha = true; respondentesAlvo.push(c); }
  }
  const totalResp = Object.values(respondentesPorStage).reduce((a, b) => a + b, 0);
  while (respondentesAlvo.length < totalResp) {
    const c = clientes.find((cl) => !cl._usadoCampanha && !respondentesAlvo.includes(cl));
    if (!c) break;
    c._usadoCampanha = true; respondentesAlvo.push(c);
  }

  const outros = safePool;
  const logs = [];
  for (let i = 0; i < falhas; i++) { const c = outros[i % outros.length]; logs.push({ phone: c.key, name: c.nome, ok: false, error: "Número inválido (demo)" }); }
  for (const c of respondentesAlvo) logs.push({ phone: c.key, name: c.nome, ok: true, error: null });
  let idx = 0;
  while (logs.length < alvoEnviados) {
    const c = outros[idx++ % outros.length];
    if (logs.find((l) => l.phone === c.key)) continue;
    logs.push({ phone: c.key, name: c.nome, ok: true, error: null });
  }
  const finalLogs = logs.slice(0, alvoEnviados);
  return {
    id, nome, startedAt, finishedAt, createdAt,
    message: `Olá {{nome}}! ${nome} — confira as novidades.`,
    result: { success: alvoEnviados - falhas, failed: falhas },
    logs: finalLogs, respondentes: respondentesAlvo,
  };
}

function montarCampanhasPlano(clientes) {
  // Novo/Contatado nunca respondem a nada no roteiro -- base sempre segura
  // de preenchimento, reaproveitável em qualquer campanha.
  const silentPool = clientes.filter((c) => c.stage === "Novo" || c.stage === "Contatado");
  // Ordem CRONOLÓGICA (mais antiga primeiro) -- ver comentário em montarCampanha
  // sobre por que essa ordem é necessária pro preenchimento não inflar as
  // campanhas mais antigas com respostas de campanhas mais novas.
  const defs = [
    { nome: "Clientes Parados — Reativação 30 dias", diasAtrasCampanha: 22, alvoEnviados: 54, falhas: 1, respondentesPorStage: { Negociando: 4, Fechado: 3, Respondeu: 6 } },
    { nome: "Novidades para Clientes", diasAtrasCampanha: 15, alvoEnviados: 64, falhas: 4, respondentesPorStage: { Respondeu: 9 } },
    { nome: "Promoção de Agosto", diasAtrasCampanha: 10, alvoEnviados: 120, falhas: 3, respondentesPorStage: { Negociando: 8, Fechado: 5, Perdido: 3, Respondeu: 10 } },
    { nome: "Oferta Especial de Sexta", diasAtrasCampanha: 5, alvoEnviados: 86, falhas: 2, respondentesPorStage: { Respondeu: 17 } },
  ];
  const safePool = [...silentPool];
  const campanhas = [];
  for (const def of defs) {
    const camp = montarCampanha(clientes, [...safePool], def);
    campanhas.push(camp);
    safePool.push(...camp.respondentes); // seguro como preenchimento das próximas (mais novas) campanhas do loop
  }
  return campanhas;
}

// ----------------------------------------------------------------------------
// Mensagens/respostas/conversas -- todo respondente de campanha recebe uma
// resposta "in" + uma "out" (resolvido), EXCETO os 7 clientes do grupo
// "aguardando" (ficam propositalmente sem retorno nosso). "conversasFinal"
// guarda só a ÚLTIMA mensagem por contato (por timestamp, não por ordem de
// inserção) -- é o mesmo critério que o app usa de verdade.
// ----------------------------------------------------------------------------
function montarConversasPlano(clientes, heroes, aguardando, campanhas) {
  const mensagens = []; // {cliente, text, dir, ts}
  const conversasFinal = new Map(); // key -> {cliente, text, dir, ts}
  function msg(cliente, text, dir, ts) {
    mensagens.push({ cliente, text, dir, ts });
    const atual = conversasFinal.get(cliente.key);
    if (!atual || ts > atual.ts) conversasFinal.set(cliente.key, { cliente, text, dir, ts });
  }

  const { mercadoBomPreco, autoPecasAvenida, casaDasTintas, constrularMateriais } = heroes;

  msg(mercadoBomPreco, "Olá, vi a promoção. Vocês conseguem me mandar um orçamento?", "in", diasAtras(2, 9).getTime());
  msg(mercadoBomPreco, "Claro! Vou preparar para você.", "out", diasAtras(2, 9, 20).getTime());
  msg(mercadoBomPreco, "Perfeito, preciso para hoje.", "in", diasAtras(2, 9, 40).getTime());

  // A saída é calculada a partir da entrada (+15min), nunca com hora aleatória
  // independente -- garante que a resposta nossa SEMPRE fica depois da
  // pergunta do cliente, mesmo que os minutos aleatórios de diasAtras() dessem
  // um resultado diferente em cada execução.
  const avenidaInTs = diasAtras(3, 10).getTime();
  msg(autoPecasAvenida, "Consegue manter aquela condição que conversamos?", "in", avenidaInTs);
  msg(autoPecasAvenida, "Consigo sim. Vou confirmar com você amanhã.", "out", avenidaInTs + 15 * 60000);

  const tintasInTs = diasAtras(5, 15).getTime();
  msg(casaDasTintas, "Fechado, pode separar.", "in", tintasInTs);
  msg(casaDasTintas, "Perfeito! Obrigado pela preferência.", "out", tintasInTs + 30 * 60000);

  const constrularInTs = diasAtras(4, 13).getTime();
  msg(constrularMateriais, "Qual a condição de pagamento pra pedido grande?", "in", constrularInTs);
  msg(constrularMateriais, "Pra pedidos acima de R$2.000 parcelamos em até 3x sem juros.", "out", constrularInTs + 20 * 60000);

  // Grupo "aguardando" -- SEM resposta nossa de propósito.
  for (const c of aguardando) msg(c, c.semRespostaTexto, "in", horasAtras(c.semRespostaHoras).getTime());

  // Todos os demais respondentes de campanha: "in" + "out" no mesmo lote (resolvidos).
  const heroesSet = new Set(Object.values(heroes));
  const aguardandoSet = new Set(aguardando);
  for (const camp of campanhas) {
    for (const c of camp.respondentes) {
      if (aguardandoSet.has(c) || heroesSet.has(c)) continue;
      const ts = camp.startedAt + 3600000 * (1 + Math.floor(Math.random() * 20));
      msg(c, "Oi! Vi a mensagem, pode me dar mais informações?", "in", ts);
      msg(c, "Olá! Claro, te explico certinho — qualquer dúvida é só chamar.", "out", ts + 1800000);
    }
  }

  return { mensagens, conversasFinal };
}

// ----------------------------------------------------------------------------
// Visitas -- hoje / 7 dias / 30 dias, distribuídas entre os 3 vendedores.
// Qualquer visita com resultado "Proposta solicitada" cujo cliente não tenha
// próxima ação ganha uma automaticamente (data futura) -- evita disparo do
// Radar ("nenhum retorno programado") por coincidência de sorteio.
// ----------------------------------------------------------------------------
function montarVisitasPlano(clientes, porNome, heroes) {
  const visitas = [];
  const { mercadoBomPreco, autoPecasAvenida, casaDasTintas, constrularMateriais, clinicaVida, petShopAmigo } = heroes;

  visitas.push({ cliente: mercadoBomPreco, vendedorChave: "joao", dataHora: diasAtras(5, 13, 15), motivo: "Apresentação", resultado: "Proposta solicitada", valor: 1200, obs: "Cliente interessado em pedido recorrente mensal." });
  visitas.push({ cliente: autoPecasAvenida, vendedorChave: "carla", dataHora: diasAtras(6, 16, 47), motivo: "Negociação", resultado: "Em negociação", valor: 1800, obs: "Negociando prazo de pagamento, aguardando aprovação interna do cliente." });
  visitas.push({ cliente: casaDasTintas, vendedorChave: "lucas", dataHora: diasAtras(5, 15, 4), motivo: "Negociação", resultado: "Venda fechada", valor: 1750, obs: "Fechado pedido de tintas e materiais para reforma." });
  visitas.push({ cliente: constrularMateriais, vendedorChave: "joao", dataHora: diasAtras(3, 18, 35), motivo: "Negociação", resultado: "Em negociação", valor: 1600, obs: "Aguardando confirmação de quantidade final." });
  // Proposta sem próximo passo (mostra a regra de Radar correspondente) --
  // ganham próxima ação futura no fechamento do plano, mais abaixo.
  visitas.push({ cliente: clinicaVida, vendedorChave: "lucas", dataHora: diasAtras(6, 13, 20), motivo: "Apresentação", resultado: "Proposta solicitada", valor: 700, obs: "Enviada proposta de manutenção mensal." });
  visitas.push({ cliente: petShopAmigo, vendedorChave: "joao", dataHora: diasAtras(7, 19, 5), motivo: "Prospecção", resultado: "Proposta solicitada", valor: 500, obs: "Proposta de fornecimento de ração enviada." });

  // HOJE: 5 visitas -- 4 concluídas + 1 em andamento (sem finished_at).
  const hojeNomes = ["Panificadora Central", "Loja Ideal", "Salão do Centro", "Móveis do Centro"];
  const hojeClientes = hojeNomes.map((n) => porNome.get(n)).filter(Boolean);
  const RESULT_HOJE = ["Interessado", "Proposta solicitada", "Em negociação", "Venda fechada"];
  const VEND_ROTATE = ["joao", "carla", "lucas"];
  hojeClientes.forEach((c, i) => visitas.push({
    cliente: c, vendedorChave: VEND_ROTATE[i % 3], dataHora: diasAtras(0, 8 + i * 2, 10),
    motivo: pick(["Prospecção", "Apresentação", "Negociação"]), resultado: RESULT_HOJE[i % RESULT_HOJE.length],
    valor: [650, 900, 1100, 1750][i], obs: "Visita registrada durante rota comercial de hoje.",
  }));
  const emAndamentoCliente = porNome.get("Mercado São Lucas");
  if (emAndamentoCliente) {
    const horaBase = HOJE.getHours() - 1 >= 8 ? HOJE.getHours() - 1 : 9;
    visitas.push({ cliente: emAndamentoCliente, vendedorChave: "carla", dataHora: diasAtras(0, horaBase, 10), motivo: "Negociação", resultado: null, valor: null, obs: "", emAndamento: true });
  }

  // Preenchimento (7 e 30 dias) por vendedor, respeitando alvo 18/15/12.
  const usadosVisita = new Set(visitas.map((v) => v.cliente));
  const disponiveis = clientes.filter((c) => !usadosVisita.has(c));
  const ALVO = { joao: 18, carla: 15, lucas: 12 };
  const jaVend = { joao: 0, carla: 0, lucas: 0 };
  for (const v of visitas) if (v.vendedorChave) jaVend[v.vendedorChave]++;
  const DIST_RES = [["Interessado", 4], ["Proposta solicitada", 2], ["Em negociação", 2], ["Venda fechada", 2], ["Retornar depois", 2], ["Sem interesse", 1], ["Sem contato", 1]];
  const VALORES = [300, 450, 550, 650, 750, 850, 950, 1050];
  let idxDisp = 0;
  for (const vendedorChave of ["joao", "carla", "lucas"]) {
    while (jaVend[vendedorChave] < ALVO[vendedorChave] && disponiveis.length) {
      const cliente = disponiveis[idxDisp++ % disponiveis.length];
      const resultado = pickPeso(DIST_RES);
      const temValor = ["Interessado", "Proposta solicitada", "Em negociação", "Venda fechada"].includes(resultado);
      const diasAt = 1 + Math.floor(Math.random() * 28);
      visitas.push({
        cliente, vendedorChave, dataHora: diasAtras(diasAt, 10 + Math.floor(Math.random() * 7)),
        motivo: pick(MOTIVOS_VISITA), resultado, valor: temValor ? pick(VALORES) : null,
        obs: "Visita registrada durante rota comercial.",
        proximaVisita: resultado === "Retornar depois" ? diasNaFrente(1 + Math.floor(Math.random() * 5)) : null,
      });
      jaVend[vendedorChave]++;
    }
  }

  // Fechamento: nenhuma visita "Proposta solicitada" fica sem próxima ação
  // no cliente correspondente -- evita disparo indevido do Radar.
  const jaTemAcaoFutura = (c) => c.proximaAcao && c.proximaAcao.data >= iso10(HOJE);
  const TEXTOS_FOLLOWUP = ["Retornar com condições finais da proposta", "Confirmar recebimento da proposta", "Acompanhar decisão do cliente", "Enviar proposta revisada", "Verificar aprovação do orçamento"];
  let idxTexto = 0;
  for (const v of visitas) {
    if (v.resultado !== "Proposta solicitada") continue;
    if (jaTemAcaoFutura(v.cliente)) continue;
    v.cliente.proximaAcao = {
      texto: TEXTOS_FOLLOWUP[idxTexto++ % TEXTOS_FOLLOWUP.length],
      data: iso10(diasNaFrente(2 + Math.floor(Math.random() * 4))), hora: "10:00",
      responsavelChave: v.vendedorChave,
    };
  }

  return visitas;
}

// ============================================================================
// EXECUÇÃO
// ============================================================================
async function run() {
  const jaExiste = await empresaExistente();
  if (MODO === "clear") return clear(jaExiste);
  if (jaExiste && MODO === "confirm") {
    console.error(`A empresa "${EMPRESA_NOME}" já existe (id ${jaExiste.id}). Rode com --clear antes de gerar de novo, pra não duplicar dados.`);
    process.exit(1);
  }

  const { clientes, porNome, aguardando, heroes } = montarPlano();
  const campanhas = montarCampanhasPlano(clientes);
  const { mensagens, conversasFinal } = montarConversasPlano(clientes, heroes, aguardando, campanhas);
  const visitas = montarVisitasPlano(clientes, porNome, heroes);
  const contatosAgenda = clientes.slice(0, 45);

  const resumo = {
    empresa: EMPRESA_NOME,
    vendedores: VENDEDORES.length,
    clientes: clientes.length,
    funil: clientes.reduce((acc, c) => ((acc[c.stage] = (acc[c.stage] || 0) + 1), acc), {}),
    campanhas: campanhas.map((c) => ({ nome: c.nome, enviados: c.logs.length, respondentes: c.respondentes.length })),
    conversasAguardando: aguardando.length,
    visitas: visitas.length,
    visitasHoje: visitas.filter((v) => iso10(v.dataHora) === iso10(HOJE)).length,
    oportunidadesKpi: visitas.filter((v) => ["Interessado", "Proposta solicitada", "Em negociação"].includes(v.resultado)).reduce((a, v) => a + (v.valor || 0), 0),
    contatosAgenda: contatosAgenda.length,
    templates: TEMPLATES.length,
    automacoes: AUTOMACOES.length,
  };

  console.log(`\n=== Plano (${MODO}) ===`);
  console.log(JSON.stringify(resumo, null, 2));

  if (MODO === "dry-run") {
    console.log("\nNenhuma alteração foi feita (--dry-run). Rode com --confirm para gravar de verdade.\n");
    return;
  }

  await gravar({ clientes, porNome, campanhas, mensagens, conversasFinal, visitas, contatosAgenda });
  console.log("\nBase demo criada com sucesso. Ver relatório impresso acima para os números finais.\n");
}

async function empresaExistente() {
  const db = getClient();
  const { data } = await db.from("empresas").select("id,name").eq("name", EMPRESA_NOME).maybeSingle();
  return data || null;
}

async function clear(empresa) {
  if (!empresa) { console.log(`Empresa "${EMPRESA_NOME}" não existe -- nada para limpar.`); return; }
  const db = getClient();
  const id = empresa.id;
  console.log(`Removendo TODOS os dados da empresa demo "${EMPRESA_NOME}" (id ${id})...`);
  // Ordem respeita FKs (filhas antes das mães). Cada delete é escopado por
  // empresa_id -- a mesma barreira de isolamento multiempresa usada no resto
  // do produto, então é estruturalmente impossível atingir outra empresa.
  const tabelas = [
    "destinatarios_campanha", "campanhas", "mensagens", "conversas", "respostas", "metricas_envios",
    "eventos_webhook", "visitas", "cliente_notas", "auditoria", "automacao_regras", "automacoes",
    "modelos_mensagem", "company_knowledge", "configuracoes_ia", "google_conexoes", "ia_consumo",
    "clientes", "contatos", "usuarios",
  ];
  for (const t of tabelas) {
    const { error } = await db.from(t).delete().eq("empresa_id", id);
    if (error) console.error(`  ! ${t}: ${error.message}`);
    else console.log(`  - ${t} limpo`);
  }
  await db.from("empresas").delete().eq("id", id);
  console.log(`Empresa "${EMPRESA_NOME}" removida.\n`);
}

async function gravar({ clientes, campanhas, mensagens, conversasFinal, visitas, contatosAgenda }) {
  // 1) Empresa (sem credencial Z-API -- nunca consegue enviar de verdade)
  const empresa = await empresasRepo.create({
    name: EMPRESA_NOME, zapiInstanceId: "", zapiInstanceToken: "", zapiClientToken: "",
    webhookSecret: crypto.randomBytes(24).toString("hex"),
  });
  console.log(`Empresa criada: ${empresa.name} (${empresa.id})`);

  // 2) Owner + vendedores
  const ownerHash = await bcrypt.hash("Demo@2026", 10);
  await usuariosRepo.create({ empresaId: empresa.id, username: "lojamodelo", passwordHash: ownerHash, role: "owner", name: "Dono da Loja Modelo" });
  const vendedorHash = await bcrypt.hash("Vendedor@2026", 10);
  const vendedoresPorChave = new Map();
  let seqVend = 900;
  for (const v of VENDEDORES) {
    const u = await usuariosRepo.create({ empresaId: empresa.id, username: `demo.${v.chave}`, passwordHash: vendedorHash, role: "vendedor", name: v.nome, phone: `550090${String(seqVend++).padStart(6, "0")}` });
    vendedoresPorChave.set(v.chave, u);
  }
  console.log(`Login owner: lojamodelo / Demo@2026`);
  console.log(`Login vendedores: demo.joao | demo.carla | demo.lucas / Vendedor@2026`);

  // 3) Perfil da empresa pra Zappy IA ter contexto (nenhuma chamada à OpenAI aqui)
  await configuracoesIaRepo.save(empresa.id, {
    segmento: "Loja de materiais e comércio local", descricao: "Empresa fictícia de demonstração do ZapFlow, comércio local de materiais de construção e itens diversos.",
    produtosServicos: "Materiais de construção, tintas, ferragens, itens de casa", publicoAlvo: "Pequenos comerciantes e consumidores da região",
    regiao: "Região metropolitana (fictícia)", tomComunicacao: "direto, cordial, comercial",
  });

  // 4) Clientes (+ próxima ação, quando houver)
  for (const c of clientes) {
    const responsavelId = c.vendedorChave ? vendedoresPorChave.get(c.vendedorChave)?.id : null;
    await clientesRepo.upsertOne(empresa.id, {
      id: c.id, key: c.key, phone: c.key, name: c.nome, stage: c.stage,
      tags: c.tags || [], origem: c.origem || "campanha", createdAt: (c.lastSentAt || diasAtras(20)).getTime(),
      lastSentAt: c.lastSentAt ? c.lastSentAt.getTime() : null, lastReplyAt: c.lastReplyAt ? c.lastReplyAt.getTime() : null,
      vendedorResponsavelId: responsavelId,
    });
    if (c.proximaAcao) {
      await clientesRepo.definirProximaAcao(empresa.id, c.id, {
        texto: c.proximaAcao.texto, data: c.proximaAcao.data, hora: c.proximaAcao.hora,
        responsavelId: c.proximaAcao.responsavelChave ? vendedoresPorChave.get(c.proximaAcao.responsavelChave)?.id : responsavelId,
      });
    }
  }
  console.log(`Clientes criados: ${clientes.length}`);

  // 5) Mensagens + respostas + conversas (thread final por contato)
  for (const m of mensagens) {
    await mensagensRepo.insertOne(empresa.id, { key: m.cliente.key, phone: m.cliente.key, text: m.text, dir: m.dir, ts: m.ts }, null, null);
    if (m.dir === "in") await respostasRepo.insertOne(empresa.id, { key: m.cliente.key, phone: m.cliente.key, content: m.text, ts: m.ts }, null);
  }
  for (const t of conversasFinal.values()) {
    await conversasRepo.upsertThread(empresa.id, { key: t.cliente.key, phone: t.cliente.key, text: t.text, dir: t.dir, ts: t.ts });
  }
  console.log(`Mensagens criadas: ${mensagens.length} | Threads de conversa: ${conversasFinal.size}`);

  // 6) Campanhas + destinatários + métricas (contatos/logs completos, já em memória)
  for (const camp of campanhas) {
    const job = {
      id: camp.id, name: camp.nome, message: camp.message,
      status: "concluido", immediate: false, hadImage: false, imageCount: 0,
      scheduledAt: camp.startedAt, startedAt: camp.startedAt, finishedAt: camp.finishedAt, createdAt: camp.createdAt,
      result: camp.result,
      contacts: camp.logs.map((l) => ({ phone: l.phone, name: l.name })), logs: camp.logs,
    };
    await campanhasRepo.upsertOne(empresa.id, job);
    await destinatariosRepo.replaceForCampaign(empresa.id, camp.id, camp.logs);
    await metricasRepo.insertOne(empresa.id, { ts: camp.startedAt, sent: camp.result.success, failed: camp.result.failed, name: camp.nome });
  }
  console.log(`Campanhas criadas: ${campanhas.length}`);

  // 7) Visitas (histórico já concluído -- inserção direta, sem passar pelo
  // fluxo de "iniciar visita" que é só pra registros ao vivo)
  const db = getClient();
  for (const v of visitas) {
    const vendedor = vendedoresPorChave.get(v.vendedorChave);
    const finishedAt = v.emAndamento ? null : new Date(v.dataHora.getTime() + 40 * 60000);
    const { error } = await db.from("visitas").insert({
      empresa_id: empresa.id, vendedor_id: vendedor?.id, cliente_id: v.cliente.id, cliente_nome: v.cliente.nome,
      objetivo: v.motivo, motivo: v.motivo, resultado: v.resultado, observacao: v.obs || "",
      valor_potencial: v.valor, data_hora: v.dataHora.toISOString(), finished_at: finishedAt ? finishedAt.toISOString() : null,
      proxima_visita_data: v.proximaVisita ? iso10(v.proximaVisita) : null,
    });
    if (error) console.error(`  ! visita ${v.cliente.nome}: ${error.message}`);
  }
  console.log(`Visitas criadas: ${visitas.length}`);

  // 8) Contatos (Agenda) -- reaproveita os primeiros clientes da base
  for (const c of contatosAgenda) {
    await contatosRepo.upsertOne(empresa.id, { id: crypto.randomUUID(), key: c.key, phone: c.key, name: c.nome, origem: c.origem === "manual" ? "manual" : "campanha", createdAt: (c.lastSentAt || diasAtras(20)).getTime() });
  }
  console.log(`Contatos (Agenda) criados: ${contatosAgenda.length}`);

  // 9) Respostas rápidas
  for (const t of TEMPLATES) await modelosRepo.upsertOne(empresa.id, { id: crypto.randomUUID(), name: t.name, message: t.message, imageUrls: [] });
  console.log(`Respostas rápidas criadas: ${TEMPLATES.length}`);

  // 10) Automações prontas (envio de mensagem sempre INATIVA)
  for (const a of AUTOMACOES) await automacaoRegrasRepo.criar(empresa.id, a);
  console.log(`Automações criadas: ${AUTOMACOES.length} (envio de mensagem inativo de propósito)`);

  console.log(`\nEmpresa demo pronta. Login: lojamodelo / Demo@2026 (id empresa: ${empresa.id})`);
}

run().catch((err) => { console.error("Erro fatal:", err); process.exit(1); });
