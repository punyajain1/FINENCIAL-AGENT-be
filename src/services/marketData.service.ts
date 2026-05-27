import axios, { AxiosError } from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import cacheService from './cache.service';

export interface PriceData {
  symbol: string;
  price: number;
  timestamp: Date;
}

export interface HistoricalPrice {
  timestamp: Date;
  price: number;
  volume?: number;
}

export interface TechnicalIndicators {
  priceChange7d: number; // Percentage change
  volatility: number;
  movingAverage7d: number;
  trend: 'UP' | 'DOWN' | 'SIDEWAYS';
  rsi?: number;
  rsiSignal?: 'BUY' | 'SELL' | 'NEUTRAL';
  macd?: {
    macdLine: number;
    signalLine: number;
    histogram: number;
    signal: 'BUY' | 'SELL' | 'NEUTRAL';
  };
  bollingerBands?: {
    middle: number;
    upper: number;
    lower: number;
    signal: 'BUY' | 'SELL' | 'NEUTRAL';
  };
  obv?: number;
}

/**
 * Service for fetching market data for cryptocurrencies and precious metals
 */
class MarketDataService {
  /** Sliding-window rate limiter: max 9 requests per hour for Gold API */
  private goldApiCallTimestamps: number[] = [];
  private readonly GOLD_API_MAX_CALLS = 9;
  private readonly GOLD_API_WINDOW_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Enforces the 9-req/hour cap. Waits until a slot is available if needed.
   */
  private async waitForGoldApiSlot(): Promise<void> {
    while (true) {
      const now = Date.now();
      // Purge timestamps older than 1 hour
      this.goldApiCallTimestamps = this.goldApiCallTimestamps.filter(
        (ts) => now - ts < this.GOLD_API_WINDOW_MS
      );

      if (this.goldApiCallTimestamps.length < this.GOLD_API_MAX_CALLS) {
        // Slot available — record and proceed
        this.goldApiCallTimestamps.push(now);
        return;
      }

      // Slot not available — wait until the oldest call expires
      const oldestTs = this.goldApiCallTimestamps[0];
      const waitMs = this.GOLD_API_WINDOW_MS - (now - oldestTs) + 100; // +100ms buffer
      logger.warn(
        `Gold API rate limit reached (${this.GOLD_API_MAX_CALLS}/hr). Waiting ${Math.ceil(waitMs / 1000)}s for a slot...`
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  /**
   * Get current price for a cryptocurrency
   */
  async getCryptoPrice(symbol: string): Promise<PriceData> {
    const cacheKey = `crypto_price:${symbol}`;
    const cached = await cacheService.get<PriceData>(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      const response = await axios.get(`${config.apis.coinGecko}/simple/price`, {
        params: {
          ids: this.getCoinGeckoId(symbol),
          vs_currencies: 'usd',
          include_24hr_change: true,
        },
        headers: config.apiKeys.coinGecko ? {
          'x-cg-pro-api-key': config.apiKeys.coinGecko,
        } : {},
      });

      const coinId = this.getCoinGeckoId(symbol);
      const price = response.data[coinId]?.usd || 0;

      const priceData: PriceData = {
        symbol,
        price,
        timestamp: new Date(),
      };

      await cacheService.set(cacheKey, priceData, 60); // Cache for 1 minute
      return priceData;
    } catch (error) {
      this.handleApiError(error, 'CoinGecko');
      throw error;
    }
  }

  /**
   * Get historical price data for cryptocurrency (7 days)
   */
  async getCryptoHistoricalPrices(symbol: string, days: number = 7): Promise<HistoricalPrice[]> {
    const cacheKey = `crypto_history:${symbol}:${days}`;
    const cached = await cacheService.get<HistoricalPrice[]>(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      const coinId = this.getCoinGeckoId(symbol);
      const response = await axios.get(
        `${config.apis.coinGecko}/coins/${coinId}/market_chart`,
        {
          params: {
            vs_currency: 'usd',
            days,
            interval: 'daily',
          },
          headers: config.apiKeys.coinGecko ? {
            'x-cg-pro-api-key': config.apiKeys.coinGecko,
          } : {},
        }
      );

      const prices: HistoricalPrice[] = response.data.prices.map((item: [number, number], index: number) => ({
        timestamp: new Date(item[0]),
        price: item[1],
        volume: response.data.total_volumes?.[index]?.[1] || 0,
      }));

      await cacheService.set(cacheKey, prices, 1800); // Cache for 30 minutes
      return prices;
    } catch (error) {
      this.handleApiError(error, 'CoinGecko Historical');
      throw error;
    }
  }

  /**
   * Get current price for precious metals (Gold/Silver)
   */
  async getMetalPrice(symbol: string): Promise<PriceData> {
    const cacheKey = `metal_price:${symbol}`;
    const cached = await cacheService.get<PriceData>(cacheKey);

    if (cached) {
      return cached;
    }

    try {
      return await this.getMetalPriceFromGoldApi(symbol);
    } catch (error) {
      this.handleApiError(error, 'Gold API');
      throw error;
    }
  }

  /**
   * Get metal price from gold-api.com
   * Endpoint: GET https://api.gold-api.com/price/{symbol}
   * No authentication required. Rate limited to 9 requests per hour (sliding window).
   */
  private async getMetalPriceFromGoldApi(symbol: string): Promise<PriceData> {
    // Enforce 9 req/hour cap before making the request
    await this.waitForGoldApiSlot();

    const apiSymbol = this.getMetalSymbol(symbol);
    const response = await axios.get(`${config.apis.goldApi}/price/${apiSymbol}`);

    const price = response.data.price || 0;

    logger.info(`Gold API: fetched ${apiSymbol} (for ${symbol}) price = $${price} (${this.goldApiCallTimestamps.length}/${this.GOLD_API_MAX_CALLS} calls this hour)`);

    const priceData: PriceData = {
      symbol,
      price,
      timestamp: new Date(),
    };

    // 400s cache (~6.6 min) → at most 9 fetches per hour per symbol
    await cacheService.set(`metal_price:${symbol}`, priceData, 400);
    return priceData;
  }

  /**
   * Get historical price data for metals (simulated with current price)
   * Note: Most free metal APIs don't provide historical data
   */
  async getMetalHistoricalPrices(symbol: string, days: number = 7): Promise<HistoricalPrice[]> {
    const cacheKey = `metal_history:${symbol}:${days}`;
    const cached = await cacheService.get<HistoricalPrice[]>(cacheKey);
    
    if (cached) {
      return cached;
    }

    // For free tier, we'll simulate historical data with slight variations
    // In production, consider upgrading to paid tier or using alternative sources
    const currentPrice = await this.getMetalPrice(symbol);
    const prices: HistoricalPrice[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      
      // Simulate price variation (±2%) and volume
      const variation = (Math.random() - 0.5) * 0.04;
      const price = currentPrice.price * (1 + variation);
      const volume = Math.floor(1000 + Math.random() * 5000);

      prices.push({
        timestamp: date,
        price,
        volume,
      });
    }

    await cacheService.set(cacheKey, prices, 1800); // Cache for 30 minutes
    logger.warn(`Using simulated historical data for ${symbol}. Consider upgrading to paid API for real data.`);
    
    return prices;
  }

  /**
   * Helper to calculate Relative Strength Index (RSI) using 14 periods.
   */
  private calculateRSI(prices: number[], period: number = 14): { rsi: number; signal: 'BUY' | 'SELL' | 'NEUTRAL' } {
    if (prices.length <= period) {
      return { rsi: 50, signal: 'NEUTRAL' };
    }

    let gainsSum = 0;
    let lossesSum = 0;

    // First period gains and losses
    for (let i = 1; i <= period; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) {
        gainsSum += change;
      } else {
        lossesSum -= change;
      }
    }

    let avgGain = gainsSum / period;
    let avgLoss = lossesSum / period;

    for (let i = period + 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      const currentGain = change > 0 ? change : 0;
      const currentLoss = change < 0 ? -change : 0;

      avgGain = (avgGain * (period - 1) + currentGain) / period;
      avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
    }

    let rsi = 50;
    if (avgLoss === 0) {
      rsi = 100;
    } else {
      const rs = avgGain / avgLoss;
      rsi = 100 - (100 / (1 + rs));
    }

    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    if (rsi < 30) signal = 'BUY';
    else if (rsi > 70) signal = 'SELL';

    return { rsi, signal };
  }

  /**
   * Helper to calculate Exponential Moving Average (EMA).
   */
  private calculateEMA(prices: number[], period: number): number[] {
    if (prices.length === 0) return [];
    const ema: number[] = new Array(prices.length).fill(0);
    const k = 2 / (period + 1);

    // Initial SMA
    let sum = 0;
    const initialPeriod = Math.min(period, prices.length);
    for (let i = 0; i < initialPeriod; i++) {
      sum += prices[i];
    }
    const initialSma = sum / initialPeriod;
    ema[initialPeriod - 1] = initialSma;

    // Pre-populate before initial period
    for (let i = 0; i < initialPeriod - 1; i++) {
      ema[i] = prices[i];
    }

    for (let i = initialPeriod; i < prices.length; i++) {
      ema[i] = (prices[i] - ema[i - 1]) * k + ema[i - 1];
    }

    return ema;
  }

  /**
   * Helper to calculate Moving Average Convergence Divergence (MACD).
   */
  private calculateMACD(prices: number[]): { macdLine: number; signalLine: number; histogram: number; signal: 'BUY' | 'SELL' | 'NEUTRAL' } {
    if (prices.length < 26) {
      return { macdLine: 0, signalLine: 0, histogram: 0, signal: 'NEUTRAL' };
    }

    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);

    const macdLine = ema12.map((val, idx) => val - ema26[idx]);
    const signalLine = this.calculateEMA(macdLine, 9);
    const histogram = macdLine.map((val, idx) => val - signalLine[idx]);

    const last = macdLine.length - 1;
    const prev = last - 1;
    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';

    if (last >= 1) {
      const macdCurr = macdLine[last];
      const macdPrev = macdLine[prev];
      const sigCurr = signalLine[last];
      const sigPrev = signalLine[prev];

      // Bullish crossover
      if (macdCurr > sigCurr && macdPrev <= sigPrev) {
        signal = 'BUY';
      }
      // Bearish crossover
      else if (macdCurr < sigCurr && macdPrev >= sigPrev) {
        signal = 'SELL';
      }
    }

    return {
      macdLine: macdLine[last] || 0,
      signalLine: signalLine[last] || 0,
      histogram: histogram[last] || 0,
      signal
    };
  }

  /**
   * Helper to calculate Bollinger Bands.
   */
  private calculateBollingerBands(prices: number[], currentPrice: number, period: number = 20): { middle: number; upper: number; lower: number; signal: 'BUY' | 'SELL' | 'NEUTRAL' } {
    if (prices.length < period) {
      const middle = prices.reduce((acc, v) => acc + v, 0) / (prices.length || 1);
      return { middle, upper: middle, lower: middle, signal: 'NEUTRAL' };
    }

    const slice = prices.slice(prices.length - period);
    const middle = slice.reduce((acc, v) => acc + v, 0) / period;

    const squaredDiffs = slice.map(v => Math.pow(v - middle, 2));
    const variance = squaredDiffs.reduce((acc, v) => acc + v, 0) / period;
    const stdDev = Math.sqrt(variance);

    const upper = middle + 2 * stdDev;
    const lower = middle - 2 * stdDev;

    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    if (currentPrice <= lower) {
      signal = 'BUY';
    } else if (currentPrice >= upper) {
      signal = 'SELL';
    }

    return { middle, upper, lower, signal };
  }

  /**
   * Helper to calculate On-Balance Volume (OBV).
   */
  private calculateOBV(prices: HistoricalPrice[]): number {
    if (prices.length === 0) return 0;
    let obv = prices[0].volume || 0;

    for (let i = 1; i < prices.length; i++) {
      const todayClose = prices[i].price;
      const yesterdayClose = prices[i - 1].price;
      const vol = prices[i].volume || 0;

      if (todayClose > yesterdayClose) {
        obv += vol;
      } else if (todayClose < yesterdayClose) {
        obv -= vol;
      }
    }

    return obv;
  }

  /**
   * Calculate technical indicators from price history
   */
  calculateTechnicalIndicators(prices: HistoricalPrice[]): TechnicalIndicators {
    if (prices.length < 2) {
      return {
        priceChange7d: 0,
        volatility: 0,
        movingAverage7d: prices[0]?.price || 0,
        trend: 'SIDEWAYS',
      };
    }

    // Since we now pass 30 days of data, we calculate a true 7-day price change
    const last7dPrices = prices.slice(-7);
    const currentPrice = prices[prices.length - 1].price;
    const oldPrice7d = last7dPrices[0]?.price || prices[0].price;
    const priceChange7d = ((currentPrice - oldPrice7d) / oldPrice7d) * 100;

    // Calculate moving average (7-day standard)
    const sum7d = last7dPrices.reduce((acc, p) => acc + p.price, 0);
    const movingAverage7d = sum7d / last7dPrices.length;

    // Calculate volatility (standard deviation over the 30-day period)
    const sum = prices.reduce((acc, p) => acc + p.price, 0);
    const mean = sum / prices.length;
    const squaredDiffs = prices.map(p => Math.pow(p.price - mean, 2));
    const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / prices.length;
    const volatility = Math.sqrt(variance);

    // Determine trend
    let trend: 'UP' | 'DOWN' | 'SIDEWAYS' = 'SIDEWAYS';
    if (priceChange7d > 2) trend = 'UP';
    else if (priceChange7d < -2) trend = 'DOWN';

    // Extract raw closes for custom computations
    const rawCloses = prices.map(p => p.price);

    // Advanced mathematical indicator calculations
    const rsiCalc = this.calculateRSI(rawCloses);
    const macdCalc = this.calculateMACD(rawCloses);
    const bbCalc = this.calculateBollingerBands(rawCloses, currentPrice);
    const obvCalc = this.calculateOBV(prices);

    return {
      priceChange7d,
      volatility,
      movingAverage7d,
      trend,
      rsi: Number(rsiCalc.rsi.toFixed(2)),
      rsiSignal: rsiCalc.signal,
      macd: {
        macdLine: Number(macdCalc.macdLine.toFixed(4)),
        signalLine: Number(macdCalc.signalLine.toFixed(4)),
        histogram: Number(macdCalc.histogram.toFixed(4)),
        signal: macdCalc.signal
      },
      bollingerBands: {
        middle: Number(bbCalc.middle.toFixed(2)),
        upper: Number(bbCalc.upper.toFixed(2)),
        lower: Number(bbCalc.lower.toFixed(2)),
        signal: bbCalc.signal
      },
      obv: obvCalc
    };
  }

  /**
   * Map common symbols to CoinGecko IDs
   */
  private getCoinGeckoId(symbol: string): string {
    const mapping: Record<string, string> = {
      'BTC': 'bitcoin',
      'ETH': 'ethereum',
      'USDT': 'tether',
      'BNB': 'binancecoin',
      'SOL': 'solana',
      'ADA': 'cardano',
      'XRP': 'ripple',
      'DOT': 'polkadot',
      'DOGE': 'dogecoin',
      'AVAX': 'avalanche-2',
      'MATIC': 'matic-network',
      'LINK': 'chainlink',
    };

    return mapping[symbol.toUpperCase()] || symbol.toLowerCase();
  }

  /**
   * Map common precious metals names or symbols to Gold API symbols
   */
  private getMetalSymbol(symbol: string): string {
    const mapping: Record<string, string> = {
      'GOLD': 'XAU',
      'SILVER': 'XAG',
      'PLATINUM': 'XPT',
      'PALLADIUM': 'XPD',
    };
    return mapping[symbol.toUpperCase()] || symbol.toUpperCase();
  }

  /**
   * Handle API errors with exponential backoff
   */
  private handleApiError(error: unknown, apiName: string): void {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      if (axiosError.response?.status === 429) {
        logger.error(`${apiName} rate limit exceeded. Implement exponential backoff.`);
      } else if (axiosError.response?.status === 401) {
        logger.error(`${apiName} authentication failed. Check API key.`);
      } else {
        logger.error(`${apiName} API error:`, {
          status: axiosError.response?.status,
          message: axiosError.message,
        });
      }
    } else {
      logger.error(`${apiName} unknown error:`, error);
    }
  }
}

export default new MarketDataService();
