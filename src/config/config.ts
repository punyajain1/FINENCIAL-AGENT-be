import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  database: {
    url: process.env.DATABASE_URL || '',
  },
  
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  },
  
  apiKeys: {
    gemini: process.env.GEMINI_API_KEY || '',
    huggingface: process.env.HUGGINGFACE_API_KEY || '',
    newsApi: process.env.NEWS_API_KEY || '',
    gnews: process.env.GNEWS_API_KEY || '',
    currentsApi: process.env.CURRENTS_API_KEY || '',
    coinGecko: process.env.COINGECKO_API_KEY || '',
    goldApi: process.env.GOLD_API_KEY || '',
  },
  
  cache: {
    ttl: parseInt(process.env.CACHE_TTL || '300'),
    checkPeriod: parseInt(process.env.CACHE_CHECK_PERIOD || '600'),
  },
  
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  
  apis: {
    coinGecko: 'https://api.coingecko.com/api/v3',
    goldApi: 'https://www.goldapi.io/api',
    newsApi: 'https://newsapi.org/v2',
    gnews: 'https://gnews.io/api/v4',
    currentsApi: 'https://api.currentsapi.services/v1',
    huggingface: 'https://api-inference.huggingface.co/models',
  },
};

export function validateConfig(): void {
  const requiredKeys = [
    'GEMINI_API_KEY',
    'HUGGINGFACE_API_KEY',
    'GOLD_API_KEY',
  ];
  
  const missingKeys: string[] = [];
  
  requiredKeys.forEach((key) => {
    if (!process.env[key]) {
      missingKeys.push(key);
    }
  });
  
  if (!process.env.NEWS_API_KEY && !process.env.GNEWS_API_KEY && !process.env.CURRENTS_API_KEY) {
    missingKeys.push('NEWS_API_KEY or GNEWS_API_KEY or CURRENTS_API_KEY');
  }
  
  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingKeys.join(', ')}\n` +
      'Please check .env.example for setup instructions.'
    );
  }
}
