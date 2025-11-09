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
}

/**
 * Service for fetching market data for cryptocurrencies and precious metals
 */
class MarketDataService {
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

      const prices: HistoricalPrice[] = response.data.prices.map((item: [number, number]) => ({
        timestamp: new Date(item[0]),
        price: item[1],
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
      // Use Gold API
      if (config.apiKeys.goldApi) {
        return await this.getMetalPriceFromGoldApi(symbol);
      }

      throw new Error('No Gold API key configured');
    } catch (error) {
      this.handleApiError(error, 'Gold API');
      throw error;
    }
  }

  /**
   * Get metal price from Gold API
   */
  private async getMetalPriceFromGoldApi(symbol: string): Promise<PriceData> {
    const response = await axios.get(`${config.apis.goldApi}/${symbol}/USD`, {
      headers: {
        'x-access-token': config.apiKeys.goldApi,
      },
    });

    const price = response.data.price || 0;

    const priceData: PriceData = {
      symbol,
      price,
      timestamp: new Date(),
    };

    await cacheService.set(`metal_price:${symbol}`, priceData, 300); // Cache for 5 minutes
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
      
      // Simulate price variation (±2%)
      const variation = (Math.random() - 0.5) * 0.04;
      const price = currentPrice.price * (1 + variation);

      prices.push({
        timestamp: date,
        price,
      });
    }

    await cacheService.set(cacheKey, prices, 1800); // Cache for 30 minutes
    logger.warn(`Using simulated historical data for ${symbol}. Consider upgrading to paid API for real data.`);
    
    return prices;
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

    const currentPrice = prices[prices.length - 1].price;
    const oldPrice = prices[0].price;
    const priceChange7d = ((currentPrice - oldPrice) / oldPrice) * 100;

    // Calculate moving average
    const sum = prices.reduce((acc, p) => acc + p.price, 0);
    const movingAverage7d = sum / prices.length;

    // Calculate volatility (standard deviation)
    const squaredDiffs = prices.map(p => Math.pow(p.price - movingAverage7d, 2));
    const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / prices.length;
    const volatility = Math.sqrt(variance);

    // Determine trend
    let trend: 'UP' | 'DOWN' | 'SIDEWAYS' = 'SIDEWAYS';
    if (priceChange7d > 2) trend = 'UP';
    else if (priceChange7d < -2) trend = 'DOWN';

    return {
      priceChange7d,
      volatility,
      movingAverage7d,
      trend,
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
