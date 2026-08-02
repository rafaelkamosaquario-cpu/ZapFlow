import type { SuggestionPrompt } from "@/types";

export const APP_NAME = "Frota IA Assistente";

export const APP_TAGLINE = "Seu especialista virtual em transporte e gestão de frotas";

export const PLACEHOLDER_RESPONSE =
  "Em breve este assistente será conectado à inteligência artificial.";

export const SUGGESTION_PROMPTS: SuggestionPrompt[] = [
  {
    id: "analisar-frete",
    label: "Analisar um frete",
    prompt: "Esse frete compensa?",
    icon: "truck",
  },
  {
    id: "calcular-consumo",
    label: "Calcular consumo",
    prompt: "Meu caminhão está fazendo 2,8 km/l. Isso é bom?",
    icon: "gauge",
  },
  {
    id: "calcular-cpk",
    label: "Calcular CPK",
    prompt: "Como calcular CPK?",
    icon: "calculator",
  },
  {
    id: "comparar-pneus",
    label: "Comparar pneus",
    prompt: "Vale mais a pena recapar ou comprar um pneu novo?",
    icon: "circleDot",
  },
  {
    id: "comparar-propostas",
    label: "Comparar propostas",
    prompt: "Tenho duas propostas de frete, qual compensa mais?",
    icon: "scale",
  },
  {
    id: "custos-frota",
    label: "Custos da frota",
    prompt: "Quanto custa rodar um caminhão?",
    icon: "wallet",
  },
  {
    id: "criar-lembrete",
    label: "Criar um lembrete",
    prompt: "Me avise 15 dias antes de vencer o seguro do caminhão",
    icon: "bell",
  },
  {
    id: "organizar-jornada",
    label: "Organizar jornada",
    prompt: "Vou sair amanhã às 5h de Curitiba pra São Paulo, organize minha jornada",
    icon: "clock",
  },
  {
    id: "consultar-historico",
    label: "Consultar histórico",
    prompt: "Traga a análise que eu fiz semana passada",
    icon: "history",
  },
  {
    id: "salvar-rota",
    label: "Salvar uma rota",
    prompt: "Salva a rota de Sorriso até Santos",
    icon: "mapPin",
  },
];
