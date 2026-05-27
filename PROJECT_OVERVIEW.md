# FinPilot Backend API - Comprehensive Project Overview

Welcome to **FinPilot Backend API**, a state-of-the-art, AI-powered financial advisor and portfolio monitoring system. The project is specifically engineered to analyze, track, and provide recommendations for cryptocurrencies (**Bitcoin, Ethereum**) and precious metals (**Gold, Silver**). 

By combining real-time market APIs, financial news sentiment analysis (using FinBERT), and Meta's state-of-the-art Llama-3.3-70B model running on high-speed Groq SDK inference, FinPilot behaves as a fully automated, self-sustaining financial analyst that runs 24/7.

---

## 🏗️ System Architecture & Conceptual Flow

FinPilot is a Node.js & TypeScript application built on top of Express.js. It features a modular service-based architecture that coordinates database persistence, real-time event broadcasting, background job automation, and multi-tier caching:

```mermaid
graph TD
    Client[Web Client / User] <-->|HTTP / WebSockets| Server[Express Server & WS Server]
    Server <--> Controllers[Controllers: Portfolio, News, Chat]
    Controllers <--> Services[Services: Chatbot, MarketData, News, Sentiment, Cache]
    Services <--> DB[(PostgreSQL Database via Prisma)]
    Services <--> Cron[Cron Scheduler: Every 5 mins]
    Services <--> Llama[Groq Llama-3.3-70B AI: Recommendations & Chat]
    Services <--> FinBERT[HuggingFace FinBERT: Sentiment Analysis]
    Services <--> ExtAPIs[External Market & News APIs: CoinGecko, GoldAPI, NewsAPI]
```

---

## 🗃️ Database Schema (`prisma/schema.prisma`)

The system utilizes PostgreSQL as its persistent datastore, managed via **Prisma ORM**. The schema consists of four core models designed for performance, quick lookup indices, and transactional consistency:

1. **`Portfolio`**: Holds user-added asset positions.
   * `id`: Unique identifier (UUID).
   * `assetName` & `symbol`: Asset details (e.g., "Bitcoin" / "BTC", "Gold" / "XAU").
   * `assetType`: Enum (`CRYPTO` or `METAL`).
   * `amount`: Units held.
   * `buyingPrice`: Entry cost in USD.
   * `lastAnalyzedAt`: Timestamp of the latest AI technical-sentiment analysis.
   * *Indices*: Optimized search filters on `assetType` and `symbol`.

2. **`News`**: Stores deduplicated and processed financial articles.
   * `title`, `description`, `content`, `url`, `source`, `publishedAt`: Article metadata.
   * `relatedAssets`: Array of asset symbols (e.g., `["BTC", "ETH"]`).
   * `sentimentScore` & `sentimentLabel`: Output from the HuggingFace FinBERT model.
   * `relevanceScore`: Metric calculating the article's importance to specific portfolio assets.
   * *Indices*: High-speed sorting indices on `publishedAt`, `sentimentLabel`, and `assetType`.

3. **`ChatHistory`**: Maintains state for the AI chatbot.
   * `conversationId`: UUID grouping messages into conversational threads.
   * `role`: Enum (`USER` or `ASSISTANT`).
   * `message`: Conversation body text.
   * `sources`: Reference citations or structural data nodes.
   * `confidence`: AI response confidence metrics.
   * `toolsUsed`: List of internal tools triggered during generation.

4. **`AnalysisCache`**: Persists heavy external API responses.
   * `cacheKey`: Unique string representing the resource path.
   * `dataType` & `assetSymbol`: Caching categorizations.
   * `data`: JSON-stringified payload.
   * `expiresAt`: Cache invalidation timestamp.

---

## 🔄 Core Engine & Business Workflows

### 1. Dynamic Two-Tier Caching System (`cache.service.ts`)
To prevent hitting API rate limits (such as CoinGecko's strict tiers), save costs, and deliver sub-millisecond response times, the system operates a sophisticated cache hierarchy:

* **Tier 1 (In-Memory Cache)**: Fast-access RAM caching utilizing `node-cache`. It is transient and clears on server restart.
* **Tier 2 (Database Cache)**: Semi-permanent storage inside the PostgreSQL `AnalysisCache` table. It persists across server reboots.

#### Request Resolution Flow:
1. A service requests an asset price or analytical trend.
2. The caching layer queries **Tier 1 (RAM)**.
3. On a RAM miss, the caching layer queries **Tier 2 (PostgreSQL)**.
4. On a DB miss, it performs the expensive HTTP fetch to the **External API** (e.g., CoinGecko, Gold API).
5. The fresh response is written back to both RAM and Database with customized TTLs:
   * **Asset Prices** (BTC, ETH, Gold, Silver) ➔ **1 Minute** (high volatility demands fresh pricing).
   * **Historical Price Data / Technical Indicators** ➔ **5 Minutes**.
   * **Sentiment Analysis Results** ➔ **1 Hour** (static news texts yield identical sentiment scores).
   * **Automated News Feeds** ➔ **5 Minutes**.

*Expired database cache cleanups are automatically handled by a daily cron job running at midnight.*

---

### 2. Portfolio Technical & Sentiment AI Recommendations (`portfolio.service.ts`)
When a portfolio asset is analyzed (either manually via REST endpoints or automatically by background crons), the system executes a comprehensive pipeline:

1. **Market Data Retrieval**: Fetches the asset's current price and a 7-day historical dataset from `marketData.service.ts`.
2. **Technical Calculations**:
   * Generates a **7-Day Simple Moving Average (SMA)**.
   * Measures **7-Day Price Change %**.
   * Computes **Volatility** (standard deviation of daily price ranges).
   * Detects the overarching price **Trend** (`UP`, `DOWN`, or `SIDEWAYS`).
3. **Sentiment Aggregation**: Retrieves the latest news articles for the asset, aggregating recent sentiment scores.
4. **AI Generation (Groq Llama-3.3)**: Sends the position payload (purchase price, profit/loss status, moving averages, volatility, sentiment metrics, and raw news headlines) to Groq's <code>llama-3.3-70b-versatile</code> model using a structured prompt.
5. **Recommendation Output**: The model responds with a structured JSON payload recommending a `BUY`, `SELL`, or `HOLD` action, along with:
   * **Reasoning**: 4-6 bulleted analytical justifications.
   * **Confidence**: 0-100% confidence level.
   * **Price Target**: Realistic 7-day price goal.
   * **Risk Level**: Assessment of volatility (`LOW`, `MEDIUM`, or `HIGH`).

*Fallback Mechanism*: If the Groq API fails, is throttled, or returns malformed data, a robust, rule-based algorithm takes over, evaluating the moving averages and sentiment score thresholds to ensure system continuity.

---

### 3. Financial Sentiment News Engine (`news.service.ts` & `sentiment.service.ts`)
FinPilot continuously scans the global media landscape to feed its analytical pipeline:
* **Aggregation**: Every 5 minutes, background jobs fetch recent finance headlines matching crypto/precious metals from APIs like Currents, NewsAPI, or GNews.
* **FinBERT Sentiment Analysis**: For each incoming article, the system sends the title/description text to HuggingFace's inference pipeline running **FinBERT** (a BERT model specifically trained for financial terminology). It classifies the text as `positive`, `negative`, or `neutral` with precise confidence percentages.
* **Real-time Streaming**: Newly parsed articles are committed to the database, deduplicated, and instantly streamed to active frontend clients via **WebSockets** and Server-Sent Events (SSE).

---

### 4. Interactive Grounded Chatbot (`chatbot.service.ts`)
The API exposes an endpoint for real-time natural language interaction, powered by Groq Llama-3.3-70B:
* **Market-Aware Synthesis**: Evaluates dynamic portfolio indices and sentiment scores to reply with specialized asset guidance.
* **Context Preservation**: The service tracks and stores conversational threads in `ChatHistory`, feeding up to the last 10 exchanges back into the prompt buffer for continuous context.

---

## 📂 Source Code Walkthrough (`src/`)

```
src/
├── config/
│   ├── config.ts         # Environment variables & runtime configurations
│   └── database.ts       # Prisma Client instantiation
├── controllers/
│   ├── chat.controller.ts       # Chat endpoint handler, invokes Llama Chat
│   ├── news.controller.ts       # Retrieves stored news, SSE stream, manual news fetching
│   └── portfolio.controller.ts  # CRUD for holdings, fetches on-demand recommendations
├── middleware/
│   ├── errorHandler.ts   # Express centralized error/not-found processing
│   └── validators.ts     # Zod schema validations for request objects
├── routes/
│   ├── index.ts          # Root API router mapping endpoints
│   ├── chat.routes.ts    # POST /api/chat
│   ├── news.routes.ts    # GET /api/news, GET /api/news/summary/:assetName
│   └── portfolio.routes.ts # GET /api/portfolio, POST /api/portfolio/add
├── services/
│   ├── cache.service.ts       # Two-tier cache service (node-cache & DB)
│   ├── chatbot.service.ts     # Groq Llama-3.3-70B Chat engine with context history
│   ├── cron.service.ts        # Node-cron scheduler for periodic market parsing
│   ├── marketData.service.ts  # CoinGecko/Metals-API price & technical indicator math
│   ├── news.service.ts        # News API aggregator, keyword filtering, and db storage
│   ├── portfolio.service.ts   # Core investment analyst generator
│   ├── sentiment.service.ts   # HuggingFace FinBERT API connection
│   └── websocket.service.ts   # Real-time WebSocket clients manager
├── types/
│   └── index.ts          # Common TypeScript interfaces & enums
├── utils/
│   └── logger.ts         # Winston structured logger (outputs console & log files)
└── server.ts             # Application entrypoint & graceful shutdown mechanics
```

---

## 🛠️ Background Automation & Cron Services (`cron.service.ts`)

Background automation keeps FinPilot self-sustained without requiring user-initiated triggers:
1. **Every 5 Minutes (`*/5 * * * *`)**:
   * Fetches latest financial headlines for all tracked portfolio assets.
   * Runs technical indicator formulas and updates AI recommendations.
   * Broadcasts aggregated sentiment telemetry and articles via WebSockets.
2. **Every Midnight (`0 0 * * *`)**:
   * Purges expired cache entries from the `AnalysisCache` table in PostgreSQL.
3. **Every Sunday at Midnight (`0 0 * * 0`)**:
   * Purges old historical news articles (older than 30 days) from the `News` table to prevent datastore bloat.

---

## 🚀 How to Run and Configure

### 1. Prerequisites
* **Node.js**: v18.0.0 or higher
* **PostgreSQL Database** running locally or in the cloud.

### 2. Environment Variables (`.env`)
Create a `.env` file in the root directory based on `.env.example`:
```env
PORT=3000
NODE_ENV=development
DATABASE_URL="postgresql://user:password@localhost:5432/finpilot?schema=public"

# AI/ML APIs
GROQ_API_KEY="your-groq-api-key"
HUGGINGFACE_API_KEY="your-huggingface-api-key"

# Market & News APIs
COINGECKO_API_KEY="your-optional-coingecko-key"
METALS_API_KEY="your-metals-api-key"
NEWS_API_KEY="your-news-api-key"
```

### 3. Build & Execution Commands
Run the following scripts via your package manager:
```bash
# Install dependencies
npm install

# Run database migrations and seed the db schema
npx prisma migrate dev

# Run development server with nodemon auto-reload
npm run dev

# Build the TypeScript project to /dist
npm run build

# Start the production server
npm run start
```
