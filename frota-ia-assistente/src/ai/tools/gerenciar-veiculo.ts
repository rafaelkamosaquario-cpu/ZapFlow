import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";
import { createAdminClient } from "@/lib/supabase/admin";
import { listVehicles, getVehicle, createVehicle, updateVehicle, setDefaultVehicle } from "@/services/supabase/vehicleService";
import { replaceCostProfile } from "@/services/supabase/vehicleCostProfileService";
import { createTireProfile } from "@/services/supabase/vehicleTireProfileService";
import type { VehicleRow, VehicleTypeEnum, FuelTypeEnum, TireCategoryEnum, VehicleCostProfileRow, VehicleTireProfileRow } from "@/lib/supabase/tables";

/**
 * Ferramenta: gerenciar_veiculo
 *
 * Ferramenta de INTEGRAÇÃO (I/O real com Supabase — vehicles,
 * vehicle_cost_profiles, vehicle_tire_profiles), mesmo padrão de
 * `gerenciar_alerta`/`registrar_despesa`.
 *
 * Fecha a lacuna real: o onboarding só grava o veículo principal como texto
 * livre (name/notes) — nenhum campo estruturado (tipo, combustível, consumo
 * etc.) era preenchido automaticamente, e nenhuma ferramenta existia pra IA
 * completar/corrigir isso depois, a partir do que o cliente conta na própria
 * conversa.
 *
 * Regra de produto desta V1: no máximo 1 veículo ATIVO por conta/empresa
 * (motorista autônomo / operação pequena) — CRIAR verifica isso antes de
 * escrever (ver `listVehicles` abaixo) e o índice único parcial
 * `vehicles_one_active_per_company_idx` (migration 20260731120000) garante o
 * mesmo em qualquer caminho de escrita, não só por esta ferramenta. Quando já
 * existe um veículo, o caminho certo é ATUALIZAR (ou DEFINIR_CUSTO/
 * DEFINIR_PNEU) — nunca CRIAR outro.
 *
 * `vehicleId` sempre é verificado contra `companyId` antes de qualquer
 * escrita (ver `verificarPropriedade`) — nunca confia soh no id que o
 * modelo mandou, mesmo sendo um valor que ele só deveria conhecer por já
 * ter vindo de LISTAR/contexto desta própria empresa.
 */

export type ModoGerenciarVeiculo = "CRIAR" | "LISTAR" | "ATUALIZAR" | "DEFINIR_PADRAO" | "DEFINIR_CUSTO" | "DEFINIR_PNEU";

const TIPOS_VEICULO: VehicleTypeEnum[] = [
  "utilitario",
  "tres_quartos",
  "toco",
  "truck",
  "cavalo_mecanico",
  "carreta",
  "bitrem",
  "rodotrem",
  "onibus",
  "outro",
];

const TIPOS_COMBUSTIVEL: FuelTypeEnum[] = ["diesel_s10", "diesel_s500", "gasolina", "etanol", "eletrico", "outro"];

const CATEGORIAS_PNEU: TireCategoryEnum[] = ["novo_nacional", "novo_importado", "recapado", "misto", "outro"];

export interface GerenciarVeiculoEntrada {
  modo: ModoGerenciarVeiculo;
  userId: string;
  companyId: string;
  conversationId?: string;
  /** Obrigatório em ATUALIZAR/DEFINIR_PADRAO/DEFINIR_CUSTO/DEFINIR_PNEU. */
  vehicleId?: string;

  // CRIAR / ATUALIZAR
  nome?: string;
  placa?: string;
  tipo?: VehicleTypeEnum;
  marca?: string;
  modelo?: string;
  anoModelo?: number;
  combustivel?: FuelTypeEnum;
  consumoMedioKmL?: number;
  velocidadeMediaKmh?: number;
  capacidadeCargaKg?: number;
  hodometroAtualKm?: number;
  numeroEixos?: number;
  vencimentoSeguro?: string;
  vencimentoLicenciamento?: string;
  observacoes?: string;

  // DEFINIR_CUSTO — campo não informado carrega o valor já salvo do perfil ativo, nunca apaga silenciosamente.
  precoCombustivelLitro?: number;
  custoFixoDia?: number;
  custoFixoMes?: number;
  custoManutencaoKm?: number;
  custoPneuKm?: number;
  custoDepreciacaoKm?: number;
  custoMotoristaDia?: number;
  custoOutroKm?: number;
  margemAlvoPercentual?: number;

  // DEFINIR_PNEU
  categoriaPneu?: TireCategoryEnum;
  marcaPneu?: string;
  modeloPneu?: string;
  medidaPneu?: string;
  custoAquisicaoPneu?: number;
  vidaUtilKmPneu?: number;
  quantidadeRecapagens?: number;
  custoRecapagem?: number;
  vidaUtilRecapagemKmPneu?: number;
}

export interface VeiculoResumo {
  id: string;
  nome: string | null;
  placa: string | null;
  tipo: VehicleTypeEnum | null;
  marca: string | null;
  modelo: string | null;
  anoModelo: number | null;
  combustivel: FuelTypeEnum | null;
  consumoMedioKmL: number | null;
  velocidadeMediaKmh: number | null;
  capacidadeCargaKg: number | null;
  hodometroAtualKm: number | null;
  numeroEixos: number | null;
  vencimentoSeguro: string | null;
  vencimentoLicenciamento: string | null;
  padrao: boolean;
}

export interface PerfilCustoResumo {
  vehicleId: string;
  precoCombustivelLitro: number | null;
  custoFixoDia: number | null;
  custoFixoMes: number | null;
  custoManutencaoKm: number | null;
  custoPneuKm: number | null;
  custoDepreciacaoKm: number | null;
  custoMotoristaDia: number | null;
  custoOutroKm: number | null;
  margemAlvoPercentual: number | null;
  vigenteDesde: string;
}

export interface PerfilPneuResumo {
  id: string;
  vehicleId: string;
  categoria: TireCategoryEnum;
  marca: string | null;
  modelo: string | null;
}

export interface GerenciarVeiculoResultado extends ResultadoFerramentaBase {
  modo: ModoGerenciarVeiculo;
  veiculo?: VeiculoResumo;
  veiculos?: VeiculoResumo[];
  perfilCusto?: PerfilCustoResumo;
  perfilPneu?: PerfilPneuResumo;
}

function mapaVeiculo(row: VehicleRow): VeiculoResumo {
  return {
    id: row.id,
    nome: row.name,
    placa: row.plate,
    tipo: row.vehicle_type,
    marca: row.brand,
    modelo: row.model,
    anoModelo: row.model_year,
    combustivel: row.fuel_type,
    consumoMedioKmL: row.average_consumption_km_l,
    velocidadeMediaKmh: row.average_speed_kmh,
    capacidadeCargaKg: row.load_capacity_kg,
    hodometroAtualKm: row.current_odometer_km,
    numeroEixos: row.axle_count,
    vencimentoSeguro: row.insurance_expiry_date,
    vencimentoLicenciamento: row.licensing_expiry_date,
    padrao: row.is_default,
  };
}

function mapaPerfilCusto(row: VehicleCostProfileRow): PerfilCustoResumo {
  return {
    vehicleId: row.vehicle_id,
    precoCombustivelLitro: row.fuel_price_per_liter,
    custoFixoDia: row.fixed_cost_per_day,
    custoFixoMes: row.fixed_cost_per_month,
    custoManutencaoKm: row.maintenance_cost_per_km,
    custoPneuKm: row.tire_cost_per_km,
    custoDepreciacaoKm: row.depreciation_cost_per_km,
    custoMotoristaDia: row.driver_cost_per_day,
    custoOutroKm: row.other_cost_per_km,
    margemAlvoPercentual: row.target_margin_percent,
    vigenteDesde: row.effective_from,
  };
}

function mapaPerfilPneu(row: VehicleTireProfileRow): PerfilPneuResumo {
  return { id: row.id, vehicleId: row.vehicle_id, categoria: row.tire_category, marca: row.brand, modelo: row.model };
}

function respostaFalha(modo: ModoGerenciarVeiculo, alertas: string[], dadosFaltantes: string[] = []): GerenciarVeiculoResultado {
  return { sucesso: false, modo, alertas, premissas: [], dadosFaltantes, mensagemResumo: alertas[0] ?? "Não foi possível concluir a ação de veículo." };
}

async function executar(entrada: GerenciarVeiculoEntrada): Promise<GerenciarVeiculoResultado> {
  const { modo, userId, companyId } = entrada;

  if (!userId || !companyId) {
    return respostaFalha(modo, ["Não foi possível identificar o usuário/empresa para o veículo."], ["userId", "companyId"]);
  }

  const admin = createAdminClient();

  try {
    if (modo === "CRIAR") {
      if (!entrada.nome && !entrada.placa) {
        return respostaFalha(modo, ["Preciso de ao menos um nome/apelido ou a placa para cadastrar o veículo."], ["nome", "placa"]);
      }

      const veiculosExistentes = await listVehicles(admin, companyId);
      if (veiculosExistentes.length > 0) {
        return respostaFalha(modo, [
          "Esta conta já tem um veículo cadastrado — nesta versão só é permitido 1 veículo por conta. Use ATUALIZAR para corrigir/completar os dados dele, em vez de cadastrar outro.",
        ]);
      }

      const criado = await createVehicle(admin, companyId, userId, {
        name: entrada.nome,
        plate: entrada.placa,
        vehicleType: entrada.tipo,
        brand: entrada.marca,
        model: entrada.modelo,
        modelYear: entrada.anoModelo,
        fuelType: entrada.combustivel,
        averageConsumptionKmL: entrada.consumoMedioKmL,
        averageSpeedKmh: entrada.velocidadeMediaKmh,
        loadCapacityKg: entrada.capacidadeCargaKg,
        currentOdometerKm: entrada.hodometroAtualKm,
        axleCount: entrada.numeroEixos,
        insuranceExpiryDate: entrada.vencimentoSeguro,
        licensingExpiryDate: entrada.vencimentoLicenciamento,
        notes: entrada.observacoes,
      });

      return {
        sucesso: true,
        modo,
        alertas: [],
        premissas: [],
        dadosFaltantes: [],
        veiculo: mapaVeiculo(criado),
        mensagemResumo: `Veículo "${criado.name ?? criado.plate ?? criado.id}" cadastrado.`,
      };
    }

    if (modo === "LISTAR") {
      const veiculos = (await listVehicles(admin, companyId)).map(mapaVeiculo);
      return {
        sucesso: true,
        modo,
        alertas: [],
        premissas: [],
        dadosFaltantes: [],
        veiculos,
        mensagemResumo: veiculos.length === 0 ? "Nenhum veículo cadastrado ainda." : `${veiculos.length} veículo(s) cadastrado(s).`,
      };
    }

    // ATUALIZAR / DEFINIR_PADRAO / DEFINIR_CUSTO / DEFINIR_PNEU exigem vehicleId, sempre verificado contra a empresa.
    if (!entrada.vehicleId) {
      return respostaFalha(modo, ["Preciso saber exatamente qual veículo (vehicleId) — use LISTAR antes se houver dúvida sobre qual é."], ["vehicleId"]);
    }

    const veiculoAtual = await getVehicle(admin, entrada.vehicleId);
    if (!veiculoAtual || veiculoAtual.company_id !== companyId) {
      return respostaFalha(modo, ["Não encontrei esse veículo para esta empresa."], ["vehicleId"]);
    }

    if (modo === "ATUALIZAR") {
      const atualizado = await updateVehicle(admin, entrada.vehicleId, companyId, userId, {
        name: entrada.nome,
        plate: entrada.placa,
        vehicleType: entrada.tipo,
        brand: entrada.marca,
        model: entrada.modelo,
        modelYear: entrada.anoModelo,
        fuelType: entrada.combustivel,
        averageConsumptionKmL: entrada.consumoMedioKmL,
        averageSpeedKmh: entrada.velocidadeMediaKmh,
        loadCapacityKg: entrada.capacidadeCargaKg,
        currentOdometerKm: entrada.hodometroAtualKm,
        axleCount: entrada.numeroEixos,
        insuranceExpiryDate: entrada.vencimentoSeguro,
        licensingExpiryDate: entrada.vencimentoLicenciamento,
        notes: entrada.observacoes,
      });

      return {
        sucesso: true,
        modo,
        alertas: [],
        premissas: [],
        dadosFaltantes: [],
        veiculo: mapaVeiculo(atualizado),
        mensagemResumo: `Dados de "${atualizado.name ?? atualizado.plate ?? atualizado.id}" atualizados.`,
      };
    }

    if (modo === "DEFINIR_PADRAO") {
      const atualizado = await setDefaultVehicle(admin, entrada.vehicleId, companyId, userId);
      return {
        sucesso: true,
        modo,
        alertas: [],
        premissas: [],
        dadosFaltantes: [],
        veiculo: mapaVeiculo(atualizado),
        mensagemResumo: `"${atualizado.name ?? atualizado.plate ?? atualizado.id}" agora é o veículo padrão.`,
      };
    }

    if (modo === "DEFINIR_CUSTO") {
      const algumCampo =
        entrada.precoCombustivelLitro !== undefined ||
        entrada.custoFixoDia !== undefined ||
        entrada.custoFixoMes !== undefined ||
        entrada.custoManutencaoKm !== undefined ||
        entrada.custoPneuKm !== undefined ||
        entrada.custoDepreciacaoKm !== undefined ||
        entrada.custoMotoristaDia !== undefined ||
        entrada.custoOutroKm !== undefined ||
        entrada.margemAlvoPercentual !== undefined;

      if (!algumCampo) {
        return respostaFalha(modo, ["Preciso de ao menos um valor de custo pra atualizar o perfil — nunca invento um número."]);
      }

      const perfil = await replaceCostProfile(admin, companyId, userId, {
        vehicleId: entrada.vehicleId,
        fuelPricePerLiter: entrada.precoCombustivelLitro,
        fixedCostPerDay: entrada.custoFixoDia,
        fixedCostPerMonth: entrada.custoFixoMes,
        maintenanceCostPerKm: entrada.custoManutencaoKm,
        tireCostPerKm: entrada.custoPneuKm,
        depreciationCostPerKm: entrada.custoDepreciacaoKm,
        driverCostPerDay: entrada.custoMotoristaDia,
        otherCostPerKm: entrada.custoOutroKm,
        targetMarginPercent: entrada.margemAlvoPercentual,
      });

      return {
        sucesso: true,
        modo,
        alertas: [],
        premissas: ["Campos não informados nesta chamada mantiveram o valor já salvo no perfil de custo anterior, quando havia um."],
        dadosFaltantes: [],
        perfilCusto: mapaPerfilCusto(perfil),
        mensagemResumo: "Perfil de custo do veículo atualizado.",
      };
    }

    // DEFINIR_PNEU
    const perfilPneu = await createTireProfile(admin, companyId, userId, {
      vehicleId: entrada.vehicleId,
      tireCategory: entrada.categoriaPneu,
      brand: entrada.marcaPneu,
      model: entrada.modeloPneu,
      size: entrada.medidaPneu,
      acquisitionCost: entrada.custoAquisicaoPneu,
      expectedLifeKm: entrada.vidaUtilKmPneu,
      numberOfRecaps: entrada.quantidadeRecapagens,
      recapCost: entrada.custoRecapagem,
      expectedRecapLifeKm: entrada.vidaUtilRecapagemKmPneu,
    });

    return {
      sucesso: true,
      modo,
      alertas: [],
      premissas: [],
      dadosFaltantes: [],
      perfilPneu: mapaPerfilPneu(perfilPneu),
      mensagemResumo: "Perfil de pneu registrado para o veículo.",
    };
  } catch {
    return respostaFalha(modo, ["Não foi possível concluir a ação de veículo agora. Confira os dados e tente novamente."]);
  }
}

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  {
    nome: "modo",
    tipo: "enum",
    obrigatorio: true,
    descricao: "Operação a executar.",
    valoresPossiveis: ["CRIAR", "LISTAR", "ATUALIZAR", "DEFINIR_PADRAO", "DEFINIR_CUSTO", "DEFINIR_PNEU"],
  },
  { nome: "userId", tipo: "string", obrigatorio: true, descricao: "Usuário dono da empresa (do contexto da conversa, nunca da mensagem)." },
  { nome: "companyId", tipo: "string", obrigatorio: true, descricao: "Empresa dona do(s) veículo(s) (do contexto da conversa)." },
  { nome: "conversationId", tipo: "string", obrigatorio: false, descricao: "Conversa de origem." },
  { nome: "vehicleId", tipo: "string", obrigatorio: false, descricao: "Id do veículo — obrigatório em ATUALIZAR/DEFINIR_PADRAO/DEFINIR_CUSTO/DEFINIR_PNEU. Use LISTAR antes se não tiver certeza de qual é." },
  { nome: "nome", tipo: "string", obrigatorio: false, descricao: "Nome/apelido do veículo (ex.: \"Volvo FH branco\")." },
  { nome: "placa", tipo: "string", obrigatorio: false, descricao: "Placa do veículo." },
  { nome: "tipo", tipo: "enum", obrigatorio: false, descricao: "Tipo do veículo/implemento.", valoresPossiveis: TIPOS_VEICULO },
  { nome: "marca", tipo: "string", obrigatorio: false, descricao: "Marca (ex.: Volvo, Scania, Mercedes)." },
  { nome: "modelo", tipo: "string", obrigatorio: false, descricao: "Modelo (ex.: FH 540)." },
  { nome: "anoModelo", tipo: "number", obrigatorio: false, descricao: "Ano do modelo." },
  { nome: "combustivel", tipo: "enum", obrigatorio: false, descricao: "Tipo de combustível.", valoresPossiveis: TIPOS_COMBUSTIVEL },
  { nome: "consumoMedioKmL", tipo: "number", obrigatorio: false, descricao: "Consumo médio em km/l." },
  { nome: "velocidadeMediaKmh", tipo: "number", obrigatorio: false, descricao: "Velocidade média operacional em km/h." },
  { nome: "capacidadeCargaKg", tipo: "number", obrigatorio: false, descricao: "Capacidade de carga em kg." },
  { nome: "hodometroAtualKm", tipo: "number", obrigatorio: false, descricao: "Hodômetro atual em km." },
  { nome: "numeroEixos", tipo: "number", obrigatorio: false, descricao: "Número de eixos do veículo/conjunto (1 a 12) — nunca estimar a partir do tipo, sempre confirmado pelo cliente." },
  { nome: "vencimentoSeguro", tipo: "string", obrigatorio: false, descricao: "Data de vencimento do seguro do veículo, formato YYYY-MM-DD — lida de foto do comprovante ou informada pelo cliente." },
  { nome: "vencimentoLicenciamento", tipo: "string", obrigatorio: false, descricao: "Data de vencimento do licenciamento/CRLV, formato YYYY-MM-DD — lida de foto do documento ou informada pelo cliente." },
  { nome: "observacoes", tipo: "string", obrigatorio: false, descricao: "Observações livres sobre o veículo." },
  { nome: "precoCombustivelLitro", tipo: "number", obrigatorio: false, descricao: "DEFINIR_CUSTO: preço do combustível por litro." },
  { nome: "custoFixoDia", tipo: "number", obrigatorio: false, descricao: "DEFINIR_CUSTO: custo fixo diário." },
  { nome: "custoFixoMes", tipo: "number", obrigatorio: false, descricao: "DEFINIR_CUSTO: custo fixo mensal." },
  { nome: "custoManutencaoKm", tipo: "number", obrigatorio: false, descricao: "DEFINIR_CUSTO: custo de manutenção por km." },
  { nome: "custoPneuKm", tipo: "number", obrigatorio: false, descricao: "DEFINIR_CUSTO: custo de pneu por km." },
  { nome: "custoDepreciacaoKm", tipo: "number", obrigatorio: false, descricao: "DEFINIR_CUSTO: custo de depreciação por km." },
  { nome: "custoMotoristaDia", tipo: "number", obrigatorio: false, descricao: "DEFINIR_CUSTO: custo do motorista por dia." },
  { nome: "custoOutroKm", tipo: "number", obrigatorio: false, descricao: "DEFINIR_CUSTO: outros custos por km." },
  { nome: "margemAlvoPercentual", tipo: "number", obrigatorio: false, descricao: "DEFINIR_CUSTO: margem alvo em %." },
  { nome: "categoriaPneu", tipo: "enum", obrigatorio: false, descricao: "DEFINIR_PNEU: categoria do pneu.", valoresPossiveis: CATEGORIAS_PNEU },
  { nome: "marcaPneu", tipo: "string", obrigatorio: false, descricao: "DEFINIR_PNEU: marca do pneu." },
  { nome: "modeloPneu", tipo: "string", obrigatorio: false, descricao: "DEFINIR_PNEU: modelo do pneu." },
  { nome: "medidaPneu", tipo: "string", obrigatorio: false, descricao: "DEFINIR_PNEU: medida do pneu (ex.: 295/80R22.5)." },
  { nome: "custoAquisicaoPneu", tipo: "number", obrigatorio: false, descricao: "DEFINIR_PNEU: custo de aquisição." },
  { nome: "vidaUtilKmPneu", tipo: "number", obrigatorio: false, descricao: "DEFINIR_PNEU: vida útil esperada em km." },
  { nome: "quantidadeRecapagens", tipo: "number", obrigatorio: false, descricao: "DEFINIR_PNEU: quantidade de recapagens previstas/feitas." },
  { nome: "custoRecapagem", tipo: "number", obrigatorio: false, descricao: "DEFINIR_PNEU: custo de cada recapagem." },
  { nome: "vidaUtilRecapagemKmPneu", tipo: "number", obrigatorio: false, descricao: "DEFINIR_PNEU: vida útil esperada por recapagem em km." },
];

export const ferramentaGerenciarVeiculo: DefinicaoFerramenta<GerenciarVeiculoEntrada, GerenciarVeiculoResultado> = {
  nome: "gerenciar_veiculo",
  descricao: "Cadastra, lista e atualiza veículos da empresa (dados básicos, perfil de custo e perfil de pneu) a partir do que o cliente conta na conversa.",
  objetivo:
    "Transformar dado de veículo mencionado na conversa (tipo, combustível, consumo, placa, custos, pneu) num registro estruturado reaproveitável pelas outras ferramentas, em vez de se perder a cada conversa nova. Nesta V1, cada conta tem no máximo 1 veículo — CRIAR só deve ser usado quando a conta ainda não tiver nenhum (LISTAR confirma); com um já existente, use ATUALIZAR/DEFINIR_CUSTO/DEFINIR_PNEU. Nunca inventa um valor não informado pelo usuário.",
  parametros: PARAMETROS,
  executar,
};
