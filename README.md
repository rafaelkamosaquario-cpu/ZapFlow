# 🤖 ZapFlow

Aplicativo web para **disparar mensagens de texto e imagem pelo WhatsApp** usando a
[**Z-API**](https://z-api.io) e uma **lista de contatos em Excel** (`.xlsx`/`.csv`)
ou inserida manualmente. Mascote: **Zappy** 🟢.

## ✨ Funcionalidades

- 🔌 Conecta à sua instância da **Z-API** (com teste de conexão; Passo 1 recolhível)
- 📊 Importa contatos de **Excel** (detecta `Telefone`, `Celular`, `WhatsApp`, `Número`, `Nome`)
  **ou** adiciona contatos manualmente (nome + telefone)
- ✅ Normaliza e valida os números (adiciona o DDI `55` do Brasil quando necessário)
- 💬 Envia **texto** e/ou **até 3 imagens** por mensagem (da galeria/foto ou por URL)
- 🏷️ Personalização com `{{nome}}` (com botão de atalho **+ nome**)
- ⏱️ Intervalo configurável **em segundos** (1–60), com aviso de risco de bloqueio
- 📈 Progresso em tempo real + **histórico de envios** (com os números e quem respondeu)
- 📅 **Agendamento** com data e horário (o servidor envia sozinho na hora marcada)
- ✉️ Até **5 mensagens independentes**, cada uma com seu texto, imagem e horário
- 📑 **Modelos de mensagem** salvos (até 10) para reutilizar
- 📊 **Painel/Dashboard** navegável: Visão Geral, Clientes (CRM), Campanhas,
  Respostas e Follow-up
- 👥 **CRM-lite**: base de clientes que cresce sozinha (tags, etapas/funil, anotações)
  e disparo para segmentos filtrados
- 🔒 **Login simples** opcional (usuário/senha via `.env`)
- 📱 Interface responsiva — funciona no **celular** (veja o deploy no Railway)

## 🚀 Como rodar

### 1. Pré-requisitos
- [Node.js](https://nodejs.org) 18 ou superior
- Uma conta na [Z-API](https://app.z-api.io) com uma instância criada e o WhatsApp conectado

### 2. Instalação

```bash
npm install
```

### 3. (Opcional) Configurar credenciais no servidor

Copie o arquivo de exemplo e preencha com os dados da sua instância:

```bash
cp .env.example .env
```

```env
ZAPI_INSTANCE_ID=seu_id_da_instancia
ZAPI_INSTANCE_TOKEN=seu_token_da_instancia
ZAPI_CLIENT_TOKEN=seu_client_token_de_seguranca

# Login simples (opcional). Preencha AMBOS para exigir login:
APP_USER=seu_usuario
APP_PASSWORD=sua_senha
```

> Se preferir, você pode digitar as credenciais da Z-API direto na interface — elas
> ficam salvas apenas no seu navegador.

### 🔒 Login simples

Se você definir `APP_USER` **e** `APP_PASSWORD` no `.env`, o app passa a exigir login
(tela com o Zappy). A sessão dura **8 horas**. Sem essas variáveis, o app fica aberto.
Não usa banco de dados — a autenticação é feita direto no servidor.

### 4. Iniciar

```bash
npm start
```

Abra o navegador em **http://localhost:3000**.

## 🔑 Onde encontrar as credenciais da Z-API

No painel [app.z-api.io](https://app.z-api.io):

| Campo | Onde encontrar |
|-------|----------------|
| **ID da Instância** | Tela da instância, campo *ID* |
| **Token da Instância** | Tela da instância, campo *Token* |
| **Client-Token** | Aba **Segurança** da sua conta (token obrigatório para a API) |

## 📋 Formato da planilha

A primeira aba da planilha é lida. Exemplo:

| Nome  | Telefone        |
|-------|-----------------|
| João  | (11) 99999-8888 |
| Maria | 11988887777     |
| Pedro | 5511977776666   |

- A coluna de telefone pode ter qualquer formatação (parênteses, traços, espaços).
- Números nacionais ganham o DDI `55` automaticamente.
- A coluna `Nome` é opcional, mas necessária para usar `{{nome}}`.

## 🛠️ Endpoints da API

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/contacts` | Lê a planilha enviada e retorna os contatos |
| `POST` | `/api/test-connection` | Verifica o status da instância na Z-API |
| `POST` | `/api/send` | Dispara as mensagens (stream NDJSON com o progresso) |
| `POST` | `/api/schedule` | Cria um agendamento de disparo (data/horário) |
| `GET`  | `/api/schedules` | Lista os envios/agendamentos (histórico) |
| `GET`  | `/api/schedules/:id` | Detalhe de um envio (números + quem respondeu) |
| `DELETE` | `/api/schedules/:id` | Cancela um agendamento pendente |
| `DELETE` | `/api/schedules` | Limpa o histórico concluído |
| `GET`  | `/api/metrics` | Métricas (hoje / mês) |
| `GET` `POST` `DELETE` | `/api/templates` | Modelos de mensagem |
| `POST` | `/api/webhook` | Recebe as respostas da Z-API |
| `POST` | `/api/login` `/api/logout` | Autenticação (se ativada) |
| `GET`  | `/api/config` | Configurações públicas do app |

## 📩 Webhook de respostas (métricas)

Para o dashboard contar **quem respondeu**, configure o webhook na Z-API apontando
para a URL pública do seu app:

1. No painel da Z-API, na sua instância, vá em **Webhooks** → **Ao receber**
   (*on-message-received*).
2. Cole a URL: `https://SEU-APP.up.railway.app/api/webhook`
3. Salve. A partir daí, cada resposta recebida é registrada em `data/metrics.json` e
   aparece no histórico (✅ **respondeu**) e no dashboard de métricas.

## ☁️ Publicar online (usar no celular)

Quer um link público para acessar do celular? Veja o guia
**[DEPLOY-RAILWAY.md](DEPLOY-RAILWAY.md)** — passo a passo para hospedar no
[Railway](https://railway.app) gratuitamente.

## 🗂️ Dados persistidos (volume)

Tudo é salvo em arquivos JSON dentro de `DATA_DIR` (padrão `./data`):
- `jobs.json` — agendamentos e histórico de envios
- `metrics.json` — métricas e respostas recebidas (webhook)
- `templates.json` — modelos de mensagem
- `clients.json` — base de clientes do CRM (tags, etapas, anotações)

No Railway, aponte `DATA_DIR=/data` e crie um **volume** em `/data` para não perder
nada nos redeploys (passo a passo no `DEPLOY-RAILWAY.md`).

## ⚠️ Uso responsável

Este projeto é uma ferramenta de automação. **Respeite** as
[políticas do WhatsApp](https://www.whatsapp.com/legal/business-policy/) e a
**LGPD**: envie mensagens apenas para contatos que consentiram em recebê-las e
evite spam. O uso indevido pode resultar no banimento do seu número.

## 📄 Licença

MIT
