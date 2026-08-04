/**
 * Conteúdo de referência sobre as 22 ferramentas do Frota IA, organizado
 * por categoria com exemplos reais de mensagem.
 *
 * Desde a reformulação das sugestões iniciais (10 itens em
 * src/lib/frotaSuggestions.ts), este arquivo NÃO é mais usado pra montar
 * a lista nativa do WhatsApp — isso agora é `frotaSuggestions.ts`. O que
 * sobra aqui, ainda em uso:
 * 1. `ehPedidoDeAjuda` — detecta a frase-gatilho ("ajuda"/"menu"/
 *    "opções"/"sugestões" etc.) que reabre a lista de 10 sugestões
 *    (webhook chama `frotaSuggestions.ts` diretamente, não este arquivo);
 * 2. `construirTextoAjudaCompleto` — referência completa embutida no
 *    system prompt, pra painel web e qualquer pergunta tipo "o que você
 *    faz" que peça mais detalhe que as 10 sugestões cobrem.
 *
 * Não importa nada de "server-only" — precisa ser seguro de importar tanto
 * no webhook (servidor) quanto em componentes client do painel web.
 */

export interface CategoriaAjuda {
  id: string;
  emoji: string;
  titulo: string;
  /** 2-4 frases de exemplo, sempre mensagens reais que o cliente mandaria. */
  exemplos: string[];
}

export const CATEGORIAS_AJUDA: CategoriaAjuda[] = [
  {
    id: "fretes",
    emoji: "🚛",
    titulo: "Fretes e viagens",
    exemplos: [
      "Esse frete de R$ 4.200 pra Santos compensa?",
      "Analise este CT-e (manda a foto)",
      "Tenho duas propostas de frete, compare pra mim",
      "Qual o valor mínimo que posso cobrar nesse frete?",
    ],
  },
  {
    id: "combustivel_custos",
    emoji: "⛽",
    titulo: "Combustível e custos",
    exemplos: [
      "Meu caminhão faz 2,5 km/l, quanto vou gastar até Curitiba?",
      "Calcula meu CPK",
      "Quanto custa meu caminhão parado por 3 dias?",
      "Qual minha margem nesse frete?",
    ],
  },
  {
    id: "pneus_manutencao",
    emoji: "🛞",
    titulo: "Pneus e manutenção",
    exemplos: ["Vale mais a pena recapar ou comprar pneu novo?", "De quanto em quanto tempo faço manutenção preventiva?"],
  },
  {
    id: "documentos",
    emoji: "📄",
    titulo: "Documentos",
    exemplos: ["Manda foto de nota fiscal, CRLV, CT-e ou comprovante de seguro", "Gera o relatório dessa análise em PDF", "Quais documentos eu já gerei?"],
  },
  {
    id: "alertas_agenda",
    emoji: "🔔",
    titulo: "Alertas, agenda e vencimentos",
    exemplos: ["Me avise 15 dias antes de vencer o seguro", "Me lembra de cobrar esse frete daqui a 30 dias", "Marca a revisão do caminhão pra semana que vem"],
  },
  {
    id: "jornada",
    emoji: "🕐",
    titulo: "Jornada",
    exemplos: ["Vou sair amanhã às 5h de Curitiba pra São Paulo, organize minha jornada", "Dá tempo de fazer essa viagem sozinho, sem parar?"],
  },
  {
    id: "rotas",
    emoji: "🗺️",
    titulo: "Rotas salvas",
    exemplos: ["Salva essa rota", "Quais rotas eu tenho salvas?"],
  },
  {
    id: "historico_legislacao",
    emoji: "📊",
    titulo: "Histórico e legislação",
    exemplos: ["Traga a análise que eu fiz semana passada", "Esse valor está acima do piso mínimo da ANTT?", "Qual o preço do diesel essa semana?"],
  },
];

const PALAVRAS_GATILHO_AJUDA = [
  "ajuda",
  "menu",
  "opções",
  "opcoes",
  "sugestões",
  "sugestoes",
  "funções",
  "funcoes",
  "o que você pode fazer",
  "o que voce pode fazer",
  "o que você faz",
  "o que voce faz",
  "mostrar funções",
  "mostrar funcoes",
  "quais são as funções",
  "quais sao as funcoes",
  "help",
];

/** Tolerante: casa por inclusão, não exige frase exata (mesmo padrão do parser de onboarding). */
export function ehPedidoDeAjuda(texto: string | undefined | null): boolean {
  if (!texto) return false;
  const normalizado = texto.trim().toLowerCase();
  if (normalizado.length > 60) return false; // frase de ajuda é curta — evita falso positivo em mensagem longa que só cita a palavra "ajuda" de passagem
  return PALAVRAS_GATILHO_AJUDA.some((gatilho) => normalizado === gatilho || normalizado.includes(gatilho));
}

/** Versão em texto corrido (painel web / referência no system prompt) — sem sintaxe de lista nativa do WhatsApp. */
export function construirTextoAjudaCompleto(): string {
  return CATEGORIAS_AJUDA.map((categoria) => {
    const exemplos = categoria.exemplos.map((ex) => `  - "${ex}"`).join("\n");
    return `${categoria.emoji} ${categoria.titulo}\n${exemplos}`;
  }).join("\n\n");
}
