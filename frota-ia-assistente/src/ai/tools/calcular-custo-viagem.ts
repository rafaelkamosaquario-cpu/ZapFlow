import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, EstrategiaSobreposicao, NivelCompletude, ResultadoFerramentaBase } from "./types";
import {
  CASAS_DECIMAIS_CUSTO_POR_KM_PADRAO,
  CASAS_DECIMAIS_MOEDA_PADRAO,
  CASAS_DECIMAIS_PERCENTUAL_PADRAO,
  arredondar,
  formatarBRL,
  formatarNumero,
} from "./utils";
import { calcularCombustivel } from "./calcular-combustivel";
import { calcularCpk } from "./calcular-cpk";

/**
 * Ferramenta: calcular_custo_viagem
 *
 * Calcula o custo operacional completo de uma viagem de transporte
 * rodoviário — não só diesel e pedágio. Sempre diferencia custo variável,
 * custo fixo proporcional, custo direto, custo indireto, previsto e
 * realizado, e nunca apresenta um valor parcial como se fosse o custo real
 * completo da operação.
 *
 * Reutiliza `calcular-combustivel.ts` (modo PREVISAO_VIAGEM) sempre que o
 * custo de combustível precisa ser derivado de distância + consumo +
 * preço, e `calcular-cpk.ts` (modo CPK_PNEUS, reaproveitado como divisor
 * genérico custo ÷ km) para o cálculo final de `custoPorKm` — o mesmo
 * padrão de composição já usado em `comparar-pneus.ts`. Nenhuma alteração
 * foi necessária nessas duas ferramentas.
 *
 * Sem APIs externas nesta fase. Nunca calcula distância automaticamente,
 * nunca assume preço de combustível, CPK, diária ou peso de carga não
 * informados.
 */

// ---------------------------------------------------------------------------
// Constantes configuráveis
// ---------------------------------------------------------------------------
export const CASAS_DECIMAIS_LITROS_PADRAO = 2;
export const CASAS_DECIMAIS_DISTANCIA_PADRAO = 2;
export const CASAS_DECIMAIS_PESO_PADRAO = 3;

const LIMITACOES_PADRAO: string[] = [
  "Esta ferramenta não calcula distância, preço de combustível, pedágio ou CPK automaticamente — todos os valores vêm do que foi informado.",
  "Custos não informados ficam de fora do cálculo; o resultado nunca deve ser lido como o custo real completo da operação quando categorias relevantes estiverem ausentes.",
  "Aumentos ou reduções na comparação previsto x realizado são apenas sinalizados (alerta); a causa não é inferida automaticamente.",
];

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

export type ModoCalculoCustoViagem =
  | "VIAGEM_SIMPLES"
  | "IDA_E_VOLTA"
  | "IDA_COM_RETORNO_VAZIO"
  | "IDA_COM_CARGA_RETORNO"
  | "CUSTO_PREVISTO"
  | "CUSTO_REALIZADO"
  | "COMPARACAO_PREVISTO_REALIZADO"
  | "MULTIPLOS_VEICULOS"
  | "RATEIO_POR_CARGA";

const MODOS_IDA_E_VOLTA: ModoCalculoCustoViagem[] = ["IDA_E_VOLTA", "IDA_COM_RETORNO_VAZIO", "IDA_COM_CARGA_RETORNO"];

/** Base de rateio de um custo fixo — evita multiplicar um valor sem saber o que ele representa. */
export type BaseCusto =
  | "POR_VIAGEM"
  | "POR_TRECHO"
  | "POR_VEICULO"
  | "POR_PESSOA"
  | "POR_DIA"
  | "POR_KM"
  | "POR_TONELADA"
  | "POR_UNIDADE"
  | "VALOR_TOTAL";

export type CriterioRateioCarga = "TONELADA" | "UNIDADE" | "VOLUME";

/** Um item de custo fixo com sua base de rateio explícita. */
export interface CustoFixoItem {
  valor?: number;
  base?: BaseCusto;
}

export interface DadosVeiculoViagem {
  identificacaoVeiculo?: string;
  tipoVeiculo?: string;
  consumoMedioKmLitro?: number;
  consumoIdaKmLitro?: number;
  consumoVoltaKmLitro?: number;
  precoCombustivelLitro?: number;
  consumoArlaPercentual?: number;
  consumoArlaLitros?: number;
  precoArlaLitro?: number;
  /** CPK do veículo já pronto (combustível + pneus + manutenção + depreciação + fixos, tudo embutido). */
  cpkTotal?: number;
  cpkManutencao?: number;
  cpkPneus?: number;
  cpkDepreciacao?: number;
  cpkCustosFixos?: number;
  capacidadeCargaToneladas?: number;
  observacoes?: string;
}

export interface PracaPedagio {
  nome?: string;
  valorPorPassagem?: number;
  quantidadePassagens?: number;
  trecho?: "IDA" | "VOLTA";
}

export interface CustosPedagio {
  valorTotal?: number;
  pracas?: PracaPedagio[];
}

export interface CustosMotorista {
  /** Por dia, por motorista — multiplicado por diasViagem × quantidadeMotoristas. */
  diaria?: number;
  salarioProporcional?: number;
  comissao?: number;
  valorFixoViagem?: number;
  horaExtra?: number;
  adicionalNoturno?: number;
  /** Total já para todos os motoristas — ver categoria de saída "Alimentação". */
  alimentacao?: number;
  /** Total já para todos os motoristas — ver categoria de saída "Hospedagem". */
  hospedagem?: number;
  adiantamento?: number;
  outros?: number;
}

export interface CustosAjudante {
  /** Por dia, por ajudante — multiplicado por diasViagem × quantidade. */
  diaria?: number;
  valorFixo?: number;
  /** Sobrescreve `quantidadeAjudantes` da entrada apenas para este cálculo, se informado. */
  quantidade?: number;
  alimentacao?: number;
  hospedagem?: number;
  outros?: number;
}

export interface CustosOperacao {
  /** Alternativa a informar os itens abaixo individualmente — nunca os dois ao mesmo tempo. */
  valorTotal?: number;
  carga?: number;
  descarga?: number;
  chapa?: number;
  estacionamento?: number;
  balanca?: number;
  balsa?: number;
  travessia?: number;
  seguroCarga?: number;
  gerenciamentoRisco?: number;
  escolta?: number;
  lavagem?: number;
  higienizacao?: number;
  documentacao?: number;
  taxaEmissao?: number;
  taxaOperacional?: number;
  despesasAdministrativas?: number;
  outros?: number;
  descricaoOutros?: string;
}

export interface CustosFixosProporcionais {
  seguroVeiculo?: CustoFixoItem;
  licenciamento?: CustoFixoItem;
  financiamento?: CustoFixoItem;
  depreciacao?: CustoFixoItem;
  rastreador?: CustoFixoItem;
  administracao?: CustoFixoItem;
  salarioFixo?: CustoFixoItem;
  garagem?: CustoFixoItem;
  impostosFixos?: CustoFixoItem;
  outros?: CustoFixoItem;
  descricaoOutros?: string;
}

/** Dados específicos do trecho de retorno, além de distância/consumo (já no nível superior). */
export interface DadosRetorno {
  /** Peso da carga trazida no retorno, em toneladas — usado em IDA_COM_CARGA_RETORNO. */
  cargaToneladas?: number;
  /** Explicita que o retorno não possui carga/receita — usado em IDA_COM_RETORNO_VAZIO. */
  possuiCarga?: boolean;
  pedagios?: CustosPedagio;
  custosAdicionais?: number;
  descricaoCustosAdicionais?: string;
}

/**
 * Conjunto completo de dados de custo de uma viagem — usado tanto para o
 * cálculo direto (a própria entrada) quanto para os blocos `previsto` e
 * `realizado` em COMPARACAO_PREVISTO_REALIZADO.
 */
export interface DadosViagemVariante {
  distanciaIdaKm?: number;
  distanciaVoltaKm?: number;
  distanciaAdicionalKm?: number;

  diasViagem?: number;
  horasViagem?: number;

  veiculo?: DadosVeiculoViagem;
  /** Custo de combustível já pronto — alternativa a informar consumo + preço em `veiculo`. */
  custoCombustivelInformado?: number;
  arla?: { litros?: number; percentualSobreDiesel?: number; precoLitro?: number };
  pedagios?: CustosPedagio;
  motorista?: CustosMotorista;
  ajudante?: CustosAjudante;
  operacao?: CustosOperacao;
  custosFixos?: CustosFixosProporcionais;
  custosAdicionais?: number;
  descricaoCustosAdicionais?: string;

  volta?: DadosRetorno;
}

export interface CalcularCustoViagemEntrada extends DadosViagemVariante {
  modo: ModoCalculoCustoViagem;
  descricao?: string;
  origem?: string;
  destino?: string;

  quantidadeVeiculos?: number;
  quantidadeMotoristas?: number;
  quantidadeAjudantes?: number;

  pesoCargaToneladas?: number;
  quantidadeCarga?: number;
  unidadeCarga?: string;
  volumeCarga?: number;

  criterioRateioCarga?: CriterioRateioCarga;
  estrategiaSobreposicao?: EstrategiaSobreposicao;

  /** Usados apenas em COMPARACAO_PREVISTO_REALIZADO — os campos acima (fora modo/descrição/etc.) são ignorados nesse modo. */
  previsto?: DadosViagemVariante;
  realizado?: DadosViagemVariante;

  casasDecimais?: number;
  permitirEstimativas?: boolean;
  observacoes?: string;
}

// ---------------------------------------------------------------------------
// Tipos de saída
// ---------------------------------------------------------------------------

type BucketCusto = "VARIAVEL" | "FIXO_PROPORCIONAL" | "DIRETO" | "INDIRETO";

export interface ResultadoCategoriaCusto {
  categoria: string;
  valor?: number;
  percentualDoTotal?: number;
  origem: string;
  baseCalculo?: string;
  previstoOuRealizado?: "PREVISTO" | "REALIZADO";
  incluido: boolean;
  observacoes?: string;
  memoriaCalculo?: string;
}

export interface ComparacaoPrevistoRealizadoViagem {
  custoPrevisto?: number;
  custoRealizado?: number;
  diferencaValor?: number;
  diferencaPercentual?: number;
  categoriasAcimaDoPrevisto: string[];
  categoriasAbaixoDoPrevisto: string[];
  principalDesvio?: string;
  alertas: string[];
}

export interface CalcularCustoViagemResultado extends ResultadoFerramentaBase {
  modo: ModoCalculoCustoViagem;
  descricao?: string;
  origem?: string;
  destino?: string;

  distanciaIdaKm?: number;
  distanciaVoltaKm?: number;
  distanciaAdicionalKm?: number;
  distanciaTotalKm?: number;

  quantidadeVeiculos?: number;

  custosPorCategoria: ResultadoCategoriaCusto[];
  custosVariaveis?: number;
  custosFixosProporcionais?: number;
  custosDiretos?: number;
  custosIndiretos?: number;

  custoIda?: number;
  custoVolta?: number;
  custoTotal?: number;

  custoPorKm?: number;
  custoPorTonelada?: number;
  custoToneladaKm?: number;
  custoPorUnidade?: number;
  custoPorVeiculo?: number;
  custoPorDia?: number;

  litrosCombustivel?: number;
  litrosArla?: number;

  comparacaoPrevistoRealizado?: ComparacaoPrevistoRealizadoViagem;

  nivelCompletude: NivelCompletude;
  custosIncluidos: string[];
  custosIgnorados: string[];
  limitacoes: string[];
  memoriaCalculo: string[];
}

// ---------------------------------------------------------------------------
// Custos fixos: itens e helper de normalização por base
// ---------------------------------------------------------------------------

type CampoCustoFixo = Exclude<keyof CustosFixosProporcionais, "descricaoOutros">;

const ITENS_CUSTO_FIXO: Array<{ campo: CampoCustoFixo; rotulo: string; categoriaSaida: string }> = [
  { campo: "seguroVeiculo", rotulo: "Seguro do veículo", categoriaSaida: "Seguro" },
  { campo: "licenciamento", rotulo: "Licenciamento", categoriaSaida: "Licenciamento" },
  { campo: "financiamento", rotulo: "Financiamento", categoriaSaida: "Financiamento" },
  { campo: "depreciacao", rotulo: "Depreciação", categoriaSaida: "Depreciação" },
  { campo: "rastreador", rotulo: "Rastreador", categoriaSaida: "Rastreador" },
  { campo: "administracao", rotulo: "Administração", categoriaSaida: "Administração" },
  { campo: "salarioFixo", rotulo: "Salário fixo", categoriaSaida: "Outros" },
  { campo: "garagem", rotulo: "Garagem", categoriaSaida: "Outros" },
  { campo: "impostosFixos", rotulo: "Impostos fixos", categoriaSaida: "Outros" },
  { campo: "outros", rotulo: "Outros custos fixos", categoriaSaida: "Outros" },
];

interface ContextoBaseCusto {
  distanciaTotalKm?: number;
  diasViagem?: number;
  quantidadeVeiculos?: number;
  quantidadeTrechos: number;
  quantidadePessoas?: number;
  pesoCargaToneladas?: number;
  quantidadeCarga?: number;
}

interface ResultadoNormalizacao {
  valor?: number;
  ignorado: boolean;
  dadoFaltante?: string;
  premissa?: string;
  baseUsada?: BaseCusto;
}

function normalizarValorComBase(item: CustoFixoItem | undefined, rotulo: string, ctx: ContextoBaseCusto): ResultadoNormalizacao {
  if (!item || item.valor === undefined) return { ignorado: true };

  if (item.base === undefined) {
    return { ignorado: true, dadoFaltante: `${rotulo}.base (valor informado sem indicar a base de rateio)` };
  }

  switch (item.base) {
    case "VALOR_TOTAL":
    case "POR_VIAGEM":
      return { valor: item.valor, ignorado: false, baseUsada: item.base };
    case "POR_TRECHO":
      return {
        valor: item.valor * ctx.quantidadeTrechos,
        ignorado: false,
        baseUsada: item.base,
        premissa: `${rotulo}: valor por trecho aplicado a ${ctx.quantidadeTrechos} trecho(s).`,
      };
    case "POR_VEICULO":
      return { valor: item.valor * (ctx.quantidadeVeiculos ?? 1), ignorado: false, baseUsada: item.base };
    case "POR_PESSOA":
      if (ctx.quantidadePessoas === undefined) {
        return { ignorado: true, dadoFaltante: `${rotulo}: quantidade de pessoas (necessária para ratear por pessoa)` };
      }
      return { valor: item.valor * ctx.quantidadePessoas, ignorado: false, baseUsada: item.base };
    case "POR_DIA":
      if (ctx.diasViagem === undefined || ctx.diasViagem <= 0) {
        return { ignorado: true, dadoFaltante: `${rotulo}: diasViagem (necessário para ratear por dia)` };
      }
      return { valor: item.valor * ctx.diasViagem, ignorado: false, baseUsada: item.base };
    case "POR_KM":
      if (ctx.distanciaTotalKm === undefined || ctx.distanciaTotalKm <= 0) {
        return { ignorado: true, dadoFaltante: `${rotulo}: distância total (necessária para ratear por km)` };
      }
      return { valor: item.valor * ctx.distanciaTotalKm, ignorado: false, baseUsada: item.base };
    case "POR_TONELADA":
      if (ctx.pesoCargaToneladas === undefined || ctx.pesoCargaToneladas <= 0) {
        return { ignorado: true, dadoFaltante: `${rotulo}: pesoCargaToneladas (necessário para ratear por tonelada)` };
      }
      return { valor: item.valor * ctx.pesoCargaToneladas, ignorado: false, baseUsada: item.base };
    case "POR_UNIDADE":
      if (ctx.quantidadeCarga === undefined || ctx.quantidadeCarga <= 0) {
        return { ignorado: true, dadoFaltante: `${rotulo}: quantidadeCarga (necessária para ratear por unidade)` };
      }
      return { valor: item.valor * ctx.quantidadeCarga, ignorado: false, baseUsada: item.base };
    default:
      return { ignorado: true, dadoFaltante: `${rotulo}: base desconhecida` };
  }
}

// ---------------------------------------------------------------------------
// Detecção e resolução de sobreposição de custos
// ---------------------------------------------------------------------------

type CampoOperacaoDetalhado = Exclude<keyof CustosOperacao, "valorTotal" | "descricaoOutros">;

const CAMPOS_OPERACAO_DETALHADOS: Array<CampoOperacaoDetalhado> = [
  "carga",
  "descarga",
  "chapa",
  "estacionamento",
  "balanca",
  "balsa",
  "travessia",
  "seguroCarga",
  "gerenciamentoRisco",
  "escolta",
  "lavagem",
  "higienizacao",
  "documentacao",
  "taxaEmissao",
  "taxaOperacional",
  "despesasAdministrativas",
  "outros",
];

function temCombustivelDetalhado(v: DadosViagemVariante): boolean {
  return (
    v.veiculo?.consumoMedioKmLitro !== undefined ||
    (v.veiculo?.consumoIdaKmLitro !== undefined && v.veiculo?.consumoVoltaKmLitro !== undefined)
  );
}

function temCustoFixoDetalhado(cf: CustosFixosProporcionais | undefined): boolean {
  if (!cf) return false;
  return ITENS_CUSTO_FIXO.some((item) => cf[item.campo]?.valor !== undefined);
}

function temOperacaoDetalhada(op: CustosOperacao | undefined): boolean {
  if (!op) return false;
  return CAMPOS_OPERACAO_DETALHADOS.some((campo) => op[campo] !== undefined);
}

interface ConflitoSobreposicao {
  descricao: string;
  camposTotal: string[];
  camposDetalhado: string[];
}

function detectarConflitos(v: DadosViagemVariante): ConflitoSobreposicao[] {
  const conflitos: ConflitoSobreposicao[] = [];
  const combustivelDetalhado = temCombustivelDetalhado(v);
  const custosFixosDetalhados = temCustoFixoDetalhado(v.custosFixos);

  if (v.custoCombustivelInformado !== undefined && combustivelDetalhado) {
    conflitos.push({
      descricao: "combustível informado como valor pronto (custoCombustivelInformado) e também detalhado por consumo/preço",
      camposTotal: ["custoCombustivelInformado"],
      camposDetalhado: ["veiculo.consumoMedioKmLitro (ou consumoIdaKmLitro/consumoVoltaKmLitro)"],
    });
  }

  if (v.veiculo?.cpkTotal !== undefined) {
    const componentes: string[] = [];
    if (v.custoCombustivelInformado !== undefined || combustivelDetalhado) componentes.push("veiculo.consumo/preço ou custoCombustivelInformado");
    if (custosFixosDetalhados) componentes.push("custosFixos");
    if (v.veiculo.cpkManutencao !== undefined) componentes.push("veiculo.cpkManutencao");
    if (v.veiculo.cpkPneus !== undefined) componentes.push("veiculo.cpkPneus");
    if (v.veiculo.cpkDepreciacao !== undefined) componentes.push("veiculo.cpkDepreciacao");
    if (v.veiculo.cpkCustosFixos !== undefined) componentes.push("veiculo.cpkCustosFixos");
    if (componentes.length > 0) {
      conflitos.push({
        descricao: "cpkTotal informado junto com custos do veículo que já estariam embutidos nele",
        camposTotal: ["veiculo.cpkTotal"],
        camposDetalhado: componentes,
      });
    }
  }

  if (v.veiculo?.cpkCustosFixos !== undefined && custosFixosDetalhados) {
    conflitos.push({
      descricao: "cpkCustosFixos informado junto com custosFixos detalhados",
      camposTotal: ["veiculo.cpkCustosFixos"],
      camposDetalhado: ["custosFixos.*"],
    });
  }

  if (v.veiculo?.cpkDepreciacao !== undefined && v.custosFixos?.depreciacao?.valor !== undefined) {
    conflitos.push({
      descricao: "cpkDepreciacao informado junto com custosFixos.depreciacao",
      camposTotal: ["veiculo.cpkDepreciacao"],
      camposDetalhado: ["custosFixos.depreciacao"],
    });
  }

  if (v.pedagios?.valorTotal !== undefined && v.pedagios.pracas && v.pedagios.pracas.length > 0) {
    conflitos.push({
      descricao: "pedágio informado como valorTotal e também como lista de praças",
      camposTotal: ["pedagios.valorTotal"],
      camposDetalhado: ["pedagios.pracas"],
    });
  }

  if (v.operacao?.valorTotal !== undefined && temOperacaoDetalhada(v.operacao)) {
    conflitos.push({
      descricao: "operação informada como valorTotal e também com itens detalhados",
      camposTotal: ["operacao.valorTotal"],
      camposDetalhado: ["operacao.* (itens individuais)"],
    });
  }

  return conflitos;
}

function resolverSobreposicoes(
  v: DadosViagemVariante,
  estrategia: EstrategiaSobreposicao,
  rotulo: string
): { efetiva: DadosViagemVariante; alertas: string[]; erros: string[] } {
  const conflitos = detectarConflitos(v);
  if (conflitos.length === 0) return { efetiva: v, alertas: [], erros: [] };

  if (estrategia === "REJEITAR_SOBREPOSICAO") {
    const erros = conflitos.map(
      (c) =>
        `${rotulo}: sobreposição de custos detectada (${c.descricao}). Informe apenas uma fonte — "${c.camposTotal.join(
          ", "
        )}" OU "${c.camposDetalhado.join(", ")}" — ou defina "estrategiaSobreposicao" para escolher qual prevalece.`
    );
    return { efetiva: v, alertas: [], erros };
  }

  const efetiva: DadosViagemVariante = {
    ...v,
    veiculo: v.veiculo ? { ...v.veiculo } : undefined,
    custosFixos: v.custosFixos ? { ...v.custosFixos } : undefined,
    pedagios: v.pedagios ? { ...v.pedagios } : undefined,
    operacao: v.operacao ? { ...v.operacao } : undefined,
  };
  const alertas: string[] = [];

  for (const c of conflitos) {
    const usados = estrategia === "PRIORIZAR_TOTAL" ? c.camposTotal : c.camposDetalhado;
    const ignorados = estrategia === "PRIORIZAR_TOTAL" ? c.camposDetalhado : c.camposTotal;
    alertas.push(
      `${rotulo}: sobreposição resolvida por "${estrategia}" (${c.descricao}). Usado: ${usados.join(", ")}. Ignorado: ${ignorados.join(", ")}.`
    );
  }

  const combustivelConflita = v.custoCombustivelInformado !== undefined && temCombustivelDetalhado(v);
  if (combustivelConflita && efetiva.veiculo) {
    if (estrategia === "PRIORIZAR_TOTAL") {
      efetiva.veiculo = { ...efetiva.veiculo, consumoMedioKmLitro: undefined, consumoIdaKmLitro: undefined, consumoVoltaKmLitro: undefined };
    } else {
      efetiva.custoCombustivelInformado = undefined;
    }
  }

  if (v.veiculo?.cpkTotal !== undefined && efetiva.veiculo) {
    const haConflitoCpkTotal =
      efetiva.custoCombustivelInformado !== undefined ||
      temCombustivelDetalhado(efetiva) ||
      temCustoFixoDetalhado(efetiva.custosFixos) ||
      efetiva.veiculo.cpkManutencao !== undefined ||
      efetiva.veiculo.cpkPneus !== undefined ||
      efetiva.veiculo.cpkDepreciacao !== undefined ||
      efetiva.veiculo.cpkCustosFixos !== undefined;

    if (haConflitoCpkTotal) {
      if (estrategia === "PRIORIZAR_TOTAL") {
        efetiva.custoCombustivelInformado = undefined;
        efetiva.custosFixos = undefined;
        efetiva.veiculo = {
          ...efetiva.veiculo,
          consumoMedioKmLitro: undefined,
          consumoIdaKmLitro: undefined,
          consumoVoltaKmLitro: undefined,
          cpkManutencao: undefined,
          cpkPneus: undefined,
          cpkDepreciacao: undefined,
          cpkCustosFixos: undefined,
        };
      } else {
        efetiva.veiculo = { ...efetiva.veiculo, cpkTotal: undefined };
      }
    }
  }

  if (efetiva.veiculo?.cpkCustosFixos !== undefined && temCustoFixoDetalhado(efetiva.custosFixos)) {
    if (estrategia === "PRIORIZAR_TOTAL") {
      efetiva.custosFixos = undefined;
    } else if (efetiva.veiculo) {
      efetiva.veiculo = { ...efetiva.veiculo, cpkCustosFixos: undefined };
    }
  }

  if (efetiva.veiculo?.cpkDepreciacao !== undefined && efetiva.custosFixos?.depreciacao?.valor !== undefined) {
    if (estrategia === "PRIORIZAR_TOTAL") {
      efetiva.custosFixos = { ...efetiva.custosFixos, depreciacao: undefined };
    } else if (efetiva.veiculo) {
      efetiva.veiculo = { ...efetiva.veiculo, cpkDepreciacao: undefined };
    }
  }

  if (efetiva.pedagios?.valorTotal !== undefined && efetiva.pedagios.pracas && efetiva.pedagios.pracas.length > 0) {
    efetiva.pedagios =
      estrategia === "PRIORIZAR_TOTAL" ? { ...efetiva.pedagios, pracas: undefined } : { ...efetiva.pedagios, valorTotal: undefined };
  }

  if (efetiva.operacao?.valorTotal !== undefined && temOperacaoDetalhada(efetiva.operacao)) {
    if (estrategia === "PRIORIZAR_TOTAL") {
      const limpo: CustosOperacao = { ...efetiva.operacao };
      for (const campo of CAMPOS_OPERACAO_DETALHADOS) {
        delete limpo[campo];
      }
      efetiva.operacao = limpo;
    } else {
      efetiva.operacao = { ...efetiva.operacao, valorTotal: undefined };
    }
  }

  return { efetiva, alertas, erros: [] };
}

// ---------------------------------------------------------------------------
// Validação estrutural
// ---------------------------------------------------------------------------

function coletarCamposNumericos(v: DadosViagemVariante, rotulo: string): Array<[string, number | undefined]> {
  const campos: Array<[string, number | undefined]> = [
    [`${rotulo}.distanciaIdaKm`, v.distanciaIdaKm],
    [`${rotulo}.distanciaVoltaKm`, v.distanciaVoltaKm],
    [`${rotulo}.distanciaAdicionalKm`, v.distanciaAdicionalKm],
    [`${rotulo}.diasViagem`, v.diasViagem],
    [`${rotulo}.horasViagem`, v.horasViagem],
    [`${rotulo}.custoCombustivelInformado`, v.custoCombustivelInformado],
    [`${rotulo}.custosAdicionais`, v.custosAdicionais],
  ];

  if (v.veiculo) {
    campos.push(
      [`${rotulo}.veiculo.consumoMedioKmLitro`, v.veiculo.consumoMedioKmLitro],
      [`${rotulo}.veiculo.consumoIdaKmLitro`, v.veiculo.consumoIdaKmLitro],
      [`${rotulo}.veiculo.consumoVoltaKmLitro`, v.veiculo.consumoVoltaKmLitro],
      [`${rotulo}.veiculo.precoCombustivelLitro`, v.veiculo.precoCombustivelLitro],
      [`${rotulo}.veiculo.consumoArlaLitros`, v.veiculo.consumoArlaLitros],
      [`${rotulo}.veiculo.precoArlaLitro`, v.veiculo.precoArlaLitro],
      [`${rotulo}.veiculo.cpkTotal`, v.veiculo.cpkTotal],
      [`${rotulo}.veiculo.cpkManutencao`, v.veiculo.cpkManutencao],
      [`${rotulo}.veiculo.cpkPneus`, v.veiculo.cpkPneus],
      [`${rotulo}.veiculo.cpkDepreciacao`, v.veiculo.cpkDepreciacao],
      [`${rotulo}.veiculo.cpkCustosFixos`, v.veiculo.cpkCustosFixos],
      [`${rotulo}.veiculo.capacidadeCargaToneladas`, v.veiculo.capacidadeCargaToneladas]
    );
  }

  if (v.arla) {
    campos.push([`${rotulo}.arla.litros`, v.arla.litros], [`${rotulo}.arla.precoLitro`, v.arla.precoLitro]);
  }

  if (v.pedagios) {
    campos.push([`${rotulo}.pedagios.valorTotal`, v.pedagios.valorTotal]);
    v.pedagios.pracas?.forEach((p, i) => {
      campos.push(
        [`${rotulo}.pedagios.pracas[${i}].valorPorPassagem`, p.valorPorPassagem],
        [`${rotulo}.pedagios.pracas[${i}].quantidadePassagens`, p.quantidadePassagens]
      );
    });
  }

  if (v.motorista) {
    campos.push(
      [`${rotulo}.motorista.diaria`, v.motorista.diaria],
      [`${rotulo}.motorista.salarioProporcional`, v.motorista.salarioProporcional],
      [`${rotulo}.motorista.comissao`, v.motorista.comissao],
      [`${rotulo}.motorista.valorFixoViagem`, v.motorista.valorFixoViagem],
      [`${rotulo}.motorista.horaExtra`, v.motorista.horaExtra],
      [`${rotulo}.motorista.adicionalNoturno`, v.motorista.adicionalNoturno],
      [`${rotulo}.motorista.alimentacao`, v.motorista.alimentacao],
      [`${rotulo}.motorista.hospedagem`, v.motorista.hospedagem],
      [`${rotulo}.motorista.adiantamento`, v.motorista.adiantamento],
      [`${rotulo}.motorista.outros`, v.motorista.outros]
    );
  }

  if (v.ajudante) {
    campos.push(
      [`${rotulo}.ajudante.diaria`, v.ajudante.diaria],
      [`${rotulo}.ajudante.valorFixo`, v.ajudante.valorFixo],
      [`${rotulo}.ajudante.quantidade`, v.ajudante.quantidade],
      [`${rotulo}.ajudante.alimentacao`, v.ajudante.alimentacao],
      [`${rotulo}.ajudante.hospedagem`, v.ajudante.hospedagem],
      [`${rotulo}.ajudante.outros`, v.ajudante.outros]
    );
  }

  if (v.operacao) {
    campos.push([`${rotulo}.operacao.valorTotal`, v.operacao.valorTotal]);
    for (const campo of CAMPOS_OPERACAO_DETALHADOS) {
      campos.push([`${rotulo}.operacao.${campo}`, v.operacao[campo]]);
    }
  }

  if (v.custosFixos) {
    for (const item of ITENS_CUSTO_FIXO) {
      campos.push([`${rotulo}.custosFixos.${item.campo}.valor`, v.custosFixos[item.campo]?.valor]);
    }
  }

  if (v.volta) {
    campos.push([`${rotulo}.volta.cargaToneladas`, v.volta.cargaToneladas], [`${rotulo}.volta.custosAdicionais`, v.volta.custosAdicionais]);
    if (v.volta.pedagios) {
      campos.push([`${rotulo}.volta.pedagios.valorTotal`, v.volta.pedagios.valorTotal]);
      v.volta.pedagios.pracas?.forEach((p, i) => {
        campos.push(
          [`${rotulo}.volta.pedagios.pracas[${i}].valorPorPassagem`, p.valorPorPassagem],
          [`${rotulo}.volta.pedagios.pracas[${i}].quantidadePassagens`, p.quantidadePassagens]
        );
      });
    }
  }

  return campos;
}

function validarVariante(v: DadosViagemVariante, rotulo: string): string[] {
  const erros: string[] = [];

  for (const [campo, valor] of coletarCamposNumericos(v, rotulo)) {
    if (valor !== undefined && valor < 0) {
      erros.push(`O campo "${campo}" não pode ser negativo.`);
    }
  }

  const camposConsumo: Array<[string, number | undefined]> = [
    [`${rotulo}.veiculo.consumoMedioKmLitro`, v.veiculo?.consumoMedioKmLitro],
    [`${rotulo}.veiculo.consumoIdaKmLitro`, v.veiculo?.consumoIdaKmLitro],
    [`${rotulo}.veiculo.consumoVoltaKmLitro`, v.veiculo?.consumoVoltaKmLitro],
  ];
  for (const [campo, valor] of camposConsumo) {
    if (valor === 0) erros.push(`O consumo ("${campo}") não pode ser igual a zero.`);
  }

  if (v.veiculo?.consumoArlaPercentual !== undefined && (v.veiculo.consumoArlaPercentual < 0 || v.veiculo.consumoArlaPercentual > 100)) {
    erros.push(`"${rotulo}.veiculo.consumoArlaPercentual" deve estar entre 0 e 100.`);
  }
  if (v.arla?.percentualSobreDiesel !== undefined && (v.arla.percentualSobreDiesel < 0 || v.arla.percentualSobreDiesel > 100)) {
    erros.push(`"${rotulo}.arla.percentualSobreDiesel" deve estar entre 0 e 100.`);
  }

  return erros;
}

function validarEstruturaTopo(entrada: CalcularCustoViagemEntrada): string[] {
  const erros: string[] = [];

  if (entrada.quantidadeVeiculos !== undefined && entrada.quantidadeVeiculos <= 0) {
    erros.push('"quantidadeVeiculos" deve ser maior que zero.');
  }
  if (entrada.quantidadeMotoristas !== undefined && entrada.quantidadeMotoristas < 0) {
    erros.push('"quantidadeMotoristas" não pode ser negativo.');
  }
  if (entrada.quantidadeAjudantes !== undefined && entrada.quantidadeAjudantes < 0) {
    erros.push('"quantidadeAjudantes" não pode ser negativo.');
  }
  if (entrada.pesoCargaToneladas !== undefined && entrada.pesoCargaToneladas < 0) {
    erros.push('"pesoCargaToneladas" não pode ser negativo.');
  }
  if (entrada.quantidadeCarga !== undefined && entrada.quantidadeCarga < 0) {
    erros.push('"quantidadeCarga" não pode ser negativo.');
  }
  if (entrada.volumeCarga !== undefined && entrada.volumeCarga < 0) {
    erros.push('"volumeCarga" não pode ser negativo.');
  }

  return erros;
}

// ---------------------------------------------------------------------------
// Fábrica de resposta de falha
// ---------------------------------------------------------------------------

function respostaFalha(entrada: CalcularCustoViagemEntrada, mensagemResumo: string, dadosFaltantes: string[] = []): CalcularCustoViagemResultado {
  return {
    sucesso: false,
    modo: entrada.modo,
    descricao: entrada.descricao,
    origem: entrada.origem,
    destino: entrada.destino,
    custosPorCategoria: [],
    nivelCompletude: "INSUFICIENTE",
    custosIncluidos: [],
    custosIgnorados: [],
    limitacoes: LIMITACOES_PADRAO,
    alertas: [],
    premissas: [],
    dadosFaltantes,
    mensagemResumo,
    memoriaCalculo: [],
  };
}

// ---------------------------------------------------------------------------
// Cálculo por categoria
// ---------------------------------------------------------------------------

interface CasasDecimais {
  moeda: number;
  custoPorKm: number;
  percentual: number;
  litros: number;
  distancia: number;
  peso: number;
}

interface ResultadoAgregacaoTrecho {
  distanciaTotalKm?: number;
  distanciaCarregadaKm?: number;
  litrosCombustivel?: number;
  litrosArla?: number;
  categorias: ResultadoCategoriaCusto[];
  custoIdaParcial: number;
  custoVoltaParcial: number;
  dadosFaltantes: string[];
  alertas: string[];
  premissas: string[];
}

function calcularCategoriaCombustivel(
  v: DadosViagemVariante,
  distanciaIda: number | undefined,
  distanciaVolta: number | undefined,
  distanciaAdicional: number | undefined,
  casas: CasasDecimais,
  rotuloPrevistoRealizado: "PREVISTO" | "REALIZADO" | undefined
): { categoria: ResultadoCategoriaCusto; litros?: number; custoIda?: number; custoVolta?: number; dadoFaltante?: string } {
  if (v.custoCombustivelInformado !== undefined) {
    return {
      categoria: {
        categoria: "Combustível",
        valor: arredondar(v.custoCombustivelInformado, casas.moeda),
        origem: "informado diretamente (custoCombustivelInformado)",
        previstoOuRealizado: rotuloPrevistoRealizado,
        incluido: true,
        memoriaCalculo: `Combustível informado diretamente: ${formatarBRL(v.custoCombustivelInformado)}.`,
      },
      custoIda: v.custoCombustivelInformado,
    };
  }

  const veiculo = v.veiculo;
  if (!veiculo) {
    return {
      categoria: { categoria: "Combustível", origem: "sem dados", incluido: false, observacoes: "Nenhum dado de veículo informado." },
      dadoFaltante: "veiculo.consumoMedioKmLitro (ou custoCombustivelInformado)",
    };
  }

  // Com trecho de volta: sempre calcula ida e volta separadamente (mesmo com
  // o mesmo consumo nas duas pernas) para poder reportar custoIda/custoVolta
  // sem juntar os dois numa única chamada a calcular_combustivel.
  if (distanciaVolta !== undefined) {
    const consumoIdaEfetivo = veiculo.consumoIdaKmLitro ?? veiculo.consumoMedioKmLitro;
    const consumoVoltaEfetivo = veiculo.consumoVoltaKmLitro ?? veiculo.consumoMedioKmLitro;

    if (consumoIdaEfetivo === undefined || consumoVoltaEfetivo === undefined) {
      return {
        categoria: { categoria: "Combustível", origem: "sem dados", incluido: false, observacoes: "Consumo não informado para ida e/ou volta." },
        dadoFaltante: "veiculo.consumoMedioKmLitro (ou consumoIdaKmLitro/consumoVoltaKmLitro)",
      };
    }

    const resultadoIda = calcularCombustivel({
      modo: "PREVISAO_VIAGEM",
      distanciaKm: distanciaIda !== undefined ? distanciaIda + (distanciaAdicional ?? 0) : distanciaAdicional,
      consumoMedioKmLitro: consumoIdaEfetivo,
      precoCombustivelLitro: veiculo.precoCombustivelLitro,
      arredondamentoCasasDecimais: casas.litros,
    });
    const resultadoVolta = calcularCombustivel({
      modo: "PREVISAO_VIAGEM",
      distanciaKm: distanciaVolta,
      consumoMedioKmLitro: consumoVoltaEfetivo,
      precoCombustivelLitro: veiculo.precoCombustivelLitro,
      arredondamentoCasasDecimais: casas.litros,
    });

    if (!resultadoIda.sucesso && !resultadoVolta.sucesso) {
      return {
        categoria: { categoria: "Combustível", origem: "sem dados", incluido: false, observacoes: "Distância indisponível para calcular combustível." },
        dadoFaltante: "distanciaIdaKm/distanciaVoltaKm",
      };
    }

    const litrosIda = resultadoIda.sucesso ? (resultadoIda.resultados.litrosNecessarios ?? 0) : 0;
    const litrosVolta = resultadoVolta.sucesso ? (resultadoVolta.resultados.litrosNecessarios ?? 0) : 0;
    const litrosTotal = litrosIda + litrosVolta;
    const custoIda = resultadoIda.sucesso ? resultadoIda.resultados.custoTotalCombustivel : undefined;
    const custoVolta = resultadoVolta.sucesso ? resultadoVolta.resultados.custoTotalCombustivel : undefined;
    const custoTotal = custoIda !== undefined && custoVolta !== undefined ? custoIda + custoVolta : undefined;
    const consumosDistintos = veiculo.consumoIdaKmLitro !== undefined && veiculo.consumoVoltaKmLitro !== undefined;

    return {
      categoria: {
        categoria: "Combustível",
        valor: custoTotal !== undefined ? arredondar(custoTotal, casas.moeda) : undefined,
        origem: `calculado via calcular_combustivel (ida e volta${consumosDistintos ? ", consumos distintos" : ""})`,
        baseCalculo: `Ida: ${formatarNumero(litrosIda)} l. Volta: ${formatarNumero(litrosVolta)} l.`,
        previstoOuRealizado: rotuloPrevistoRealizado,
        incluido: custoTotal !== undefined,
        observacoes: veiculo.precoCombustivelLitro === undefined ? "Preço do combustível não informado — apenas os litros foram calculados." : undefined,
        memoriaCalculo: `Combustível (ida+volta): ${formatarNumero(litrosTotal)} l${
          custoTotal !== undefined ? `, custo ${formatarBRL(custoTotal)}` : ""
        }.`,
      },
      litros: litrosTotal,
      custoIda,
      custoVolta,
      dadoFaltante: veiculo.precoCombustivelLitro === undefined ? "veiculo.precoCombustivelLitro" : undefined,
    };
  }

  if (veiculo.consumoMedioKmLitro === undefined) {
    return {
      categoria: { categoria: "Combustível", origem: "sem dados", incluido: false, observacoes: "Consumo médio não informado." },
      dadoFaltante: "veiculo.consumoMedioKmLitro",
    };
  }

  const resultado = calcularCombustivel({
    modo: "PREVISAO_VIAGEM",
    distanciaKm: distanciaIda,
    distanciaAdicionalKm: distanciaAdicional,
    consumoMedioKmLitro: veiculo.consumoMedioKmLitro,
    precoCombustivelLitro: veiculo.precoCombustivelLitro,
    arredondamentoCasasDecimais: casas.litros,
  });

  if (!resultado.sucesso) {
    return {
      categoria: { categoria: "Combustível", origem: "sem dados", incluido: false, observacoes: resultado.mensagemResumo },
      dadoFaltante: resultado.dadosFaltantes.join(", ") || "distância/consumo",
    };
  }

  const custoTotal = resultado.resultados.custoTotalCombustivel;
  return {
    categoria: {
      categoria: "Combustível",
      valor: custoTotal !== undefined ? arredondar(custoTotal, casas.moeda) : undefined,
      origem: "calculado via calcular_combustivel (PREVISAO_VIAGEM)",
      baseCalculo: `${formatarNumero(resultado.resultados.litrosNecessarios ?? 0)} l a ${
        veiculo.precoCombustivelLitro !== undefined ? formatarBRL(veiculo.precoCombustivelLitro) : "preço não informado"
      }/l.`,
      previstoOuRealizado: rotuloPrevistoRealizado,
      incluido: custoTotal !== undefined,
      memoriaCalculo: `Combustível: ${formatarNumero(resultado.resultados.litrosNecessarios ?? 0)} l${
        custoTotal !== undefined ? `, custo ${formatarBRL(custoTotal)}` : " (preço não informado, custo não calculado)"
      }.`,
    },
    litros: resultado.resultados.litrosNecessarios,
    custoIda: custoTotal,
    dadoFaltante: veiculo.precoCombustivelLitro === undefined ? "veiculo.precoCombustivelLitro" : undefined,
  };
}

function calcularCategoriaArla(
  v: DadosViagemVariante,
  litrosDiesel: number | undefined,
  casas: CasasDecimais,
  rotuloPrevistoRealizado: "PREVISTO" | "REALIZADO" | undefined
): { categoria: ResultadoCategoriaCusto; litros?: number } {
  const arla = v.arla;
  const percentualVeiculo = v.veiculo?.consumoArlaPercentual;
  const litrosVeiculo = v.veiculo?.consumoArlaLitros;
  const precoVeiculo = v.veiculo?.precoArlaLitro;

  let litrosArla: number | undefined;
  let origem: string;

  if (arla?.litros !== undefined) {
    litrosArla = arla.litros;
    origem = "litros informados diretamente";
  } else if (litrosVeiculo !== undefined) {
    litrosArla = litrosVeiculo;
    origem = "litros informados diretamente (veiculo.consumoArlaLitros)";
  } else if ((arla?.percentualSobreDiesel !== undefined || percentualVeiculo !== undefined) && litrosDiesel !== undefined) {
    const percentual = arla?.percentualSobreDiesel ?? percentualVeiculo ?? 0;
    litrosArla = (litrosDiesel * percentual) / 100;
    origem = `${percentual}% do consumo de diesel`;
  } else {
    return { categoria: { categoria: "ARLA", origem: "sem dados", incluido: false } };
  }

  const preco = arla?.precoLitro ?? precoVeiculo;
  const custo = preco !== undefined ? litrosArla * preco : undefined;

  return {
    categoria: {
      categoria: "ARLA",
      valor: custo !== undefined ? arredondar(custo, casas.moeda) : undefined,
      origem,
      baseCalculo: `${formatarNumero(arredondar(litrosArla, casas.litros))} l${preco !== undefined ? ` a ${formatarBRL(preco)}/l` : ""}.`,
      previstoOuRealizado: rotuloPrevistoRealizado,
      incluido: custo !== undefined,
      observacoes: preco === undefined ? "Preço do ARLA não informado." : undefined,
      memoriaCalculo: `ARLA: ${formatarNumero(arredondar(litrosArla, casas.litros))} l${custo !== undefined ? `, custo ${formatarBRL(custo)}` : ""}.`,
    },
    litros: litrosArla,
  };
}

function calcularCategoriaPedagio(
  pedagios: CustosPedagio | undefined,
  casas: CasasDecimais,
  rotulo: string,
  rotuloPrevistoRealizado: "PREVISTO" | "REALIZADO" | undefined
): { categoria: ResultadoCategoriaCusto; custoIda: number; custoVolta: number } {
  if (!pedagios) return { categoria: { categoria: rotulo, origem: "sem dados", incluido: false }, custoIda: 0, custoVolta: 0 };

  if (pedagios.valorTotal !== undefined) {
    return {
      categoria: {
        categoria: rotulo,
        valor: arredondar(pedagios.valorTotal, casas.moeda),
        origem: "valor total informado",
        previstoOuRealizado: rotuloPrevistoRealizado,
        incluido: true,
        memoriaCalculo: `${rotulo}: valor total ${formatarBRL(pedagios.valorTotal)}.`,
      },
      custoIda: pedagios.valorTotal,
      custoVolta: 0,
    };
  }

  if (pedagios.pracas && pedagios.pracas.length > 0) {
    let totalIda = 0;
    let totalVolta = 0;
    let totalSemTrecho = 0;
    for (const praca of pedagios.pracas) {
      const valor = (praca.valorPorPassagem ?? 0) * (praca.quantidadePassagens ?? 1);
      if (praca.trecho === "IDA") totalIda += valor;
      else if (praca.trecho === "VOLTA") totalVolta += valor;
      else totalSemTrecho += valor;
    }
    const total = totalIda + totalVolta + totalSemTrecho;
    return {
      categoria: {
        categoria: rotulo,
        valor: arredondar(total, casas.moeda),
        origem: `soma de ${pedagios.pracas.length} praça(s)`,
        previstoOuRealizado: rotuloPrevistoRealizado,
        incluido: true,
        observacoes: totalSemTrecho > 0 ? "Parte das praças não tem trecho (ida/volta) definido; não entrou no split por trecho." : undefined,
        memoriaCalculo: `${rotulo}: ${pedagios.pracas.length} praça(s), total ${formatarBRL(total)}.`,
      },
      custoIda: totalIda + totalSemTrecho,
      custoVolta: totalVolta,
    };
  }

  return { categoria: { categoria: rotulo, origem: "sem dados", incluido: false }, custoIda: 0, custoVolta: 0 };
}

function calcularCategoriaMotoristaAjudante(
  motorista: CustosMotorista | undefined,
  ajudante: CustosAjudante | undefined,
  diasViagem: number | undefined,
  quantidadeMotoristas: number | undefined,
  quantidadeAjudantesEntrada: number | undefined,
  casas: CasasDecimais,
  rotuloPrevistoRealizado: "PREVISTO" | "REALIZADO" | undefined
): { motorista: ResultadoCategoriaCusto; ajudante: ResultadoCategoriaCusto; alimentacao: ResultadoCategoriaCusto; hospedagem: ResultadoCategoriaCusto; dadosFaltantes: string[] } {
  const dadosFaltantes: string[] = [];
  const qtdMotoristas = quantidadeMotoristas ?? 1;
  const qtdAjudantes = ajudante?.quantidade ?? quantidadeAjudantesEntrada ?? 0;

  let valorMotorista = 0;
  let temMotorista = false;
  if (motorista?.diaria !== undefined) {
    if (diasViagem === undefined || diasViagem <= 0) {
      dadosFaltantes.push("diasViagem (necessário para calcular a diária do motorista)");
    } else {
      valorMotorista += motorista.diaria * diasViagem * qtdMotoristas;
      temMotorista = true;
    }
  }
  for (const campo of ["salarioProporcional", "comissao", "valorFixoViagem", "horaExtra", "adicionalNoturno", "adiantamento", "outros"] as const) {
    const valor = motorista?.[campo];
    if (valor !== undefined) {
      valorMotorista += valor;
      temMotorista = true;
    }
  }

  let valorAjudante = 0;
  let temAjudante = false;
  if (ajudante?.diaria !== undefined) {
    if (diasViagem === undefined || diasViagem <= 0) {
      dadosFaltantes.push("diasViagem (necessário para calcular a diária do ajudante)");
    } else if (qtdAjudantes <= 0) {
      dadosFaltantes.push("quantidadeAjudantes (necessário para calcular a diária do ajudante)");
    } else {
      valorAjudante += ajudante.diaria * diasViagem * qtdAjudantes;
      temAjudante = true;
    }
  }
  for (const campo of ["valorFixo", "outros"] as const) {
    const valor = ajudante?.[campo];
    if (valor !== undefined) {
      valorAjudante += valor;
      temAjudante = true;
    }
  }

  const valorAlimentacao = (motorista?.alimentacao ?? 0) + (ajudante?.alimentacao ?? 0);
  const temAlimentacao = motorista?.alimentacao !== undefined || ajudante?.alimentacao !== undefined;
  const valorHospedagem = (motorista?.hospedagem ?? 0) + (ajudante?.hospedagem ?? 0);
  const temHospedagem = motorista?.hospedagem !== undefined || ajudante?.hospedagem !== undefined;

  return {
    motorista: {
      categoria: "Motorista",
      valor: temMotorista ? arredondar(valorMotorista, casas.moeda) : undefined,
      origem: motorista?.diaria !== undefined ? "diária × dias × motoristas + demais componentes informados" : "componentes informados diretamente",
      previstoOuRealizado: rotuloPrevistoRealizado,
      incluido: temMotorista,
      memoriaCalculo: temMotorista ? `Motorista: ${formatarBRL(valorMotorista)}.` : undefined,
    },
    ajudante: {
      categoria: "Ajudante",
      valor: temAjudante ? arredondar(valorAjudante, casas.moeda) : undefined,
      origem: ajudante?.diaria !== undefined ? "diária × dias × ajudantes + demais componentes informados" : "componentes informados diretamente",
      previstoOuRealizado: rotuloPrevistoRealizado,
      incluido: temAjudante,
      memoriaCalculo: temAjudante ? `Ajudante: ${formatarBRL(valorAjudante)}.` : undefined,
    },
    alimentacao: {
      categoria: "Alimentação",
      valor: temAlimentacao ? arredondar(valorAlimentacao, casas.moeda) : undefined,
      origem: "soma de motorista.alimentacao + ajudante.alimentacao",
      previstoOuRealizado: rotuloPrevistoRealizado,
      incluido: temAlimentacao,
    },
    hospedagem: {
      categoria: "Hospedagem",
      valor: temHospedagem ? arredondar(valorHospedagem, casas.moeda) : undefined,
      origem: "soma de motorista.hospedagem + ajudante.hospedagem",
      previstoOuRealizado: rotuloPrevistoRealizado,
      incluido: temHospedagem,
    },
    dadosFaltantes,
  };
}

function calcularCategoriaOperacao(
  operacao: CustosOperacao | undefined,
  casas: CasasDecimais,
  rotuloPrevistoRealizado: "PREVISTO" | "REALIZADO" | undefined
): { cargaDescarga: ResultadoCategoriaCusto; operacaoGeral: ResultadoCategoriaCusto; indireto: ResultadoCategoriaCusto } {
  const cargaDescargaValor = (operacao?.carga ?? 0) + (operacao?.descarga ?? 0);
  const temCargaDescarga = operacao?.carga !== undefined || operacao?.descarga !== undefined;

  if (operacao?.valorTotal !== undefined) {
    return {
      cargaDescarga: { categoria: "Carga e descarga", origem: "incluído em operacao.valorTotal", incluido: false },
      operacaoGeral: {
        categoria: "Operação",
        valor: arredondar(operacao.valorTotal, casas.moeda),
        origem: "valor total informado (operacao.valorTotal)",
        previstoOuRealizado: rotuloPrevistoRealizado,
        incluido: true,
      },
      indireto: { categoria: "Outros (indiretos)", origem: "incluído em operacao.valorTotal", incluido: false },
    };
  }

  const camposOperacaoGeral = [
    "chapa",
    "estacionamento",
    "balanca",
    "balsa",
    "travessia",
    "seguroCarga",
    "gerenciamentoRisco",
    "escolta",
    "lavagem",
    "higienizacao",
    "documentacao",
    "taxaEmissao",
    "taxaOperacional",
  ] as const;
  let valorOperacaoGeral = 0;
  let temOperacaoGeral = false;
  for (const campo of camposOperacaoGeral) {
    const valor = operacao?.[campo];
    if (valor !== undefined) {
      valorOperacaoGeral += valor;
      temOperacaoGeral = true;
    }
  }
  if (operacao?.outros !== undefined) {
    valorOperacaoGeral += operacao.outros;
    temOperacaoGeral = true;
  }

  const valorIndireto = operacao?.despesasAdministrativas ?? 0;
  const temIndireto = operacao?.despesasAdministrativas !== undefined;

  return {
    cargaDescarga: {
      categoria: "Carga e descarga",
      valor: temCargaDescarga ? arredondar(cargaDescargaValor, casas.moeda) : undefined,
      origem: "operacao.carga + operacao.descarga",
      previstoOuRealizado: rotuloPrevistoRealizado,
      incluido: temCargaDescarga,
    },
    operacaoGeral: {
      categoria: "Operação",
      valor: temOperacaoGeral ? arredondar(valorOperacaoGeral, casas.moeda) : undefined,
      origem: "soma dos itens operacionais informados (exceto carga/descarga e despesas administrativas)",
      previstoOuRealizado: rotuloPrevistoRealizado,
      incluido: temOperacaoGeral,
    },
    indireto: {
      categoria: "Outros (indiretos)",
      valor: temIndireto ? arredondar(valorIndireto, casas.moeda) : undefined,
      origem: "operacao.despesasAdministrativas",
      previstoOuRealizado: rotuloPrevistoRealizado,
      incluido: temIndireto,
    },
  };
}

function calcularCategoriasCustoFixo(
  custosFixos: CustosFixosProporcionais | undefined,
  ctx: ContextoBaseCusto,
  casas: CasasDecimais,
  rotuloPrevistoRealizado: "PREVISTO" | "REALIZADO" | undefined
): { categorias: ResultadoCategoriaCusto[]; dadosFaltantes: string[]; premissas: string[] } {
  const dadosFaltantes: string[] = [];
  const premissas: string[] = [];
  const acumuladoPorSaida = new Map<string, { valor: number; bases: Set<string> }>();

  if (custosFixos) {
    for (const item of ITENS_CUSTO_FIXO) {
      const resultado = normalizarValorComBase(custosFixos[item.campo], `custosFixos.${item.campo}`, ctx);
      if (resultado.dadoFaltante) dadosFaltantes.push(resultado.dadoFaltante);
      if (resultado.premissa) premissas.push(resultado.premissa);
      if (!resultado.ignorado && resultado.valor !== undefined) {
        const atual = acumuladoPorSaida.get(item.categoriaSaida) ?? { valor: 0, bases: new Set<string>() };
        atual.valor += resultado.valor;
        if (resultado.baseUsada) atual.bases.add(resultado.baseUsada);
        acumuladoPorSaida.set(item.categoriaSaida, atual);
      }
    }
  }

  const categoriasSaida = ["Seguro", "Licenciamento", "Financiamento", "Depreciação", "Rastreador", "Administração", "Outros"];
  const categorias: ResultadoCategoriaCusto[] = categoriasSaida.map((nome) => {
    const acumulado = acumuladoPorSaida.get(nome);
    return {
      categoria: nome,
      valor: acumulado ? arredondar(acumulado.valor, casas.moeda) : undefined,
      origem: acumulado ? `rateado (${Array.from(acumulado.bases).join(", ") || "valor direto"})` : "sem dados",
      previstoOuRealizado: acumulado ? rotuloPrevistoRealizado : undefined,
      incluido: acumulado !== undefined,
    };
  });

  return { categorias, dadosFaltantes, premissas };
}

// ---------------------------------------------------------------------------
// Agregação de um trecho/variante completo
// ---------------------------------------------------------------------------

const BUCKET_POR_CATEGORIA: Record<string, BucketCusto> = {
  Combustível: "VARIAVEL",
  ARLA: "VARIAVEL",
  Pedágios: "VARIAVEL",
  Motorista: "DIRETO",
  Ajudante: "DIRETO",
  Alimentação: "DIRETO",
  Hospedagem: "DIRETO",
  "Carga e descarga": "DIRETO",
  Operação: "DIRETO",
  Manutenção: "FIXO_PROPORCIONAL",
  Pneus: "FIXO_PROPORCIONAL",
  Depreciação: "FIXO_PROPORCIONAL",
  Seguro: "FIXO_PROPORCIONAL",
  Licenciamento: "FIXO_PROPORCIONAL",
  Financiamento: "FIXO_PROPORCIONAL",
  Rastreador: "FIXO_PROPORCIONAL",
  Administração: "FIXO_PROPORCIONAL",
  "CPK total do veículo": "FIXO_PROPORCIONAL",
  "Outros (indiretos)": "INDIRETO",
};

function agregarVariante(
  entrada: CalcularCustoViagemEntrada,
  v: DadosViagemVariante,
  rotulo: string,
  rotuloPrevistoRealizado: "PREVISTO" | "REALIZADO" | undefined,
  casas: CasasDecimais
): ResultadoAgregacaoTrecho {
  const distanciaIda = v.distanciaIdaKm;
  const distanciaVolta = MODOS_IDA_E_VOLTA.includes(entrada.modo) ? v.distanciaVoltaKm : undefined;
  const distanciaTotalKm =
    distanciaIda !== undefined || distanciaVolta !== undefined || v.distanciaAdicionalKm !== undefined
      ? (distanciaIda ?? 0) + (distanciaVolta ?? 0) + (v.distanciaAdicionalKm ?? 0)
      : undefined;

  const distanciaCarregadaKm =
    distanciaIda !== undefined ? distanciaIda + (v.volta?.cargaToneladas !== undefined ? (distanciaVolta ?? 0) : 0) : undefined;

  const dadosFaltantes: string[] = [];
  const alertas: string[] = [];
  const premissas: string[] = [];
  const categorias: ResultadoCategoriaCusto[] = [];

  const usandoCpkTotal = v.veiculo?.cpkTotal !== undefined;

  let litrosCombustivel: number | undefined;
  let custoIdaCombustivel: number | undefined;
  let custoVoltaCombustivel = 0;

  if (usandoCpkTotal && distanciaTotalKm !== undefined) {
    const custoCpkTotal = (v.veiculo?.cpkTotal as number) * distanciaTotalKm;
    categorias.push({
      categoria: "CPK total do veículo",
      valor: arredondar(custoCpkTotal, casas.moeda),
      origem: "cpkTotal × distância total",
      baseCalculo: `${formatarBRL(v.veiculo?.cpkTotal as number)}/km × ${formatarNumero(distanciaTotalKm)} km`,
      previstoOuRealizado: rotuloPrevistoRealizado,
      incluido: true,
      observacoes: "Substitui combustível, manutenção, pneus, depreciação e custos fixos individualmente (já embutidos no CPK total).",
      memoriaCalculo: `CPK total: ${formatarBRL(v.veiculo?.cpkTotal as number)}/km × ${formatarNumero(distanciaTotalKm)} km = ${formatarBRL(custoCpkTotal)}.`,
    });
  } else {
    const resultadoCombustivel = calcularCategoriaCombustivel(v, distanciaIda, distanciaVolta, v.distanciaAdicionalKm, casas, rotuloPrevistoRealizado);
    categorias.push(resultadoCombustivel.categoria);
    litrosCombustivel = resultadoCombustivel.litros;
    custoIdaCombustivel = resultadoCombustivel.custoIda;
    custoVoltaCombustivel = resultadoCombustivel.custoVolta ?? 0;
    if (resultadoCombustivel.dadoFaltante) dadosFaltantes.push(`${rotulo}.${resultadoCombustivel.dadoFaltante}`);

    if (v.veiculo?.cpkManutencao !== undefined && distanciaTotalKm !== undefined) {
      const valor = v.veiculo.cpkManutencao * distanciaTotalKm;
      categorias.push({
        categoria: "Manutenção",
        valor: arredondar(valor, casas.moeda),
        origem: "cpkManutencao × distância total",
        previstoOuRealizado: rotuloPrevistoRealizado,
        incluido: true,
      });
    }
    if (v.veiculo?.cpkPneus !== undefined && distanciaTotalKm !== undefined) {
      const valor = v.veiculo.cpkPneus * distanciaTotalKm;
      categorias.push({
        categoria: "Pneus",
        valor: arredondar(valor, casas.moeda),
        origem: "cpkPneus × distância total",
        previstoOuRealizado: rotuloPrevistoRealizado,
        incluido: true,
      });
    }
    if (v.veiculo?.cpkDepreciacao !== undefined && distanciaTotalKm !== undefined) {
      const valor = v.veiculo.cpkDepreciacao * distanciaTotalKm;
      categorias.push({
        categoria: "Depreciação",
        valor: arredondar(valor, casas.moeda),
        origem: "cpkDepreciacao × distância total",
        previstoOuRealizado: rotuloPrevistoRealizado,
        incluido: true,
      });
    }

    const contextoBase: ContextoBaseCusto = {
      distanciaTotalKm,
      diasViagem: v.diasViagem,
      quantidadeVeiculos: entrada.quantidadeVeiculos,
      quantidadeTrechos: MODOS_IDA_E_VOLTA.includes(entrada.modo) ? 2 : 1,
      pesoCargaToneladas: entrada.pesoCargaToneladas,
      quantidadeCarga: entrada.quantidadeCarga,
    };

    if (v.veiculo?.cpkCustosFixos !== undefined && distanciaTotalKm !== undefined) {
      const valor = v.veiculo.cpkCustosFixos * distanciaTotalKm;
      categorias.push({
        categoria: "Outros",
        valor: arredondar(valor, casas.moeda),
        origem: "cpkCustosFixos × distância total",
        previstoOuRealizado: rotuloPrevistoRealizado,
        incluido: true,
        observacoes: "Representa o conjunto de custos fixos proporcionais via CPK, sem detalhamento por item.",
      });
    } else {
      const { categorias: categoriasFixas, dadosFaltantes: faltantesFixos, premissas: premissasFixos } = calcularCategoriasCustoFixo(
        v.custosFixos,
        contextoBase,
        casas,
        rotuloPrevistoRealizado
      );
      categorias.push(...categoriasFixas);
      dadosFaltantes.push(...faltantesFixos.map((f) => `${rotulo}.${f}`));
      premissas.push(...premissasFixos.map((p) => `${rotulo}: ${p}`));
    }
  }

  const resultadoArla = calcularCategoriaArla(v, litrosCombustivel, casas, rotuloPrevistoRealizado);
  categorias.push(resultadoArla.categoria);

  const resultadoPedagio = calcularCategoriaPedagio(v.pedagios, casas, "Pedágios", rotuloPrevistoRealizado);
  categorias.push(resultadoPedagio.categoria);
  const custoIdaPedagio = resultadoPedagio.custoIda;
  let custoVoltaPedagio = resultadoPedagio.custoVolta;

  if (v.volta?.pedagios) {
    const resultadoPedagioVolta = calcularCategoriaPedagio(v.volta.pedagios, casas, "Pedágios (retorno)", rotuloPrevistoRealizado);
    if (resultadoPedagioVolta.categoria.incluido) {
      categorias.push(resultadoPedagioVolta.categoria);
      custoVoltaPedagio += resultadoPedagioVolta.custoIda + resultadoPedagioVolta.custoVolta;
    }
  }

  const {
    motorista: catMotorista,
    ajudante: catAjudante,
    alimentacao: catAlimentacao,
    hospedagem: catHospedagem,
    dadosFaltantes: faltantesPessoal,
  } = calcularCategoriaMotoristaAjudante(
    v.motorista,
    v.ajudante,
    v.diasViagem,
    entrada.quantidadeMotoristas,
    entrada.quantidadeAjudantes,
    casas,
    rotuloPrevistoRealizado
  );
  categorias.push(catMotorista, catAjudante, catAlimentacao, catHospedagem);
  dadosFaltantes.push(...faltantesPessoal.map((f) => `${rotulo}.${f}`));

  const { cargaDescarga, operacaoGeral, indireto } = calcularCategoriaOperacao(v.operacao, casas, rotuloPrevistoRealizado);
  categorias.push(cargaDescarga, operacaoGeral, indireto);

  let custoVoltaAdicional = 0;
  if (v.volta?.custosAdicionais !== undefined) {
    custoVoltaAdicional += v.volta.custosAdicionais;
    categorias.push({
      categoria: "Outros (indiretos)",
      valor: arredondar(v.volta.custosAdicionais, casas.moeda),
      origem: v.volta.descricaoCustosAdicionais ? `custos adicionais do retorno (${v.volta.descricaoCustosAdicionais})` : "custos adicionais do retorno",
      previstoOuRealizado: rotuloPrevistoRealizado,
      incluido: true,
    });
  }

  if (v.custosAdicionais !== undefined) {
    categorias.push({
      categoria: "Outros (indiretos)",
      valor: arredondar(v.custosAdicionais, casas.moeda),
      origem: v.descricaoCustosAdicionais ? `custos adicionais informados (${v.descricaoCustosAdicionais})` : "custos adicionais informados",
      previstoOuRealizado: rotuloPrevistoRealizado,
      incluido: true,
    });
  }

  if (entrada.modo === "IDA_COM_RETORNO_VAZIO") {
    const semCarga = v.volta?.possuiCarga === false || v.volta?.possuiCarga === undefined;
    if (semCarga) {
      premissas.push(`${rotulo}: o retorno foi considerado vazio (sem carga ou receita); os custos da volta foram incluídos normalmente no total.`);
    }
  }

  const custoIdaParcial = (custoIdaCombustivel ?? 0) + custoIdaPedagio;
  const custoVoltaParcial = custoVoltaCombustivel + custoVoltaPedagio + custoVoltaAdicional;

  return {
    distanciaTotalKm,
    distanciaCarregadaKm,
    litrosCombustivel,
    litrosArla: resultadoArla.litros,
    categorias,
    custoIdaParcial,
    custoVoltaParcial,
    dadosFaltantes,
    alertas,
    premissas,
  };
}

// ---------------------------------------------------------------------------
// Consolidação (soma por bucket, custoTotal, nível de completude)
// ---------------------------------------------------------------------------

interface ResultadoConsolidado {
  categorias: ResultadoCategoriaCusto[];
  custosVariaveis: number;
  custosFixosProporcionais: number;
  custosDiretos: number;
  custosIndiretos: number;
  custoTotal: number;
  custosIncluidos: string[];
  custosIgnorados: string[];
  nivelCompletude: NivelCompletude;
}

function consolidar(categorias: ResultadoCategoriaCusto[], distanciaTotalKm: number | undefined): ResultadoConsolidado {
  let custosVariaveis = 0;
  let custosFixosProporcionais = 0;
  let custosDiretos = 0;
  let custosIndiretos = 0;
  const custosIncluidos: string[] = [];
  const custosIgnorados: string[] = [];

  for (const c of categorias) {
    if (c.incluido && c.valor !== undefined) {
      custosIncluidos.push(c.categoria);
      const bucket = BUCKET_POR_CATEGORIA[c.categoria] ?? "INDIRETO";
      if (bucket === "VARIAVEL") custosVariaveis += c.valor;
      else if (bucket === "FIXO_PROPORCIONAL") custosFixosProporcionais += c.valor;
      else if (bucket === "DIRETO") custosDiretos += c.valor;
      else custosIndiretos += c.valor;
    } else {
      custosIgnorados.push(c.categoria);
    }
  }

  const custoTotal = custosVariaveis + custosFixosProporcionais + custosDiretos + custosIndiretos;

  const usouCpkTotal = categorias.some((c) => c.categoria === "CPK total do veículo" && c.incluido);
  const temCombustivelCompleto = categorias.some((c) => c.categoria === "Combustível" && c.incluido);
  const temAlgumCustoFixo = categorias.some(
    (c) => ["Seguro", "Licenciamento", "Financiamento", "Depreciação", "Rastreador", "Administração", "CPK total do veículo", "Outros"].includes(c.categoria) && c.incluido
  );

  let nivelCompletude: NivelCompletude;
  if (distanciaTotalKm === undefined || distanciaTotalKm <= 0 || custosIncluidos.length === 0) {
    nivelCompletude = "INSUFICIENTE";
  } else if (!usouCpkTotal && (!temCombustivelCompleto || !temAlgumCustoFixo)) {
    nivelCompletude = "PARCIAL";
  } else {
    nivelCompletude = "COMPLETO";
  }

  return {
    categorias,
    custosVariaveis: arredondar(custosVariaveis, CASAS_DECIMAIS_MOEDA_PADRAO),
    custosFixosProporcionais: arredondar(custosFixosProporcionais, CASAS_DECIMAIS_MOEDA_PADRAO),
    custosDiretos: arredondar(custosDiretos, CASAS_DECIMAIS_MOEDA_PADRAO),
    custosIndiretos: arredondar(custosIndiretos, CASAS_DECIMAIS_MOEDA_PADRAO),
    custoTotal: arredondar(custoTotal, CASAS_DECIMAIS_MOEDA_PADRAO),
    custosIncluidos,
    custosIgnorados,
    nivelCompletude,
  };
}

// ---------------------------------------------------------------------------
// Comparação previsto x realizado
// ---------------------------------------------------------------------------

function compararPrevistoRealizado(
  categoriasPrevisto: ResultadoCategoriaCusto[],
  categoriasRealizado: ResultadoCategoriaCusto[],
  custoPrevisto: number,
  custoRealizado: number,
  casas: CasasDecimais
): ComparacaoPrevistoRealizadoViagem {
  const diferencaValor = arredondar(custoRealizado - custoPrevisto, casas.moeda);
  const diferencaPercentual = custoPrevisto !== 0 ? arredondar((diferencaValor / custoPrevisto) * 100, casas.percentual) : undefined;

  const mapaPrevisto = new Map(categoriasPrevisto.filter((c) => c.incluido && c.valor !== undefined).map((c) => [c.categoria, c.valor as number]));
  const mapaRealizado = new Map(categoriasRealizado.filter((c) => c.incluido && c.valor !== undefined).map((c) => [c.categoria, c.valor as number]));

  const categoriasAcimaDoPrevisto: string[] = [];
  const categoriasAbaixoDoPrevisto: string[] = [];
  let maiorDesvioAbs = 0;
  let principalDesvio: string | undefined;

  const todasCategorias = new Set([...mapaPrevisto.keys(), ...mapaRealizado.keys()]);
  for (const categoria of todasCategorias) {
    const previsto = mapaPrevisto.get(categoria) ?? 0;
    const realizado = mapaRealizado.get(categoria) ?? 0;
    const desvio = realizado - previsto;
    if (desvio > 0) categoriasAcimaDoPrevisto.push(categoria);
    else if (desvio < 0) categoriasAbaixoDoPrevisto.push(categoria);

    if (Math.abs(desvio) > maiorDesvioAbs) {
      maiorDesvioAbs = Math.abs(desvio);
      principalDesvio = categoria;
    }
  }

  const alertas: string[] = [];
  if (principalDesvio !== undefined && maiorDesvioAbs > 0) {
    alertas.push(
      `A categoria com maior desvio entre previsto e realizado foi "${principalDesvio}" (${formatarBRL(maiorDesvioAbs)}). A causa não foi informada — pode ser desvio de rota, operação adicional ou variação de preço.`
    );
  }

  return {
    custoPrevisto: arredondar(custoPrevisto, casas.moeda),
    custoRealizado: arredondar(custoRealizado, casas.moeda),
    diferencaValor,
    diferencaPercentual,
    categoriasAcimaDoPrevisto,
    categoriasAbaixoDoPrevisto,
    principalDesvio,
    alertas,
  };
}

// ---------------------------------------------------------------------------
// Resumo textual e memória de cálculo
// ---------------------------------------------------------------------------

function construirResumo(
  entrada: CalcularCustoViagemEntrada,
  distanciaTotalKm: number | undefined,
  custoTotal: number | undefined,
  custoPorKm: number | undefined,
  consolidado: ResultadoConsolidado,
  categoriasPrincipais: ResultadoCategoriaCusto[]
): string {
  if (custoTotal === undefined || distanciaTotalKm === undefined) {
    return "Não foi possível concluir o cálculo com os dados informados. Verifique os campos faltantes.";
  }

  const partes: string[] = [];
  const trajeto = entrada.origem && entrada.destino ? `A viagem de ${entrada.origem} a ${entrada.destino}` : "A viagem";
  partes.push(`${trajeto} possui ${formatarNumero(distanciaTotalKm)} km totais considerados.`);
  partes.push(`O custo estimado foi de ${formatarBRL(custoTotal)}${custoPorKm !== undefined ? `, equivalente a ${formatarBRL(custoPorKm)} por km` : ""}.`);

  const maioresCategorias = categoriasPrincipais
    .filter((c) => c.incluido && c.valor !== undefined && c.valor > 0)
    .sort((a, b) => (b.valor as number) - (a.valor as number))
    .slice(0, 3);
  if (maioresCategorias.length > 0) {
    partes.push(
      maioresCategorias.map((c) => `${c.categoria} representou ${formatarBRL(c.valor as number)}`).join(", ") + "."
    );
  }

  if (consolidado.nivelCompletude === "PARCIAL") {
    partes.push(`O cálculo foi classificado como parcial porque não foram informados: ${consolidado.custosIgnorados.join(", ")}.`);
  } else if (consolidado.nivelCompletude === "INSUFICIENTE") {
    partes.push("O cálculo foi classificado como insuficiente para um resultado financeiro confiável.");
  }

  return partes.join(" ");
}

// ---------------------------------------------------------------------------
// Função principal
// ---------------------------------------------------------------------------

function casasDecimaisDe(entrada: CalcularCustoViagemEntrada): CasasDecimais {
  const override = entrada.casasDecimais;
  return {
    moeda: override ?? CASAS_DECIMAIS_MOEDA_PADRAO,
    custoPorKm: override ?? CASAS_DECIMAIS_CUSTO_POR_KM_PADRAO,
    percentual: override ?? CASAS_DECIMAIS_PERCENTUAL_PADRAO,
    litros: override ?? CASAS_DECIMAIS_LITROS_PADRAO,
    distancia: override ?? CASAS_DECIMAIS_DISTANCIA_PADRAO,
    peso: override ?? CASAS_DECIMAIS_PESO_PADRAO,
  };
}

function calcularCustosDerivados(
  custoTotal: number,
  distanciaTotalKm: number | undefined,
  distanciaCarregadaKm: number | undefined,
  entrada: CalcularCustoViagemEntrada,
  casas: CasasDecimais
): {
  custoPorKm?: number;
  custoPorTonelada?: number;
  custoToneladaKm?: number;
  custoPorUnidade?: number;
  custoPorVeiculo?: number;
  custoPorDia?: number;
  custoTotalOperacao?: number;
  dadosFaltantes: string[];
} {
  const dadosFaltantes: string[] = [];

  let custoPorKm: number | undefined;
  if (distanciaTotalKm !== undefined && distanciaTotalKm > 0) {
    const resultado = calcularCpk({
      modo: "CPK_PNEUS",
      custoPneus: custoTotal,
      quilometragem: distanciaTotalKm,
      arredondamentoCasasDecimais: casas.custoPorKm,
    });
    custoPorKm = resultado.sucesso ? resultado.resultados.cpk : undefined;
  }

  let custoPorTonelada: number | undefined;
  if (entrada.pesoCargaToneladas !== undefined && entrada.pesoCargaToneladas > 0) {
    custoPorTonelada = arredondar(custoTotal / entrada.pesoCargaToneladas, casas.moeda);
  } else if (entrada.modo === "RATEIO_POR_CARGA" && entrada.criterioRateioCarga === "TONELADA") {
    dadosFaltantes.push("pesoCargaToneladas (necessário para o rateio por tonelada)");
  }

  let custoToneladaKm: number | undefined;
  if (entrada.pesoCargaToneladas !== undefined && entrada.pesoCargaToneladas > 0 && distanciaCarregadaKm !== undefined && distanciaCarregadaKm > 0) {
    custoToneladaKm = arredondar(custoTotal / (entrada.pesoCargaToneladas * distanciaCarregadaKm), casas.custoPorKm);
  }

  let custoPorUnidade: number | undefined;
  if (entrada.quantidadeCarga !== undefined && entrada.quantidadeCarga > 0) {
    custoPorUnidade = arredondar(custoTotal / entrada.quantidadeCarga, casas.moeda);
  } else if (entrada.modo === "RATEIO_POR_CARGA" && entrada.criterioRateioCarga === "UNIDADE") {
    dadosFaltantes.push("quantidadeCarga (necessário para o rateio por unidade)");
  }

  if (entrada.modo === "RATEIO_POR_CARGA" && entrada.criterioRateioCarga === "VOLUME" && (entrada.volumeCarga === undefined || entrada.volumeCarga <= 0)) {
    dadosFaltantes.push("volumeCarga (necessário para o rateio por volume)");
  }

  let custoPorVeiculo: number | undefined;
  let custoTotalOperacao: number | undefined;
  if (entrada.modo === "MULTIPLOS_VEICULOS") {
    if (entrada.quantidadeVeiculos === undefined || entrada.quantidadeVeiculos <= 0) {
      dadosFaltantes.push("quantidadeVeiculos (necessário para o modo MULTIPLOS_VEICULOS)");
    } else {
      custoPorVeiculo = arredondar(custoTotal, casas.moeda);
      custoTotalOperacao = arredondar(custoTotal * entrada.quantidadeVeiculos, casas.moeda);
    }
  } else if (entrada.quantidadeVeiculos !== undefined && entrada.quantidadeVeiculos > 0) {
    custoPorVeiculo = arredondar(custoTotal / entrada.quantidadeVeiculos, casas.moeda);
  }

  let custoPorDia: number | undefined;
  if (entrada.diasViagem !== undefined && entrada.diasViagem > 0) {
    custoPorDia = arredondar(custoTotal / entrada.diasViagem, casas.moeda);
  }

  return { custoPorKm, custoPorTonelada, custoToneladaKm, custoPorUnidade, custoPorVeiculo, custoPorDia, custoTotalOperacao, dadosFaltantes };
}

function calcularUmaVariante(
  entrada: CalcularCustoViagemEntrada,
  v: DadosViagemVariante,
  rotulo: string,
  rotuloPrevistoRealizado: "PREVISTO" | "REALIZADO" | undefined,
  estrategiaSobreposicao: EstrategiaSobreposicao,
  casas: CasasDecimais
): {
  agregacao: ResultadoAgregacaoTrecho;
  consolidado: ResultadoConsolidado;
  erros: string[];
  alertasSobreposicao: string[];
} {
  const { efetiva, alertas: alertasSobreposicao, erros } = resolverSobreposicoes(v, estrategiaSobreposicao, rotulo);
  if (erros.length > 0) {
    return {
      agregacao: { categorias: [], custoIdaParcial: 0, custoVoltaParcial: 0, dadosFaltantes: [], alertas: [], premissas: [] },
      consolidado: consolidar([], undefined),
      erros,
      alertasSobreposicao: [],
    };
  }

  const agregacao = agregarVariante(entrada, efetiva, rotulo, rotuloPrevistoRealizado, casas);
  const consolidado = consolidar(agregacao.categorias, agregacao.distanciaTotalKm);
  return { agregacao, consolidado, erros: [], alertasSobreposicao };
}

export function calcularCustoViagem(entrada: CalcularCustoViagemEntrada): CalcularCustoViagemResultado {
  const casas = casasDecimaisDe(entrada);
  const estrategiaSobreposicao = entrada.estrategiaSobreposicao ?? "REJEITAR_SOBREPOSICAO";

  const errosTopo = validarEstruturaTopo(entrada);
  if (errosTopo.length > 0) {
    return respostaFalha(entrada, errosTopo.join(" "));
  }

  if (entrada.modo === "COMPARACAO_PREVISTO_REALIZADO") {
    if (!entrada.previsto || !entrada.realizado) {
      const dadosFaltantes: string[] = [];
      if (!entrada.previsto) dadosFaltantes.push("previsto");
      if (!entrada.realizado) dadosFaltantes.push("realizado");
      return respostaFalha(
        entrada,
        "Para comparar previsto e realizado, informe os blocos completos \"previsto\" e \"realizado\".",
        dadosFaltantes
      );
    }

    const errosPrevisto = validarVariante(entrada.previsto, "previsto");
    const errosRealizado = validarVariante(entrada.realizado, "realizado");
    if (errosPrevisto.length > 0 || errosRealizado.length > 0) {
      return respostaFalha(entrada, [...errosPrevisto, ...errosRealizado].join(" "));
    }

    if ((entrada.previsto.distanciaIdaKm ?? 0) <= 0 && entrada.previsto.distanciaIdaKm !== undefined) {
      return respostaFalha(entrada, 'A distância informada em "previsto" não pode ser igual a zero.');
    }
    if ((entrada.realizado.distanciaIdaKm ?? 0) <= 0 && entrada.realizado.distanciaIdaKm !== undefined) {
      return respostaFalha(entrada, 'A distância informada em "realizado" não pode ser igual a zero.');
    }

    const resultadoPrevisto = calcularUmaVariante(entrada, entrada.previsto, "previsto", "PREVISTO", estrategiaSobreposicao, casas);
    const resultadoRealizado = calcularUmaVariante(entrada, entrada.realizado, "realizado", "REALIZADO", estrategiaSobreposicao, casas);

    if (resultadoPrevisto.erros.length > 0 || resultadoRealizado.erros.length > 0) {
      return respostaFalha(entrada, [...resultadoPrevisto.erros, ...resultadoRealizado.erros].join(" "));
    }

    const dadosFaltantesGeral = [
      ...resultadoPrevisto.agregacao.dadosFaltantes,
      ...resultadoRealizado.agregacao.dadosFaltantes,
    ];

    if (resultadoPrevisto.consolidado.nivelCompletude === "INSUFICIENTE" || resultadoRealizado.consolidado.nivelCompletude === "INSUFICIENTE") {
      return respostaFalha(
        entrada,
        "Não há dados suficientes para comparar previsto e realizado. Verifique os campos faltantes.",
        dadosFaltantesGeral
      );
    }

    const comparacao = compararPrevistoRealizado(
      resultadoPrevisto.agregacao.categorias,
      resultadoRealizado.agregacao.categorias,
      resultadoPrevisto.consolidado.custoTotal,
      resultadoRealizado.consolidado.custoTotal,
      casas
    );

    const todasCategorias = [...resultadoPrevisto.agregacao.categorias, ...resultadoRealizado.agregacao.categorias];
    const custosIncluidos = Array.from(new Set([...resultadoPrevisto.consolidado.custosIncluidos, ...resultadoRealizado.consolidado.custosIncluidos]));
    const custosIgnorados = Array.from(new Set([...resultadoPrevisto.consolidado.custosIgnorados, ...resultadoRealizado.consolidado.custosIgnorados]));
    const nivelCompletude: NivelCompletude =
      resultadoPrevisto.consolidado.nivelCompletude === "PARCIAL" || resultadoRealizado.consolidado.nivelCompletude === "PARCIAL"
        ? "PARCIAL"
        : "COMPLETO";

    const memoriaCalculo = [
      ...(resultadoPrevisto.agregacao.categorias.filter((c) => c.memoriaCalculo).map((c) => c.memoriaCalculo as string)),
      ...(resultadoRealizado.agregacao.categorias.filter((c) => c.memoriaCalculo).map((c) => c.memoriaCalculo as string)),
    ];

    return {
      sucesso: true,
      modo: entrada.modo,
      descricao: entrada.descricao,
      origem: entrada.origem,
      destino: entrada.destino,
      distanciaIdaKm: entrada.previsto.distanciaIdaKm,
      distanciaTotalKm: resultadoPrevisto.agregacao.distanciaTotalKm,
      quantidadeVeiculos: entrada.quantidadeVeiculos,
      custosPorCategoria: todasCategorias,
      custoTotal: comparacao.custoRealizado,
      comparacaoPrevistoRealizado: comparacao,
      nivelCompletude,
      custosIncluidos,
      custosIgnorados,
      limitacoes: LIMITACOES_PADRAO,
      alertas: [
        ...resultadoPrevisto.alertasSobreposicao,
        ...resultadoRealizado.alertasSobreposicao,
        ...resultadoPrevisto.agregacao.alertas,
        ...resultadoRealizado.agregacao.alertas,
        ...comparacao.alertas,
      ],
      premissas: [...resultadoPrevisto.agregacao.premissas, ...resultadoRealizado.agregacao.premissas],
      dadosFaltantes: [],
      mensagemResumo: `Custo previsto: ${formatarBRL(comparacao.custoPrevisto ?? 0)}. Custo realizado: ${formatarBRL(
        comparacao.custoRealizado ?? 0
      )}. Diferença: ${formatarBRL(comparacao.diferencaValor ?? 0)}${
        comparacao.diferencaPercentual !== undefined ? ` (${formatarNumero(comparacao.diferencaPercentual)}%)` : ""
      }.`,
      memoriaCalculo,
    };
  }

  // Modos de variante única
  const errosVariante = validarVariante(entrada, "viagem");
  if (errosVariante.length > 0) {
    return respostaFalha(entrada, errosVariante.join(" "));
  }

  const dadosFaltantesModo: string[] = [];
  if (entrada.distanciaIdaKm === undefined) {
    dadosFaltantesModo.push("distanciaIdaKm");
  } else if (entrada.distanciaIdaKm === 0) {
    return respostaFalha(entrada, "A distância não pode ser igual a zero.");
  }
  if (MODOS_IDA_E_VOLTA.includes(entrada.modo)) {
    if (entrada.distanciaVoltaKm === undefined) {
      dadosFaltantesModo.push("distanciaVoltaKm");
    } else if (entrada.distanciaVoltaKm === 0) {
      return respostaFalha(entrada, "A distância de volta não pode ser igual a zero.");
    }
  }
  if (entrada.modo === "MULTIPLOS_VEICULOS" && (entrada.quantidadeVeiculos === undefined || entrada.quantidadeVeiculos <= 0)) {
    dadosFaltantesModo.push("quantidadeVeiculos");
  }
  if (entrada.modo === "RATEIO_POR_CARGA" && entrada.criterioRateioCarga === undefined) {
    dadosFaltantesModo.push("criterioRateioCarga");
  }

  if (dadosFaltantesModo.length > 0) {
    return respostaFalha(
      entrada,
      `Para calcular o custo da viagem, informe: ${dadosFaltantesModo.join(", ")}.`,
      dadosFaltantesModo
    );
  }

  const { agregacao, consolidado, erros, alertasSobreposicao } = calcularUmaVariante(
    entrada,
    entrada,
    "viagem",
    entrada.modo === "CUSTO_REALIZADO" ? "REALIZADO" : entrada.modo === "CUSTO_PREVISTO" ? "PREVISTO" : undefined,
    estrategiaSobreposicao,
    casas
  );

  if (erros.length > 0) {
    return respostaFalha(entrada, erros.join(" "));
  }

  if (consolidado.nivelCompletude === "INSUFICIENTE") {
    return respostaFalha(
      entrada,
      "Não há dados suficientes para um cálculo confiável do custo da viagem. Verifique os campos faltantes.",
      agregacao.dadosFaltantes
    );
  }

  const derivados = calcularCustosDerivados(consolidado.custoTotal, agregacao.distanciaTotalKm, agregacao.distanciaCarregadaKm, entrada, casas);

  const permitirEstimativas = entrada.permitirEstimativas ?? true;
  const bloquearConclusao = !permitirEstimativas && consolidado.nivelCompletude === "PARCIAL";

  const alertasFinal = [...alertasSobreposicao, ...agregacao.alertas];
  if (bloquearConclusao) {
    alertasFinal.push('Conclusão financeira parcial: "permitirEstimativas" está desativado e há categorias relevantes não informadas.');
  }

  const categoriasPrincipais = agregacao.categorias.filter((c) => c.incluido);

  const mensagemResumo = construirResumo(
    entrada,
    agregacao.distanciaTotalKm,
    consolidado.custoTotal,
    derivados.custoPorKm,
    consolidado,
    categoriasPrincipais
  );

  const memoriaCalculo = agregacao.categorias.filter((c) => c.memoriaCalculo).map((c) => c.memoriaCalculo as string);

  return {
    sucesso: true,
    modo: entrada.modo,
    descricao: entrada.descricao,
    origem: entrada.origem,
    destino: entrada.destino,
    distanciaIdaKm: entrada.distanciaIdaKm,
    distanciaVoltaKm: entrada.distanciaVoltaKm,
    distanciaAdicionalKm: entrada.distanciaAdicionalKm,
    distanciaTotalKm: agregacao.distanciaTotalKm !== undefined ? arredondar(agregacao.distanciaTotalKm, casas.distancia) : undefined,
    quantidadeVeiculos: entrada.quantidadeVeiculos,
    custosPorCategoria: agregacao.categorias,
    custosVariaveis: consolidado.custosVariaveis,
    custosFixosProporcionais: consolidado.custosFixosProporcionais,
    custosDiretos: consolidado.custosDiretos,
    custosIndiretos: consolidado.custosIndiretos,
    custoIda: MODOS_IDA_E_VOLTA.includes(entrada.modo) ? arredondar(agregacao.custoIdaParcial, casas.moeda) : undefined,
    custoVolta: MODOS_IDA_E_VOLTA.includes(entrada.modo) ? arredondar(agregacao.custoVoltaParcial, casas.moeda) : undefined,
    custoTotal: entrada.modo === "MULTIPLOS_VEICULOS" ? derivados.custoTotalOperacao ?? consolidado.custoTotal : consolidado.custoTotal,
    custoPorKm: derivados.custoPorKm,
    custoPorTonelada: derivados.custoPorTonelada,
    custoToneladaKm: derivados.custoToneladaKm,
    custoPorUnidade: derivados.custoPorUnidade,
    custoPorVeiculo: derivados.custoPorVeiculo,
    custoPorDia: derivados.custoPorDia,
    litrosCombustivel: agregacao.litrosCombustivel !== undefined ? arredondar(agregacao.litrosCombustivel, casas.litros) : undefined,
    litrosArla: agregacao.litrosArla !== undefined ? arredondar(agregacao.litrosArla, casas.litros) : undefined,
    nivelCompletude: consolidado.nivelCompletude,
    custosIncluidos: consolidado.custosIncluidos,
    custosIgnorados: consolidado.custosIgnorados,
    limitacoes: LIMITACOES_PADRAO,
    alertas: alertasFinal,
    premissas: agregacao.premissas,
    dadosFaltantes: [],
    mensagemResumo: bloquearConclusao
      ? `Não é possível apresentar uma conclusão financeira: dados incompletos (${consolidado.custosIgnorados.join(", ")}) e "permitirEstimativas" está desativado.`
      : mensagemResumo,
    memoriaCalculo,
  };
}

// ---------------------------------------------------------------------------
// Registro da ferramenta
// ---------------------------------------------------------------------------

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  {
    nome: "modo",
    tipo: "enum",
    obrigatorio: true,
    descricao: "Tipo de cálculo de custo de viagem desejado.",
    valoresPossiveis: [
      "VIAGEM_SIMPLES",
      "IDA_E_VOLTA",
      "IDA_COM_RETORNO_VAZIO",
      "IDA_COM_CARGA_RETORNO",
      "CUSTO_PREVISTO",
      "CUSTO_REALIZADO",
      "COMPARACAO_PREVISTO_REALIZADO",
      "MULTIPLOS_VEICULOS",
      "RATEIO_POR_CARGA",
    ],
  },
  { nome: "descricao", tipo: "string", obrigatorio: false, descricao: "Descrição livre da viagem." },
  { nome: "origem", tipo: "string", obrigatorio: false, descricao: "Origem (apenas informativo — a distância não é calculada automaticamente)." },
  { nome: "destino", tipo: "string", obrigatorio: false, descricao: "Destino (apenas informativo)." },
  { nome: "distanciaIdaKm", tipo: "number", obrigatorio: true, descricao: "Distância de ida, em km." },
  { nome: "distanciaVoltaKm", tipo: "number", obrigatorio: false, descricao: "Distância de volta, em km (obrigatório nos modos de ida e volta)." },
  { nome: "distanciaAdicionalKm", tipo: "number", obrigatorio: false, descricao: "Deslocamento extra a somar, em km." },
  { nome: "quantidadeVeiculos", tipo: "number", obrigatorio: false, descricao: "Quantidade de veículos (obrigatório em MULTIPLOS_VEICULOS)." },
  { nome: "quantidadeMotoristas", tipo: "number", obrigatorio: false, descricao: "Quantidade de motoristas." },
  { nome: "quantidadeAjudantes", tipo: "number", obrigatorio: false, descricao: "Quantidade de ajudantes." },
  { nome: "pesoCargaToneladas", tipo: "number", obrigatorio: false, descricao: "Peso da carga, em toneladas." },
  { nome: "quantidadeCarga", tipo: "number", obrigatorio: false, descricao: "Quantidade de unidades de carga." },
  { nome: "unidadeCarga", tipo: "string", obrigatorio: false, descricao: "Rótulo da unidade de carga (ex.: \"paletes\")." },
  { nome: "volumeCarga", tipo: "number", obrigatorio: false, descricao: "Volume da carga (m³ ou outra unidade informada)." },
  { nome: "diasViagem", tipo: "number", obrigatorio: false, descricao: "Duração da viagem, em dias." },
  { nome: "horasViagem", tipo: "number", obrigatorio: false, descricao: "Duração da viagem, em horas." },
  {
    nome: "veiculo",
    tipo: "string",
    obrigatorio: false,
    descricao:
      "Dados operacionais do veículo: consumoMedioKmLitro/consumoIdaKmLitro/consumoVoltaKmLitro + precoCombustivelLitro, OU cpkTotal, OU cpkManutencao/cpkPneus/cpkDepreciacao/cpkCustosFixos (nunca misturar cpkTotal com os demais).",
  },
  { nome: "custoCombustivelInformado", tipo: "number", obrigatorio: false, descricao: "Custo de combustível já pronto, em R$ (alternativa a informar consumo/preço)." },
  { nome: "arla", tipo: "string", obrigatorio: false, descricao: "litros (direto) OU percentualSobreDiesel + precoLitro." },
  { nome: "pedagios", tipo: "string", obrigatorio: false, descricao: "valorTotal OU pracas (lista) — nunca os dois." },
  { nome: "motorista", tipo: "string", obrigatorio: false, descricao: "diaria, salarioProporcional, comissao, valorFixoViagem, horaExtra, adicionalNoturno, alimentacao, hospedagem, adiantamento, outros." },
  { nome: "ajudante", tipo: "string", obrigatorio: false, descricao: "diaria, valorFixo, quantidade, alimentacao, hospedagem, outros." },
  { nome: "operacao", tipo: "string", obrigatorio: false, descricao: "valorTotal OU itens detalhados (carga, descarga, chapa, estacionamento, etc.) — nunca os dois." },
  { nome: "custosFixos", tipo: "string", obrigatorio: false, descricao: "seguroVeiculo/licenciamento/financiamento/depreciacao/rastreador/administracao/salarioFixo/garagem/impostosFixos/outros, cada um com {valor, base}." },
  { nome: "custosAdicionais", tipo: "number", obrigatorio: false, descricao: "Outro custo não categorizado, em R$." },
  { nome: "volta", tipo: "string", obrigatorio: false, descricao: "Dados específicos do retorno: cargaToneladas, possuiCarga, pedagios, custosAdicionais." },
  { nome: "previsto", tipo: "string", obrigatorio: false, descricao: "Bloco completo de dados previstos — obrigatório em COMPARACAO_PREVISTO_REALIZADO." },
  { nome: "realizado", tipo: "string", obrigatorio: false, descricao: "Bloco completo de dados realizados — obrigatório em COMPARACAO_PREVISTO_REALIZADO." },
  {
    nome: "criterioRateioCarga",
    tipo: "enum",
    obrigatorio: false,
    descricao: "Critério de rateio em RATEIO_POR_CARGA.",
    valoresPossiveis: ["TONELADA", "UNIDADE", "VOLUME"],
  },
  {
    nome: "estrategiaSobreposicao",
    tipo: "enum",
    obrigatorio: false,
    descricao: "Como resolver quando a mesma categoria de custo é informada de duas formas. Padrão: REJEITAR_SOBREPOSICAO.",
    valoresPossiveis: ["REJEITAR_SOBREPOSICAO", "PRIORIZAR_TOTAL", "PRIORIZAR_DETALHADO"],
  },
  { nome: "casasDecimais", tipo: "number", obrigatorio: false, descricao: "Sobrescreve as casas decimais padrão (moeda 2, custo/km 4, percentual 2, litros 2, distância 2, peso 3)." },
  { nome: "permitirEstimativas", tipo: "boolean", obrigatorio: false, descricao: "Quando false, suprime a conclusão financeira se houver categorias relevantes ausentes. Padrão: true." },
  { nome: "observacoes", tipo: "string", obrigatorio: false, descricao: "Observações livres." },
];

export const ferramentaCalcularCustoViagem: DefinicaoFerramenta<CalcularCustoViagemEntrada, CalcularCustoViagemResultado> = {
  nome: "calcular_custo_viagem",
  descricao:
    "Calcula o custo operacional completo de uma viagem de transporte rodoviário (combustível, ARLA, pedágios, motorista, ajudante, operação, custos fixos proporcionais), com custo por km, por tonelada, por veículo e por dia. Aceita ida e volta, retorno vazio, múltiplos veículos e comparação previsto x realizado. Use apenas para pedidos de cálculo de custo de viagem com dados concretos; não use para perguntas gerais sem números para calcular.",
  objetivo:
    "Consolidar o custo real esperado (ou realizado) de uma viagem para embasar precificação e viabilidade, sem inventar distância, preço de combustível, pedágio, diária, peso de carga ou CPK, e sem apresentar um cálculo parcial como se fosse o custo total da operação.",
  parametros: PARAMETROS,
  executar: calcularCustoViagem,
};
