# 📤 Frota-bot

Aplicativo web para **disparar mensagens de texto e imagem pelo WhatsApp** usando a
[**Z-API**](https://z-api.io) e uma **lista de contatos em Excel** (`.xlsx`/`.csv`).

## ✨ Funcionalidades

- 🔌 Conecta à sua instância da **Z-API** (com teste de conexão)
- 📊 Importa contatos de uma planilha **Excel** — detecta automaticamente colunas de
  telefone (`Telefone`, `Celular`, `WhatsApp`, `Número`...) e `Nome`
- ✅ Normaliza e valida os números (adiciona o DDI `55` do Brasil quando necessário)
- 💬 Envia **texto** e/ou **imagem** (por URL ou upload de arquivo)
- 🏷️ Personalização com `{{nome}}` na mensagem
- ⏱️ Intervalo configurável entre os envios (reduz risco de bloqueio)
- 📈 Acompanhamento do progresso em tempo real, com relatório de sucesso/falha

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
```

> Se preferir, você pode digitar essas credenciais direto na interface — elas ficam
> salvas apenas no seu navegador.

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
| `GET`  | `/api/config` | Indica se há credenciais no `.env` |

## ⚠️ Uso responsável

Este projeto é uma ferramenta de automação. **Respeite** as
[políticas do WhatsApp](https://www.whatsapp.com/legal/business-policy/) e a
**LGPD**: envie mensagens apenas para contatos que consentiram em recebê-las e
evite spam. O uso indevido pode resultar no banimento do seu número.

## 📄 Licença

MIT
