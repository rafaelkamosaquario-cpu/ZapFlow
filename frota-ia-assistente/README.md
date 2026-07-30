# Frota IA Assistente

Especialista virtual em transporte e gestão de frotas.

Projeto construído do zero (não reaproveita código do ZapFlow que vive na raiz
deste repositório — inclusive tem projeto Supabase próprio e isolado).

Estado atual por camada:

- **Chat (Fase 2)**: login obrigatório (`/login`) + onboarding
  (`/onboarding`, criar empresa e cadastrar veículo) antes de liberar `/`.
  O chat fala de verdade com a Claude API (tool use com as 12 ferramentas)
  e persiste no Supabase — ver
  [`docs/fase-2-chat-e-onboarding.md`](./docs/fase-2-chat-e-onboarding.md).
  **Não testado ponta a ponta**: faltam `ANTHROPIC_API_KEY` e as
  credenciais do Google Cloud (login e Calendar).
- **Ferramentas internas**: 14 ferramentas em `src/ai/tools/` — 11 de
  cálculo puro + `gerenciar_google_calendar`, `consultar_historico` e
  `gerenciar_alerta` (integrações externas). Documentadas em
  `src/ai/tools/README.md`.
- **Camada 3 — Supabase (identidade, dados, memória)**: schema V1 criado e
  aplicado no projeto Supabase `frotaia`, com RLS, services e camada de
  contexto para as ferramentas. Documentação completa em
  [`docs/camada-3-supabase.md`](./docs/camada-3-supabase.md).
- **Camada 4 — Google Calendar**: OAuth próprio, refresh token no Supabase
  Vault. Documentação em
  [`docs/camada-4-google-calendar.md`](./docs/camada-4-google-calendar.md).
  Pendente das credenciais do Google Cloud.
- **Camada 5 — WhatsApp (Z-API)**: segundo canal, instância própria
  (separada do ZapFlow). Webhook de entrada + vínculo de número usam a
  mesma engine de chat da Fase 2. Documentação em
  [`docs/camada-5-whatsapp-zapi.md`](./docs/camada-5-whatsapp-zapi.md).
  Pendente da instância Z-API dedicada ao Frota IA.
- **Camada 6 — V1 centrada no WhatsApp (em andamento, por fases)**: número
  desconhecido no WhatsApp cria conta e faz onboarding conversacional
  (uma pergunta por vez) sem precisar do painel. Painel web preservado no
  código, mas atrás da flag `CUSTOMER_PANEL_ENABLED` (só admins entram na
  V1). Diagnóstico completo, o que já está pronto e o que falta em
  [`docs/camada-6-whatsapp-v1.md`](./docs/camada-6-whatsapp-v1.md).

## Stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack)
- [TypeScript](https://www.typescriptlang.org)
- [Tailwind CSS 4](https://tailwindcss.com)
- [lucide-react](https://lucide.dev) (ícones)
- [next-themes](https://github.com/pacocoursey/next-themes) (modo claro/escuro)

- [@supabase/ssr](https://supabase.com/docs/guides/auth/server-side/nextjs) e [@supabase/supabase-js](https://supabase.com/docs/reference/javascript) (Camada 3)
- [Zod](https://zod.dev) (validação de entrada antes de qualquer insert/update no Supabase)

A API de IA (Claude) ainda não foi conectada — isso é a Fase 2. Banco de
dados e autenticação **já existem** (Camada 3, Supabase), mas ainda não são
usados pela tela de chat em si (que continua 100% Fase 1 por enquanto).

## Como rodar localmente

```bash
cd frota-ia-assistente
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

Outros scripts:

```bash
npm run build   # build de produção
npm run start   # roda o build de produção
npm run lint    # eslint
```

## Estrutura de pastas

```
frota-ia-assistente/
├── src/
│   ├── app/                    # rotas (App Router)
│   │   ├── layout.tsx          # fontes, metadata, providers (tema/toast)
│   │   ├── page.tsx            # tela única do assistente
│   │   ├── icon.tsx            # favicon gerado (logo)
│   │   ├── globals.css         # tokens de design (cores, animações)
│   │   └── auth/callback/      # callback do OAuth (Google via Supabase Auth)
│   ├── components/
│   │   ├── ui/                 # Button, Input, Textarea, Card, Loading,
│   │   │                       # EmptyState, Toast, Modal, Dialog
│   │   ├── layout/              # Header, Sidebar (desktop), MobileSidebar
│   │   │                        # (menu retrátil), SidebarContent, ThemeToggle
│   │   ├── chat/                # ChatWindow, MessageList, MessageBubble,
│   │   │                        # ChatInput, SuggestionCards, TypingIndicator,
│   │   │                        # WelcomeScreen
│   │   ├── icons/                # Logo (marca Frota IA)
│   │   └── providers/            # ThemeProvider, ToastProvider
│   ├── hooks/                   # useChat, useConversations, useLocalStorage,
│   │                             # useMediaQuery, useToast, useHasMounted
│   ├── ai/
│   │   ├── tools/                # as 11 ferramentas puras de cálculo (ver
│   │   │                         # src/ai/tools/README.md)
│   │   └── context/               # ponte Supabase → ferramentas
│   │                               # (loadCustomerContext, saveToolExecution…)
│   ├── services/
│   │   ├── aiService.ts, chatService.ts, messageService.ts
│   │   │                         # (Fase 1: interfaces vazias, prontas p/ Fase 2)
│   │   └── supabase/              # 1 service por domínio (profile, company,
│   │                               # vehicle, memory, conversation, google…)
│   ├── types/                    # ChatMessage, Conversation, SuggestionPrompt
│   ├── lib/
│   │   ├── utils.ts, constants.ts, mock-data.ts
│   │   ├── supabase/              # client.ts, server.ts, admin.ts,
│   │   │                          # database.types.ts (gerado), tables.ts, json.ts
│   │   └── validation/            # schemas.ts (Zod)
│   └── proxy.ts                  # refresh de sessão Supabase a cada requisição
│                                   # (convenção "proxy" desta versão do Next 16,
│                                   # substitui o antigo middleware.ts)
├── supabase/
│   ├── config.toml
│   └── migrations/                # 7 migrations versionadas da Camada 3
├── docs/
│   └── camada-3-supabase.md       # documentação completa da Camada 3
└── public/                       # assets estáticos
```

## Telas e componentes

A aplicação abre direto no assistente — uma única tela, sem login ou painel.

- **Header**: logo + nome, botão "Nova conversa", alternância de tema, botão
  de menu (mobile).
- **Tela de boas-vindas**: aparece antes da primeira mensagem, com 6 cartões
  de sugestão ("Analisar um frete", "Calcular consumo", "Calcular CPK",
  "Comparar pneus", "Reduzir custos", "Custos da frota"). Clicar num cartão
  apenas preenche o campo de texto — nenhuma ação é executada.
- **Conversa**: mensagens do usuário e do assistente, indicador de "digitando"
  animado e resposta fixa: *"Em breve este assistente será conectado à
  inteligência artificial."*
- **Campo de mensagem**: textarea que cresce automaticamente, envia com
  Enter (Shift+Enter para nova linha).
- **Sidebar (desktop) / menu retrátil (mobile)**: histórico de conversas
  simulado (persistido em `localStorage`), com opções de selecionar, criar
  nova conversa e excluir (com diálogo de confirmação).
- **Modo claro/escuro**: alternância manual no header, com preferência do
  sistema como padrão.

## Arquitetura proposta

- **Estado local, sem backend.** `useConversations` guarda o histórico em
  `localStorage`; `useChat` cuida do envio de mensagens e simula a resposta
  do assistente com um `setTimeout`.
- **Camada de serviços já desenhada para a Fase 2**, mas sem implementação:
  - `aiService.requestAICompletion` — vai chamar a Claude API.
  - `chatService` — vai persistir conversas (API + banco).
  - `messageService` — fábrica de mensagens (já usada nesta fase, localmente).
  Essas funções hoje só lançam um erro "ainda não implementado (Fase 2)".
  A ideia é que `useChat` troque o `setTimeout` por uma chamada real a
  `aiService` sem precisar mexer em nenhum componente visual.
- **Design tokens em `globals.css`** (`--primary`, `--surface`, `--border`,
  etc.) com variante `.dark` — qualquer componente novo herda o tema
  automaticamente.
- **Componentes de UI genéricos** (`src/components/ui`) não conhecem nada de
  "frota" ou "chat" — podem ser reaproveitados em telas futuras.

## Próximos passos

1. Implementar `aiService.requestAICompletion` com a Claude API (Fase 2 do
   chat) e conectá-la à camada de contexto da Camada 3
   (`src/ai/context/customerContext.ts`) e às 11 ferramentas.
2. Trocar o `setTimeout` de `useChat` pela chamada real ao serviço.
3. Persistir conversas de verdade via `src/services/supabase/conversationService.ts`,
   substituindo o `localStorage`.
4. Streaming de resposta (mensagem do assistente aparecendo token a token).
5. UI de onboarding (criar empresa, cadastrar veículo) sobre os services já
   prontos da Camada 3.
6. Ver [`docs/camada-3-supabase.md`](./docs/camada-3-supabase.md), seção
   "Próximos passos (Camada 4)", para o restante do backlog de dados.
