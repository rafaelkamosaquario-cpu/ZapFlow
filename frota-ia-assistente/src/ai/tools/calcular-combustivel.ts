import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";
import { CASAS_DECIMAIS_PADRAO, arredondar, formatarBRL, formatarNumero } from "./utils";

/**
 * Ferramenta: calcular_combustivel
 *
 * Calcula consumo e custo de combustível em viagens ou períodos
 * operacionais, sem depender de nenhuma API externa. Todos os dados usados
 * no cálculo vêm do que foi informado pelo usuário (ou repassado pelo
 * sistema) — nada é estimado ou inventado silenciosamente.
 *
 * Modos suportados: ver `ModoCalculoCombustivel`. Cada modo tem seu próprio
 * conjunto de campos obrigatórios (ver README.md da pasta tools).
 */

// ---------------------------------------------------------------------------
// Constantes configuráveis
// ---------------------------------------------------------------------------

/**
 * Tolerância (em %) para considerar o consumo real "dentro do esperado" em
 * relação ao previsto, na comparação PREVISTO x REALIZADO.
 */
export const TOLERANCIA_CONSUMO_PERCENTUAL = 3;

/**
 * Abaixo deste valor (em km), a autonomia é classificada como insuficiente.
 */
export const AUTONOMIA_UTIL_MINIMA_KM = 50;

/**
 * Entre `AUTONOMIA_UTIL_MINIMA_KM` e este valor (em km), a autonomia é
 * classificada como "próxima do limite". Acima dele, é considerada
 * suficiente.
 */
export const AUTONOMIA_UTIL_ALERTA_KM = 150;

const PREMISSA_ESTIMATIVA = "O cálculo representa uma estimativa.";
const PREMISSA_SEM_VARIACOES =
  "Não foram consideradas variações de consumo por carga, relevo, trânsito ou clima.";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ModoCalculoCombustivel =
  | "PREVISAO_VIAGEM"
  | "CONSUMO_REAL"
  | "COMPARACAO_PREVISTO_REALIZADO"
  | "AUTONOMIA"
  | "COMPARACAO_CENARIOS";

/** Um cenário completo para o modo COMPARACAO_CENARIOS. */
export interface CenarioCombustivelComparacao {
  descricaoCenario?: string;
  distanciaKm?: number;
  consumoMedioKmLitro?: number;
  precoCombustivelLitro?: number;
}

export interface CalcularCombustivelEntrada {
  modo: ModoCalculoCombustivel;

  // Distância
  distanciaKm?: number;
  distanciaIdaKm?: number;
  distanciaVoltaKm?: number;
  distanciaAdicionalKm?: number;
  considerarIdaVolta?: boolean;

  // Consumo
  consumoMedioKmLitro?: number;
  consumoPrevistoKmLitro?: number;
  consumoRealKmLitro?: number;

  // Litros / abastecimento
  litrosAbastecidos?: number;
  litrosConsumidos?: number;
  litrosNoTanque?: number;
  capacidadeTanqueLitros?: number;

  // Preço
  precoCombustivelLitro?: number;
  precoCombustivelPrevistoLitro?: number;
  precoCombustivelRealLitro?: number;
  valorTotalAbastecido?: number;

  // Hodômetro
  quilometragemInicial?: number;
  quilometragemFinal?: number;

  // Reserva / autonomia
  percentualReserva?: number;

  // Comparação de cenários
  cenarioA?: CenarioCombustivelComparacao;
  cenarioB?: CenarioCombustivelComparacao;

  // Metadados
  descricaoCenario?: string;
  arredondamentoCasasDecimais?: number;
}

export type ClassificacaoCombustivel =
  | "VIAGEM_CALCULADA"
  | "ABASTECIMENTO_NECESSARIO"
  | "CONSUMO_CALCULADO"
  | "CONSUMO_MELHOR_QUE_PREVISTO"
  | "CONSUMO_DENTRO_DO_ESPERADO"
  | "CONSUMO_PIOR_QUE_PREVISTO"
  | "AUTONOMIA_SUFICIENTE"
  | "AUTONOMIA_PROXIMA_DO_LIMITE"
  | "AUTONOMIA_INSUFICIENTE"
  | "CENARIOS_COMPARADOS";

export interface ResultadosCombustivel {
  distanciaTotalKm?: number;
  distanciaRealKm?: number;
  litrosNecessarios?: number;
  litrosConsumidos?: number;
  custoTotalCombustivel?: number;
  custoCombustivelPorKm?: number;
  consumoRealKmLitro?: number;
  consumoPrevistoKmLitro?: number;
  litrosPor100Km?: number;
  autonomiaTotalKm?: number;
  autonomiaUtilKm?: number;
  litrosReserva?: number;
  litrosRestantes?: number;
  litrosFaltantes?: number;
  diferencaConsumoKmLitro?: number;
  diferencaPercentualConsumo?: number;
  custoPrevisto?: number;
  custoRealizado?: number;
  diferencaCusto?: number;
  cenarioACustoTotal?: number;
  cenarioACustoPorKm?: number;
  cenarioALitrosNecessarios?: number;
  cenarioBCustoTotal?: number;
  cenarioBCustoPorKm?: number;
  cenarioBLitrosNecessarios?: number;
  economiaNominal?: number;
  economiaPercentual?: number;
  diferencaLitros?: number;
  diferencaCustoPorKm?: number;
}

export interface CalcularCombustivelResultado extends ResultadoFerramentaBase {
  modo: ModoCalculoCombustivel;
  dadosEntrada: CalcularCombustivelEntrada;
  resultados: ResultadosCombustivel;
  classificacao?: ClassificacaoCombustivel | "DADOS_INSUFICIENTES";
  /** Apenas no modo COMPARACAO_CENARIOS: identifica o cenário mais econômico. */
  cenarioMaisEconomico?: string;
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

function validarValoresBasicos(entrada: CalcularCombustivelEntrada): string[] {
  const erros: string[] = [];

  const camposNaoNegativos: Array<[string, number | undefined]> = [
    ["distanciaKm", entrada.distanciaKm],
    ["distanciaIdaKm", entrada.distanciaIdaKm],
    ["distanciaVoltaKm", entrada.distanciaVoltaKm],
    ["distanciaAdicionalKm", entrada.distanciaAdicionalKm],
    ["consumoMedioKmLitro", entrada.consumoMedioKmLitro],
    ["consumoPrevistoKmLitro", entrada.consumoPrevistoKmLitro],
    ["consumoRealKmLitro", entrada.consumoRealKmLitro],
    ["litrosAbastecidos", entrada.litrosAbastecidos],
    ["litrosConsumidos", entrada.litrosConsumidos],
    ["litrosNoTanque", entrada.litrosNoTanque],
    ["capacidadeTanqueLitros", entrada.capacidadeTanqueLitros],
    ["precoCombustivelLitro", entrada.precoCombustivelLitro],
    ["precoCombustivelPrevistoLitro", entrada.precoCombustivelPrevistoLitro],
    ["precoCombustivelRealLitro", entrada.precoCombustivelRealLitro],
    ["valorTotalAbastecido", entrada.valorTotalAbastecido],
    ["quilometragemInicial", entrada.quilometragemInicial],
    ["quilometragemFinal", entrada.quilometragemFinal],
  ];
  for (const [campo, valor] of camposNaoNegativos) {
    if (valor !== undefined && valor < 0) {
      erros.push(`O campo "${campo}" não pode ser negativo.`);
    }
  }

  const camposConsumo: Array<[string, number | undefined]> = [
    ["consumoMedioKmLitro", entrada.consumoMedioKmLitro],
    ["consumoPrevistoKmLitro", entrada.consumoPrevistoKmLitro],
    ["consumoRealKmLitro", entrada.consumoRealKmLitro],
  ];
  for (const [campo, valor] of camposConsumo) {
    if (valor === 0) erros.push(`O consumo ("${campo}") não pode ser igual a zero.`);
  }

  const camposPreco: Array<[string, number | undefined]> = [
    ["precoCombustivelLitro", entrada.precoCombustivelLitro],
    ["precoCombustivelPrevistoLitro", entrada.precoCombustivelPrevistoLitro],
    ["precoCombustivelRealLitro", entrada.precoCombustivelRealLitro],
  ];
  for (const [campo, valor] of camposPreco) {
    if (valor === 0) erros.push(`O preço do combustível ("${campo}") não pode ser igual a zero.`);
  }

  if (entrada.quilometragemInicial !== undefined && entrada.quilometragemFinal !== undefined) {
    if (entrada.quilometragemFinal < entrada.quilometragemInicial) {
      erros.push("A quilometragem final não pode ser menor que a quilometragem inicial.");
    }
  }

  if (entrada.capacidadeTanqueLitros !== undefined && entrada.litrosNoTanque !== undefined) {
    if (entrada.litrosNoTanque > entrada.capacidadeTanqueLitros) {
      erros.push("Os litros informados no tanque ultrapassam a capacidade cadastrada.");
    }
  }

  if (entrada.percentualReserva !== undefined) {
    if (entrada.percentualReserva < 0 || entrada.percentualReserva > 100) {
      erros.push("O percentual de reserva deve estar entre 0 e 100.");
    }
  }

  const cenarios: Array<[string, CenarioCombustivelComparacao | undefined]> = [
    ["cenarioA", entrada.cenarioA],
    ["cenarioB", entrada.cenarioB],
  ];
  for (const [rotulo, cenario] of cenarios) {
    if (!cenario) continue;
    if (cenario.distanciaKm !== undefined && cenario.distanciaKm < 0) {
      erros.push(`O campo "${rotulo}.distanciaKm" não pode ser negativo.`);
    }
    if (cenario.consumoMedioKmLitro === 0) {
      erros.push(`O consumo ("${rotulo}.consumoMedioKmLitro") não pode ser igual a zero.`);
    } else if (cenario.consumoMedioKmLitro !== undefined && cenario.consumoMedioKmLitro < 0) {
      erros.push(`O campo "${rotulo}.consumoMedioKmLitro" não pode ser negativo.`);
    }
    if (cenario.precoCombustivelLitro === 0) {
      erros.push(`O preço do combustível ("${rotulo}.precoCombustivelLitro") não pode ser igual a zero.`);
    } else if (cenario.precoCombustivelLitro !== undefined && cenario.precoCombustivelLitro < 0) {
      erros.push(`O campo "${rotulo}.precoCombustivelLitro" não pode ser negativo.`);
    }
  }

  return erros;
}

// ---------------------------------------------------------------------------
// Fábricas de resultado
// ---------------------------------------------------------------------------

function resultadoDadosFaltantes(
  modo: ModoCalculoCombustivel,
  entrada: CalcularCombustivelEntrada,
  dadosFaltantes: string[],
  mensagemResumo: string
): CalcularCombustivelResultado {
  return {
    sucesso: false,
    modo,
    dadosEntrada: entrada,
    resultados: {},
    classificacao: "DADOS_INSUFICIENTES",
    alertas: [],
    premissas: [],
    dadosFaltantes,
    mensagemResumo,
  };
}

function resultadoInvalido(
  modo: ModoCalculoCombustivel,
  entrada: CalcularCombustivelEntrada,
  erros: string[]
): CalcularCombustivelResultado {
  return {
    sucesso: false,
    modo,
    dadosEntrada: entrada,
    resultados: {},
    alertas: [],
    premissas: [],
    dadosFaltantes: [],
    mensagemResumo: erros.join(" "),
  };
}

// ---------------------------------------------------------------------------
// Distância total (usada no modo PREVISAO_VIAGEM)
// ---------------------------------------------------------------------------

function calcularDistanciaTotal(entrada: CalcularCombustivelEntrada): {
  distanciaTotalKm: number | undefined;
  premissas: string[];
} {
  const premissas: string[] = [];
  let distanciaBase: number | undefined;

  if (entrada.distanciaIdaKm !== undefined && entrada.distanciaVoltaKm !== undefined) {
    distanciaBase = entrada.distanciaIdaKm + entrada.distanciaVoltaKm;
    premissas.push("Foram somadas as distâncias de ida e de volta informadas separadamente.");
  } else if (entrada.distanciaIdaKm !== undefined && entrada.considerarIdaVolta) {
    distanciaBase = entrada.distanciaIdaKm * 2;
    premissas.push("Foi considerada ida e volta (distância de ida multiplicada por dois).");
  } else if (entrada.distanciaKm !== undefined) {
    distanciaBase = entrada.distanciaKm;
  }

  if (distanciaBase === undefined) {
    return { distanciaTotalKm: undefined, premissas };
  }

  if (entrada.distanciaAdicionalKm) {
    distanciaBase += entrada.distanciaAdicionalKm;
    premissas.push(`Foram adicionados ${formatarNumero(entrada.distanciaAdicionalKm)} km de deslocamento extra.`);
  }

  return { distanciaTotalKm: distanciaBase, premissas };
}

// ---------------------------------------------------------------------------
// Modo 1: PREVISAO_VIAGEM
// ---------------------------------------------------------------------------

function calcularPrevisaoViagem(
  entrada: CalcularCombustivelEntrada,
  casas: number
): CalcularCombustivelResultado {
  const { distanciaTotalKm, premissas } = calcularDistanciaTotal(entrada);
  const dadosFaltantes: string[] = [];

  if (distanciaTotalKm === undefined) {
    dadosFaltantes.push("distanciaKm (ou distanciaIdaKm/distanciaVoltaKm)");
  }
  if (entrada.consumoMedioKmLitro === undefined) {
    dadosFaltantes.push("consumoMedioKmLitro");
  }

  if (dadosFaltantes.length > 0) {
    return resultadoDadosFaltantes(
      "PREVISAO_VIAGEM",
      entrada,
      dadosFaltantes,
      "Para calcular a viagem, informe a distância e o consumo médio do veículo. O preço do combustível é necessário para calcular o custo em reais."
    );
  }

  if (distanciaTotalKm === 0) {
    return resultadoInvalido("PREVISAO_VIAGEM", entrada, ["A distância total não pode ser igual a zero."]);
  }

  const consumoMedio = entrada.consumoMedioKmLitro as number;
  const litrosNecessarios = (distanciaTotalKm as number) / consumoMedio;

  const resultados: ResultadosCombustivel = {
    distanciaTotalKm: arredondar(distanciaTotalKm as number, casas),
    litrosNecessarios: arredondar(litrosNecessarios, casas),
  };

  const alertas: string[] = [];
  const premissasFinal = [...premissas];
  let classificacao: ClassificacaoCombustivel = "VIAGEM_CALCULADA";

  if (entrada.precoCombustivelLitro !== undefined) {
    const custoTotal = litrosNecessarios * entrada.precoCombustivelLitro;
    resultados.custoTotalCombustivel = arredondar(custoTotal, casas);
    resultados.custoCombustivelPorKm = arredondar(custoTotal / (distanciaTotalKm as number), casas);
    premissasFinal.push("O preço do combustível utilizado foi o informado pelo usuário.");
  }

  if (entrada.litrosNoTanque !== undefined) {
    if (entrada.litrosNoTanque >= litrosNecessarios) {
      resultados.litrosRestantes = arredondar(entrada.litrosNoTanque - litrosNecessarios, casas);
    } else {
      const litrosFaltantes = litrosNecessarios - entrada.litrosNoTanque;
      resultados.litrosRestantes = 0;
      resultados.litrosFaltantes = arredondar(litrosFaltantes, casas);
      classificacao = "ABASTECIMENTO_NECESSARIO";
      alertas.push(
        `O veículo precisará de aproximadamente ${formatarNumero(arredondar(litrosFaltantes, casas))} litros adicionais para concluir o percurso.`
      );
    }
  }

  premissasFinal.push(PREMISSA_SEM_VARIACOES, PREMISSA_ESTIMATIVA);

  const partesResumo = [
    `Para ${formatarNumero(resultados.distanciaTotalKm as number)} km, são necessários aproximadamente ${formatarNumero(
      resultados.litrosNecessarios as number
    )} litros de combustível.`,
  ];
  if (resultados.custoTotalCombustivel !== undefined) {
    partesResumo.push(
      `Custo estimado: ${formatarBRL(resultados.custoTotalCombustivel)} (${formatarBRL(
        resultados.custoCombustivelPorKm ?? 0
      )}/km).`
    );
  }
  if (classificacao === "ABASTECIMENTO_NECESSARIO") {
    partesResumo.push(
      `Será necessário abastecer mais ${formatarNumero(resultados.litrosFaltantes as number)} litros para completar o percurso.`
    );
  }

  return {
    sucesso: true,
    modo: "PREVISAO_VIAGEM",
    dadosEntrada: entrada,
    resultados,
    classificacao,
    alertas,
    premissas: premissasFinal,
    dadosFaltantes: [],
    mensagemResumo: partesResumo.join(" "),
  };
}

// ---------------------------------------------------------------------------
// Modo 2: CONSUMO_REAL
// ---------------------------------------------------------------------------

function calcularConsumoReal(
  entrada: CalcularCombustivelEntrada,
  casas: number
): CalcularCombustivelResultado {
  const dadosFaltantes: string[] = [];

  let distanciaRealKm: number | undefined;
  if (entrada.quilometragemInicial !== undefined && entrada.quilometragemFinal !== undefined) {
    distanciaRealKm = entrada.quilometragemFinal - entrada.quilometragemInicial;
  } else if (entrada.distanciaKm !== undefined) {
    distanciaRealKm = entrada.distanciaKm;
  }
  if (distanciaRealKm === undefined) {
    dadosFaltantes.push("distanciaKm (ou quilometragemInicial e quilometragemFinal)");
  }

  const litrosConsumidos = entrada.litrosConsumidos;
  if (litrosConsumidos === undefined) {
    dadosFaltantes.push("litrosConsumidos");
  }

  const alertas: string[] = [];
  if (litrosConsumidos === undefined && entrada.litrosAbastecidos !== undefined) {
    alertas.push(
      'O campo "litrosAbastecidos" foi informado, mas não pode ser usado automaticamente como litros consumidos sem confirmação de que o tanque foi completado.'
    );
  }

  if (dadosFaltantes.length > 0) {
    return resultadoDadosFaltantes(
      "CONSUMO_REAL",
      entrada,
      dadosFaltantes,
      "Para calcular o consumo real, informe a distância percorrida (ou a quilometragem inicial e final) e os litros efetivamente consumidos."
    );
  }

  if (distanciaRealKm === 0) {
    return resultadoInvalido("CONSUMO_REAL", entrada, ["A distância percorrida não pode ser igual a zero."]);
  }

  const distancia = distanciaRealKm as number;
  const litros = litrosConsumidos as number;
  const consumoRealKmLitro = distancia / litros;

  const resultados: ResultadosCombustivel = {
    distanciaRealKm: arredondar(distancia, casas),
    litrosConsumidos: arredondar(litros, casas),
    consumoRealKmLitro: arredondar(consumoRealKmLitro, casas),
    litrosPor100Km: arredondar(100 / consumoRealKmLitro, casas),
  };

  const premissas = [PREMISSA_SEM_VARIACOES, PREMISSA_ESTIMATIVA];
  const precoUtilizado = entrada.precoCombustivelRealLitro ?? entrada.precoCombustivelLitro;
  if (precoUtilizado !== undefined) {
    const custoTotal = litros * precoUtilizado;
    resultados.custoTotalCombustivel = arredondar(custoTotal, casas);
    resultados.custoCombustivelPorKm = arredondar(custoTotal / distancia, casas);
    premissas.push("O preço do combustível utilizado foi o informado pelo usuário.");
  }

  return {
    sucesso: true,
    modo: "CONSUMO_REAL",
    dadosEntrada: entrada,
    resultados,
    classificacao: "CONSUMO_CALCULADO",
    alertas,
    premissas,
    dadosFaltantes: [],
    mensagemResumo: `O consumo real registrado foi de ${formatarNumero(
      resultados.consumoRealKmLitro as number
    )} km/l (${formatarNumero(resultados.litrosPor100Km as number)} l/100km) em ${formatarNumero(
      resultados.distanciaRealKm as number
    )} km percorridos.`,
  };
}

// ---------------------------------------------------------------------------
// Modo 3: COMPARACAO_PREVISTO_REALIZADO
// ---------------------------------------------------------------------------

function calcularComparacaoPrevistoRealizado(
  entrada: CalcularCombustivelEntrada,
  casas: number
): CalcularCombustivelResultado {
  const dadosFaltantes: string[] = [];

  if (entrada.consumoPrevistoKmLitro === undefined) {
    dadosFaltantes.push("consumoPrevistoKmLitro");
  }

  let distanciaBase = entrada.distanciaKm;
  if (entrada.quilometragemInicial !== undefined && entrada.quilometragemFinal !== undefined) {
    distanciaBase = entrada.quilometragemFinal - entrada.quilometragemInicial;
  }

  let consumoRealKmLitro = entrada.consumoRealKmLitro;
  if (consumoRealKmLitro === undefined && distanciaBase !== undefined && distanciaBase !== 0 && entrada.litrosConsumidos !== undefined) {
    consumoRealKmLitro = distanciaBase / entrada.litrosConsumidos;
  }

  if (distanciaBase === undefined) {
    dadosFaltantes.push("distanciaKm (ou quilometragemInicial e quilometragemFinal)");
  }
  if (consumoRealKmLitro === undefined) {
    dadosFaltantes.push("consumoRealKmLitro (ou litrosConsumidos, junto da distância)");
  }

  if (dadosFaltantes.length > 0) {
    return resultadoDadosFaltantes(
      "COMPARACAO_PREVISTO_REALIZADO",
      entrada,
      dadosFaltantes,
      "Para comparar o consumo previsto com o realizado, informe o consumo previsto, o consumo real (ou distância e litros consumidos) e a distância da viagem."
    );
  }

  if (distanciaBase === 0) {
    return resultadoInvalido("COMPARACAO_PREVISTO_REALIZADO", entrada, ["A distância não pode ser igual a zero."]);
  }

  const distancia = distanciaBase as number;
  const consumoPrevisto = entrada.consumoPrevistoKmLitro as number;
  const consumoReal = consumoRealKmLitro as number;

  const diferencaConsumoKmLitro = consumoReal - consumoPrevisto;
  const diferencaPercentualConsumo = (diferencaConsumoKmLitro / consumoPrevisto) * 100;

  let classificacao: ClassificacaoCombustivel;
  if (Math.abs(diferencaPercentualConsumo) <= TOLERANCIA_CONSUMO_PERCENTUAL) {
    classificacao = "CONSUMO_DENTRO_DO_ESPERADO";
  } else if (diferencaPercentualConsumo > 0) {
    classificacao = "CONSUMO_MELHOR_QUE_PREVISTO";
  } else {
    classificacao = "CONSUMO_PIOR_QUE_PREVISTO";
  }

  const resultados: ResultadosCombustivel = {
    distanciaTotalKm: arredondar(distancia, casas),
    consumoPrevistoKmLitro: arredondar(consumoPrevisto, casas),
    consumoRealKmLitro: arredondar(consumoReal, casas),
    diferencaConsumoKmLitro: arredondar(diferencaConsumoKmLitro, casas),
    diferencaPercentualConsumo: arredondar(diferencaPercentualConsumo, casas),
  };

  const premissas = [
    `A classificação usa uma tolerância de ${TOLERANCIA_CONSUMO_PERCENTUAL}% para considerar o consumo "dentro do esperado".`,
    PREMISSA_SEM_VARIACOES,
    PREMISSA_ESTIMATIVA,
  ];

  const precoPrevisto = entrada.precoCombustivelPrevistoLitro ?? entrada.precoCombustivelLitro;
  const precoReal = entrada.precoCombustivelRealLitro ?? entrada.precoCombustivelLitro;
  if (precoPrevisto !== undefined && precoReal !== undefined) {
    const litrosPrevistos = distancia / consumoPrevisto;
    const litrosReais = entrada.litrosConsumidos ?? distancia / consumoReal;
    const custoPrevisto = litrosPrevistos * precoPrevisto;
    const custoRealizado = litrosReais * precoReal;
    resultados.custoPrevisto = arredondar(custoPrevisto, casas);
    resultados.custoRealizado = arredondar(custoRealizado, casas);
    resultados.diferencaCusto = arredondar(custoRealizado - custoPrevisto, casas);
  }

  const alertas: string[] = [];
  if (classificacao === "CONSUMO_PIOR_QUE_PREVISTO") {
    alertas.push(
      `O consumo realizado ficou ${formatarNumero(Math.abs(resultados.diferencaPercentualConsumo as number))}% pior que o previsto.`
    );
  } else if (classificacao === "CONSUMO_MELHOR_QUE_PREVISTO") {
    alertas.push(
      `O consumo realizado ficou ${formatarNumero(Math.abs(resultados.diferencaPercentualConsumo as number))}% melhor que o previsto.`
    );
  }

  return {
    sucesso: true,
    modo: "COMPARACAO_PREVISTO_REALIZADO",
    dadosEntrada: entrada,
    resultados,
    classificacao,
    alertas,
    premissas,
    dadosFaltantes: [],
    mensagemResumo: `Consumo previsto: ${formatarNumero(resultados.consumoPrevistoKmLitro as number)} km/l. Consumo real: ${formatarNumero(
      resultados.consumoRealKmLitro as number
    )} km/l (diferença de ${formatarNumero(resultados.diferencaPercentualConsumo as number)}%).`,
  };
}

// ---------------------------------------------------------------------------
// Modo 4: AUTONOMIA
// ---------------------------------------------------------------------------

function calcularAutonomia(
  entrada: CalcularCombustivelEntrada,
  casas: number
): CalcularCombustivelResultado {
  const dadosFaltantes: string[] = [];
  if (entrada.litrosNoTanque === undefined) dadosFaltantes.push("litrosNoTanque");
  if (entrada.consumoMedioKmLitro === undefined) dadosFaltantes.push("consumoMedioKmLitro");

  if (dadosFaltantes.length > 0) {
    return resultadoDadosFaltantes(
      "AUTONOMIA",
      entrada,
      dadosFaltantes,
      "Para calcular a autonomia, informe os litros no tanque e o consumo médio do veículo."
    );
  }

  const litrosNoTanque = entrada.litrosNoTanque as number;
  const consumoMedio = entrada.consumoMedioKmLitro as number;
  const autonomiaTotalKm = litrosNoTanque * consumoMedio;

  const resultados: ResultadosCombustivel = {
    autonomiaTotalKm: arredondar(autonomiaTotalKm, casas),
  };

  const premissas = [PREMISSA_SEM_VARIACOES, PREMISSA_ESTIMATIVA];
  let autonomiaConsiderada = autonomiaTotalKm;

  if (entrada.percentualReserva !== undefined) {
    const litrosReserva = (litrosNoTanque * entrada.percentualReserva) / 100;
    const litrosDisponiveisOperacao = litrosNoTanque - litrosReserva;
    const autonomiaUtilKm = litrosDisponiveisOperacao * consumoMedio;
    resultados.litrosReserva = arredondar(litrosReserva, casas);
    resultados.autonomiaUtilKm = arredondar(autonomiaUtilKm, casas);
    autonomiaConsiderada = autonomiaUtilKm;
    premissas.push(
      `Foi reservado ${entrada.percentualReserva}% do combustível como margem de segurança, não utilizado para a operação.`
    );
  } else {
    premissas.push("Não foi informado percentual de reserva: a autonomia calculada é teórica, sem margem de segurança.");
  }

  let classificacao: ClassificacaoCombustivel;
  if (autonomiaConsiderada <= AUTONOMIA_UTIL_MINIMA_KM) {
    classificacao = "AUTONOMIA_INSUFICIENTE";
  } else if (autonomiaConsiderada <= AUTONOMIA_UTIL_ALERTA_KM) {
    classificacao = "AUTONOMIA_PROXIMA_DO_LIMITE";
  } else {
    classificacao = "AUTONOMIA_SUFICIENTE";
  }

  const alertas: string[] = [];
  if (classificacao === "AUTONOMIA_INSUFICIENTE") {
    alertas.push("A autonomia disponível está muito baixa. Recomenda-se abastecer antes de seguir viagem.");
  } else if (classificacao === "AUTONOMIA_PROXIMA_DO_LIMITE") {
    alertas.push("A autonomia disponível está se aproximando do limite. Planeje um abastecimento em breve.");
  }

  const mensagemResumo =
    resultados.autonomiaUtilKm !== undefined
      ? `Autonomia teórica: ${formatarNumero(resultados.autonomiaTotalKm as number)} km. Autonomia útil (descontada a reserva): ${formatarNumero(
          resultados.autonomiaUtilKm
        )} km.`
      : `Autonomia teórica estimada: ${formatarNumero(resultados.autonomiaTotalKm as number)} km.`;

  return {
    sucesso: true,
    modo: "AUTONOMIA",
    dadosEntrada: entrada,
    resultados,
    classificacao,
    alertas,
    premissas,
    dadosFaltantes: [],
    mensagemResumo,
  };
}

// ---------------------------------------------------------------------------
// Modo 5: COMPARACAO_CENARIOS
// ---------------------------------------------------------------------------

function calcularComparacaoCenarios(
  entrada: CalcularCombustivelEntrada,
  casas: number
): CalcularCombustivelResultado {
  const dadosFaltantes: string[] = [];
  if (!entrada.cenarioA) dadosFaltantes.push("cenarioA");
  if (!entrada.cenarioB) dadosFaltantes.push("cenarioB");

  if (dadosFaltantes.length === 0) {
    const pares: Array<[string, CenarioCombustivelComparacao]> = [
      ["cenarioA", entrada.cenarioA as CenarioCombustivelComparacao],
      ["cenarioB", entrada.cenarioB as CenarioCombustivelComparacao],
    ];
    for (const [rotulo, cenario] of pares) {
      if (cenario.distanciaKm === undefined) dadosFaltantes.push(`${rotulo}.distanciaKm`);
      if (cenario.consumoMedioKmLitro === undefined) dadosFaltantes.push(`${rotulo}.consumoMedioKmLitro`);
      if (cenario.precoCombustivelLitro === undefined) dadosFaltantes.push(`${rotulo}.precoCombustivelLitro`);
    }
  }

  if (dadosFaltantes.length > 0) {
    return resultadoDadosFaltantes(
      "COMPARACAO_CENARIOS",
      entrada,
      dadosFaltantes,
      "Para comparar dois cenários, informe a distância, o consumo médio e o preço do combustível de cada um deles."
    );
  }

  const a = entrada.cenarioA as CenarioCombustivelComparacao;
  const b = entrada.cenarioB as CenarioCombustivelComparacao;

  if (a.distanciaKm === 0 || b.distanciaKm === 0) {
    return resultadoInvalido("COMPARACAO_CENARIOS", entrada, ["A distância de um cenário não pode ser igual a zero."]);
  }

  const distanciaA = a.distanciaKm as number;
  const distanciaB = b.distanciaKm as number;
  const litrosA = distanciaA / (a.consumoMedioKmLitro as number);
  const custoTotalA = litrosA * (a.precoCombustivelLitro as number);
  const custoPorKmA = custoTotalA / distanciaA;

  const litrosB = distanciaB / (b.consumoMedioKmLitro as number);
  const custoTotalB = litrosB * (b.precoCombustivelLitro as number);
  const custoPorKmB = custoTotalB / distanciaB;

  const nomeA = a.descricaoCenario ?? "Cenário A";
  const nomeB = b.descricaoCenario ?? "Cenário B";

  const cenarioMaisEconomico = custoPorKmA <= custoPorKmB ? nomeA : nomeB;
  const maiorCustoPorKm = Math.max(custoPorKmA, custoPorKmB);
  const menorCustoPorKm = Math.min(custoPorKmA, custoPorKmB);
  const economiaPercentual = maiorCustoPorKm > 0 ? ((maiorCustoPorKm - menorCustoPorKm) / maiorCustoPorKm) * 100 : 0;

  const resultados: ResultadosCombustivel = {
    cenarioACustoTotal: arredondar(custoTotalA, casas),
    cenarioACustoPorKm: arredondar(custoPorKmA, casas),
    cenarioALitrosNecessarios: arredondar(litrosA, casas),
    cenarioBCustoTotal: arredondar(custoTotalB, casas),
    cenarioBCustoPorKm: arredondar(custoPorKmB, casas),
    cenarioBLitrosNecessarios: arredondar(litrosB, casas),
    economiaNominal: arredondar(Math.abs(custoTotalA - custoTotalB), casas),
    economiaPercentual: arredondar(economiaPercentual, casas),
    diferencaLitros: arredondar(Math.abs(litrosA - litrosB), casas),
    diferencaCustoPorKm: arredondar(Math.abs(custoPorKmA - custoPorKmB), casas),
  };

  const premissas = [PREMISSA_SEM_VARIACOES, PREMISSA_ESTIMATIVA];
  if (distanciaA !== distanciaB) {
    premissas.push(
      "Os cenários possuem distâncias diferentes: a comparação mais confiável é o custo por km, não o custo total."
    );
  }

  return {
    sucesso: true,
    modo: "COMPARACAO_CENARIOS",
    dadosEntrada: entrada,
    resultados,
    classificacao: "CENARIOS_COMPARADOS",
    cenarioMaisEconomico,
    alertas: [],
    premissas,
    dadosFaltantes: [],
    mensagemResumo: `${cenarioMaisEconomico} é mais econômico: ${formatarBRL(menorCustoPorKm)}/km contra ${formatarBRL(
      maiorCustoPorKm
    )}/km (economia de ${formatarNumero(resultados.economiaPercentual as number)}%).`,
  };
}

// ---------------------------------------------------------------------------
// Função principal
// ---------------------------------------------------------------------------

export function calcularCombustivel(entrada: CalcularCombustivelEntrada): CalcularCombustivelResultado {
  const casas = entrada.arredondamentoCasasDecimais ?? CASAS_DECIMAIS_PADRAO;

  const errosBasicos = validarValoresBasicos(entrada);
  if (errosBasicos.length > 0) {
    return resultadoInvalido(entrada.modo, entrada, errosBasicos);
  }

  switch (entrada.modo) {
    case "PREVISAO_VIAGEM":
      return calcularPrevisaoViagem(entrada, casas);
    case "CONSUMO_REAL":
      return calcularConsumoReal(entrada, casas);
    case "COMPARACAO_PREVISTO_REALIZADO":
      return calcularComparacaoPrevistoRealizado(entrada, casas);
    case "AUTONOMIA":
      return calcularAutonomia(entrada, casas);
    case "COMPARACAO_CENARIOS":
      return calcularComparacaoCenarios(entrada, casas);
    default:
      return resultadoInvalido(entrada.modo, entrada, [`Modo de cálculo desconhecido: "${entrada.modo}".`]);
  }
}

// ---------------------------------------------------------------------------
// Registro da ferramenta
// ---------------------------------------------------------------------------

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  {
    nome: "modo",
    tipo: "enum",
    obrigatorio: true,
    descricao: "Tipo de cálculo desejado.",
    valoresPossiveis: [
      "PREVISAO_VIAGEM",
      "CONSUMO_REAL",
      "COMPARACAO_PREVISTO_REALIZADO",
      "AUTONOMIA",
      "COMPARACAO_CENARIOS",
    ],
  },
  { nome: "distanciaKm", tipo: "number", obrigatorio: false, descricao: "Distância total (ida, ou já somada), em km." },
  { nome: "distanciaIdaKm", tipo: "number", obrigatorio: false, descricao: "Distância de ida, em km." },
  { nome: "distanciaVoltaKm", tipo: "number", obrigatorio: false, descricao: "Distância de volta, em km." },
  { nome: "distanciaAdicionalKm", tipo: "number", obrigatorio: false, descricao: "Deslocamento extra a somar, em km." },
  { nome: "considerarIdaVolta", tipo: "boolean", obrigatorio: false, descricao: "Se verdadeiro, dobra distanciaIdaKm quando a volta não for informada." },
  { nome: "consumoMedioKmLitro", tipo: "number", obrigatorio: false, descricao: "Consumo médio do veículo, em km/l." },
  { nome: "consumoPrevistoKmLitro", tipo: "number", obrigatorio: false, descricao: "Consumo previsto, em km/l." },
  { nome: "consumoRealKmLitro", tipo: "number", obrigatorio: false, descricao: "Consumo realizado, em km/l." },
  { nome: "litrosAbastecidos", tipo: "number", obrigatorio: false, descricao: "Litros abastecidos (não confundir com litros consumidos)." },
  { nome: "litrosConsumidos", tipo: "number", obrigatorio: false, descricao: "Litros efetivamente consumidos no trecho." },
  { nome: "litrosNoTanque", tipo: "number", obrigatorio: false, descricao: "Litros atualmente no tanque." },
  { nome: "capacidadeTanqueLitros", tipo: "number", obrigatorio: false, descricao: "Capacidade total do tanque, em litros." },
  { nome: "precoCombustivelLitro", tipo: "number", obrigatorio: false, descricao: "Preço do litro do combustível, em R$." },
  { nome: "precoCombustivelPrevistoLitro", tipo: "number", obrigatorio: false, descricao: "Preço previsto do litro, em R$." },
  { nome: "precoCombustivelRealLitro", tipo: "number", obrigatorio: false, descricao: "Preço real pago pelo litro, em R$." },
  { nome: "valorTotalAbastecido", tipo: "number", obrigatorio: false, descricao: "Valor total pago no abastecimento, em R$." },
  { nome: "quilometragemInicial", tipo: "number", obrigatorio: false, descricao: "Odômetro no início do trecho." },
  { nome: "quilometragemFinal", tipo: "number", obrigatorio: false, descricao: "Odômetro no fim do trecho." },
  { nome: "percentualReserva", tipo: "number", obrigatorio: false, descricao: "Percentual do tanque reservado como margem de segurança (0 a 100)." },
  { nome: "cenarioA", tipo: "string", obrigatorio: false, descricao: "Primeiro cenário para o modo COMPARACAO_CENARIOS." },
  { nome: "cenarioB", tipo: "string", obrigatorio: false, descricao: "Segundo cenário para o modo COMPARACAO_CENARIOS." },
  { nome: "arredondamentoCasasDecimais", tipo: "number", obrigatorio: false, descricao: `Casas decimais na saída (padrão: ${CASAS_DECIMAIS_PADRAO}).` },
];

export const ferramentaCalcularCombustivel: DefinicaoFerramenta<
  CalcularCombustivelEntrada,
  CalcularCombustivelResultado
> = {
  nome: "calcular_combustivel",
  descricao:
    "Calcula litros necessários, custo, consumo real, autonomia e comparações de combustível em viagens ou períodos operacionais.",
  objetivo:
    "Dar respostas numéricas confiáveis sobre combustível sem que o modelo de linguagem precise (ou tente) fazer as contas sozinho.",
  parametros: PARAMETROS,
  executar: calcularCombustivel,
};
