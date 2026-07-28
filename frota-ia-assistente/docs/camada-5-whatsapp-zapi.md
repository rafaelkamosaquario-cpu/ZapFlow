# Camada 5 — WhatsApp (Z-API)

Segundo canal do Frota IA, além da dashboard web: mensagens de WhatsApp
chegam por uma instância Z-API própria (separada da instância do ZapFlow,
o outro app deste repositório) e são respondidas pela mesma engine de chat
da Fase 2 — nenhuma lógica de IA/ferramentas foi duplicada.

## 1. Motor de resposta compartilhado

O loop de tool use que já existia só em `src/app/api/chat/route.ts` foi
extraído para `src/ai/chat/gerarRespostaAssistente.ts`. A rota da web e o
webhook do WhatsApp chamam a mesma função — a diferença é só como cada um
chega até `userId`/`companyId`/`conversation`:

- **Web**: sessão do Supabase Auth (`supabase.auth.getUser()`), client com
  RLS.
- **WhatsApp**: não existe sessão de navegador. O número que mandou a
  mensagem é resolvido via `user_channels` (client admin, bypassa RLS —
  só código de webhook usa esse client, nunca UI).

## 2. Vínculo do número (WhatsApp-first)

Como o WhatsApp pode ser o primeiro contato (antes de qualquer login), o
fluxo para um número desconhecido é:

1. Mensagem chega em `/api/whatsapp/webhook` de um `phone` sem registro em
   `user_channels`.
2. O webhook responde com um link assinado (`buildWhatsappConnectLink`,
   `src/services/whatsapp/whatsappConnectLink.ts`, HMAC com
   `WHATSAPP_WEBHOOK_SECRET`, expira em 15 minutos) e a URL do site para
   quem ainda não tem conta.
3. O usuário cria a conta / faz login no site (Google, via Supabase Auth —
   Camada 3) e abre o link recebido.
4. `src/app/auth/whatsapp/connect/route.ts` confirma o vínculo
   (`linkChannel`, já existente desde a Camada 3) e volta pra `/`.
5. Da próxima vez que esse número mandar mensagem, `user_channels` resolve
   direto para o usuário — sem link de novo.

Se o número já está vinculado mas o cadastro (empresa/veículo) não foi
concluído, o webhook responde pedindo para terminar o onboarding no site
em vez de tentar adivinhar os dados.

## 3. Webhook de entrada

`src/app/api/whatsapp/webhook/route.ts` — POST chamado pelo Z-API a cada
mensagem recebida na instância.

- Autenticação: token na query string (`?token=`) comparado em tempo
  constante com `WHATSAPP_WEBHOOK_SECRET` — a Z-API não assina o corpo da
  requisição, então esse token (definido só entre você e o seu próprio
  servidor, colado na URL configurada no painel do Z-API) é a única
  validação de origem.
- Ignora `fromMe: true` (eco da própria instância) e mensagens sem `text`
  (áudio, imagem etc. — responde só avisando a limitação, não falha
  silenciosamente).
- Reentrega do mesmo webhook (`messageId` repetido) é deduplicada pelo
  índice único `idx_messages_external_message_id` já existente desde a
  Camada 3 — a segunda tentativa não gera uma segunda resposta.
- Sempre responde `200` para a Z-API (mesmo em erro interno) — evita retry
  agressivo por parte do Z-API; o usuário recebe uma mensagem de erro
  amigável por WhatsApp em vez de silêncio.

## 4. Envio de mensagem

`src/lib/whatsapp/zapiClient.ts` — chamada HTTP direta ao endpoint
`send-text` da Z-API (mesmo padrão de "sem SDK oficial" já usado para o
Google Calendar em `src/lib/google/calendarClient.ts`). Envio é
best-effort: se a Z-API estiver fora do ar, a falha é engolida
(`.catch(() => {})`) para não travar o processamento da mensagem recebida.

## 5. O que é PRÓPRIO do Frota IA (não reaproveita o ZapFlow)

- Instância e número Z-API — crie uma instância nova, dedicada.
- Variáveis de ambiente próprias (`ZAPI_*` e `WHATSAPP_WEBHOOK_SECRET` —
  ver `.env.example`), mesmo nome de variável do ZapFlow (`ZAPI_INSTANCE_ID`
  etc.) mas **valores diferentes**, porque são serviços/deploys Railway
  separados — não há conflito por estarem em apps distintos.
- Nenhuma tabela nova no Supabase: `user_channels`, `conversations` e
  `messages` já existiam desde a Camada 3, preparadas exatamente para isso
  (`channel_id`, `external_message_id`, `provider: 'z_api'`).

## 6. O que NÃO foi testado (sem credenciais neste ambiente)

- Recebimento real de mensagem via Z-API (exige instância configurada com
  a URL do webhook apontando para um domínio público — não existe ainda,
  ver deploy do Railway).
- Envio real de resposta.
- Fluxo completo de vínculo de número ponta a ponta.

`npx tsc --noEmit`, `npm run lint` e `npm run build` foram verificados
limpos.
