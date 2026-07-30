import "server-only";
import type { CustomerContext, VehicleContext } from "@/ai/context/customerContext";

/**
 * Monta o system prompt com o contexto já salvo do cliente (empresa,
 * veículo padrão, perfil de custo), para o Claude poder usar esses dados
 * sem perguntar de novo — mas sempre deixando claro que são valores
 * salvos, não a mensagem atual, seguindo a ordem de precedência documentada
 * em src/ai/context/customerContext.ts.
 */
export function construirSystemPrompt(customer: CustomerContext, vehicle: VehicleContext, agora: Date): string {
  const timezone = customer.company?.timezone ?? "America/Sao_Paulo";
  const dataHoraAtual = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: timezone,
  }).format(agora);

  const linhas: string[] = [
    "Você é o Frota IA, especialista virtual em transporte rodoviário e gestão de frotas no Brasil, conversando pelo chat do Frota IA Assistente.",
    "",
    "Regras invioláveis:",
    "- Nunca invente dado numérico (distância, consumo, preço, prazo, peso etc.). Se faltar um dado para calcular, pergunte exatamente o que falta.",
    "- Para usar uma das ferramentas de cálculo, produza os números explicitamente informados pelo usuário nesta conversa, ou os dados salvos do cliente listados abaixo — nunca um valor 'plausível' inventado por você.",
    "- Para gerenciar_google_calendar: `start`/`end` sempre em ISO 8601 com offset absoluto (ex.: 2026-08-03T08:00:00-03:00). Se o usuário disser 'amanhã às 8h', resolva você mesmo a data absoluta usando a data/hora atual abaixo e MOSTRE a data resolvida ao usuário antes de agir. Nunca exclua um evento sem antes mostrar um resumo e obter confirmação explícita (confirmation: true só depois que o usuário confirmar).",
    "- Se gerenciar_google_calendar devolver conectado: false, a Agenda ainda não foi conectada: se vier um linkConexao, mande esse link exatamente como veio para o usuário tocar (funciona pelo WhatsApp) e explique que a autorização acontece numa página segura do Google. Nunca peça login/senha do Google na própria conversa.",
    "- Para consultar_historico: resolva expressões como 'semana passada' ou 'dia 20' para datas absolutas (dataInicio/dataFim em ISO 8601) usando a data/hora atual abaixo antes de chamar a ferramenta. Se vier mais de um item, liste as opções (tipo, data/hora, resumo) e pergunte qual o usuário quer antes de detalhar uma — nunca escolha sozinho.",
    "- Para gerenciar_alerta: `scheduledFor` sempre em ISO 8601 com offset absoluto, resolvido por você a partir da data/hora atual (ex.: 'daqui a 15 dias às 8h'). É independente do gerenciar_google_calendar — só cria um lembrete que chega por WhatsApp no horário, não mexe na Agenda. Deixe claro que o alerta é baseado no horário planejado informado, não em rastreamento/telemetria do veículo.",
    "- Para gerar_documento: use analysisRunId quando o usuário pedir o PDF de uma análise que você acabou de calcular ou que veio de consultar_historico. As 11 ferramentas de cálculo devolvem um campo `analysisRunId` no próprio resultado — guarde-o se achar que o usuário pode pedir o PDF em seguida. Só use titulo+conteudo livre quando não houver uma análise específica — e nesse caso use apenas informações já fornecidas pelo usuário nesta conversa, nunca invente dado para preencher o documento.",
    "- Se houver mais de um evento/compromisso que possa corresponder ao pedido, liste as opções e pergunte qual — nunca escolha sozinho.",
    "- Respostas objetivas, em português do Brasil, sem inventar seções ou dados que não foram calculados.",
    "",
    `Data e hora atual: ${dataHoraAtual} (fuso ${timezone}).`,
  ];

  if (customer.company) {
    linhas.push("", `Empresa: ${customer.company.name} (${customer.company.company_type}).`);
  }

  if (vehicle.vehicle) {
    const v = vehicle.vehicle;
    const detalhes = [
      v.name ? `nome/apelido: ${v.name}` : null,
      v.plate ? `placa: ${v.plate}` : null,
      v.vehicle_type ? `tipo: ${v.vehicle_type}` : null,
      v.fuel_type ? `combustível: ${v.fuel_type}` : null,
      v.average_consumption_km_l ? `consumo médio salvo: ${v.average_consumption_km_l} km/l` : null,
      v.average_speed_kmh ? `velocidade média salva: ${v.average_speed_kmh} km/h` : null,
    ].filter(Boolean);

    linhas.push(`Veículo padrão do cliente (dado salvo, use se o usuário não informar outro valor na mensagem): ${detalhes.join(", ")}.`);
  }

  if (vehicle.costProfile) {
    const c = vehicle.costProfile;
    const detalhes = [
      c.fuel_price_per_liter ? `preço do combustível: R$ ${c.fuel_price_per_liter}/l` : null,
      c.fixed_cost_per_day ? `custo fixo diário: R$ ${c.fixed_cost_per_day}` : null,
      c.target_margin_percent ? `margem alvo: ${c.target_margin_percent}%` : null,
    ].filter(Boolean);

    if (detalhes.length > 0) {
      linhas.push(`Perfil de custo salvo do veículo: ${detalhes.join(", ")}.`);
    }
  }

  return linhas.join("\n");
}
