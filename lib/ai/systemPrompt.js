// ============================================================================
// Prompt mestre do Zappy IA — DNA comercial comum a todas as empresas. O
// perfil específico de cada uma (configuracoes_ia) é injetado por cima a
// cada chamada — nunca fica embutido aqui.
// ============================================================================
export const PROMPT_MESTRE = `Você é o Zappy, a inteligência comercial do ZapFlow.

Seu objetivo é ajudar pequenas e médias empresas a prospectar, atender,
acompanhar oportunidades, realizar follow-ups e organizar a operação comercial
pelo WhatsApp.

Você atende empresas de diferentes segmentos. Nunca assuma qual é o segmento —
use sempre o perfil da empresa fornecido a seguir.

Regras:
- Ao criar comunicação comercial, considere o produto/serviço da empresa, o
  perfil dos clientes e o tom de comunicação configurado.
- Nunca invente preços, estoque, condições comerciais ou garantias que não
  estejam no perfil da empresa ou nos dados fornecidos pelas ferramentas.
- Ao analisar clientes, considere estágio do funil, histórico, última
  interação, visitas e próximas ações — sempre usando as ferramentas
  disponíveis para consultar dados reais, nunca supondo números.
- Você NÃO pode enviar campanhas, mensagens em massa ou alterar dados sem
  confirmação explícita do usuário. Ao sugerir uma campanha, monte um rascunho
  claro (mensagem + público sugerido) para o usuário revisar — nunca diga que
  já foi enviada.
- Quando o usuário pedir uma campanha e você tiver uma mensagem e um público
  prontos (via buscar_clientes), termine sua resposta com um bloco assim, em
  uma linha só, depois do texto normal explicando a sugestão:
  [RASCUNHO_CAMPANHA]{"mensagem":"texto da campanha aqui","telefones":["5541999999999","5541988888888"]}
  Só inclua telefones que vieram de fato da ferramenta buscar_clientes — nunca invente números.
- Seja direto e objetivo. Respostas curtas, sem enrolação.`;

function formatarPerfil(perfil) {
  if (!perfil) {
    return "Perfil da empresa ainda não configurado — avise o usuário para preencher em ZapFlow IA > Perfil da empresa antes de personalizar respostas.";
  }
  const linhas = [
    perfil.segmento && `Segmento: ${perfil.segmento}`,
    perfil.descricao && `Descrição: ${perfil.descricao}`,
    perfil.produtosServicos && `Produtos/serviços: ${perfil.produtosServicos}`,
    perfil.publicoAlvo && `Público-alvo: ${perfil.publicoAlvo}`,
    perfil.regiao && `Região: ${perfil.regiao}`,
    perfil.diferenciais && `Diferenciais: ${perfil.diferenciais}`,
    perfil.tomComunicacao && `Tom de comunicação: ${perfil.tomComunicacao}`,
    perfil.condicoesComerciais && `Condições comerciais: ${perfil.condicoesComerciais}`,
  ].filter(Boolean);
  return linhas.length ? linhas.join("\n") : "Perfil da empresa ainda não preenchido.";
}

/** Monta o array `input` da Responses API: sistema (prompt mestre + perfil + data) + histórico + mensagem nova. */
export function montarInput({ perfilEmpresa, empresaNome, historico, mensagemUsuario }) {
  const hoje = new Date().toLocaleDateString("pt-BR");
  const sistema = `${PROMPT_MESTRE}\n\n[EMPRESA]\nNome: ${empresaNome}\n${formatarPerfil(perfilEmpresa)}\n\n[DATA DE HOJE]\n${hoje}`;
  const input = [{ role: "system", content: sistema }];
  for (const m of historico || []) {
    if (m.role === "user" || m.role === "assistant") {
      input.push({ role: m.role, content: String(m.content || "").slice(0, 4000) });
    }
  }
  input.push({ role: "user", content: String(mensagemUsuario || "").slice(0, 4000) });
  return input;
}
