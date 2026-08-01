import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";
import { createAdminClient } from "@/lib/supabase/admin";
import { updatePreferences } from "@/services/supabase/companyPreferencesService";

/**
 * Ferramenta: definir_estilo_resposta
 *
 * Ferramenta de INTEGRAÇÃO (I/O real com Supabase — company_preferences),
 * mesmo padrão de `gerenciar_alerta`/`registrar_despesa`. Grava em
 * `company_preferences.preferred_response_style`, coluna que já existia
 * (usada por `updatePreferences`, nunca chamada por nenhum caminho até
 * agora) mas nunca era lida pelo system prompt para variar o tom.
 *
 * Só muda a FORMA da resposta (simples/técnica/objetiva) — nunca os
 * números calculados, que são sempre os mesmos independente do estilo
 * (ver regra correspondente no system prompt).
 */

export type EstiloResposta = "SIMPLES" | "TECNICO" | "OBJETIVO";

const ESTILOS: EstiloResposta[] = ["SIMPLES", "TECNICO", "OBJETIVO"];

export interface DefinirEstiloRespostaEntrada {
  userId: string;
  companyId: string;
  conversationId?: string;
  estilo: EstiloResposta;
}

export interface DefinirEstiloRespostaResultado extends ResultadoFerramentaBase {
  estilo?: EstiloResposta;
}

function respostaFalha(alertas: string[]): DefinirEstiloRespostaResultado {
  return { sucesso: false, alertas, premissas: [], dadosFaltantes: ["estilo"], mensagemResumo: alertas[0] ?? "Não foi possível salvar o estilo de resposta." };
}

async function executar(entrada: DefinirEstiloRespostaEntrada): Promise<DefinirEstiloRespostaResultado> {
  const { userId, companyId, estilo } = entrada;

  if (!userId || !companyId) {
    return { sucesso: false, alertas: ["Não foi possível identificar o usuário/empresa."], premissas: [], dadosFaltantes: ["userId", "companyId"], mensagemResumo: "Não foi possível salvar o estilo de resposta." };
  }
  if (!estilo || !ESTILOS.includes(estilo)) {
    return respostaFalha([`Estilo inválido: "${estilo}". Use um de: ${ESTILOS.join(", ")}.`]);
  }

  try {
    const admin = createAdminClient();
    await updatePreferences(admin, companyId, userId, { preferredResponseStyle: estilo.toLowerCase() });

    return {
      sucesso: true,
      alertas: [],
      premissas: [],
      dadosFaltantes: [],
      estilo,
      mensagemResumo: `Estilo de resposta definido como ${estilo.toLowerCase()}.`,
    };
  } catch {
    return respostaFalha(["Não foi possível salvar o estilo de resposta agora. Tente novamente em instantes."]);
  }
}

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  { nome: "userId", tipo: "string", obrigatorio: true, descricao: "Usuário dono da empresa (do contexto da conversa, nunca da mensagem)." },
  { nome: "companyId", tipo: "string", obrigatorio: true, descricao: "Empresa dona da preferência (do contexto da conversa)." },
  { nome: "conversationId", tipo: "string", obrigatorio: false, descricao: "Conversa de origem." },
  {
    nome: "estilo",
    tipo: "enum",
    obrigatorio: true,
    descricao: "SIMPLES: linguagem direta, sem jargão. TECNICO: terminologia precisa e detalhamento completo. OBJETIVO: padrão atual, direto sem ser nem simples nem técnico.",
    valoresPossiveis: ESTILOS,
  },
];

export const ferramentaDefinirEstiloResposta: DefinicaoFerramenta<DefinirEstiloRespostaEntrada, DefinirEstiloRespostaResultado> = {
  nome: "definir_estilo_resposta",
  descricao: "Salva a preferência do cliente sobre como a IA deve explicar os cálculos (simples, técnico ou objetivo) — persiste entre conversas.",
  objetivo:
    "Deixar o cliente escolher o jeito de conversa que prefere, sem precisar pedir de novo a cada conversa. Nunca muda os números calculados, só a forma de explicá-los.",
  parametros: PARAMETROS,
  executar,
};
