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
 * Service for fetching market data for cryptocurrencies and precious metals.
 *
 * Crypto data source: Binance Public API (https://api.binance.com)
 *   - No API key required
 *   - Rate limit: ~1 200 requests/min (weight-based) — far more generous than CoinGecko free tier
 *
 * Metal data source: gold-api.com
 *   - No authentication required
 *   - Rate limit: 9 requests/hour (enforced by sliding-window limiter below)
 */
class MarketDataService {
  // ---------------------------------------------------------------------------
  // Gold API rate limiter (9 req / hour)
  // ---------------------------------------------------------------------------
  private goldApiCallTimestamps: number[] = [];
  private readonly GOLD_API_MAX_CALLS = 9;
  private readonly GOLD_API_WINDOW_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Enforces the 9-req/hour cap for the Gold API.
   * Blocks until a request slot becomes available.
   */
  private async waitForGoldApiSlot(): Promise<void> {
    while (true) {
      const now = Date.now();
      this.goldApiCallTimestamps = this.goldApiCallTimestamps.filter(
        (ts) => now - ts < this.GOLD_API_WINDOW_MS
      );

      if (this.goldApiCallTimestamps.length < this.GOLD_API_MAX_CALLS) {
        this.goldApiCallTimestamps.push(now);
        return;
      }

      const oldestTs = this.goldApiCallTimestamps[0];
      const waitMs = this.GOLD_API_WINDOW_MS - (now - oldestTs) + 100;
      logger.warn(
        `Gold API rate limit reached (${this.GOLD_API_MAX_CALLS}/hr). Waiting ${Math.ceil(waitMs / 1000)}s for a slot...`
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  // ---------------------------------------------------------------------------
  // Generic exponential-backoff retry helper
  // ---------------------------------------------------------------------------

  /**
   * Runs `fn` and retries up to `maxRetries` times on HTTP 429 responses,
   * honouring the Retry-After header when present.
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    label: string,
    maxRetries: number = 4
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const isRateLimit =
          axios.isAxiosError(error) && error.response?.status === 429;

        if (!isRateLimit || attempt === maxRetries) {
          throw error;
        }

        const retryAfterHeader = axios.isAxiosError(error)
          ? error.response?.headers?.['retry-after']
          : undefined;

        const backoffMs = retryAfterHeader
          ? parseInt(retryAfterHeader, 10) * 1000
          : Math.min(2000 * Math.pow(2, attempt - 1), 30000); // 2s → 4s → 8s … capped at 30s

        logger.warn(
          `${label} rate limited (429). Attempt ${attempt}/${maxRetries}. Retrying in ${Math.ceil(backoffMs / 1000)}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
    throw lastError;
  }

  // ---------------------------------------------------------------------------
  // Crypto — Binance Public API
  // ---------------------------------------------------------------------------

  /** USD-pegged stablecoins — always worth exactly $1, no API call needed. */
  private readonly USD_STABLECOINS = new Set([
    'USDT', 'BUSD', 'USDC', 'DAI', 'TUSD', 'USDP', 'FDUSD',
  ]);

  /**
   * Quote currency priority when auto-detecting a Binance pair.
   * The service tries each in order and picks the first one that exists.
   */
  private readonly QUOTE_PRIORITY = ['USDT', 'BTC', 'ETH', 'BNB'];

  /**
   * Auto-detects the best Binance trading pair for a given symbol.
   *
   * Strategy (in order): XXXUSDT → XXXBTC → XXXETH → XXXBNB
   * Result is cached for 1 hour so the lookup only happens once per symbol.
   *
   * Examples:
   *   BTC  → { pair: 'BTCUSDT',  quote: 'USDT' }
   *   ETH  → { pair: 'ETHUSDT',  quote: 'USDT' }
   *   SOL  → { pair: 'SOLUSDT',  quote: 'USDT' }
   *   RARE → { pair: 'RAREBTC',  quote: 'BTC'  }  ← auto-fallback
   */
  private async resolveBinancePair(
    symbol: string
  ): Promise<{ pair: string; quote: string } | null> {
    const upper = symbol.toUpperCase();

    // Stablecoins never need a pair
    if (this.USD_STABLECOINS.has(upper)) return null;

    const cacheKey = `binance_pair:${upper}`;
    const cached = await cacheService.get<{ pair: string; quote: string }>(cacheKey);
    if (cached) return cached;

    for (const quote of this.QUOTE_PRIORITY) {
      if (upper === quote) continue; // skip self-referential pairs

      const pair = `${upper}${quote}`;
      try {
        await axios.get(`${config.apis.binance}/api/v3/ticker/price`, {
          params: { symbol: pair },
        });
        const result = { pair, quote };
        await cacheService.set(cacheKey, result, 3600); // cache 1 hour
        logger.info(`Binance: auto-resolved ${upper} → ${pair}`);
        return result;
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 400) {
          continue; // this quote currency doesn't exist, try next
        }
        throw err; // network error — propagate
      }
    }

    // Nothing worked — cache the miss to avoid spamming
    await cacheService.set(cacheKey, null as any, 3600);
    return null;
  }

  /**
   * Fetches the current USD price for any symbol via Binance.
   *
   * - Stablecoins         → $1.00 (no API call)
   * - XXXUSDT pair exists → direct price
   * - Only XXXBTC exists  → price × BTC/USD (recursive, cached)
   * - Only XXXETH exists  → price × ETH/USD
   * - Only XXXBNB exists  → price × BNB/USD
   */
  private async fetchBinancePriceUSD(symbol: string): Promise<number> {
    const upper = symbol.toUpperCase();
    if (this.USD_STABLECOINS.has(upper)) return 1.0;

    const pairInfo = await this.resolveBinancePair(symbol);
    if (!pairInfo) {
      throw new Error(
        `"${symbol}" is not listed on Binance. ` +
        `Tried: ${this.QUOTE_PRIORITY.map((q) => `${upper}${q}`).join(', ')}.`
      );
    }

    const response = await this.withRetry(
      () =>
        axios.get(`${config.apis.binance}/api/v3/ticker/price`, {
          params: { symbol: pairInfo.pair },
        }),
      `Binance price (${pairInfo.pair})`
    );

    const rawPrice = parseFloat(response.data.price);
    if (pairInfo.quote === 'USDT') return rawPrice;

    // Convert to USD: multiply by quote asset's USD price (also auto-resolved)
    const quoteUsd = await this.fetchBinancePriceUSD(pairInfo.quote);
    return rawPrice * quoteUsd;
  }

  /**
   * Fetches historical daily close prices in USD for any symbol.
   *
   * Uses Binance klines (interval=1d). If the resolved pair is not USDT-quoted,
   * it also fetches the quote asset's historical USD prices and multiplies them.
   */
  private async fetchBinanceHistoricalUSD(
    symbol: string,
    days: number
  ): Promise<HistoricalPrice[]> {
    const upper = symbol.toUpperCase();

    // Stablecoins — flat $1 history, zero API calls
    if (this.USD_STABLECOINS.has(upper)) {
      return Array.from({ length: days }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (days - 1 - i));
        return { timestamp: date, price: 1.0, volume: 0 };
      });
    }

    const pairInfo = await this.resolveBinancePair(symbol);
    if (!pairInfo) {
      throw new Error(
        `"${symbol}" is not listed on Binance. ` +
        `Tried: ${this.QUOTE_PRIORITY.map((q) => `${upper}${q}`).join(', ')}.`
      );
    }

    const response = await this.withRetry(
      () =>
        axios.get(`${config.apis.binance}/api/v3/klines`, {
          params: {
            symbol: pairInfo.pair,
            interval: '1d',
            limit: days + 1, // fetch one extra so we have `days` complete candles
          },
        }),
      `Binance klines (${pairInfo.pair}, ${days}d)`
    );

    // Kline array: [openTime, open, high, low, close, volume, ...]
    const candles = (response.data as unknown[][]).slice(0, days);

    if (pairInfo.quote === 'USDT') {
      return candles.map((c) => ({
        timestamp: new Date(c[0] as number),
        price: parseFloat(c[4] as string),   // close price in USD
        volume: parseFloat(c[5] as string),  // base-asset volume
      }));
    }

    // Non-USDT quoted: convert each candle's close to USD
    const quoteHistory = await this.fetchBinanceHistoricalUSD(pairInfo.quote, days);
    return candles.map((c, i) => ({
      timestamp: new Date(c[0] as number),
      price: parseFloat(c[4] as string) * (quoteHistory[i]?.price ?? 1),
      volume: parseFloat(c[5] as string),
    }));
  }

  // ---------------------------------------------------------------------------
  // Public methods — just pass "BTC", "ETH", "SOL", etc.
  // ---------------------------------------------------------------------------

  /**
   * Get the current USD price for a cryptocurrency.
   * Auto-detects the right Binance pair — no manual configuration needed.
   */
  async getCryptoPrice(symbol: string): Promise<PriceData> {
    const cacheKey = `crypto_price:${symbol}`;
    const cached = await cacheService.get<PriceData>(cacheKey);
    if (cached) return cached;

    try {
      const price = await this.fetchBinancePriceUSD(symbol);
      const priceData: PriceData = { symbol, price, timestamp: new Date() };
      await cacheService.set(cacheKey, priceData, 60); // 1 minute cache
      logger.info(`Binance: ${symbol} = $${price.toFixed(4)}`);
      return priceData;
    } catch (error) {
      this.handleApiError(error, 'Binance');
      throw error;
    }
  }

  /**
   * Get historical daily USD prices for a cryptocurrency.
   * Auto-detects the right Binance pair — no manual configuration needed.
   */
  async getCryptoHistoricalPrices(
    symbol: string,
    days: number = 7
  ): Promise<HistoricalPrice[]> {
    const cacheKey = `crypto_history:${symbol}:${days}`;
    const cached = await cacheService.get<HistoricalPrice[]>(cacheKey);
    if (cached) return cached;

    try {
      const prices = await this.fetchBinanceHistoricalUSD(symbol, days);
      await cacheService.set(cacheKey, prices, 21600); // 6 hour cache
      logger.info(`Binance: ${prices.length} candles fetched for ${symbol}`);
      return prices;
    } catch (error) {
      this.handleApiError(error, 'Binance Historical');
      throw error;
    }
  }



  // ---------------------------------------------------------------------------
  // Metals — gold-api.com
  // ---------------------------------------------------------------------------

  /**
   * Get current price for precious metals (Gold/Silver/Platinum/Palladium).
   */
  async getMetalPrice(symbol: string): Promise<PriceData> {
    const cacheKey = `metal_price:${symbol}`;
    const cached = await cacheService.get<PriceData>(cacheKey);
    if (cached) return cached;

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
   * No authentication required. Rate limited to 9 requests/hour.
   */
  private async getMetalPriceFromGoldApi(symbol: string): Promise<PriceData> {
    await this.waitForGoldApiSlot();

    const apiSymbol = this.getMetalSymbol(symbol);
    const response = await axios.get(`${config.apis.goldApi}/price/${apiSymbol}`);
    const price = response.data.price || 0;

    logger.info(
      `Gold API: fetched ${apiSymbol} (${symbol}) = $${price} (${this.goldApiCallTimestamps.length}/${this.GOLD_API_MAX_CALLS} calls this hour)`
    );

    const priceData: PriceData = { symbol, price, timestamp: new Date() };

    await cacheService.set(`metal_price:${symbol}`, priceData, 400); // ~6.6 min
    return priceData;
  }

  /**
   * Get historical price data for metals (simulated — free metal APIs rarely provide history).
   */
  async getMetalHistoricalPrices(
    symbol: string,
    days: number = 7
  ): Promise<HistoricalPrice[]> {
    const cacheKey = `metal_history:${symbol}:${days}`;
    const cached = await cacheService.get<HistoricalPrice[]>(cacheKey);
    if (cached) return cached;

    const currentPrice = await this.getMetalPrice(symbol);
    const prices: HistoricalPrice[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const variation = (Math.random() - 0.5) * 0.04; // ±2%
      prices.push({
        timestamp: date,
        price: currentPrice.price * (1 + variation),
        volume: Math.floor(1000 + Math.random() * 5000),
      });
    }

    await cacheService.set(cacheKey, prices, 1800); // 30 minutes
    logger.warn(
      `Using simulated historical data for ${symbol}. Consider a paid metal data API for real history.`
    );
    return prices;
  }

  // ---------------------------------------------------------------------------
  // Technical-indicator calculations (unchanged)
  // ---------------------------------------------------------------------------

  private calculateRSI(
    prices: number[],
    period: number = 14
  ): { rsi: number; signal: 'BUY' | 'SELL' | 'NEUTRAL' } {
    if (prices.length <= period) return { rsi: 50, signal: 'NEUTRAL' };

    let gainsSum = 0;
    let lossesSum = 0;
    for (let i = 1; i <= period; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gainsSum += change;
      else lossesSum -= change;
    }

    let avgGain = gainsSum / period;
    let avgLoss = lossesSum / period;

    for (let i = period + 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    }

    let rsi = 50;
    if (avgLoss === 0) rsi = 100;
    else rsi = 100 - 100 / (1 + avgGain / avgLoss);

    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    if (rsi < 30) signal = 'BUY';
    else if (rsi > 70) signal = 'SELL';

    return { rsi, signal };
  }

  private calculateEMA(prices: number[], period: number): number[] {
    if (prices.length === 0) return [];
    const ema: number[] = new Array(prices.length).fill(0);
    const k = 2 / (period + 1);
    const initialPeriod = Math.min(period, prices.length);

    let sum = 0;
    for (let i = 0; i < initialPeriod; i++) sum += prices[i];
    ema[initialPeriod - 1] = sum / initialPeriod;

    for (let i = 0; i < initialPeriod - 1; i++) ema[i] = prices[i];
    for (let i = initialPeriod; i < prices.length; i++) {
      ema[i] = (prices[i] - ema[i - 1]) * k + ema[i - 1];
    }
    return ema;
  }

  private calculateMACD(prices: number[]): {
    macdLine: number;
    signalLine: number;
    histogram: number;
    signal: 'BUY' | 'SELL' | 'NEUTRAL';
  } {
    if (prices.length < 26)
      return { macdLine: 0, signalLine: 0, histogram: 0, signal: 'NEUTRAL' };

    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signalLine = this.calculateEMA(macdLine, 9);
    const histogram = macdLine.map((v, i) => v - signalLine[i]);

    const last = macdLine.length - 1;
    const prev = last - 1;
    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    if (last >= 1) {
      if (macdLine[last] > signalLine[last] && macdLine[prev] <= signalLine[prev])
        signal = 'BUY';
      else if (macdLine[last] < signalLine[last] && macdLine[prev] >= signalLine[prev])
        signal = 'SELL';
    }

    return {
      macdLine: macdLine[last] || 0,
      signalLine: signalLine[last] || 0,
      histogram: histogram[last] || 0,
      signal,
    };
  }

  private calculateBollingerBands(
    prices: number[],
    currentPrice: number,
    period: number = 20
  ): { middle: number; upper: number; lower: number; signal: 'BUY' | 'SELL' | 'NEUTRAL' } {
    if (prices.length < period) {
      const middle = prices.reduce((a, v) => a + v, 0) / (prices.length || 1);
      return { middle, upper: middle, lower: middle, signal: 'NEUTRAL' };
    }

    const slice = prices.slice(prices.length - period);
    const middle = slice.reduce((a, v) => a + v, 0) / period;
    const stdDev = Math.sqrt(
      slice.map((v) => Math.pow(v - middle, 2)).reduce((a, v) => a + v, 0) / period
    );
    const upper = middle + 2 * stdDev;
    const lower = middle - 2 * stdDev;

    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    if (currentPrice <= lower) signal = 'BUY';
    else if (currentPrice >= upper) signal = 'SELL';

    return { middle, upper, lower, signal };
  }

  private calculateOBV(prices: HistoricalPrice[]): number {
    if (prices.length === 0) return 0;
    let obv = prices[0].volume || 0;
    for (let i = 1; i < prices.length; i++) {
      const vol = prices[i].volume || 0;
      if (prices[i].price > prices[i - 1].price) obv += vol;
      else if (prices[i].price < prices[i - 1].price) obv -= vol;
    }
    return obv;
  }

  /**
   * Calculate technical indicators from price history.
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

    const last7dPrices = prices.slice(-7);
    const currentPrice = prices[prices.length - 1].price;
    const oldPrice7d = last7dPrices[0]?.price || prices[0].price;
    const priceChange7d = ((currentPrice - oldPrice7d) / oldPrice7d) * 100;

    const movingAverage7d =
      last7dPrices.reduce((acc, p) => acc + p.price, 0) / last7dPrices.length;

    const mean = prices.reduce((acc, p) => acc + p.price, 0) / prices.length;
    const volatility = Math.sqrt(
      prices.map((p) => Math.pow(p.price - mean, 2)).reduce((a, v) => a + v, 0) /
      prices.length
    );

    let trend: 'UP' | 'DOWN' | 'SIDEWAYS' = 'SIDEWAYS';
    if (priceChange7d > 2) trend = 'UP';
    else if (priceChange7d < -2) trend = 'DOWN';

    const rawCloses = prices.map((p) => p.price);
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
        signal: macdCalc.signal,
      },
      bollingerBands: {
        middle: Number(bbCalc.middle.toFixed(2)),
        upper: Number(bbCalc.upper.toFixed(2)),
        lower: Number(bbCalc.lower.toFixed(2)),
        signal: bbCalc.signal,
      },
      obv: obvCalc,
    };
  }

  // ---------------------------------------------------------------------------
  // Symbol helpers
  // ---------------------------------------------------------------------------

  /**
   * Map common precious-metal names/symbols to Gold API symbols.
   */
  private getMetalSymbol(symbol: string): string {
    const mapping: Record<string, string> = {
      GOLD: 'XAU',
      SILVER: 'XAG',
      PLATINUM: 'XPT',
      PALLADIUM: 'XPD',
    };
    return mapping[symbol.toUpperCase()] || symbol.toUpperCase();
  }

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  private handleApiError(error: unknown, apiName: string): void {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 429) {
        logger.error(`${apiName} rate limit exceeded.`);
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
