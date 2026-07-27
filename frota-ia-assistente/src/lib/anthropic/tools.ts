import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { FERRAMENTAS_FROTA_IA } from "@/ai/tools";
import type { DefinicaoParametroFerramenta } from "@/ai/tools";

/**
 * Campos de contexto (identidade, nunca dado de negócio) que nenhuma
 * ferramenta expõe ao Claude — são sempre injetados pelo backend depois
 * que o modelo decide chamar a ferramenta, nunca aceitos do que o modelo
 * "imaginou". Mesmo princípio de "não confiar em company_id enviado pelo
 * cliente" usado nas RLS policies da Camada 3, aplicado aqui à saída do
 * modelo. Usado por construirFerramentasAnthropic (para não anunciar esses
 * campos ao Claude) e pela rota /api/chat (para sobrescrever o que o
 * modelo tiver enviado nesses campos, se algo).
 */
export const CAMPOS_DE_CONTEXTO_RESERVADOS = new Set(["userId", "companyId", "conversationId"]);

function parametroParaJsonSchema(parametro: DefinicaoParametroFerramenta): Record<string, unknown> {
  const base: Record<string, unknown> = { description: parametro.descricao };

  switch (parametro.tipo) {
    case "string":
      base.type = "string";
      break;
    case "number":
      base.type = "number";
      break;
    case "boolean":
      base.type = "boolean";
      break;
    case "enum":
      base.type = "string";
      base.enum = parametro.valoresPossiveis ?? [];
      break;
  }

  return base;
}

/**
 * Converte as 12 ferramentas para o formato de tool use da Anthropic.
 *
 * Limitação conhecida: `DefinicaoParametroFerramenta` só descreve campos
 * primitivos (string/number/boolean/enum) — não expressa objetos ou listas
 * aninhadas (ex.: `opcoes` de comparar_pneus, `periodos`/`motoristas` de
 * calcular_jornada). Por isso o schema aqui é "aberto"
 * (`additionalProperties: true`): o Claude ainda consegue enviar essa
 * estrutura mais rica com base na descrição em texto da ferramenta, só não
 * tem a validação estrita de schema para ela. Toda ferramenta valida sua
 * entrada de forma defensiva e explica o que falta em vez de quebrar, então
 * isso é seguro — só menos preciso do que seria com um schema completo por
 * ferramenta (melhoria futura).
 */
export function construirFerramentasAnthropic(): Anthropic.Tool[] {
  return FERRAMENTAS_FROTA_IA.map((ferramenta) => {
    const parametrosVisiveis = ferramenta.parametros.filter((p) => !CAMPOS_DE_CONTEXTO_RESERVADOS.has(p.nome));

    return {
      name: ferramenta.nome,
      description: `${ferramenta.descricao} ${ferramenta.objetivo}`.trim(),
      input_schema: {
        type: "object" as const,
        properties: Object.fromEntries(parametrosVisiveis.map((p) => [p.nome, parametroParaJsonSchema(p)])),
        required: parametrosVisiveis.filter((p) => p.obrigatorio).map((p) => p.nome),
        additionalProperties: true,
      },
    };
  });
}
