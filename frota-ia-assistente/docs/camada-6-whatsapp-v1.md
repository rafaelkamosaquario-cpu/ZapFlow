# Camada 6 — Frota IA V1 centrada no WhatsApp

Implementação em fases do prompt "FROTA IA V1 CENTRADA NO WHATSAPP". Este
documento é atualizado a cada fase concluída — a seção 0 tem o diagnóstico
completo feito antes de qualquer alteração, como pedido no prompt.

## 0. Diagnóstico da estrutura encontrada (antes de qualquer mudança)

O prompt presume um conjunto de integrações "já existentes" que **não
existem** neste repositório. Registrado aqui para não gerar confusão sobre
o que esta fase alterou vs. o que nunca existiu:

**Existe de verdade** (Camadas 1-5, sessões anteriores):
- 11 ferramentas de cálculo puro + `gerenciar_google_calendar` (12 no
  total) — `src/ai/tools/`
- Supabase: `profiles`, `companies`, `company_members`, `vehicles`,
  `user_channels`, `conversations`, `messages`, `ai_memories`,
  `analysis_runs`, `tool_executions`, `google_integrations`,
  `calendar_action_logs`, todas com RLS
- Google Calendar OAuth com link seguro de conexão (Camada 4)
- WhatsApp/Z-API: webhook de entrada, motor de resposta compartilhado com
  a web (Camada 5)
- Painel web com login Google + onboarding por formulário (Fase 2)

**NÃO existe** (o prompt trata como pronto, mas é construção nova):
Google Maps, rotas, pedágios, clima, ANTT, ANP, legislação, geração de
documentos/PDF, agendador de alertas proativos, busca de histórico em
linguagem natural como ferramenta, feature flags, onboarding conversacional
por estados, processamento de áudio/imagem/documento recebido.

Dado o tamanho real do escopo, a implementação foi dividida em fases (A a
G) — ver tarefas no início desta sessão. Este documento cresce conforme
cada fase é concluída e testada.

## Fase A — Identidade por telefone + onboarding conversacional + feature flags

### Identidade por telefone (seção 2 do prompt)

`src/lib/identity/phoneNormalizer.ts` — normaliza dígitos, corrige DDI
duplicado (`5555...` → `55...`), gera E.164. **Não usa telefone como chave
primária**: ele só localiza o `user_id` real via `user_channels.external_user_id`
(já existente desde a Camada 3, reaproveitado — nenhuma tabela nova para
identidade).

`src/services/supabase/userIdentityService.ts` —
`resolveOrCreateUserByPhone`: para um número desconhecido, cria um usuário
de verdade em `auth.users` via Admin API (`phone` + `phone_confirm: true`,
sem e-mail/senha) — necessário porque todo o schema (RLS via `auth.uid()`,
FKs de `companies`/`vehicles`) depende de um `auth.users.id` real. O
número é considerado verificado de imediato (a mensagem chegou por aquele
número na própria instância Z-API).

### Onboarding conversacional (seções 3-6)

Nova migration `create_onboarding_sessions`: tabela `onboarding_sessions`
(estado explícito — `not_started` a `completed`/`paused` — em vez de
depender do histórico de texto) + coluna `profiles.is_admin`. Nenhuma
tabela duplicada: `onboarding_sessions.collected_data` é só rascunho até
`completed`, quando os dados viram `companies`/`vehicles` de verdade via os
mesmos services já usados pelo onboarding web (`createCompanyWithOwner`,
`createVehicle` — zero duplicação de lógica).

`src/ai/whatsapp/onboardingConversation.ts` — função pura, uma pergunta
por vez: nome → perfil (autônomo/dono de frota/gestor de frota/
transportadora/outro, mapeado para o enum `company_type` já existente) →
cidade/UF base → quantidade de veículos → veículo principal (opcional,
aceita "depois"). Reconhece `cancelar`, `continuar depois`/`pausar` e
`pular` em qualquer etapa opcional.

`src/ai/whatsapp/finalizeOnboarding.ts` — ao concluir, cria a empresa
(`createCompanyWithOwner`), grava a quantidade de veículos como uma
memória estruturada (`ai_memories`, reaproveitando a Camada 3 em vez de
criar coluna nova) e cria o veículo principal se informado.

O webhook (`src/app/api/whatsapp/webhook/route.ts`) foi reescrito para:
número novo → cria usuário + começa onboarding; onboarding em andamento →
processa a próxima pergunta sem passar pela IA; onboarding concluído →
segue exatamente como antes (mesma engine de chat da Camada 5). Usuários
que já existiam antes desta fase (vindos do vínculo web da Camada 5) e já
têm empresa são tratados como onboarding concluído — nunca reabrimos o
onboarding de quem já usa o Frota IA.

### Feature flags (seção 14)

`src/lib/featureFlags.ts` — `CUSTOMER_PANEL_ENABLED` (padrão `false` na
V1) e `ADMIN_PANEL_ENABLED`. `src/app/page.tsx` e
`src/app/onboarding/page.tsx` (painel web) redirecionam para `/login` se a
flag estiver desligada e o usuário não tiver `profiles.is_admin = true`.
**Nenhuma rota, componente ou service do painel foi removido** — só
ganhou um gate a mais na entrada. `is_admin` nunca é setado pelo próprio
usuário, só via SQL direto por quem administra o projeto:

```sql
update public.profiles set is_admin = true where id = '<uuid do usuário>';
```

### Limitações conhecidas desta fase

- Extração de marca/modelo/ano do veículo principal é só texto livre
  (guardado em `vehicles.notes`) — não há parsing estruturado.
- Mensagens trocadas durante o onboarding não entram em `conversations`/
  `messages` (essas tabelas exigem `company_id`, que só existe depois do
  onboarding concluído) — não aparecem no histórico.
- `pausado` → ao retomar, a pergunta é escolhida pelo que falta em
  `collected_data`, não por um estado salvo separado do que já foi
  respondido.
- Não testado com tráfego real do Z-API (sem instância dedicada
  configurada neste ambiente) — `tsc`/`lint`/`build` limpos, fluxo
  validado por leitura de código, não por execução ponta a ponta.

## Fase B — Conectar Google pelo WhatsApp (seção 7)

Não precisou de fluxo novo — o link seguro de conexão já existia desde a
Camada 4 (`buildSecureConnectLink`, independente de canal). O que faltava
era a ferramenta `gerenciar_google_calendar` **devolver esse link** quando
a Agenda não está conectada, para a IA poder repassá-lo pelo WhatsApp.

- `gerenciar_google_calendar` ganhou o campo `linkConexao` no resultado,
  preenchido em `VERIFICAR_CONEXAO` e em qualquer chamada que falhe por
  `GoogleCalendarNotConnectedError` — só quando `isGoogleCalendarConfigured()`
  é verdadeiro (nunca devolve um link que sabe que vai falhar).
- Regra nova no system prompt: se a Agenda não estiver conectada, repassar
  o `linkConexao` exatamente como veio, nunca pedir login/senha do Google
  na conversa.

**Bug real encontrado e corrigido nesta fase**: `gerenciar_google_calendar`
nunca tinha sido adicionado ao enum Zod `frotaIaToolNameSchema`
(`src/lib/validation/schemas.ts`) usado por `recordToolExecution` — desde
a Camada 4, toda chamada dessa ferramenta gravava uma falha de validação
ao tentar registrar em `tool_executions`, o que fazia o loop de tool use
reportar a chamada como erro pra IA (`"A ferramenta falhou..."`) mesmo
quando a ação no Google Calendar tinha funcionado. Corrigido junto com
esta fase.

## Fase E — Busca de histórico em linguagem natural (seção 10)

Nova ferramenta `consultar_historico` (13ª ferramenta), mesmo padrão de
I/O real de `gerenciar_google_calendar`: consulta `analysis_runs`
(Camada 3, sem tabela nova) por texto livre (`ilike` em pedido do
usuário/resumo/tipo) e período, sempre busca estruturada — nunca depende
só da memória textual da conversa. Migration
`add_history_search_tool_to_enum` adiciona o valor ao enum
`frota_ia_tool_name` do Postgres (mesmo procedimento já usado para
`gerenciar_google_calendar` na Camada 4).

Resolução de datas relativas ("semana passada", "dia 20") e desambiguação
quando há mais de um resultado ficam a cargo da IA (mesmo princípio já
estabelecido: a ferramenta nunca interpreta linguagem natural) — regra
adicionada ao system prompt.

`tsc`, `lint` e `build` limpos após B e E.

## Fase C — Alertas agendados (seções 8-9)

Nova migration `create_scheduled_alerts`: tabela `scheduled_alerts`
(título, categoria livre, `scheduled_for` absoluto, status
pending/sent/cancelled/failed) — independente de `calendar_action_logs`
(que só registra ações já feitas na Agenda) e independente de um evento
no Google Calendar (o usuário pode ter os dois, criados separadamente,
sem nenhum vínculo automático entre eles nesta fase).

Nova ferramenta `gerenciar_alerta` (14ª ferramenta) — CRIAR/LISTAR/CANCELAR,
mesmo princípio de nunca interpretar "daqui a 15 dias" (a IA resolve pra
ISO absoluto antes de chamar, mesma regra de `gerenciar_google_calendar`).
Deixa explícito ao usuário que o alerta é baseado no horário planejado,
não em rastreamento — não há telemetria neste projeto.

**Disparo real**: `src/app/api/alerts/dispatch/route.ts` — rota protegida
por token (`ALERTS_DISPATCH_SECRET`, mesmo padrão do webhook do
WhatsApp), busca alertas `pending` com `scheduled_for` vencido, resolve o
número de WhatsApp do usuário (`user_channels`) e envia via
`sendWhatsappText`. Não interpreta nada — só dispara o que já está
resolvido no banco.

### Configuração necessária no Railway (você escolheu: cron dentro do próprio Railway)

1. No mesmo projeto Railway do serviço "frota-ia-assistente", clique em
   **"+ New"** → **"Cron Job"** (ou "Empty Service" com schedule, dependendo
   da versão da UI do Railway).
2. **Comando**:
   ```
   curl -fsS "https://<seu-domínio-railway>/api/alerts/dispatch?token=$ALERTS_DISPATCH_SECRET"
   ```
3. **Schedule** (cron padrão): `*/5 * * * *` (a cada 5 minutos — ajuste
   conforme a granularidade que fizer sentido).
4. Nas **Variables** desse serviço cron, adicione `ALERTS_DISPATCH_SECRET`
   com o **mesmo valor** configurado no serviço principal (`frota-ia-assistente`).
5. No serviço principal, gere e configure `ALERTS_DISPATCH_SECRET`
   (`openssl rand -base64 32`) se ainda não existir.

### Limitações conhecidas desta fase

- Só considera o primeiro canal de WhatsApp verificado do usuário — sem
  suporte a múltiplos números por conta.
- Sem retry automático: um alerta que falha ao enviar (ex.: Z-API fora do
  ar no momento exato) fica marcado `failed` e não é reenviado sozinho.
- Não testado com cron real neste ambiente (sem serviço de cron
  provisionado) — a rota foi validada por leitura de código e
  `tsc`/`lint`/`build`, não por execução ponta a ponta.

## Correção de base: `analysis_runs` nunca era gravada

Auditando a Fase E, descobri que `startAnalysisRun`/`completeAnalysisRun`
(Camada 3) existiam desde sempre mas nunca eram chamados pelo loop de tool
use — `analysis_runs` ficava sempre vazia. `consultar_historico` (Fase E)
nunca encontraria nada de verdade sem isso. Corrigido em
`src/ai/chat/gerarRespostaAssistente.ts`: as 11 ferramentas de cálculo
(não as de integração) agora geram um registro por chamada, com o
resultado completo e vinculado ao `tool_executions` correspondente. O
`analysisRunId` também passou a vir de volta no próprio resultado da
ferramenta para a IA poder referenciar numa chamada seguinte de
`gerar_documento`.

## Fase D — Geração e envio de documentos PDF (seção 11)

Nova dependência: `pdf-lib` (zero dependências nativas, testado e
gerando PDF válido — `%PDF-` no cabeçalho — neste ambiente). Nova tabela
`generated_documents` — só metadados (título, tipo, nome do arquivo,
se foi entregue), **nunca o arquivo em si**: o PDF é gerado na hora e
enviado direto em base64 pela Z-API (`sendWhatsappPdf`,
`send-document/pdf`), sem precisar de bucket do Supabase Storage — decisão
deliberada para não introduzir mais uma peça de infraestrutura nova nesta
fase.

- `src/services/documents/pdfGenerator.ts` — layout simples (título, data
  de geração, cliente, empresa, período, pedido, resumo, linhas
  chave/valor, observações, rodapé com identificação do Frota IA).
- Nova ferramenta `gerar_documento` (15ª ferramenta): recebe
  `analysisRunId` (preferencial — puxa uma análise já feita) ou
  `titulo`+`conteudo` livre. Nunca inventa dado ausente — se faltar os
  dois, pede antes de gerar.

### Limitações conhecidas desta fase

- Só entrega por WhatsApp — se o usuário não tiver um canal de WhatsApp
  verificado vinculado (caso raro na V1, já que o WhatsApp é o ponto de
  entrada), a ferramenta explica que não conseguiu entregar em vez de
  tentar outro canal.
- Sem gráficos/tabelas — texto corrido, formatação simples.
- Testado isoladamente (geração de PDF válido, confirmado o cabeçalho
  `%PDF-`) — não testado o envio real via Z-API nem ponta a ponta pelo
  WhatsApp, pelas mesmas razões das fases anteriores (sem instância Z-API
  conectada neste ambiente).

## Fase F — Recebimento de áudio/imagem/documento/localização/contato (seção 13)

`src/lib/whatsapp/mediaDownloader.ts` — download seguro (timeout de 15s,
limite de 15 MB, só URLs `http(s)`) da mídia que a Z-API manda no próprio
payload do webhook. **A URL nunca é exposta de volta ao usuário nem
aparece em texto puro salvo** — só os bytes baixados (ou o metadado
`fileName`/`mimeType`) são persistidos.

`gerarRespostaAssistente` ganhou um parâmetro opcional
`conteudoMultimodal` (blocos extras só para a rodada atual, nunca
persistidos como binário no histórico) — 100% compatível com o chat web,
que nunca usa esse campo.

Por tipo de mensagem recebida no WhatsApp:

| Tipo | Comportamento |
|---|---|
| Texto | Fluxo normal (Fases A-E) |
| Imagem (JPEG/PNG/GIF/WebP) | Baixada e enviada como imagem de verdade para a Claude (visão nativa) — a IA pode responder sobre o conteúdo da foto |
| Documento PDF | Baixado e enviado como documento nativo para a Claude (leitura de PDF nativa) |
| Documento não-PDF (planilha, Word etc.) | Recebido, registrado (`content_type`/`metadata` em `messages`), mas o conteúdo **não é interpretado** — resposta explica a limitação |
| Áudio | Recebido e registrado, mas **não transcrito** — resposta explica a limitação |
| Localização | Convertida em texto descritivo (latitude/longitude/endereço) e enviada à IA normalmente |
| Contato (vCard) | Convertido em texto descritivo (nome + telefone extraído do vCard) e enviado à IA normalmente |

Nenhuma tabela nova: tudo usa `messages.content_type`/`messages.metadata`,
colunas que já existiam desde a Camada 3 e nunca eram usadas para nada
além do padrão `'text'`.

### Por que áudio e planilhas não são interpretados nesta fase

A API da Claude (Messages API) não tem um modo nativo de entrada de áudio
— transcrever voz exigiria uma API de terceiros (speech-to-text) que não
faz parte de nenhuma integração já aprovada neste projeto, e adicionar uma
adicionaria custo/dependência nova fora do escopo desta fase. Parsing de
planilha (xlsx/csv) também exigiria uma lib de parsing dedicada. Ambos
ficam registrados como próximo passo, não como funcionalidade quebrada —
o usuário sempre recebe uma explicação clara, nunca silêncio.

### Limitações conhecidas desta fase

- Sem OCR dedicado — a leitura de imagem/PDF depende inteiramente da
  visão/leitura de documento nativa da Claude, sem pré-processamento.
- Não testado com mídia real da Z-API neste ambiente (mesma limitação de
  todas as fases anteriores) — validado por `tsc`/`lint`/`build` e leitura
  de código.

## Fase H — Onboarding com listas/botões nativos e novas perguntas (região, rota fixa)

Redesenho do roteiro de onboarding (identidade permanece obrigatória e
curta; detalhe de configuração de veículo/implemento continua fora daqui —
progressivo, perguntado pela IA sob demanda quando uma ferramenta precisar,
não implementado nesta fase):

- **Novo enum** `onboarding_state`: `awaiting_region` e `awaiting_fixed_route`,
  entre `awaiting_base_location` e `awaiting_vehicle_count` (migration
  `add_region_fixed_route_to_onboarding_state`).
- **Pergunta de perfil** (`awaiting_profile`) deixou de aceitar só texto
  livre: agora envia uma **lista nativa do WhatsApp** (`sendWhatsappOptionList`,
  endpoint `send-option-list` da Z-API) com 5 opções (motorista autônomo,
  apenas motorista, dono de empresa, gestor de frota, transportador). Texto
  livre continua funcionando como *fallback* (`parseCompanyType` primeiro
  tenta casar pelo `id` da opção, depois cai na heurística de texto de
  sempre) — importante para quem responde por engano em texto em vez de
  tocar na lista.
- **Pergunta de rota fixa** (`awaiting_fixed_route`, nova): **botões nativos**
  Sim/Não (`sendWhatsappButtons`, endpoint `send-button-actions`, tipo
  `REPLY`), mesmo princípio de fallback em texto (`parseFixedRoute`).
- **Região de atuação** (`awaiting_region`, nova): texto livre, sem lista —
  a variação de resposta (estados, corredores, "Sudeste todo") não cabe bem
  numa lista fechada de até 10 itens.
- `zapiClient.ts` ganhou `sendWhatsappOptionList`/`sendWhatsappButtons`. O
  webhook resolve a entrada do onboarding em ordem de prioridade:
  `listResponseMessage.selectedRowId` → `buttonsResponseMessage.buttonId` →
  `text.message` (`resolverEntradaOnboarding`), e envia a `reply` (agora um
  tipo estruturado `OnboardingReply` com `kind: "text" | "list" | "buttons"`,
  não mais uma string solta) pelo método certo (`enviarRespostaOnboarding`).
- **Região** e **rota fixa** viram `ai_memories` estruturadas
  (`operating_region`, `has_fixed_route`) em `finalizeOnboarding.ts` — mesmo
  padrão já usado para `fleet_vehicle_count`, nenhuma coluna nova em
  `companies`.
- **Mensagem de conclusão** reforçada com exemplos concretos de uso
  (incluindo lembrete/Agenda), para tornar a integração com Google Calendar
  descobrível sem forçar a conexão durante o cadastro — a lógica de
  conexão em si (reativa, só quando a IA precisa mesmo da ferramenta)
  não mudou.

### Limitações conhecidas desta fase

- Não testado com tráfego real de lista/botão via Z-API neste ambiente
  (mesma limitação de todas as fases anteriores) — `tsc`/`lint`/`build`
  limpos, formato de payload de envio e de webhook confirmado contra a
  documentação oficial da Z-API, não contra uma resposta real de usuário.
- Configuração detalhada de veículo (tipo: toco/truck/bitruck/cavalo
  mecânico + implemento, quando aplicável) **não foi implementada** — fica
  como próximo passo, disparado pela IA quando uma ferramenta que precisa
  desse dado for usada (ex.: comparar pneus, calcular CPK), não durante o
  onboarding.

## Fase I — Piso mínimo ANTT e busca em fontes oficiais (ANP/legislação)

Implementa os itens 5 (ANTT), 6 (ANP) e 7 (legislação/fontes oficiais) de
uma lista de integrações que o Rafael avaliou item a item contra o código
real antes de decidir o que construir (ver checklist completo na memória
do projeto). Decisão: nada de RAG/base de conhecimento própria — busca em
tempo real restrita a domínios oficiais, seguindo o mesmo padrão que o
Jão iAgro usa (Perplexity API) só que com a ferramenta nativa da própria
Claude API.

- **Nova ferramenta `verificar_piso_minimo_antt`** (16ª ferramenta,
  `src/ai/tools/verificar-piso-minimo-antt.ts`): calcula o piso mínimo
  **legal** de frete (Lei 13.703/2018, fórmula pública da ANTT:
  `distância × CCD + CC`, mais 0,92 × distância de retorno × CCD se houver
  retorno vazio). **Nunca inventa o CCD/CC** — são sempre entrada
  obrigatória, nunca uma tabela hardcoded (ficaria desatualizada a cada
  resolução nova, e um piso errado tem consequência legal real). Ver
  `src/ai/tools/README.md` para detalhe completo, incluindo por que essa
  decisão é deliberada.
- **Ferramenta de busca web nativa da Claude** (`web_search_20260209`,
  `construirFerramentaBuscaOficial()` em `src/lib/anthropic/tools.ts`) —
  diferente das 16 ferramentas internas, roda server-side na própria
  Anthropic, restrita por `allowed_domains` a uma lista curada de domínios
  oficiais (ANTT, ANP, Planalto, DOU/in.gov.br, DNIT, SENATRAN, LexML).
  Usada pela IA para: (1) encontrar o CCD/CC vigente antes de chamar
  `verificar_piso_minimo_antt`; (2) preço de referência de combustível da
  ANP — sempre contextual, nunca substitui o preço informado/salvo do
  cliente; (3) perguntas gerais de legislação/trânsito.
- `gerarRespostaAssistente.ts`: `tools` passou a combinar as 16 ferramentas
  internas + a ferramenta de busca; o loop de tool use ganhou tratamento de
  `stop_reason: "pause_turn"` (limite interno de 10 iterações de busca da
  própria Anthropic) — reenvia a conversa pra continuar, sem exigir
  `tool_result` (só as ferramentas internas passam por esse fluxo).
- `verificar_piso_minimo_antt` adicionado ao enum `frota_ia_tool_name`
  (migration) e ao Zod `frotaIaToolNameSchema`, e às ferramentas "de
  análise" (gera `analysis_runs`, pesquisável depois por
  `consultar_historico` e referenciável por `gerar_documento`) — mesmo
  tratamento das 11 ferramentas de cálculo puro.

### Limitações conhecidas desta fase

- Não testado com busca real neste ambiente (mesma limitação de todas as
  fases anteriores que dependem de integração externa) — `tsc`/`lint`/
  `build` limpos, formato do parâmetro (`allowed_domains`, `max_uses`) e
  do tipo `WebSearchTool20260209` confirmados pelo próprio compilador
  TypeScript contra o SDK oficial, não por execução real.
- `verificar_piso_minimo_antt` não busca o CCD/CC sozinha — depende da IA
  chamar `web_search` antes e passar o valor encontrado. Se a IA não
  encontrar um valor claro na busca, o comportamento esperado (reforçado
  no system prompt) é avisar o usuário, nunca estimar.
- Google Maps/Routes (item 2), pedágios/Maplink (item 3) continuam fora de
  escopo — não implementados nesta fase, por decisão do Rafael.

## Fase J — Google Maps Platform (Geocoding API + Routes API)

Implementa o item 2 da checklist de integrações do Rafael (ver memória do
projeto). Diferente do Google Calendar (Camada 4, OAuth por cliente), usa
uma **chave de API única do servidor** (`GOOGLE_MAPS_API_KEY`) — não
depende de nenhum login/autorização do cliente. Custo confirmado antes de
implementar: 10.000 chamadas grátis/mês por API (Geocoding e Routes),
depois US$5/1000 até 100k.

- **`src/lib/google/mapsConfig.ts`** — mesmo padrão de `config.ts`
  (Calendar): `isGoogleMapsConfigured()`/`getGoogleMapsConfig()`, nunca
  vaza valor de variável em erro.
- **`src/lib/google/mapsClient.ts`** — cliente mínimo via fetch direto
  (sem SDK), com duas funções: `geocodificarEndereco` (Geocoding API,
  devolve `null` em `ZERO_RESULTS` — não é erro, é resultado válido de
  "não achei") e `calcularRota` (Routes API `computeRoutes`, sempre com
  coordenadas — nunca endereço em texto direto pra Routes, porque o
  formato de campo `address` daquela API não foi verificado contra a
  documentação oficial antes de implementar).
- **Nova ferramenta `consultar_rota`** (17ª ferramenta,
  `src/ai/tools/consultar-rota.ts`) — ferramenta de integração (I/O,
  `executar` assíncrona, mesmo padrão de `gerenciar_google_calendar`).
  Modos: `GEOCODIFICAR_ENDERECO` (localizar/confirmar um endereço) e
  `CALCULAR_DISTANCIA_ROTA` (geocodifica origem e destino, depois calcula
  distância/duração). Alimenta `distanciaKm` nas outras ferramentas
  (`calcular_custo_viagem`, `analisar_frete`, `verificar_piso_minimo_antt`
  etc.) sem o motorista precisar informar o km manualmente.
- `consultar_rota` adicionado ao enum `frota_ia_tool_name` (migration) e
  ao Zod `frotaIaToolNameSchema`. **Não** entra em `FERRAMENTAS_DE_ANALISE`
  (é consulta/utilidade, não uma análise financeira — mesmo tratamento de
  `gerenciar_google_calendar`/`consultar_historico`).
- System prompt atualizado: usar `consultar_rota` antes de pedir distância
  manualmente quando o usuário informar origem/destino em texto; se a
  ferramenta falhar (endereço não encontrado ou integração não
  configurada), pedir a distância direto ao usuário — nunca estimar de
  memória geográfica.

### Limitações conhecidas desta fase

- Não testado com chamada real à Google Maps Platform neste ambiente
  (`GOOGLE_MAPS_API_KEY` pendente de configuração) — `tsc`/`lint`/`build`
  limpos, formato de request/response da Geocoding API e da Routes API
  (`computeRoutes`) confirmado contra a documentação oficial do Google,
  não por execução real.
- Rota calculada é a sugestão padrão do Google Maps para veículos de
  passeio — não considera restrições específicas de caminhão (altura,
  peso, rotas proibidas). Isso já vem explicitado em `limitacoes` no
  resultado da ferramenta, para a IA repassar ao usuário.
- Item 3 (pedágio, Maplink) continua bloqueado — precisa de uma rota
  calculada (polyline) como entrada, que esta fase entrega só como
  distância/duração agregada, não como geometria de rota. Se/quando o
  item 3 avançar, `calcularRota` provavelmente precisa devolver também
  `polyline.encodedPolyline` (já suportado pela Routes API, só não pedido
  no fieldMask atual).

## Fase K — Transcrição de áudio (OpenAI)

Resolve a maior lacuna registrada desde o início do projeto: mensagens de
voz chegavam e só geravam a resposta "ainda não consigo entender áudio".
Decisão explícita do Rafael (após discutir se valeria trocar toda a IA
pra OpenAI pra evitar duas APIs): **manter a Claude como o único
"cérebro"** (entende, decide ferramenta, calcula, responde) e usar a
OpenAI só para a conversão áudio→texto — nada além disso. Justificativa:
o Jão iAgro (referência de mercado) já usa 6+ provedores diferentes por
trás de um "cérebro" principal; duas APIs não é incomum nem incorreto, e
trocar a Claude pelo GPT como cérebro custaria muito mais (reconstruir
prompt, ferramentas, disciplina de "nunca inventar dado" já validada) do
que vale só para evitar uma segunda chave de API.

- **`src/lib/openai/whisperConfig.ts` / `whisperClient.ts`** — mesmo
  padrão de fetch direto (sem SDK) já usado em `calendarClient.ts`,
  `zapiClient.ts` e `mapsClient.ts`. Chama
  `POST api.openai.com/v1/audio/transcriptions` com o modelo
  `gpt-4o-mini-transcribe` (mais barato que o Whisper clássico,
  ~US$0,003/minuto), `language: "pt"`.
- **`src/app/api/whatsapp/webhook/route.ts`** (branch `else if (body.audio)`):
  se `OPENAI_API_KEY` não estiver configurada, mantém o comportamento
  antigo (explica a limitação). Se estiver, baixa o áudio
  (`baixarMidia`, já existia da Fase F) e transcreve; o texto resultante
  vira `mensagemUsuario` normal, seguindo o mesmo fluxo de qualquer
  mensagem digitada (mesma IA, mesmas 17 ferramentas) — a OpenAI não
  participa de mais nada depois de devolver o texto. Se a transcrição
  falhar (áudio incompreensível, erro de rede, formato rejeitado), avisa
  o usuário e pede pra tentar de novo ou escrever — nunca falha em
  silêncio.

### Limitações conhecidas desta fase

- **Formato de áudio não validado com teste real.** O WhatsApp manda
  `.ogg` com codec Opus; a documentação oficial da OpenAI não confirma
  esse formato de forma inequívoca (relatos de desenvolvedores variam
  entre "funciona direto" e "precisa converter"). Só será confirmado
  testando com um áudio real depois do deploy — se a API rejeitar o
  formato, o próximo passo seria adicionar conversão (ex.: reencodar para
  mp3/wav) antes de enviar.
- Não testado com áudio real neste ambiente — `tsc`/`lint`/`build`
  limpos, formato de request (multipart `FormData`) confirmado contra a
  documentação oficial da OpenAI, não por execução real.
- Sem retry automático em caso de falha de transcrição — o usuário
  precisa reenviar manualmente.

## Fase L — `web_fetch` para leitura completa de fontes oficiais (correção pós-teste real)

Testando `verificar_piso_minimo_antt` com tráfego real do Rafael (mensagem
pedindo o piso mínimo pra carga geral, 5 eixos), `web_search` sozinha não
conseguiu extrair o CCD/CC — trouxe resumo/estrutura de outras
combinações, não o valor exato pedido. A IA reagiu corretamente (não
inventou o número, pediu confirmação ao usuário), mas isso não entrega o
valor automaticamente como pretendido.

**Diagnóstico confirmado manualmente**: a página da Resolução ANTT em
vigor (`anttlegis.antt.gov.br`) **tem** a tabela completa de coeficientes
embutida como texto — `calculadorafrete.antt.gov.br` (a calculadora
interativa) é que provavelmente não é fetchável por ser um app
JavaScript. `web_search` só devolve resumo/trecho da página, insuficiente
pra ler um valor de dentro de uma tabela grande.

**Correção**: nova ferramenta `construirFerramentaLeituraOficial()`
(`web_fetch_20260209`, mesma lista de domínios oficiais,
`max_content_tokens: 8000`) adicionada ao array de `tools` em
`gerarRespostaAssistente.ts`, ao lado de `web_search`. Fluxo agora
esperado (reforçado no system prompt): buscar primeiro pra achar a URL
exata da resolução vigente, depois ler essa URL por completo com
`web_fetch` antes de extrair o CCD/CC e chamar
`verificar_piso_minimo_antt`.

### Limitações conhecidas desta fase

- Não retestado com tráfego real após esta correção — `tsc`/`lint`/
  `build` limpos, e o achado de que anttlegis.antt.gov.br tem a tabela em
  texto foi confirmado manualmente via WebFetch nesta sessão, mas o fluxo
  busca→leitura completa dentro do loop de tool use da produção ainda não
  foi validado ponta a ponta.
- `web_fetch` só lê uma URL que já apareceu na conversa (limitação da
  própria ferramenta da Claude) — por isso depende de `web_search` rodar
  primeiro; não funciona como ferramenta isolada.

## Fase M — Estender o fluxo busca→leitura completa pra ANP/legislação

Testando com tráfego real: legislação (Lei do Motorista) funcionou de
primeira só com `web_search`. ANP (preço do diesel) teve o mesmo padrão
já visto na ANTT — a IA não inventou o preço da semana atual (achou só
dados de março/maio, disse isso claramente e recomendou o link oficial),
mas não entregou o dado mais recente sozinha.

**Correção**: só texto no system prompt, nenhuma ferramenta nova — a
`web_fetch` já estava disponível pra todos os domínios oficiais desde a
Fase L, só faltava instruir explicitamente esse mesmo fluxo (buscar
primeiro, `web_fetch` na página mais relevante se a busca só trouxer
resumo/dado desatingido) também pra ANP/legislação, não só pra ANTT.

### Limitações conhecidas desta fase

- Não retestado com tráfego real após esta correção específica.

## Fase N — Polyline no `consultar_rota` (preparação pro item 3)

`calcularRota` (mapsClient.ts) passou a pedir também
`routes.polyline.encodedPolyline` no fieldMask da Routes API — mesma
chamada, sem custo adicional. `consultar_rota` expõe isso como
`polylineCodificada` no resultado. Nenhuma ferramenta consome esse campo
ainda; é preparação para o item 3 (pedágio, Maplink Toll API), que
precisa de uma rota já calculada (geometria) como entrada — a Toll API
não calcula rota sozinha.

**O que ainda falta pro item 3 de verdade**: Rafael criar conta na
Maplink e contratar a Toll API; e obter o schema real de request/response
dela (não documentado publicamente em detalhe) antes de escrever a
integração — mesmo princípio de nunca implementar contra uma API sem
schema verificado, já aplicado ao Google Maps e à ANTT.

## Fase G — Testes e entrega final

`npx tsc --noEmit`, `npm run lint` e `npm run build` limpos em cada fase
(A a F), sempre antes do commit. Além disso, três lotes de teste
executados de verdade nesta fase (não é papel — resultado real reproduzido
abaixo):

### 1. Máquina de estados do onboarding (`npx tsx`, 20 asserções, todas passaram)

Cobre: mensagem inicial pede só o nome (uma pergunta por vez); fluxo
completo nome → perfil → base → frota → veículo, cada resposta avançando
o estado certo e salvando o dado certo; mapeamento de perfil livre
("sou motorista autônomo") para o enum `company_type`; parsing de
"Curitiba, PR" em cidade+UF; parsing de quantidade em número; pular o
veículo principal ainda finaliza; `cancelar` pausa em qualquer etapa;
retomar depois de pausado pula direto para a pergunta que falta (não
reinicia do zero).

### 2. Deduplicação de mensagem (SQL real contra o Supabase, dentro de uma transação com rollback — nenhum dado ficou no banco)

Inseri a mesma `external_message_id` duas vezes em `messages`: a segunda
tentativa falhou com `23505 duplicate key value violates unique
constraint "idx_messages_external_message_id"` — exatamente o código que
`isUniqueViolation()` reconhece no webhook para não reenviar resposta.
Confirmado depois que zero linhas de teste ficaram no banco.

### 3. Geração de PDF (Node real, não simulado)

`pdf-lib` gerando um PDF de 867 bytes com cabeçalho `%PDF-` válido neste
ambiente — ver Fase D.

### Cobertura dos 9 testes obrigatórios do prompt original

| # | Cenário | Status |
|---|---|---|
| 1 | Usuário novo → onboarding iniciado | Mensagem inicial testada (acima); criação de usuário via Admin API verificada por leitura de código, não executável sem instância Z-API real |
| 2 | Onboarding até `completed` | **Testado de verdade** (acima) |
| 3 | Usuário retorna, é reconhecido | Verificado por leitura de código (`session.state === 'completed'` pula onboarding) — não executado ponta a ponta |
| 4 | Conectar Google pelo WhatsApp | Geração do link reaproveita código já testado na Camada 4; a decisão da IA de chamar a ferramenta ao ouvir "conecte minha agenda" depende de uma chamada real à Claude, não testável aqui |
| 5 | Criar alerta | Ferramenta e rota de disparo com tipos corretos e build limpo; sem cron real neste ambiente para dispersar de verdade |
| 6 | Buscar histórico | Lógica de busca e o fix de `analysis_runs` verificados por leitura de código; sem dado real de produção para consultar |
| 7 | Gerar PDF | **Geração testada de verdade** (acima); envio real pela Z-API não testado |
| 8 | Painel bloqueado com `CUSTOMER_PANEL_ENABLED=false` | Lógica compilada e presente nas rotas (`/` e `/onboarding`); não executado contra uma sessão real logada |
| 9 | Mensagem duplicada | **Testado de verdade** (acima) |

**Por que não dá pra ir além disso neste ambiente**: os testes 1, 3, 4, 5,
6 e 8 exigem pelo menos um destes três: uma instância Z-API real enviando
webhooks, uma chamada de verdade à Claude API decidindo qual ferramenta
chamar, ou uma sessão de navegador autenticada contra o deploy em
produção — nenhum dos três está disponível neste sandbox de
desenvolvimento. Isso é consistente com a mesma limitação já registrada em
todas as fases anteriores (Camada 3, 4, 5) desta sessão.
