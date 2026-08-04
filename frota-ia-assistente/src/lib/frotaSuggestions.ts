/**
 * Fonte única das 10 sugestões iniciais do Frota IA — usada nos 2 ambientes
 * (mensagem pós-onboarding no WhatsApp e cards da tela inicial do painel
 * web), pra nunca ter texto/id duplicado e divergente entre os dois.
 *
 * Sem "server-only": importado tanto no webhook (servidor) quanto em
 * componente client do painel.
 *
 * `whatsappTitle`/`whatsappDescription` existem separados de `title`/
 * `description` pra permitir copy diferente por canal no futuro — hoje são
 * idênticos porque só foi especificada uma versão de texto por sugestão.
 *
 * `intent` reservado pra roteamento futuro (ex.: abrir direto uma
 * ferramenta específica em vez de só preencher o campo de texto) — hoje não
 * é lido em lugar nenhum, só identifica a sugestão de forma estável.
 *
 * `icon` é o nome do ícone Lucide (PascalCase) usado na web. Onde a
 * especificação sugeriu dois ícones combinados (ex.: "Truck acompanhado de
 * CircleDollarSign"), o tipo só comporta um — usei o principal e deixei o
 * secundário anotado no comentário de cada item, caso o card evolua pra
 * suportar ícone composto depois.
 */

export interface FrotaSuggestion {
  id: string;
  title: string;
  description: string;
  icon: string;
  intent: string;
  whatsappTitle: string;
  whatsappDescription: string;
}

export const FROTA_SUGGESTIONS: FrotaSuggestion[] = [
  {
    id: "analisar_frete",
    title: "Analisar um frete",
    description: "Esse frete compensa?",
    icon: "Truck", // secundário sugerido: CircleDollarSign
    intent: "analisar_frete",
    whatsappTitle: "Analisar um frete",
    whatsappDescription: "Esse frete compensa?",
  },
  {
    id: "calcular_consumo",
    title: "Calcular consumo",
    description: "Meu caminhão está fazendo 2,8 km/l. Isso é bom?",
    icon: "Gauge",
    intent: "calcular_consumo",
    whatsappTitle: "Calcular consumo",
    whatsappDescription: "Meu caminhão está fazendo 2,8 km/l. Isso é bom?",
  },
  {
    id: "calcular_cpk",
    title: "Calcular CPK",
    description: "Como calcular CPK?",
    icon: "Calculator",
    intent: "calcular_cpk",
    whatsappTitle: "Calcular CPK",
    whatsappDescription: "Como calcular CPK?",
  },
  {
    id: "comparar_pneus",
    title: "Comparar pneus",
    description: "Vale mais a pena recapar ou comprar um pneu novo?",
    icon: "CircleGauge",
    intent: "comparar_pneus",
    whatsappTitle: "Comparar pneus",
    whatsappDescription: "Vale mais a pena recapar ou comprar um pneu novo?",
  },
  {
    id: "comparar_propostas",
    title: "Comparar propostas",
    description: "Tenho duas propostas de frete, qual compensa mais?",
    icon: "Scale",
    intent: "comparar_propostas",
    whatsappTitle: "Comparar propostas",
    whatsappDescription: "Tenho duas propostas de frete, qual compensa mais?",
  },
  {
    id: "custos_frota",
    title: "Custos da frota",
    description: "Quanto custa rodar um caminhão?",
    icon: "WalletCards",
    intent: "custos_frota",
    whatsappTitle: "Custos da frota",
    whatsappDescription: "Quanto custa rodar um caminhão?",
  },
  {
    id: "criar_lembrete",
    title: "Criar um lembrete",
    description: "Me avise 15 dias antes de vencer o seguro do caminhão",
    icon: "Bell",
    intent: "criar_lembrete",
    whatsappTitle: "Criar um lembrete",
    whatsappDescription: "Me avise 15 dias antes de vencer o seguro do caminhão",
  },
  {
    id: "organizar_jornada",
    title: "Organizar jornada",
    description: "Vou sair amanhã às 5h de Curitiba pra São Paulo, organize minha jornada",
    icon: "Clock3",
    intent: "organizar_jornada",
    whatsappTitle: "Organizar jornada",
    whatsappDescription: "Vou sair amanhã às 5h de Curitiba pra São Paulo, organize minha jornada",
  },
  {
    id: "consultar_historico",
    title: "Consultar histórico",
    description: "Traga a análise que eu fiz semana passada",
    icon: "History",
    intent: "consultar_historico",
    whatsappTitle: "Consultar histórico",
    whatsappDescription: "Traga a análise que eu fiz semana passada",
  },
  {
    id: "salvar_rota",
    title: "Salvar uma rota",
    description: "Salva a rota de Sorriso até Santos",
    icon: "MapPin",
    intent: "salvar_rota",
    whatsappTitle: "Salvar uma rota",
    whatsappDescription: "Salva a rota de Sorriso até Santos",
  },
];

/**
 * Resolve a resposta de um menu numerado em texto (fallback do WhatsApp,
 * usado só quando o envio da lista nativa falha) — aceita o número (1-10)
 * ou o título exato da sugestão. Só deve ser chamado quando a sessão
 * estiver de fato aguardando essa escolha (ver `awaitingNumberedMenuSelection`
 * em onboarding_sessions.collected_data no webhook) — nunca em mensagem
 * solta, pra não confundir um número de cálculo com escolha de menu.
 */
export function resolverSelecaoNumerada(texto: string | undefined | null): FrotaSuggestion | undefined {
  if (!texto) return undefined;
  const normalizado = texto.trim().toLowerCase();

  const numero = Number(normalizado);
  if (Number.isInteger(numero) && numero >= 1 && numero <= FROTA_SUGGESTIONS.length) {
    return FROTA_SUGGESTIONS[numero - 1];
  }

  return FROTA_SUGGESTIONS.find((s) => s.title.toLowerCase() === normalizado);
}
