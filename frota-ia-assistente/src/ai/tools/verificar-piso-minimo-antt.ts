import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";
import { CASAS_DECIMAIS_MOEDA_PADRAO, CASAS_DECIMAIS_PERCENTUAL_PADRAO, arredondar, formatarBRL, formatarNumero } from "./utils";

/**
 * Ferramenta: verificar_piso_minimo_antt
 *
 * Calcula o piso mínimo LEGAL de frete definido pela Política Nacional de
 * Pisos Mínimos do Transporte Rodoviário de Cargas (Lei nº 13.703/2018),
 * usando a fórmula pública da ANTT:
 *
 *   pisoIda      = distânciaKm × CCD + CC
 *   pisoRetorno  = temRetornoVazio ? 0,92 × distânciaRetornoKm × CCD : 0
 *   pisoMínimo   = pisoIda + pisoRetorno
 *
 * onde CCD (Coeficiente de Custo de Deslocamento, R$/km) e CC (Custo de
 * Carga e Descarga, R$) variam por tipo de carga e número de eixos, e são
 * atualizados pela ANTT semestralmente (ou extraordinariamente, se o diesel
 * variar 5%+).
 *
 * **Nunca inventa CCD/CC.** Esta ferramenta não mantém — e não deveria
 * manter — uma tabela própria desses coeficientes: eles mudam por
 * resolução, e uma tabela hardcoded aqui ficaria desatualizada por design.
 * `coeficienteDeslocamentoReaisPorKm` é sempre obrigatório na entrada; a
 * forma correta de obtê-lo é a própria IA consultar a fonte oficial (ver
 * `gerenciar_pesquisa_oficial`/`web_search`, restrita a antt.gov.br) antes
 * de chamar esta ferramenta — nunca estimado ou lembrado de memória.
 *
 * Esse é o piso **legal** (Lei 13.703/2018) — diferente do piso
 * **econômico** que `calcular_valor_minimo_frete` calcula a partir dos
 * custos informados pelo cliente. Os dois nunca devem ser confundidos na
 * resposta ao usuário.
 */

const LIMITACOES_PADRAO: string[] = [
  "Este cálculo depende do Coeficiente de Custo de Deslocamento (CCD) e do Custo de Carga e Descarga (CC) vigentes na resolução ANTT em vigor no momento — informados nesta chamada, nunca inventados por esta ferramenta ou pela IA. Confirme sempre a fonte (número da resolução) usada.",
  "É uma aplicação direta da fórmula pública da Política Nacional de Pisos Mínimos (Lei nº 13.703/2018) — não substitui verificação oficial em caso de disputa contratual ou fiscalização.",
  "Não calcula automaticamente distância, tipo de carga ou número de eixos — esses dados (e o CCD/CC correspondentes) vêm de fora desta ferramenta.",
];

export type ModoVerificarPisoMinimoAntt = "CALCULAR_PISO_MINIMO" | "COMPARAR_COM_OFERTA";

export type ClassificacaoPisoMinimoAntt = "ABAIXO_DO_PISO_LEGAL" | "DENTRO_DO_PISO_LEGAL" | "NAO_AVALIADO";

export interface VerificarPisoMinimoAnttEntrada {
  modo: ModoVerificarPisoMinimoAntt;

  distanciaKm: number;
  /** CCD — R$/km, obtido na fonte oficial (calculadorafrete.antt.gov.br) para o tipo de carga/eixos específicos. Nunca inventado. */
  coeficienteDeslocamentoReaisPorKm: number;
  /** CC — custo fixo de carga e descarga, R$. Se não informado, considerado R$ 0,00 com alerta explícito (nunca assumido silenciosamente). */
  custoCargaDescargaReais?: number;

  temRetornoVazio?: boolean;
  /** Obrigatório quando temRetornoVazio = true. */
  distanciaRetornoKm?: number;

  /** Rótulos informativos (não entram na fórmula) — só para a IA registrar o que foi consultado. */
  tipoCarga?: string;
  numeroEixos?: number;
  /** Ex.: "Resolução ANTT nº 6.084, de 16/07/2026" — registra a fonte do CCD/CC usados, para transparência na resposta. */
  fonteCoeficiente?: string;

  /** Obrigatório quando modo = COMPARAR_COM_OFERTA. */
  valorFreteOfertado?: number;

  casasDecimais?: number;
}

export interface VerificarPisoMinimoAnttResultado extends ResultadoFerramentaBase {
  modo: ModoVerificarPisoMinimoAntt;

  pisoMinimoLegalReais?: number;
  pisoIdaReais?: number;
  pisoRetornoReais?: number;
  distanciaTotalConsideradaKm?: number;

  valorFreteOfertado?: number;
  diferencaReais?: number;
  diferencaPercentual?: number;
  classificacao?: ClassificacaoPisoMinimoAntt;

  fonteCoeficiente?: string;
  memoriaCalculo: string[];
  limitacoes: string[];
}

function validar(entrada: VerificarPisoMinimoAnttEntrada): string[] {
  const erros: string[] = [];

  if (entrada.distanciaKm !== undefined && entrada.distanciaKm <= 0) {
    erros.push('"distanciaKm" deve ser maior que zero.');
  }
  if (entrada.coeficienteDeslocamentoReaisPorKm !== undefined && entrada.coeficienteDeslocamentoReaisPorKm <= 0) {
    erros.push('"coeficienteDeslocamentoReaisPorKm" deve ser maior que zero.');
  }
  if (entrada.custoCargaDescargaReais !== undefined && entrada.custoCargaDescargaReais < 0) {
    erros.push('"custoCargaDescargaReais" não pode ser negativo.');
  }
  if (entrada.temRetornoVazio && !(entrada.distanciaRetornoKm !== undefined && entrada.distanciaRetornoKm > 0)) {
    erros.push('"temRetornoVazio" foi marcado, mas "distanciaRetornoKm" não foi informado (ou não é maior que zero).');
  }
  if (entrada.modo === "COMPARAR_COM_OFERTA" && entrada.valorFreteOfertado === undefined) {
    erros.push('O modo COMPARAR_COM_OFERTA exige "valorFreteOfertado".');
  }
  if (entrada.valorFreteOfertado !== undefined && entrada.valorFreteOfertado < 0) {
    erros.push('"valorFreteOfertado" não pode ser negativo.');
  }

  return erros;
}

function executar(entrada: VerificarPisoMinimoAnttEntrada): VerificarPisoMinimoAnttResultado {
  const casas = entrada.casasDecimais ?? CASAS_DECIMAIS_MOEDA_PADRAO;
  const casasPercentual = entrada.casasDecimais ?? CASAS_DECIMAIS_PERCENTUAL_PADRAO;

  const dadosFaltantes: string[] = [];
  if (entrada.distanciaKm === undefined) dadosFaltantes.push("distanciaKm");
  if (entrada.coeficienteDeslocamentoReaisPorKm === undefined) dadosFaltantes.push("coeficienteDeslocamentoReaisPorKm");

  if (dadosFaltantes.length > 0) {
    return {
      sucesso: false,
      modo: entrada.modo,
      alertas: [],
      premissas: [],
      dadosFaltantes,
      mensagemResumo: `Faltam dados obrigatórios para calcular o piso mínimo: ${dadosFaltantes.join(", ")}.`,
      memoriaCalculo: [],
      limitacoes: LIMITACOES_PADRAO,
    };
  }

  const erros = validar(entrada);
  if (erros.length > 0) {
    return {
      sucesso: false,
      modo: entrada.modo,
      alertas: [],
      premissas: [],
      dadosFaltantes: [],
      mensagemResumo: `Não foi possível calcular: ${erros.join(" ")}`,
      memoriaCalculo: [],
      limitacoes: LIMITACOES_PADRAO,
    };
  }

  const alertas: string[] = [];
  const premissas: string[] = [];
  const memoriaCalculo: string[] = [];

  const cc = entrada.custoCargaDescargaReais ?? 0;
  if (entrada.custoCargaDescargaReais === undefined) {
    alertas.push("Custo de Carga e Descarga (CC) não informado — considerado R$ 0,00. Isso pode subestimar o piso mínimo real.");
  }

  const pisoIda = entrada.distanciaKm * entrada.coeficienteDeslocamentoReaisPorKm + cc;
  memoriaCalculo.push(
    `Piso da ida = distância (${formatarNumero(entrada.distanciaKm)} km) × CCD (${formatarBRL(entrada.coeficienteDeslocamentoReaisPorKm)}/km) + CC (${formatarBRL(cc)}) = ${formatarBRL(pisoIda)}.`
  );

  let pisoRetorno = 0;
  let distanciaTotalConsideradaKm = entrada.distanciaKm;
  if (entrada.temRetornoVazio && entrada.distanciaRetornoKm) {
    pisoRetorno = 0.92 * entrada.distanciaRetornoKm * entrada.coeficienteDeslocamentoReaisPorKm;
    distanciaTotalConsideradaKm += entrada.distanciaRetornoKm;
    memoriaCalculo.push(
      `Piso do retorno vazio = 0,92 × distância de retorno (${formatarNumero(entrada.distanciaRetornoKm)} km) × CCD = ${formatarBRL(pisoRetorno)}.`
    );
    premissas.push("Retorno vazio considerado no cálculo, conforme informado.");
  }

  const pisoMinimoLegalReais = arredondar(pisoIda + pisoRetorno, casas);

  if (entrada.fonteCoeficiente) {
    premissas.push(`CCD/CC usados conforme: ${entrada.fonteCoeficiente}.`);
  } else {
    alertas.push("Fonte do CCD/CC não informada — confirme se os valores usados são os vigentes na resolução ANTT atual antes de repassar ao usuário.");
  }

  const base: Omit<VerificarPisoMinimoAnttResultado, "classificacao" | "valorFreteOfertado" | "diferencaReais" | "diferencaPercentual"> = {
    sucesso: true,
    modo: entrada.modo,
    alertas,
    premissas,
    dadosFaltantes: [],
    mensagemResumo: `Piso mínimo legal calculado: ${formatarBRL(pisoMinimoLegalReais)}.`,
    pisoMinimoLegalReais,
    pisoIdaReais: arredondar(pisoIda, casas),
    pisoRetornoReais: arredondar(pisoRetorno, casas),
    distanciaTotalConsideradaKm,
    fonteCoeficiente: entrada.fonteCoeficiente,
    memoriaCalculo,
    limitacoes: LIMITACOES_PADRAO,
  };

  if (entrada.modo === "CALCULAR_PISO_MINIMO" || entrada.valorFreteOfertado === undefined) {
    return { ...base, classificacao: "NAO_AVALIADO" };
  }

  const diferencaReais = arredondar(entrada.valorFreteOfertado - pisoMinimoLegalReais, casas);
  const diferencaPercentual = arredondar((diferencaReais / pisoMinimoLegalReais) * 100, casasPercentual);
  const classificacao: ClassificacaoPisoMinimoAntt = entrada.valorFreteOfertado < pisoMinimoLegalReais ? "ABAIXO_DO_PISO_LEGAL" : "DENTRO_DO_PISO_LEGAL";

  if (classificacao === "ABAIXO_DO_PISO_LEGAL") {
    alertas.push(
      `O valor ofertado (${formatarBRL(entrada.valorFreteOfertado)}) está ${formatarBRL(Math.abs(diferencaReais))} abaixo do piso mínimo legal — contratar por esse valor pode configurar infração à Lei 13.703/2018, sujeita a multa e indenização em dobro ao transportador.`
    );
  }

  return {
    ...base,
    valorFreteOfertado: entrada.valorFreteOfertado,
    diferencaReais,
    diferencaPercentual,
    classificacao,
    mensagemResumo:
      classificacao === "ABAIXO_DO_PISO_LEGAL"
        ? `O frete ofertado (${formatarBRL(entrada.valorFreteOfertado)}) está ABAIXO do piso mínimo legal (${formatarBRL(pisoMinimoLegalReais)}).`
        : `O frete ofertado (${formatarBRL(entrada.valorFreteOfertado)}) está dentro do piso mínimo legal (${formatarBRL(pisoMinimoLegalReais)}).`,
  };
}

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  {
    nome: "modo",
    tipo: "enum",
    obrigatorio: true,
    descricao: "CALCULAR_PISO_MINIMO só calcula o piso; COMPARAR_COM_OFERTA também compara com um valor de frete ofertado.",
    valoresPossiveis: ["CALCULAR_PISO_MINIMO", "COMPARAR_COM_OFERTA"],
  },
  { nome: "distanciaKm", tipo: "number", obrigatorio: true, descricao: "Distância da viagem (ida), em km." },
  {
    nome: "coeficienteDeslocamentoReaisPorKm",
    tipo: "number",
    obrigatorio: true,
    descricao: "CCD (R$/km) vigente para o tipo de carga e número de eixos — obtido na fonte oficial (antt.gov.br), nunca inventado.",
  },
  { nome: "custoCargaDescargaReais", tipo: "number", obrigatorio: false, descricao: "CC — custo fixo de carga e descarga (R$). Se ausente, considerado R$ 0,00 com alerta." },
  { nome: "temRetornoVazio", tipo: "boolean", obrigatorio: false, descricao: "Se a viagem tem retorno sem carga/receita." },
  { nome: "distanciaRetornoKm", tipo: "number", obrigatorio: false, descricao: "Distância do retorno vazio, em km — obrigatório se temRetornoVazio for true." },
  { nome: "tipoCarga", tipo: "string", obrigatorio: false, descricao: "Rótulo informativo do tipo de carga consultado (não entra na fórmula)." },
  { nome: "numeroEixos", tipo: "number", obrigatorio: false, descricao: "Rótulo informativo do número de eixos consultado (não entra na fórmula)." },
  { nome: "fonteCoeficiente", tipo: "string", obrigatorio: false, descricao: "Identificação da resolução ANTT de onde vieram o CCD/CC (ex.: 'Resolução ANTT nº 6.084/2026'), para transparência." },
  { nome: "valorFreteOfertado", tipo: "number", obrigatorio: false, descricao: "Valor do frete a comparar com o piso — obrigatório em COMPARAR_COM_OFERTA." },
  { nome: "casasDecimais", tipo: "number", obrigatorio: false, descricao: "Sobrescreve as casas decimais padrão da saída." },
];

export const ferramentaVerificarPisoMinimoAntt: DefinicaoFerramenta<VerificarPisoMinimoAnttEntrada, VerificarPisoMinimoAnttResultado> = {
  nome: "verificar_piso_minimo_antt",
  descricao: "Calcula o piso mínimo LEGAL de frete (Lei 13.703/2018, fórmula ANTT) e, opcionalmente, compara com um valor ofertado.",
  objetivo:
    "Proteger motorista/transportadora de contratar ou aceitar frete abaixo do piso mínimo legal — fiscalização eletrônica automática desde 2026, com multas de até R$ 10 milhões. Nunca inventa o coeficiente CCD/CC: eles devem vir de consulta à fonte oficial (ferramenta de busca restrita a antt.gov.br) antes desta chamada.",
  parametros: PARAMETROS,
  executar,
};
