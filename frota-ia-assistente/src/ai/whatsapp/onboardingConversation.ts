import type { OnboardingState } from "@/lib/supabase/tables";
import type { CompanyRow } from "@/lib/supabase/tables";

/**
 * Onboarding conversacional pelo WhatsApp (Camada 6, seções 3-6 do prompt
 * V1-WhatsApp): uma pergunta por vez, sem formulário, com estado explícito
 * em vez de depender só do histórico de texto. Função pura — quem chama
 * (o webhook) é responsável por persistir o estado/collected_data e por
 * finalizar (criar company/vehicle) quando finalize=true.
 */

export type OnboardingCompanyType = CompanyRow["company_type"];

export interface OnboardingCollectedData {
  name?: string;
  profileLabel?: string;
  companyType?: OnboardingCompanyType;
  baseCity?: string;
  baseState?: string;
  vehicleCount?: number;
  primaryVehicleRaw?: string;
  primaryVehicleSkipped?: boolean;
}

export interface OnboardingStepResult {
  nextState: OnboardingState;
  reply: string;
  collectedData: OnboardingCollectedData;
  /** true só quando nextState === 'completed' — sinaliza ao webhook para criar company/vehicle de verdade. */
  finalize: boolean;
}

const CANCEL_WORDS = ["cancelar"];
const PAUSE_WORDS = ["continuar depois", "depois eu continuo", "pausar"];
const SKIP_WORDS = ["pular", "depois"];

function norm(text: string): string {
  return text.trim().toLowerCase();
}

export function firstOnboardingMessage(): string {
  return "Olá! Eu sou o Frota IA, seu assistente especializado em transporte rodoviário.\n\nAntes de começarmos, como posso chamar você?";
}

function askProfile(name: string): string {
  return `Prazer, ${name}! Você trabalha como motorista autônomo ou administra uma frota? (autônomo, dono de frota, gestor de frota, transportadora ou outro)`;
}

function askBaseLocation(): string {
  return "Qual cidade ou região você utiliza como base principal?";
}

function askVehicleCount(): string {
  return "Quantos veículos você possui ou administra atualmente?";
}

function askPrimaryVehicle(): string {
  return 'Qual é o veículo que você utiliza com mais frequência? Pode informar marca, modelo e ano. Caso não queira cadastrar agora, responda "depois".';
}

function completionMessage(): string {
  return "Pronto, seu acesso ao Frota IA está configurado.\n\nVocê já pode analisar fretes, calcular custos, consultar jornada, comparar pneus e muito mais. O que deseja fazer agora?";
}

function parseCompanyType(text: string): { companyType: OnboardingCompanyType; label: string } | null {
  const t = norm(text);
  if (t.includes("autônomo") || t.includes("autonomo") || t.includes("motorista")) {
    return { companyType: "autonomo", label: "motorista autônomo" };
  }
  if (t.includes("transportadora")) {
    return { companyType: "transportadora", label: "transportadora" };
  }
  if (t.includes("gestor")) {
    return { companyType: "transportadora", label: "gestor de frota" };
  }
  if (t.includes("dono") || t.includes("frota")) {
    return { companyType: "transportadora", label: "dono de frota" };
  }
  if (t.includes("embarcador")) {
    return { companyType: "embarcador", label: "embarcador" };
  }
  if (t.trim().length > 0) {
    return { companyType: "outro", label: "outro profissional do transporte" };
  }
  return null;
}

const NUMBER_WORDS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  três: 3,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
};

function parseVehicleCount(text: string): number | null {
  const digitMatch = text.match(/\d+/);
  if (digitMatch) return Number(digitMatch[0]);

  const t = norm(text);
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (t.includes(word)) return value;
  }
  return null;
}

function parseBaseLocation(text: string): { city: string; state?: string } {
  const parts = text.split(/[-,/]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const maybeState = parts[parts.length - 1];
    if (/^[A-Za-z]{2}$/.test(maybeState)) {
      return { city: parts.slice(0, -1).join(", "), state: maybeState.toUpperCase() };
    }
  }
  return { city: text.trim() };
}

/**
 * Processa uma mensagem recebida durante o onboarding. `state` nunca deve
 * ser 'not_started' (isso é resolvido antes, criando a sessão já em
 * 'awaiting_name') nem 'completed' (onboarding concluído não roteia mais
 * para cá).
 */
export function processOnboardingMessage(
  state: OnboardingState,
  collectedData: OnboardingCollectedData,
  incomingText: string
): OnboardingStepResult {
  const t = norm(incomingText);

  if (state !== "paused" && CANCEL_WORDS.some((w) => t === w || t.includes(w))) {
    return {
      nextState: "paused",
      reply: "Sem problema, cancelei o cadastro por aqui. Quando quiser recomeçar, é só mandar uma mensagem.",
      collectedData,
      finalize: false,
    };
  }

  if (state !== "paused" && PAUSE_WORDS.some((w) => t.includes(w))) {
    return {
      nextState: "paused",
      reply: "Tudo bem, paro por aqui. Quando quiser continuar o cadastro, é só me chamar de novo.",
      collectedData,
      finalize: false,
    };
  }

  if (state === "paused") {
    // Qualquer mensagem retoma de onde parou — mas não sabemos "onde parou"
    // sem o estado anterior, então reiniciamos a pergunta mais básica ainda
    // não respondida a partir do collectedData já salvo.
    if (!collectedData.name) return { nextState: "awaiting_name", reply: firstOnboardingMessage(), collectedData, finalize: false };
    if (!collectedData.companyType) return { nextState: "awaiting_profile", reply: askProfile(collectedData.name), collectedData, finalize: false };
    if (!collectedData.baseCity) return { nextState: "awaiting_base_location", reply: askBaseLocation(), collectedData, finalize: false };
    if (collectedData.vehicleCount === undefined) return { nextState: "awaiting_vehicle_count", reply: askVehicleCount(), collectedData, finalize: false };
    return { nextState: "awaiting_primary_vehicle", reply: askPrimaryVehicle(), collectedData, finalize: false };
  }

  switch (state) {
    case "awaiting_name": {
      const name = incomingText.trim();
      if (!name) {
        return { nextState: state, reply: "Não entendi — como posso te chamar?", collectedData, finalize: false };
      }
      const updated = { ...collectedData, name };
      return { nextState: "awaiting_profile", reply: askProfile(name), collectedData: updated, finalize: false };
    }

    case "awaiting_profile": {
      const parsed = parseCompanyType(incomingText);
      if (!parsed) {
        return { nextState: state, reply: "Pode me dizer se você é motorista autônomo, dono de frota, gestor de frota, transportadora ou outro profissional do transporte?", collectedData, finalize: false };
      }
      const updated = { ...collectedData, companyType: parsed.companyType, profileLabel: parsed.label };
      return { nextState: "awaiting_base_location", reply: askBaseLocation(), collectedData: updated, finalize: false };
    }

    case "awaiting_base_location": {
      if (!incomingText.trim()) {
        return { nextState: state, reply: "Qual cidade ou região você usa como base?", collectedData, finalize: false };
      }
      const { city, state: uf } = parseBaseLocation(incomingText);
      const updated = { ...collectedData, baseCity: city, baseState: uf };
      return { nextState: "awaiting_vehicle_count", reply: askVehicleCount(), collectedData: updated, finalize: false };
    }

    case "awaiting_vehicle_count": {
      if (SKIP_WORDS.some((w) => t.includes(w))) {
        const updated = { ...collectedData, vehicleCount: 1 };
        return { nextState: "awaiting_primary_vehicle", reply: askPrimaryVehicle(), collectedData: updated, finalize: false };
      }
      const count = parseVehicleCount(incomingText);
      if (count === null || count <= 0) {
        return { nextState: state, reply: "Pode me passar a quantidade de veículos em número? Ex.: 1, 3, 12.", collectedData, finalize: false };
      }
      const updated = { ...collectedData, vehicleCount: count };
      return { nextState: "awaiting_primary_vehicle", reply: askPrimaryVehicle(), collectedData: updated, finalize: false };
    }

    case "awaiting_primary_vehicle": {
      if (SKIP_WORDS.some((w) => t.includes(w))) {
        const updated = { ...collectedData, primaryVehicleSkipped: true };
        return { nextState: "completed", reply: completionMessage(), collectedData: updated, finalize: true };
      }
      const updated = { ...collectedData, primaryVehicleRaw: incomingText.trim() };
      return { nextState: "completed", reply: completionMessage(), collectedData: updated, finalize: true };
    }

    default:
      return { nextState: state, reply: "Pode repetir, por favor?", collectedData, finalize: false };
  }
}
