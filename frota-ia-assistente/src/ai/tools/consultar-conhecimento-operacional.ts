import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";

/**
 * Ferramenta: consultar_conhecimento_operacional
 *
 * Ferramenta de INTEGRAÇÃO (I/O real — leitura de arquivo local), mesmo
 * padrão de `consultar_historico`. Fecha a lacuna entre o que o Prompt
 * Mestre original prometia (especialidade em negociação, manutenção,
 * pneus, gestão, jornada) e o que existia de fato: fórmulas de cálculo +
 * busca ao vivo em fonte oficial, sem nenhum conteúdo de boas práticas
 * operacionais por trás.
 *
 * Diferente da ANTT/ANP (fato regulatório que muda e precisa de fonte
 * oficial ao vivo), o conteúdo aqui é referência de boas práticas — por
 * isso vive em arquivo local versionado (`src/ai/conhecimentos/`), não em
 * busca externa. Não é RAG/embedding: com só 5 tópicos fixos e bem
 * definidos, o próprio Claude já escolhe o tópico certo pela descrição do
 * parâmetro, sem precisar de busca semântica.
 *
 * Nunca é fonte de número fixo, fato legal ou dado calculado — cada
 * arquivo se declara "referência geral" e aponta de volta pras ferramentas
 * que calculam o número de verdade (ver rodapé de cada .md). O rascunho de
 * conteúdo foi escrito por mim (Claude) com linguagem propositalmente
 * hedged ("referência", "costuma", "tende a") — precisa de revisão do
 * Rafael antes de ir pro ar, ver conversa que originou este arquivo.
 */

export type TopicoConhecimentoOperacional =
  | "NEGOCIACAO_E_ATENDIMENTO"
  | "MANUTENCAO_PREVENTIVA"
  | "PNEUS_E_DIRECAO_ECONOMICA"
  | "GESTAO_E_INDICADORES"
  | "JORNADA_E_BEM_ESTAR";

const ARQUIVO_POR_TOPICO: Record<TopicoConhecimentoOperacional, string> = {
  NEGOCIACAO_E_ATENDIMENTO: "negociacao-e-atendimento.md",
  MANUTENCAO_PREVENTIVA: "manutencao-preventiva.md",
  PNEUS_E_DIRECAO_ECONOMICA: "pneus-e-direcao-economica.md",
  GESTAO_E_INDICADORES: "gestao-e-indicadores.md",
  JORNADA_E_BEM_ESTAR: "jornada-e-bem-estar.md",
};

const TOPICOS = Object.keys(ARQUIVO_POR_TOPICO) as TopicoConhecimentoOperacional[];

export interface ConsultarConhecimentoOperacionalEntrada {
  topico: TopicoConhecimentoOperacional;
}

export interface ConsultarConhecimentoOperacionalResultado extends ResultadoFerramentaBase {
  topico?: TopicoConhecimentoOperacional;
  conteudo?: string;
}

async function executar(entrada: ConsultarConhecimentoOperacionalEntrada): Promise<ConsultarConhecimentoOperacionalResultado> {
  const { topico } = entrada;

  if (!topico || !TOPICOS.includes(topico)) {
    return {
      sucesso: false,
      alertas: [`Tópico inválido: "${topico}". Use um de: ${TOPICOS.join(", ")}.`],
      premissas: [],
      dadosFaltantes: ["topico"],
      mensagemResumo: "Tópico de conhecimento operacional inválido.",
    };
  }

  try {
    const caminho = join(process.cwd(), "src", "ai", "conhecimentos", ARQUIVO_POR_TOPICO[topico]);
    const conteudo = await readFile(caminho, "utf-8");

    return {
      sucesso: true,
      alertas: [],
      premissas: ["Conteúdo de referência/boas práticas — nunca substitui número calculado pelas ferramentas nem fato regulatório buscado em fonte oficial."],
      dadosFaltantes: [],
      topico,
      conteudo,
      mensagemResumo: `Conhecimento operacional sobre "${topico}" carregado.`,
    };
  } catch {
    return {
      sucesso: false,
      alertas: ["Não foi possível carregar esse conteúdo agora."],
      premissas: [],
      dadosFaltantes: [],
      mensagemResumo: "Não foi possível carregar o conhecimento operacional agora.",
    };
  }
}

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  {
    nome: "topico",
    tipo: "enum",
    obrigatorio: true,
    descricao:
      "NEGOCIACAO_E_ATENDIMENTO: ler proposta de frete, red flags, comunicação com embarcador. MANUTENCAO_PREVENTIVA: intervalos de referência, sinais de alerta. PNEUS_E_DIRECAO_ECONOMICA: cuidado com pneu e direção econômica. GESTAO_E_INDICADORES: como interpretar CPK/margem/receita por km. JORNADA_E_BEM_ESTAR: boas práticas de planejamento e fadiga (nunca o limite legal em si).",
    valoresPossiveis: TOPICOS,
  },
];

export const ferramentaConsultarConhecimentoOperacional: DefinicaoFerramenta<
  ConsultarConhecimentoOperacionalEntrada,
  ConsultarConhecimentoOperacionalResultado
> = {
  nome: "consultar_conhecimento_operacional",
  descricao: "Traz referência de boas práticas do setor (negociação, manutenção, pneus/direção econômica, indicadores, jornada/bem-estar) para enriquecer a resposta.",
  objetivo:
    "Complementar a resposta com conhecimento de especialista quando a pergunta for sobre prática/técnica, não sobre número. Nunca usar como fonte de dado calculado, fato legal ou preço — isso continua sendo sempre as ferramentas de cálculo ou busca oficial ao vivo.",
  parametros: PARAMETROS,
  executar,
};
