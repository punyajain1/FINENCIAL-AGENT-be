# Trading Agent Backend

An AI-powered trading agent backend built with Node.js, Express, TypeScript, and Google Gemini AI with Google Search grounding. Provides real-time analysis, recommendations, and investment guidance for cryptocurrencies and precious metals.

## Features

### 1. Portfolio Management System
- Add, update, and remove assets (cryptocurrencies and precious metals)
- Automated analysis every 5 minutes
- AI-powered buy/sell/hold recommendations
- Technical analysis with price trends and volatility
- Sentiment analysis from recent news
- Risk assessment and confidence scoring

### 2. Real-Time News Aggregation
- Multi-source news fetching (NewsAPI, GNews, Currents API)
- Sentiment analysis using HuggingFace FinBERT
- Real-time updates via Server-Sent Events (SSE)
- Filtering by asset type, sentiment, and date range
- Automatic deduplication and relevance scoring

### 3. Intelligent Chatbot
- Google Gemini AI with Google Search grounding
- Real-time web information access
- Source citations and search query transparency
- Context-aware conversations with memory
- Personalized investment advice
- Risk warnings and disclaimers

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **AI/ML**: 
  - Google Gemini AI with Google Search grounding
  - HuggingFace FinBERT for sentiment analysis
- **APIs**:
  - CoinGecko (Crypto prices)
  - Metals-API / Gold API (Metal prices)
  - NewsAPI / GNews / Currents API (News)
- **Caching**: Node-cache with database persistence
- **Logging**: Winston
- **Validation**: Express-validator

## Installation

### Prerequisites
- Node.js 18+ 
- PostgreSQL database
- API keys (see Environment Variables section)

### Steps

1. **Clone the repository**
```bash
git clone <repository-url>
cd tbot-new-small
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp .env.example .env
```

Edit `.env` and fill in your API keys:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/trading_agent_db"
GEMINI_API_KEY=your_gemini_api_key
HUGGINGFACE_API_KEY=your_huggingface_api_key
NEWS_API_KEY=your_news_api_key
METALS_API_KEY=your_metals_api_key
```

4. **Set up Prisma and database**
```bash
npm run prisma:generate
npm run prisma:migrate
```

5. **Start the development server**
```bash
npm run dev
```

The server will start on `http://localhost:3000`

## API Keys Setup

### Required API Keys

#### 1. Google Gemini AI (REQUIRED)
- **Get Key**: https://makersuite.google.com/app/apikey or https://aistudio.google.com/app/apikey
- **Free Tier**: Yes
- **Usage**: AI-powered recommendations and chatbot

#### 2. HuggingFace (REQUIRED)
- **Get Key**: https://huggingface.co/settings/tokens
- **Sign Up**: https://huggingface.co/join
- **Free Tier**: Yes
- **Usage**: Financial sentiment analysis (FinBERT model)

#### 3. News API (REQUIRED - Choose ONE)

**Option A: NewsAPI.org (Recommended)**
- **Get Key**: https://newsapi.org/register
- **Free Tier**: 100 requests/day
- **Usage**: News articles fetching

**Option B: GNews API**
- **Get Key**: https://gnews.io/register  
- **Free Tier**: 100 requests/day
- **Usage**: Alternative news source

**Option C: Currents API**
- **Get Key**: https://currentsapi.services/en/register
- **Free Tier**: Available
- **Usage**: Alternative news source

#### 4. Metals API (REQUIRED - Choose ONE)

**Option A: Metals-API.com (Recommended)**
- **Get Key**: https://metals-api.com/signup/free
- **Free Tier**: 50 requests/month
- **Usage**: Gold and Silver prices

**Option B: Gold API**
- **Get Key**: https://www.goldapi.io/dashboard
- **Free Tier**: Available
- **Usage**: Alternative metals pricing

### Optional API Keys

#### CoinGecko API (OPTIONAL)
- **No API Key Required**: Free tier works without authentication
- **Get Key for Higher Limits**: https://www.coingecko.com/en/api/pricing
- **Free Tier**: 10-50 calls/minute without key
- **Usage**: Cryptocurrency prices
- **Note**: Leave `COINGECKO_API_KEY` empty to use free tier

## API Endpoints

### Health Check
```
GET /api/health
```

### Portfolio Management

#### Add Asset
```
POST /api/portfolio/add
Content-Type: application/json

{
  "assetName": "Bitcoin",
  "assetType": "CRYPTO",
  "symbol": "BTC",
  "amount": 0.5
}
```

#### Get Portfolio
```
GET /api/portfolio
```

#### Update Asset
```
PUT /api/portfolio/update/:id
Content-Type: application/json

{
  "amount": 1.0
}
```

#### Remove Asset
```
DELETE /api/portfolio/remove/:id
```

#### Get Recommendations
```
GET /api/portfolio/recommendations
```

#### Analyze Asset
```
POST /api/portfolio/analyze/:id
```

### News API

#### Get News
```
GET /api/news?assetType=CRYPTO&limit=10&sentiment=positive
```

Query Parameters:
- `assetType`: CRYPTO | METAL
- `assetName`: Asset name (e.g., Bitcoin, Gold)
- `sentiment`: positive | negative | neutral
- `startDate`: ISO date string
- `endDate`: ISO date string
- `limit`: Number of articles (1-100)
- `offset`: Pagination offset

#### Get News Summary
```
GET /api/news/summary/:assetName
```

#### News Stream (SSE)
```
GET /api/news/stream?assetType=CRYPTO
```

### Chatbot

#### Send Message
```
POST /api/chat
Content-Type: application/json

{
  "message": "What are the best cryptocurrency investments right now?",
  "conversationId": "optional-conversation-id"
}
```

#### Get Chat History
```
GET /api/chat/history?conversationId=xxx&limit=50
```

## Database Schema

### Portfolio
- Asset information (name, type, symbol, amount)
- Timestamps

### Recommendation
- Trading action (BUY/SELL/HOLD)
- Reasoning and confidence
- Technical indicators
- Sentiment data
- Risk level

### News
- Article details
- Sentiment analysis
- Related assets
- Relevance scores

### ChatHistory
- Conversation messages
- Sources and tools used
- Confidence levels

### AnalysisCache
- Cached API responses
- Expiration management

## Automated Jobs

The system runs the following cron jobs:

- **Every 5 minutes**: Analyze portfolio assets and fetch news
- **Daily at midnight**: Clean expired cache
- **Weekly**: Remove news older than 30 days

## Development

### Available Scripts

```bash
# Development with auto-reload
npm run dev

# Build TypeScript
npm run build

# Start production server
npm start

# Generate Prisma client
npm run prisma:generate

# Run database migrations
npm run prisma:migrate

# Open Prisma Studio
npm run prisma:studio
```

### Project Structure

```
src/
├── config/          # Configuration files
│   ├── config.ts    # Environment configuration
│   └── database.ts  # Prisma client
├── controllers/     # Request handlers
│   ├── portfolio.controller.ts
│   ├── news.controller.ts
│   └── chat.controller.ts
├── middleware/      # Express middleware
│   ├── errorHandler.ts
│   └── validators.ts
├── routes/          # API routes
│   ├── portfolio.routes.ts
│   ├── news.routes.ts
│   ├── chat.routes.ts
│   └── index.ts
├── services/        # Business logic
│   ├── portfolio.service.ts
│   ├── marketData.service.ts
│   ├── news.service.ts
│   ├── sentiment.service.ts
│   ├── chatbot.service.ts
│   ├── cache.service.ts
│   └── cron.service.ts
├── utils/           # Utilities
│   └── logger.ts
└── server.ts        # Application entry point
```

## Testing

Import `postman_collection.json` into Postman to test all endpoints.

The collection includes:
- Health checks
- Portfolio management (add, update, delete, analyze)
- News fetching with various filters
- Chatbot conversations
- SSE streams

## Error Handling

The API implements comprehensive error handling:
- Rate limiting (100 requests per 15 minutes)
- Input validation
- API fallbacks
- Exponential backoff for rate limits
- Detailed logging

## Security Features

- CORS configuration
- Rate limiting
- Input validation and sanitization
- Environment variable protection
- SQL injection prevention (Prisma)
- XSS protection

## Deployment

### Environment Variables for Production

```env
NODE_ENV=production
DATABASE_URL=your_production_database_url
PORT=3000
```

### Build for Production

```bash
npm run build
npm start
```

## Limitations & Notes

1. **Free Tier Limits**:
   - NewsAPI: 100 requests/day
   - Metals-API: 50 requests/month
   - HuggingFace: Rate limited
   - CoinGecko: 10-50 calls/minute

2. **Metal Historical Data**: Free metal APIs don't provide historical data. The system simulates it for technical analysis.

3. **Caching**: Aggressive caching is used to stay within API limits.

4. **Disclaimers**: All investment advice includes appropriate risk warnings.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

ISC

## Support

For issues and questions, please create an issue in the repository.

## Disclaimer

This software is for educational purposes only. It does NOT provide professional financial advice. Users should consult licensed financial advisors before making investment decisions. Cryptocurrency and metal markets are highly volatile. Only invest what you can afford to lose.
