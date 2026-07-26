/**
 * Tipos compartilhados pela camada de ferramentas (tools) do Frota IA.
 *
 * Toda ferramenta interna segue o mesmo contrato: recebe uma entrada tipada,
 * nunca inventa dados que não foram informados, e devolve um resultado que
 * sempre explicita o que foi calculado, quais premissas foram assumidas e
 * quais dados ainda faltam (quando aplicável). Esse contrato é o que permite
 * ao Claude (ou a qualquer outro consumidor) decidir se deve pedir mais
 * informações ao usuário antes de responder.
 */

/** Tipos de dado aceitos pelos parâmetros de entrada das ferramentas. */
export type TipoParametroFerramenta = "string" | "number" | "boolean" | "enum";

/** Descreve um único parâmetro de entrada de uma ferramenta (usado em documentação e, futuramente, na geração do schema enviado ao Claude). */
export interface DefinicaoParametroFerramenta {
  nome: string;
  tipo: TipoParametroFerramenta;
  obrigatorio: boolean;
  descricao: string;
  /** Apenas quando `tipo` for "enum". */
  valoresPossiveis?: string[];
}

/**
 * Campos presentes em todo resultado de ferramenta, independentemente do
 * cálculo realizado. `resultados` fica a cargo de cada ferramenta definir
 * com sua própria tipagem específica.
 */
export interface ResultadoFerramentaBase {
  /** `false` quando faltam dados obrigatórios ou a entrada é inválida. */
  sucesso: boolean;
  /** Avisos relevantes (ex.: "abastecimento necessário", "consumo pior que o previsto"). */
  alertas: string[];
  /** Premissas assumidas no cálculo (ex.: "foi considerada ida e volta"). */
  premissas: string[];
  /** Nomes dos campos obrigatórios que não foram informados, quando `sucesso` for `false` por dados faltantes. */
  dadosFaltantes: string[];
  /** Resumo em linguagem natural, pronto para ser usado na resposta ao usuário. */
  mensagemResumo: string;
}

/**
 * Metadados + implementação de uma ferramenta interna do Frota IA.
 * `TEntrada` e `TSaida` são definidos por cada ferramenta individualmente.
 */
export interface DefinicaoFerramenta<TEntrada, TSaida extends ResultadoFerramentaBase> {
  /** Identificador único, em snake_case (mesmo padrão usado em tool use do Claude). */
  nome: string;
  descricao: string;
  objetivo: string;
  parametros: DefinicaoParametroFerramenta[];
  executar: (entrada: TEntrada) => TSaida;
}
