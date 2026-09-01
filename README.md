<h1 align="center">FinPilot (Financial Adviser Backend API)</h1>

<div align="center">
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Express.js-404D59?style=for-the-badge&logo=express&logoColor=white" alt="Express">
  <img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/Prisma-3982CE?style=for-the-badge&logo=Prisma&logoColor=white" alt="Prisma">
  <img src="https://img.shields.io/badge/GPT--OSS%20120B-412991?style=for-the-badge&logo=openai&logoColor=white" alt="GPT-OSS 120B">
  <img src="https://img.shields.io/badge/Groq%20SDK-f55e5b?style=for-the-badge" alt="Groq SDK">
</div>

<br>

> **An AI-powered financial adviser backend** built with Node.js, Express, TypeScript, and Groq GPT-OSS 120B (`openai/gpt-oss-120b`). It provides real-time market analysis, portfolio recommendations, and investment guidance specifically tuned for cryptocurrencies and precious metals.

---

## ⚡ Key Features

- **📊 Portfolio Management System**
  - Track, add, update, and remove assets (Cryptocurrencies & Precious Metals).
  - Automated portfolio analysis running locally every 5 minutes.
  - Generates AI-powered **Buy / Sell / Hold** recommendations with confidence scoring and risk assessment.
  
- **📰 Real-Time News & Sentiment Aggregation**
  - Multi-source financial news fetching (NewsAPI, GNews, Currents API).
  - Natural Language Processing (NLP) sentiment analysis using **HuggingFace FinBERT**.
  - Real-time event streaming to clients via Server-Sent Events (SSE).

- **🤖 Intelligent Financial Chatbot with Time-Based RAG**
  - Powered by **Groq GPT-OSS 120B** (`openai/gpt-oss-120b`) for ultra-fast, intelligent dialogue turns.
  - Uses **Time-Based Retrieval-Augmented Generation (RAG)** to dynamically inject the absolute latest database news and portfolio data directly into prompts.
  - Context-aware conversations with persistent 10-turn sliding session memory.
  - Real-time portfolio grounding and strict risk disclaimers.

---

## 🏗️ Architecture & Design

This project implements a clean layered architecture, enforcing strict separation of concerns to guarantee robust maintainability and testability.

### 🔄 Data Flow

```mermaid
graph TD
    Client((Client)) -->|HTTP Requests| Server[Express Server]
    
    subgraph "Application Architecture"
        Server --> Config["Config / Middleware<br>(ErrorHandler, Validators)"]
        Config --> Routes["Routing Layer<br>(Express Routers)"]
        Routes --> Controllers["Controller Layer<br>(Request/Response Handling)"]
        Controllers --> Services["Service Layer<br>(Core Business Logic)"]
    end
    
    subgraph "Data & External Layers"
        Services --> ORM[Prisma ORM]
        ORM --> DB[(PostgreSQL Database)]
        Services --> ExternalWeb["External APIs<br>(Groq SDK, FinBERT, News, Market Data)"]
    end
    
    style Client fill:#FAFAFA,stroke:#333
    style Server fill:#f9f9f9,stroke:#666
    style DB fill:#5E9EE4,stroke:#316192,stroke-width:2px,color:#fff
    style ORM fill:#e5f1ff,stroke:#3982CE
```

### 📂 Directory Structure

```text
src/
├── config/         # Environment variables & DB connection setup
├── controllers/    # Route controllers (req, res handling)
├── middleware/     # Express middlewares (Validation, Error Handling, Rate Limiting)
├── routes/         # Express route definitions
├── services/       # Core business logic (Cache, Chat, Cron, Market, News)
├── types/          # TypeScript interfaces & type definitions
└── utils/          # Utility functions and standard loggers
```

---

## 🛠️ Technology Stack

| Category         | Technologies Used |
|-----------------|-------------------|
| **Runtime**     | Node.js, TypeScript |
| **Framework**   | Express.js |
| **Database**    | PostgreSQL, Prisma ORM |
| **AI / ML**     | Groq GPT-OSS 120B (Agent/Chat), HuggingFace FinBERT (Sentiment) |
| **External APIs**| CoinGecko (Crypto), Gold API (Metals), NewsAPI/GNews (News) |
| **Tooling**     | Winston (Logging), Node-Cache (Caching), Express-Validator |

---

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed on your local machine:
- **Node.js** (v18 or higher)
- **PostgreSQL** running locally or via a cloud provider.

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd financial-advisory-backend # Or your respective directory
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   Copy the example config to configure your local keys. Look inside the `.env.example` file for detailed instructions on acquiring required API keys.
   ```bash
   cp .env.example .env
   ```

4. **Initialize Database**
   Generate the Prisma Client and run migrations to build your SQL schema.
   ```bash
   npx prisma generate
   npx prisma migrate dev
   ```

5. **Start the Server**
   ```bash
   npm run dev
   ```
   *The server will start on `http://localhost:3000`*

---

## 📖 API Documentation

The REST API is structurally grouped into the following domains:

- **Health:** `/api/health` - Basic ping endpoint.
- **Portfolio:** `/api/portfolio/*` - CRUD operations, automated recommendations, and targeted asset analysis.
- **News:** `/api/news/*` - Query articles by asset type/sentiment, access summarized news, and subscribe to SSE streams.
- **Chat:** `/api/chat/*` - Interact with the AI Adviser and fetch contextual conversation histories.

*(For detailed Request/Response schemas, refer to the Postman collection or code validators).*

---

## 🗄️ Database Schema Summary

- **Portfolio (`assets`)**: Tracks individual user holdings, symbols, types, and amounts.
- **Recommendations (`recommendations`)**: AI trading indicators (BUY/SELL/HOLD), reasoning text, confidence scores, technicals, and risk levels.
- **News (`news_articles`)**: Cached articles with FinBERT-scored sentiment, relevance filtering, and source origin.
- **Chat History (`chat_messages`)**: AI agent dialogues linked to a conversation UUID to preserve context over sessions.

---

*Built for advanced automated financial insights. Disclaimer: Not actual certified financial advice.*
