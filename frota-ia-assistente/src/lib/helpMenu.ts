/**
 * Conteúdo único do "menu de ajuda" — cobre as 22 ferramentas do Frota IA,
 * organizadas por categoria com exemplos reais de mensagem. Usado em 3
 * lugares que precisam ficar sempre em sincronia:
 * 1. Mensagem de conclusão do onboarding (WhatsApp, lista nativa);
 * 2. Comando de ajuda permanente no WhatsApp ("ajuda"/"menu"/"o que você
 *    pode fazer"), interceptado no webhook antes de chegar na IA — resposta
 *    determinística, sem gastar chamada de modelo, mesmo princípio já usado
 *    no onboarding;
 * 3. Referência embutida no system prompt, pro painel web (e qualquer
 *    pergunta do tipo "o que você faz" que escape do intercept do
 *    WhatsApp) responder de forma completa e consistente, sem depender de
 *    a IA improvisar/esquecer alguma categoria.
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

export interface ListaAjudaWhatsapp {
  texto: string;
  titulo: string;
  botao: string;
  opcoes: Array<{ id: string; title: string; description: string }>;
}

/** Monta o payload pronto pra `sendWhatsappOptionList` — uma linha por categoria, com exemplo na descrição. */
export function construirListaAjudaWhatsapp(introducao: string): ListaAjudaWhatsapp {
  return {
    texto: introducao,
    titulo: "Como posso ajudar",
    botao: "Ver funções",
    opcoes: CATEGORIAS_AJUDA.map((categoria) => ({
      id: categoria.id,
      title: `${categoria.emoji} ${categoria.titulo}`,
      description: categoria.exemplos[0],
    })),
  };
}

/** Detalhe de uma categoria específica (usado quando o cliente toca numa linha do menu). */
export function construirDetalheCategoria(categoriaId: string): string | null {
  const categoria = CATEGORIAS_AJUDA.find((c) => c.id === categoriaId);
  if (!categoria) return null;
  const exemplos = categoria.exemplos.map((ex) => `• "${ex}"`).join("\n");
  return `${categoria.emoji} *${categoria.titulo}*\n\n${exemplos}\n\nÉ só mandar uma mensagem parecida com essas.`;
}

/** Versão em texto corrido (painel web / referência no system prompt) — sem sintaxe de lista nativa do WhatsApp. */
export function construirTextoAjudaCompleto(): string {
  return CATEGORIAS_AJUDA.map((categoria) => {
    const exemplos = categoria.exemplos.map((ex) => `  - "${ex}"`).join("\n");
    return `${categoria.emoji} ${categoria.titulo}\n${exemplos}`;
  }).join("\n\n");
}
