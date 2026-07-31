import type { DefinicaoFerramenta, DefinicaoParametroFerramenta, ResultadoFerramentaBase } from "./types";
import { arredondar } from "./utils";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordExpense, listExpenses } from "@/services/supabase/expenseService";
import type { ExpenseRow, ExpenseTypeEnum } from "@/lib/supabase/tables";

/**
 * Ferramenta: registrar_despesa
 *
 * Ferramenta de INTEGRAÇÃO (I/O real com Supabase — `expenses`, ver
 * migration 20260731100000), mesmo padrão de `gerenciar_alerta`: `executar`
 * é assíncrona, nunca inventa valor/tipo/data.
 *
 * Resolve a lacuna de "foto de nota fiscal": o Claude já lê a imagem
 * nativamente (visão) e consegue enxergar valor/data/fornecedor, mas sem
 * esta ferramenta esse dado só existia como texto solto na conversa — nunca
 * virava um registro estruturado. O fluxo esperado (ver regra no system
 * prompt) é: usuário manda foto de nota → Claude lê os dados visíveis →
 * confirma com o usuário (nunca assume) → chama REGISTRAR com o que foi
 * confirmado.
 *
 * Modo CONSULTAR soma despesas por período/veículo/tipo para alimentar
 * calcular_cpk/calcular_custo_dia por decisão explícita da IA (lê o total
 * aqui e passa como argumento numérico para a outra ferramenta) — nunca
 * soma automaticamente dentro delas.
 */

export type ModoRegistrarDespesa = "REGISTRAR" | "CONSULTAR";

const TIPOS_DESPESA: ExpenseTypeEnum[] = [
  "combustivel",
  "manutencao",
  "pedagio",
  "alimentacao",
  "hospedagem",
  "documentacao",
  "pneu",
  "seguro",
  "multa",
  "outro",
];

export interface RegistrarDespesaEntrada {
  modo: ModoRegistrarDespesa;
  userId: string;
  companyId: string;
  conversationId?: string;
  /** Mensagem (foto/PDF) de origem — injetada pelo backend quando a despesa vem de uma mídia recebida nesta rodada, nunca informada pelo modelo. */
  sourceMessageId?: string;
  vehicleId?: string;

  // REGISTRAR
  tipo?: ExpenseTypeEnum;
  valor?: number;
  /** Data da despesa em YYYY-MM-DD (não a data/hora de registro) — resolvida pela IA a partir da nota ou da data atual informada no system prompt. */
  data?: string;
  fornecedor?: string;
  descricao?: string;

  // CONSULTAR
  dataInicio?: string;
  dataFim?: string;
  limite?: number;
}

export interface DespesaResumo {
  id: string;
  tipo: ExpenseTypeEnum;
  valor: number;
  data: string;
  veiculoId: string | null;
  fornecedor: string | null;
  descricao: string | null;
}

export interface RegistrarDespesaResultado extends ResultadoFerramentaBase {
  modo: ModoRegistrarDespesa;
  despesa?: DespesaResumo;
  itens?: DespesaResumo[];
  totalGeral?: number;
  totalPorTipo?: Record<string, number>;
  quantidadeEncontrada?: number;
}

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function mapaDespesa(row: ExpenseRow): DespesaResumo {
  return {
    id: row.id,
    tipo: row.expense_type,
    valor: Number(row.amount),
    data: row.expense_date,
    veiculoId: row.vehicle_id,
    fornecedor: row.vendor,
    descricao: row.description,
  };
}

function respostaFalha(modo: ModoRegistrarDespesa, alertas: string[], dadosFaltantes: string[] = []): RegistrarDespesaResultado {
  return { sucesso: false, modo, alertas, premissas: [], dadosFaltantes, mensagemResumo: alertas[0] ?? "Não foi possível concluir a ação de despesa." };
}

async function executar(entrada: RegistrarDespesaEntrada): Promise<RegistrarDespesaResultado> {
  const { modo, userId, companyId } = entrada;

  if (!userId || !companyId) {
    return respostaFalha(modo, ["Não foi possível identificar o usuário/empresa para a despesa."], ["userId", "companyId"]);
  }

  const admin = createAdminClient();

  try {
    switch (modo) {
      case "REGISTRAR": {
        const faltando: string[] = [];
        if (!entrada.tipo) faltando.push("tipo");
        if (entrada.valor === undefined) faltando.push("valor");
        if (!entrada.data) faltando.push("data");
        if (faltando.length > 0) {
          return respostaFalha(modo, ["Faltam dados para registrar a despesa — nunca invento tipo, valor ou data."], faltando);
        }
        if (!TIPOS_DESPESA.includes(entrada.tipo as ExpenseTypeEnum)) {
          return respostaFalha(modo, [`Tipo de despesa inválido: "${entrada.tipo}". Use um de: ${TIPOS_DESPESA.join(", ")}.`]);
        }
        if (entrada.valor! <= 0) {
          return respostaFalha(modo, ["O valor da despesa precisa ser maior que zero."]);
        }
        if (!DATA_REGEX.test(entrada.data!)) {
          return respostaFalha(modo, ['A data da despesa precisa estar em "YYYY-MM-DD" (ex.: 2026-07-31) — nunca uma expressão relativa.']);
        }

        const criada = await recordExpense(admin, {
          companyId,
          userId,
          conversationId: entrada.conversationId,
          vehicleId: entrada.vehicleId,
          sourceMessageId: entrada.sourceMessageId,
          expenseType: entrada.tipo as ExpenseTypeEnum,
          amount: entrada.valor!,
          expenseDate: entrada.data!,
          vendor: entrada.fornecedor,
          description: entrada.descricao,
        });

        return {
          sucesso: true,
          modo,
          alertas: [],
          premissas: [],
          dadosFaltantes: [],
          despesa: mapaDespesa(criada),
          mensagemResumo: `Despesa de ${criada.expense_type} registrada.`,
        };
      }

      case "CONSULTAR": {
        const limite = Math.min(Math.max(entrada.limite ?? 50, 1), 200);
        const linhas = await listExpenses(admin, {
          companyId,
          vehicleId: entrada.vehicleId,
          expenseType: entrada.tipo,
          dateFrom: entrada.dataInicio,
          dateTo: entrada.dataFim,
          limit: limite,
        });

        const itens = linhas.map(mapaDespesa);
        const totalGeral = arredondar(itens.reduce((acc, i) => acc + i.valor, 0), 2);
        const totalPorTipo: Record<string, number> = {};
        for (const item of itens) {
          totalPorTipo[item.tipo] = arredondar((totalPorTipo[item.tipo] ?? 0) + item.valor, 2);
        }

        return {
          sucesso: true,
          modo,
          alertas: [],
          premissas: [],
          dadosFaltantes: [],
          itens,
          totalGeral,
          totalPorTipo,
          quantidadeEncontrada: itens.length,
          mensagemResumo:
            itens.length === 0
              ? "Nenhuma despesa encontrada com esses critérios."
              : `${itens.length} despesa(s) encontrada(s), totalizando R$ ${totalGeral.toFixed(2)}.`,
        };
      }

      default: {
        const modoNuncaVisto: never = modo;
        return respostaFalha(modoNuncaVisto as ModoRegistrarDespesa, [`Modo desconhecido: ${String(modoNuncaVisto)}.`]);
      }
    }
  } catch {
    return respostaFalha(modo, ["Não foi possível concluir a ação de despesa agora. Tente novamente em instantes."]);
  }
}

const PARAMETROS: DefinicaoParametroFerramenta[] = [
  { nome: "modo", tipo: "enum", obrigatorio: true, descricao: "Operação a executar.", valoresPossiveis: ["REGISTRAR", "CONSULTAR"] },
  { nome: "userId", tipo: "string", obrigatorio: true, descricao: "Usuário dono da despesa (do contexto da conversa, nunca da mensagem)." },
  { nome: "companyId", tipo: "string", obrigatorio: true, descricao: "Empresa dona da despesa (do contexto da conversa)." },
  { nome: "conversationId", tipo: "string", obrigatorio: false, descricao: "Conversa de origem." },
  { nome: "vehicleId", tipo: "string", obrigatorio: false, descricao: "Veículo relacionado à despesa, quando identificado (REGISTRAR) ou filtro (CONSULTAR)." },
  { nome: "tipo", tipo: "enum", obrigatorio: false, descricao: "Tipo da despesa (REGISTRAR, obrigatório) ou filtro (CONSULTAR).", valoresPossiveis: TIPOS_DESPESA },
  { nome: "valor", tipo: "number", obrigatorio: false, descricao: "Valor da despesa em reais — obrigatório em REGISTRAR. Só o que estiver visível na nota/mensagem, nunca estimado." },
  { nome: "data", tipo: "string", obrigatorio: false, descricao: 'Data da despesa em "YYYY-MM-DD" — obrigatória em REGISTRAR. Use a data da nota se visível; senão confirme com o usuário antes de assumir a data atual.' },
  { nome: "fornecedor", tipo: "string", obrigatorio: false, descricao: "Nome do posto/oficina/estabelecimento, se visível ou informado." },
  { nome: "descricao", tipo: "string", obrigatorio: false, descricao: "Descrição livre adicional (ex.: item específico da nota)." },
  { nome: "dataInicio", tipo: "string", obrigatorio: false, descricao: "Início do período em YYYY-MM-DD (CONSULTAR), já resolvido a partir da data atual." },
  { nome: "dataFim", tipo: "string", obrigatorio: false, descricao: "Fim do período em YYYY-MM-DD (CONSULTAR)." },
  { nome: "limite", tipo: "number", obrigatorio: false, descricao: "Máximo de resultados em CONSULTAR (padrão 50, limite 200)." },
];

export const ferramentaRegistrarDespesa: DefinicaoFerramenta<RegistrarDespesaEntrada, RegistrarDespesaResultado> = {
  nome: "registrar_despesa",
  descricao: "Registra uma despesa estruturada (combustível, manutenção, pedágio etc.) e consulta/soma despesas já registradas por período, veículo ou tipo.",
  objetivo:
    "Transformar o que o Claude lê numa foto de nota/cupom fiscal (ou o que o usuário informa em texto) num registro estruturado vinculado ao veículo/empresa, em vez de ficar só mencionado na conversa. O modo CONSULTAR permite somar despesas de um período para alimentar calcular_cpk/calcular_custo_dia por decisão explícita da IA — nunca some despesas de cabeça, sempre via este modo.",
  parametros: PARAMETROS,
  executar,
};
