# FinPilot — Technical Systems Architecture & Operations Guide

Welcome to the comprehensive technical documentation for **FinPilot**, an advanced, real time AI-powered financial advisor and technical analysis asset platform.

This guide outlines the system's runtime architecture, custom analytical equations, standby resource-management designs, and deployment configurations.

---

## 🗺️ System Overview & Topology

FinPilot aggregates data from live precious metals markets, active crypto rates, and global finance headlines to provide on-demand, institutional-grade technical asset portfolios and AI recommendations.

```mermaid
graph TD
    Client[Browser Client app.js] <-->|HTTP/WS| Express[Express Server server.ts]
    Express <--> Database[(Prisma DB / PostgreSQL)]
    Express -->|Groq API| Groq[Groq GPT-OSS 120B (openai/gpt-oss-120b)]
    Express -->|HuggingFace API| HF[HF Sentiment FinBERT]
    Express -->|Gold API v2| GoldAPI[Gold API Rate Engine]
    Express -->|WebSocket Tickers| CryptoAPI[Crypto Rates Stream]
    
    subgraph STANDBY_CRON_STANDBY
        Cron[Cron Service cron.service.ts]
    end
    
    Cron -.->|Only runs if active clients present| Express
```

---

## ⚡ Grounding Pipelines & Core APIs

### 1. Market Data Aggregation
* **Precious Metals (Gold API v2)**: The platform resolves commodity tickers. A backend normalization method (`getMetalSymbol`) maps friendly identifiers (like `GOLD` and `SILVER`) into standard ISO metal tokens (`XAU` and `XAG`).
* **Cryptocurrencies (CoinGecko & Custom WS)**: Downloads live crypto quotes and 30-day closed-price vectors index-by-index.

### 2. NLP Sentiment Processing
* **Hugging Face FinBERT**: Ingests headlines and runs sentiment classification (`ProsusAI/finbert`) yielding positive, negative, and neutral weights.
* **Groq GPT-OSS 120B Fallback**: If the Hugging Face token hits permission constraints (HTTP 403) or rate ceilings, the backend routes sentiment analysis to the high-capacity `openai/gpt-oss-120b` model under strict JSON response shapes, ensuring zero-downtime execution.

### 3. Chatbot Time-Based RAG Injection
* **Keyword Matching**: A dedicated extraction engine in `chatbot.service.ts` parses incoming user messages for known financial tickers (`BTC`, `ETH`, `XAU`, etc.).
* **Zero-Hallucination Retrieval**: Bypassing complex vector embeddings, the engine queries the PostgreSQL `News` table for exact ticker matches and strictly orders by `publishedAt DESC`. It also fetches live user `Portfolio` data.
* **Prompt Augmentation**: The system dynamically shapes a `[LIVE DATABASE CONTEXT]` string block, prepending it to the AI prompt. This ensures the Groq model bases its financial advice entirely on real-time scraped headlines and live portfolio balances.

---

## 📈 Technical Indicators & Mathematical Formulas

The platform performs high-precision 30-day vector calculations:

### 1. Relative Strength Index (RSI - 14 Period)
Tracks momentum changes to identify overbought and oversold conditions:
$$RSI = 100 - \frac{100}{1 + RS}$$
Where $RS = \frac{\text{Average Gain of 14 Periods}}{\text{Average Loss of 14 Periods}}$.
* **$\text{RSI} < 30$**: Oversold boundary (triggers `BUY` signal).
* **$\text{RSI} > 70$**: Overbought boundary (triggers `SELL` signal).

### 2. MACD (Moving Average Convergence Divergence)
Tracks trend crossovers using Exponential Moving Averages (EMA):
$$\text{MACD Line} = \text{EMA}_{12}(\text{Close}) - \text{EMA}_{26}(\text{Close})$$
$$\text{Signal Line} = \text{EMA}_{9}(\text{MACD Line})$$
$$\text{Histogram} = \text{MACD Line} - \text{Signal Line}$$
* **MACD Crossovers**: Triggers `BUY` if the MACD line crosses above the Signal Line, and `SELL` if it crosses below.

### 3. Bollinger Bands (20-Period Standard Deviation)
Sets support and resistance boundary ribbons around asset prices:
$$\text{Middle Band} = \text{Simple Moving Average}_{20}(\text{Close})$$
$$\text{Upper Band} = \text{Middle Band} + \left(2 \times \sigma_{20}\right)$$
$$\text{Lower Band} = \text{Middle Band} - \left(2 \times \sigma_{20}\right)$$
Where $\sigma_{20}$ represents the 20-period historical closed standard deviation.
* **Support Breach**: Triggers `BUY` when prices touch or fall below the Lower Band.

### 4. On-Balance Volume (OBV)
Measures cumulative volume pressure to evaluate trend strengths:
$$\text{OBV}_t = \begin{cases} 
\text{OBV}_{t-1} + \text{Volume}_t & \text{if } \text{Close}_t > \text{Close}_{t-1} \\
\text{OBV}_{t-1} - \text{Volume}_t & \text{if } \text{Close}_t < \text{Close}_{t-1} \\
\text{OBV}_{t-1} & \text{if } \text{Close}_t = \text{Close}_{t-1} 
\end{cases}$$

---

## 💤 Active-Client Standby Engine (Render Cost Savings)

When hosting applications on free/hobby hosting platforms (like Render, Heroku, or Fly.io), running heavy cron jobs continuously in the background wastes resource quotas and hits API rate limits.

FinPilot introduces a **Client-Aware Standby Loop** inside [cron.service.ts](file:///Users/punyajain/Devlopment/FinPilot-Backend-API/src/services/cron.service.ts):

### 1. Inactivity Standby
* Every scheduled cron trigger (hourly portfolio scanner, 5-minute news crawler) queries the WebSocket server:
  ```typescript
  if (websocketService.getClientCount() === 0) {
    logger.debug('Skipping cron task: Standby mode active (No clients connected)');
    return;
  }
  ```
* If no active browser connections are listening, all external fetches, API sentiment tasks, and database queries **immediately halt**.

### 2. Instant Wake & Refresh
* To prevent users from seeing outdated content upon opening the page, the WebSocket server registers a connection listener callback list:
  ```typescript
  websocketService.onConnect(() => {
    logger.info('Client connected: triggering immediate rates & news sync...');
    this.fetchAllNews();
    this.analyzeAllPortfolios();
  });
  ```
* The exact second a client navigates to the page, the server wakes up, syncs precious metals, crawls news headlines, runs sentiment scores, and broadcasts the fresh context to the browser instantly.

---

## ⌛ Render Cold Startup Loading Handshake

Render's free hosting tier puts containers to "sleep" after 15 minutes of user inactivity. Waking up the server container can introduce a boot latency of up to 45 seconds.

To provide a premium UX, FinPilot features a **Glassmorphic Waking overlay overlay**:

1. **Static Blocking Overlay**: An ultra-premium overlay is embedded directly inside `index.html` at the top of the body, blocking all dashboard elements with a pulsing spinner and loading cards.
2. **Ready Handshake**: In the browser client (`app.js`), the screen monitors two critical initial handshakes:
   * `state.isPortfolioLoaded = true` (successful retrieval of the user portfolio database).
   * `state.isWsConnected = true` (successful socket handshake to the news gateway).
3. **Smooth Dismissal**: Once both parameters resolve successfully, the spinner displays an "Engines Ready" notification and fades out smoothly using high-performance CSS transitions (`transition: opacity 0.5s`).
4. **Safety Timeout**: If the server fails to connect or is offline, a **6-second safety timeout** forcibly dismisses the overlay so the interface remains accessible.

---

## ⚙️ Environment Configuration

Ensure your `.env` contains the required keys:

```ini
PORT=3000
DATABASE_URL="postgresql://user:password@localhost:5432/finpilot"

# Cognitive AI Engines
GROQ_API_KEY="gsk_..."
HUGGINGFACE_API_KEY="hf_..."

# Metals Rates Endpoint
GOLD_API_KEY="gapi_..."
```

---

## 🚀 Development Quickstart

1. **Install Dependencies**:
   ```bash
   npm install
   ```
2. **Database Migrations**:
   ```bash
   npx prisma db push
   ```
3. **Boot Development Thread**:
   ```bash
   npm run dev
   ```
4. **Build Production Assets**:
   ```bash
   npm run build
   ```
