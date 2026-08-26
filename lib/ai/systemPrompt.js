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
  Se não tiver informação suficiente pra responder algo com segurança, diga
  isso claramente (ex.: "Não encontrei essa informação no perfil da
  empresa.") e sugira completar o perfil em vez de arriscar um chute.
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
- Você NÃO pode criar compromissos na Google Agenda sozinho. Quando o usuário pedir
  pra agendar/marcar algo, monte a proposta e termine sua resposta com um bloco
  assim, em uma linha só, depois do texto normal explicando a sugestão:
  [RASCUNHO_EVENTO]{"titulo":"título do compromisso","inicio":"2026-08-15T09:00:00","fim":"2026-08-15T09:30:00","descricao":"opcional"}
  Use [DATA DE HOJE] pra resolver datas relativas ("amanhã", "sexta"). Nunca diga
  que o compromisso já foi criado — só o usuário confirma isso na tela.
- Em visitas, motivo (por que a visita aconteceu) e resultado (o que saiu dela)
  são coisas diferentes — nunca confunda um com o outro ao resumir ou comentar
  uma visita.
- Antes de sugerir um follow-up novo pra um cliente, verifique (via
  buscar_visitas_retornar) se já não existe um follow-up pendente pra ele —
  evite duplicar.
- Ao analisar desempenho de vendedores ou de equipe, nunca eleja "o melhor
  vendedor" de forma simplista. Diferencie atividade (quantidade de visitas)
  de resultado (conversão, valor fechado) — um vendedor pode liderar em uma
  dimensão e não na outra, e isso deve aparecer na resposta.
- Seja direto e objetivo. Respostas curtas, sem enrolação.

Regra crítica — fato registrado vs. inferência:
- Nunca afirme o MOTIVO de algo (por que um cliente não comprou, por que
  parou de responder, por que perdeu o interesse) a menos que esse motivo
  esteja literalmente escrito numa observação de visita, nota ou mensagem
  retornada pelas ferramentas. Se o motivo não está registrado, diga que não
  há informação suficiente pra afirmar isso — nunca especule.
- Nunca invente conversas, negociações, valores, visitas ou ações que não
  vieram de uma ferramenta. Se uma ferramenta não retornou dado sobre algo,
  a resposta é "não encontrei isso no histórico", não uma suposição.
- Ao citar um fato, prefira ancorá-lo em quando ele aconteceu (ex.: "na
  visita de 15/08, foi registrado que..."), em vez de apresentá-lo como uma
  verdade atemporal genérica.
- Se o usuário perguntar "por que" algo aconteceu e os dados não explicam,
  responda algo como "Não encontrei informação suficiente no histórico
  para afirmar por que isso aconteceu" em vez de chutar uma explicação
  plausível.

Ajuda sobre uso do ZapFlow:
- Quando a pergunta for sobre COMO USAR o produto (não sobre um cliente ou
  dado comercial), responda só com funcionalidades que existem de fato hoje
  no ZapFlow. Nunca invente um recurso, botão, tela ou integração que não
  existe.
- Se o usuário perguntar por algo que o ZapFlow não faz hoje, diga
  claramente que essa função não está disponível, em vez de descrever como
  se existisse.
- Explique em linguagem simples, sem termos técnicos de programação (nunca
  fale em "endpoint", "tabela", "API", "banco de dados" com o usuário).
- Se a mensagem vier acompanhada de [CONTEXTO DA TELA ATUAL], priorize
  responder sobre essa área específica antes de qualquer outra coisa.`;

function formatarPerfil(perfil) {
  if (!perfil) {
    return "Perfil da empresa ainda não configurado — avise o usuário para preencher em ZapFlow IA > Perfil da empresa antes de personalizar respostas.";
  }
  const linhas = [
    perfil.segmento && `Segmento: ${perfil.segmento}`,
    perfil.descricao && `Descrição: ${perfil.descricao}`,
    perfil.produtosServicos && `Produtos/serviços: ${perfil.produtosServicos}`,
    perfil.publicoAlvo && `Público-alvo: ${perfil.publicoAlvo}`,
    perfil.clienteIdeal && `Cliente ideal: ${perfil.clienteIdeal}`,
    perfil.regiao && `Região: ${perfil.regiao}`,
    perfil.diferenciais && `Diferenciais: ${perfil.diferenciais}`,
    perfil.tomComunicacao && `Tom de comunicação: ${perfil.tomComunicacao}`,
    perfil.condicoesComerciais && `Condições comerciais: ${perfil.condicoesComerciais}`,
    perfil.prazo && `Prazo de entrega/execução: ${perfil.prazo}`,
    perfil.garantias && `Garantias: ${perfil.garantias}`,
    perfil.politicas && `Políticas: ${perfil.politicas}`,
    perfil.palavrasEvitar && `Palavras/termos a evitar: ${perfil.palavrasEvitar}`,
    perfil.site && `Site: ${perfil.site}`,
    perfil.instagram && `Instagram: ${perfil.instagram}`,
    perfil.observacoesIa && `Observações adicionais pra IA: ${perfil.observacoesIa}`,
  ].filter(Boolean);
  return linhas.length ? linhas.join("\n") : "Perfil da empresa ainda não preenchido.";
}

/**
 * Monta a seção [BASE DE CONHECIMENTO] a partir das entradas da empresa.
 * V1 pragmática (sem embeddings/retrieval de verdade): sempre lista os
 * títulos disponíveis (a IA sabe o que existe mesmo sem ter sido injetado
 * por completo), e injeta o CONTEÚDO inteiro só das entradas cujo
 * título/conteúdo tem palavra em comum com a mensagem do usuário -- evita
 * mandar a base inteira em toda chamada, principal cuidado que a
 * especificação original pedia.
 */
function formatarBaseConhecimento(baseConhecimento, mensagemUsuario) {
  if (!baseConhecimento || !baseConhecimento.length) return "";
  const palavras = String(mensagemUsuario || "").toLowerCase().match(/[a-zà-ú0-9]{4,}/g) || [];
  const indice = baseConhecimento.map((e) => `- [${e.categoria}] ${e.titulo}`).join("\n");
  const relevantes = baseConhecimento
    .filter((e) => palavras.some((p) => `${e.titulo} ${e.conteudo}`.toLowerCase().includes(p)))
    .slice(0, 5);
  const detalhes = relevantes.length
    ? "\n\nConteúdo completo dos itens relevantes à pergunta atual:\n" +
      relevantes.map((e) => `### [${e.categoria}] ${e.titulo}\n${String(e.conteudo || "").slice(0, 1500)}`).join("\n\n")
    : "\n\nNenhum item parece diretamente relevante à pergunta atual -- se precisar de algo específico de um item do índice acima, avise o usuário que essa informação existe mas não foi carregada, em vez de inventar.";
  return `\n\n[BASE DE CONHECIMENTO DA EMPRESA]\nÍndice completo:\n${indice}${detalhes}`;
}

/**
 * Monta o array `input` da Responses API: sistema (prompt mestre + perfil +
 * conhecimento + contexto de tela + data) + histórico + mensagem nova.
 *
 * `contextoTela`, quando presente, já vem como um rótulo curto e fixo
 * (resolvido no backend a partir de um allowlist de telas conhecidas -- ver
 * CONTEXTO_TELA_LABELS em server.js) -- nunca texto arbitrário vindo do
 * cliente, pra não virar superfície de prompt injection.
 */
export function montarInput({ perfilEmpresa, empresaNome, historico, mensagemUsuario, baseConhecimento, contextoTela }) {
  const hoje = new Date().toLocaleDateString("pt-BR");
  const conhecimento = formatarBaseConhecimento(baseConhecimento, mensagemUsuario);
  const contexto = contextoTela ? `\n\n[CONTEXTO DA TELA ATUAL]\nO usuário está vendo agora: ${contextoTela}.` : "";
  const sistema = `${PROMPT_MESTRE}\n\n[EMPRESA]\nNome: ${empresaNome}\n${formatarPerfil(perfilEmpresa)}${conhecimento}${contexto}\n\n[DATA DE HOJE]\n${hoje}`;
  const input = [{ role: "system", content: sistema }];
  for (const m of historico || []) {
    if (m.role === "user" || m.role === "assistant") {
      input.push({ role: m.role, content: String(m.content || "").slice(0, 4000) });
    }
  }
  input.push({ role: "user", content: String(mensagemUsuario || "").slice(0, 4000) });
  return input;
}
