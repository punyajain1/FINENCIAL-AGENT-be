import prisma from '../config/database';
import { AssetType } from '@prisma/client';
import { Action, RiskLevel } from '../types';
import marketDataService, { TechnicalIndicators } from './marketData.service';
import newsService from './news.service';
import sentimentService from './sentiment.service';
import { logger } from '../utils/logger';
import Groq from 'groq-sdk';
import { config } from '../config/config';

export interface PortfolioAsset {
  id: string;
  assetName: string;
  assetType: AssetType;
  symbol: string;
  amount: number;
  buyingPrice: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortfolioAssetWithCurrentPrice extends PortfolioAsset {
  currentPrice: number;
  priceChange: number; // Percentage change from buying price
  priceChangeAbsolute: number; // Absolute change from buying price
  totalValue: number; // Current value of holdings
  totalCost: number; // Original cost of holdings
  profitLoss: number; // Profit or loss amount
  profitLossPercentage: number; // Profit or loss percentage
  lastAnalyzedAt?: Date;
}

export interface RecommendationData {
  id: string;
  action: Action;
  reasoning: string[];
  confidence: number;
  priceTarget?: number;
  riskLevel: RiskLevel;
  currentPrice: number;
  priceChange7d: number;
  volatility: number;
  movingAverage: number;
  sentimentScore: number;
  sentimentLabel: string;
  analysisDate: Date;
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
 * Service for managing portfolio and generating recommendations
 */
class PortfolioService {
  private groq: Groq;

  constructor() {
    this.groq = new Groq({ apiKey: config.apiKeys.groq });
  }

  /**
   * Add asset to portfolio
   */
  async addAsset(
    assetName: string,
    assetType: AssetType,
    symbol: string,
    amount: number,
    buyingPrice: number
  ): Promise<PortfolioAsset> {
    try {
      const asset = await prisma.portfolio.create({
        data: {
          assetName,
          assetType,
          symbol: symbol.toUpperCase(),
          amount,
          buyingPrice,
        },
      });

      logger.info(`Asset added to portfolio: ${assetName} (${symbol}) - Amount: ${amount}, Buying Price: $${buyingPrice}`);
      return asset;
    } catch (error) {
      logger.error('Error adding asset to portfolio:', error);
      throw error;
    }
  }

  /**
   * Get all portfolio assets
   */
  async getPortfolio(): Promise<PortfolioAsset[]> {
    return await prisma.portfolio.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get all portfolio assets with current prices and calculations
   */
  async getPortfolioWithCurrentPrices(): Promise<PortfolioAssetWithCurrentPrice[]> {
    try {
      const assets = await prisma.portfolio.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          analyses: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { createdAt: true }
          }
        }
      });

      const portfolioWithPrices = await Promise.all(
        assets.map(async (asset) => {
          try {
            // Fetch current price based on asset type
            const priceData = asset.assetType === 'CRYPTO'
              ? await marketDataService.getCryptoPrice(asset.symbol)
              : await marketDataService.getMetalPrice(asset.symbol);

            const currentPrice = priceData.price;
            const priceChangeAbsolute = currentPrice - asset.buyingPrice;
            const priceChange = ((currentPrice - asset.buyingPrice) / asset.buyingPrice) * 100;
            const totalValue = currentPrice * asset.amount;
            const totalCost = asset.buyingPrice * asset.amount;
            const profitLoss = totalValue - totalCost;
            const profitLossPercentage = ((totalValue - totalCost) / totalCost) * 100;

            return {
              ...asset,
              lastAnalyzedAt: asset.analyses?.[0]?.createdAt,
              currentPrice,
              priceChange,
              priceChangeAbsolute,
              totalValue,
              totalCost,
              profitLoss,
              profitLossPercentage,
            } as PortfolioAssetWithCurrentPrice;
          } catch (error) {
            logger.error(`Error fetching current price for ${asset.symbol}:`, error);
            // Return asset with zero current price if fetch fails
            return {
              ...asset,
              lastAnalyzedAt: asset.analyses?.[0]?.createdAt,
              currentPrice: 0,
              priceChange: 0,
              priceChangeAbsolute: 0,
              totalValue: 0,
              totalCost: asset.buyingPrice * asset.amount,
              profitLoss: -(asset.buyingPrice * asset.amount),
              profitLossPercentage: -100,
            } as PortfolioAssetWithCurrentPrice;
          }
        })
      );

      return portfolioWithPrices;
    } catch (error) {
      logger.error('Error getting portfolio with current prices:', error);
      throw error;
    }
  }

  /**
   * Update asset fields
   */
  async updateAsset(id: string, updateData: { amount?: number; buyingPrice?: number }): Promise<PortfolioAsset> {
    try {
      const asset = await prisma.portfolio.update({
        where: { id },
        data: updateData,
      });

      logger.info(`Asset updated: ${asset.assetName} - Data: ${JSON.stringify(updateData)}`);
      return asset;
    } catch (error) {
      logger.error('Error updating asset:', error);
      throw error;
    }
  }

  /**
   * Remove asset from portfolio
   */
  async removeAsset(id: string): Promise<void> {
    try {
      await prisma.portfolio.delete({
        where: { id },
      });

      logger.info(`Asset removed from portfolio: ${id}`);
    } catch (error) {
      logger.error('Error removing asset:', error);
      throw error;
    }
  }

  /**
   * Analyze portfolio asset and generate recommendation
   */
  async analyzeAsset(portfolioId: string): Promise<RecommendationData> {
    try {
      const portfolio = await prisma.portfolio.findUnique({
        where: { id: portfolioId },
      });

      if (!portfolio) {
        throw new Error('Portfolio asset not found');
      }

      logger.info(`Analyzing ${portfolio.assetName}...`);

      // Fetch market data
      const currentPrice = portfolio.assetType === 'CRYPTO'
        ? await marketDataService.getCryptoPrice(portfolio.symbol)
        : await marketDataService.getMetalPrice(portfolio.symbol);

      const historicalPrices = portfolio.assetType === 'CRYPTO'
        ? await marketDataService.getCryptoHistoricalPrices(portfolio.symbol, 30)
        : await marketDataService.getMetalHistoricalPrices(portfolio.symbol, 30);

      const technicalIndicators = marketDataService.calculateTechnicalIndicators(historicalPrices);

      // Fetch and analyze news
      const newsArticles = await newsService.fetchNewsForAssets([portfolio.assetName], portfolio.assetType);
      const sentiments = newsArticles.map(n => n.sentiment);
      const aggregatedSentiment = sentimentService.aggregateSentiment(sentiments);

      // Generate AI recommendation
      const recommendation = await this.generateRecommendation(
        portfolio,
        currentPrice.price,
        technicalIndicators,
        aggregatedSentiment,
        newsArticles.slice(0, 5)
      );

      // Build the full recommendation payload
      const fullRecommendation: RecommendationData = {
        id: `temp-${portfolioId}-${Date.now()}`, // Temporary ID
        action: recommendation.action,
        reasoning: recommendation.reasoning,
        confidence: recommendation.confidence,
        priceTarget: recommendation.priceTarget || undefined,
        riskLevel: recommendation.riskLevel,
        currentPrice: currentPrice.price,
        priceChange7d: technicalIndicators.priceChange7d,
        volatility: technicalIndicators.volatility,
        movingAverage: technicalIndicators.movingAverage7d,
        sentimentScore: aggregatedSentiment.score,
        sentimentLabel: aggregatedSentiment.label,
        analysisDate: new Date(),
        
        // Advanced calculations parameters
        rsi: technicalIndicators.rsi,
        rsiSignal: technicalIndicators.rsiSignal,
        macd: technicalIndicators.macd,
        bollingerBands: technicalIndicators.bollingerBands,
        obv: technicalIndicators.obv,
      };

      // Save the analysis to the PortfolioAnalysis table
      await prisma.portfolioAnalysis.create({
        data: { 
          portfolioId: portfolioId,
          data: fullRecommendation as any
        },
      }).catch(err => {
        logger.error(`Failed to save analysis for ${portfolio.assetName}:`, err);
      });

      logger.info(`Recommendation generated for ${portfolio.assetName}: ${recommendation.action}`);

      return fullRecommendation;
    } catch (error) {
      logger.error('Error analyzing asset:', error);
      throw error;
    }
  }

  /**
   * Get cached AI-powered recommendation for a portfolio asset
   */
  async getCachedAnalysis(portfolioId: string): Promise<RecommendationData | null> {
    try {
      const latestAnalysis = await prisma.portfolioAnalysis.findFirst({
        where: { portfolioId },
        orderBy: { createdAt: 'desc' },
      });
      
      if (!latestAnalysis) {
        return null;
      }
      
      return latestAnalysis.data as unknown as RecommendationData;
    } catch (error) {
      logger.error('Error fetching cached analysis:', error);
      return null;
    }
  }

  /**
   * Generate AI-powered recommendation
   */
  private async generateRecommendation(
    portfolio: PortfolioAsset,
    currentPrice: number,
    technical: TechnicalIndicators,
    sentiment: any,
    recentNews: any[]
  ): Promise<{
    action: Action;
    reasoning: string[];
    confidence: number;
    priceTarget?: number;
    riskLevel: RiskLevel;
  }> {
    // Calculate profit/loss metrics
    const buyingPrice = portfolio.buyingPrice;
    const priceChangeFromBuying = ((currentPrice - buyingPrice) / buyingPrice) * 100;
    const profitLoss = (currentPrice - buyingPrice) * portfolio.amount;
    const isInProfit = currentPrice > buyingPrice;
    
    // Prepare news context with better formatting
    const newsContext = recentNews.length > 0 
      ? recentNews.map((n, i) => `${i + 1}. ${n.title} (Sentiment: ${n.sentiment.label}, Confidence: ${(n.sentiment.confidence * 100).toFixed(0)}%)`).join('\n')
      : 'No recent news available';

    const prompt = `You are a professional financial analyst with expertise in ${portfolio.assetType === 'CRYPTO' ? 'cryptocurrency' : 'precious metals'} markets. Analyze the following investment position and provide a data-driven trading recommendation.

INVESTMENT POSITION:
Asset: ${portfolio.assetName} (${portfolio.symbol})
Asset Type: ${portfolio.assetType}
Holdings: ${portfolio.amount} units
Buying Price: $${buyingPrice.toFixed(2)}
Current Price: $${currentPrice.toFixed(2)}
Position P/L: ${isInProfit ? '+' : ''}${priceChangeFromBuying.toFixed(2)}% (${isInProfit ? '+' : ''}$${profitLoss.toFixed(2)})
Position Status: ${isInProfit ? 'IN PROFIT' : 'IN LOSS'}

TECHNICAL ANALYSIS:
- 7-Day Price Change: ${technical.priceChange7d > 0 ? '+' : ''}${technical.priceChange7d.toFixed(2)}%
- Price Trend: ${technical.trend}
- 7-Day Moving Average: $${technical.movingAverage7d.toFixed(2)}
- Current vs MA: ${((currentPrice / technical.movingAverage7d - 1) * 100).toFixed(2)}%
- Volatility (30-day standard deviation): ${technical.volatility.toFixed(2)} (${technical.volatility > technical.movingAverage7d * 0.1 ? 'HIGH' : technical.volatility < technical.movingAverage7d * 0.05 ? 'LOW' : 'MEDIUM'})
- Relative Strength Index (RSI, 14-period): ${technical.rsi} (${technical.rsiSignal === 'BUY' ? 'OVERSOLD (BUY Signal)' : technical.rsiSignal === 'SELL' ? 'OVERBOUGHT (SELL Signal)' : 'NEUTRAL'})
- MACD (12/26/9 EMA):
  * MACD Line: ${technical.macd?.macdLine}
  * Signal Line: ${technical.macd?.signalLine}
  * Histogram: ${technical.macd?.histogram}
  * Crossover Signal: ${technical.macd?.signal === 'BUY' ? 'BULLISH CROSSOVER (BUY Signal)' : technical.macd?.signal === 'SELL' ? 'BEARISH CROSSOVER (SELL Signal)' : 'NEUTRAL'}
- Bollinger Bands (20-period):
  * Middle Band (20 SMA): $${technical.bollingerBands?.middle.toFixed(2)}
  * Upper Band (Resistance): $${technical.bollingerBands?.upper.toFixed(2)}
  * Lower Band (Support): $${technical.bollingerBands?.lower.toFixed(2)}
  * Signal: ${technical.bollingerBands?.signal === 'BUY' ? 'PRICE TOUCHED LOWER BAND (BUY/SUPPORT Signal)' : technical.bollingerBands?.signal === 'SELL' ? 'PRICE TOUCHED UPPER BAND (SELL/RESISTANCE Signal)' : 'NEUTRAL'}
- On-Balance Volume (OBV): ${technical.obv}

SENTIMENT ANALYSIS (from ${recentNews.length} recent articles):
- Overall Sentiment: ${sentiment.label.toUpperCase()} (Score: ${sentiment.score.toFixed(2)})
- Positive Coverage: ${((sentiment.details?.positive || 0) * 100).toFixed(0)}%
- Negative Coverage: ${((sentiment.details?.negative || 0) * 100).toFixed(0)}%
- Neutral Coverage: ${((sentiment.details?.neutral || 0) * 100).toFixed(0)}%

RECENT NEWS HEADLINES:
${newsContext}

ANALYSIS INSTRUCTIONS:
Provide a comprehensive investment recommendation considering:
1. The current profit/loss position (${isInProfit ? 'in profit' : 'in loss'} by ${Math.abs(priceChangeFromBuying).toFixed(2)}%)
2. Technical indicators (trend: ${technical.trend}, price vs MA)
3. Advanced indicators:
   - RSI (Relative Strength Index): 14-period momentum scanner. Values <30 are oversold (potential BUY/reversal), while values >70 are overbought (potential SELL/profit-taking).
   - MACD (12/26/9 EMA): Trend-following momentum indicator. Bullish crossovers (MACD line crosses above signal line) signify buying opportunities, while Bearish crossovers signify selling pressure.
   - Bollinger Bands (20-period): Volatility bands. Middle band is 20-period simple moving average. Prices touching or crossing the lower band act as support lines (potential BUY), while prices touching upper bands act as resistance (potential SELL).
   - On-Balance Volume (OBV): Volume-weighted indicator showing momentum trends. An increasing OBV indicates buying pressure outstripping selling pressure, confirming price moves.
4. Market sentiment from news analysis
5. Risk-reward ratio for the asset type

Your recommendation should:
- BUY: If strong upward momentum, positive sentiment, and good entry point
- HOLD: If mixed signals, moderate position, or waiting for better entry/exit
- SELL: If downward trend, negative sentiment, significant profit-taking opportunity, or stop-loss needed

Provide 4-6 specific, actionable reasoning points that justify your recommendation. Base these reasons directly on technical crossover states, RSI values, Bollinger support, and OBV indicators where appropriate.
Include a realistic 7-day price target based on current trends.
Set appropriate risk level based on volatility and market conditions.

REQUIRED JSON FORMAT (respond ONLY with valid JSON):
{
  "action": "BUY|SELL|HOLD",
  "reasoning": [
    "Detailed reason 1 with specific data",
    "Detailed reason 2 with specific data",
    "Detailed reason 3 with specific data",
    "Additional reasons as needed"
  ],
  "confidence": 75,
  "priceTarget": 50000.00,
  "riskLevel": "LOW|MEDIUM|HIGH"
}`;

    try {
      logger.info(`Generating AI recommendation for ${portfolio.assetName} at $${currentPrice.toFixed(2)} (bought at $${portfolio.buyingPrice.toFixed(2)})`);
      
      const completion = await this.groq.chat.completions.create({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: 'You are a professional financial analyst. Always respond with raw valid JSON only, no markdown.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
      });
      const text = completion.choices[0]?.message?.content;

      if (!text) {
        logger.warn(`No valid text returned from AI response for ${portfolio.assetName}, using fallback`);
        throw new Error('Invalid AI response');
      }

      logger.debug(`AI Response for ${portfolio.assetName}: ${text.substring(0, 200)}...`);

      // Extract JSON from response (handle markdown code blocks)
      let jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (!jsonMatch) {
        jsonMatch = text.match(/\{[\s\S]*\}/);
      }
      
      if (!jsonMatch) {
        logger.warn(`No valid JSON found in AI response for ${portfolio.assetName}, using fallback`);
        throw new Error('Invalid AI response format');
      }

      const jsonText = jsonMatch[1] || jsonMatch[0];
      const recommendation = JSON.parse(jsonText);

      // Validate recommendation fields
      if (!recommendation.action || !recommendation.reasoning || !Array.isArray(recommendation.reasoning)) {
        logger.warn(`Incomplete recommendation from AI for ${portfolio.assetName}, using fallback`);
        throw new Error('Incomplete recommendation data');
      }

      logger.info(`AI Recommendation for ${portfolio.assetName}: ${recommendation.action} (Confidence: ${recommendation.confidence}%)`);

      // Validate and normalize
      return {
        action: this.normalizeAction(recommendation.action),
        reasoning: Array.isArray(recommendation.reasoning) ? recommendation.reasoning.slice(0, 6) : [],
        confidence: Math.min(Math.max(recommendation.confidence || 50, 0), 100),
        priceTarget: recommendation.priceTarget || undefined,
        riskLevel: this.normalizeRiskLevel(recommendation.riskLevel),
      };
    } catch (error) {
      logger.error('Error generating AI recommendation:', error);
      logger.info(`Using fallback recommendation for ${portfolio.assetName}`);
      
      // Fallback to rule-based recommendation
      return this.generateFallbackRecommendation(portfolio, currentPrice, technical, sentiment);
    }
  }

  /**
   * Fallback rule-based recommendation
   */
  private generateFallbackRecommendation(
    portfolio: PortfolioAsset,
    currentPrice: number,
    technical: TechnicalIndicators,
    sentiment: any
  ): {
    action: Action;
    reasoning: string[];
    confidence: number;
    riskLevel: RiskLevel;
  } {
    const reasoning: string[] = [];
    let action: Action = Action.HOLD;
    let confidence = 50;
    let riskLevel: RiskLevel = RiskLevel.MEDIUM;

    // Calculate profit/loss from buying price
    const buyingPrice = portfolio.buyingPrice;
    const profitLossPercent = ((currentPrice - buyingPrice) / buyingPrice) * 100;
    const isInProfit = currentPrice > buyingPrice;

    // Position-based analysis
    if (isInProfit) {
      if (profitLossPercent > 20) {
        action = Action.SELL;
        reasoning.push(`Strong profit position: +${profitLossPercent.toFixed(2)}% gain from buying price of $${buyingPrice.toFixed(2)}`);
        confidence += 15;
      } else if (profitLossPercent > 10) {
        action = Action.HOLD;
        reasoning.push(`Moderate profit: +${profitLossPercent.toFixed(2)}% gain, consider holding for more upside`);
        confidence += 10;
      }
    } else {
      if (profitLossPercent < -15) {
        action = Action.SELL;
        reasoning.push(`Significant loss: ${profitLossPercent.toFixed(2)}% down from buying price, consider cutting losses`);
        confidence += 10;
        riskLevel = RiskLevel.HIGH;
      } else if (profitLossPercent < -5) {
        action = Action.HOLD;
        reasoning.push(`Minor loss: ${profitLossPercent.toFixed(2)}% down, monitoring for recovery signals`);
      }
    }

    // Technical analysis
    if (technical.priceChange7d > 7) {
      if (action !== Action.SELL) action = Action.BUY;
      reasoning.push(`Strong upward momentum: +${technical.priceChange7d.toFixed(2)}% over 7 days`);
      confidence += 15;
    } else if (technical.priceChange7d > 3) {
      reasoning.push(`Positive price trend: +${technical.priceChange7d.toFixed(2)}% gain in recent week`);
      confidence += 10;
    } else if (technical.priceChange7d < -7) {
      if (!isInProfit || action === Action.HOLD) action = Action.SELL;
      reasoning.push(`Sharp downward trend: ${technical.priceChange7d.toFixed(2)}% decline over 7 days`);
      confidence += 15;
      riskLevel = RiskLevel.HIGH;
    } else if (technical.priceChange7d < -3) {
      reasoning.push(`Negative price momentum: ${technical.priceChange7d.toFixed(2)}% decline`);
      confidence += 5;
    } else {
      reasoning.push(`Price relatively stable with ${technical.priceChange7d.toFixed(2)}% change over 7 days`);
    }

    // Moving average analysis
    const priceVsMA = ((currentPrice - technical.movingAverage7d) / technical.movingAverage7d) * 100;
    if (priceVsMA > 5) {
      reasoning.push(`Price ${priceVsMA.toFixed(2)}% above 7-day MA, potential resistance level`);
    } else if (priceVsMA < -5) {
      reasoning.push(`Price ${Math.abs(priceVsMA).toFixed(2)}% below 7-day MA, potential support level`);
      if (action === Action.HOLD && technical.trend === 'UP') {
        action = Action.BUY;
        reasoning.push('Oversold condition with upward trend suggests buying opportunity');
      }
    }

    // Sentiment analysis
    if (sentiment.score > 0.4) {
      if (action === Action.SELL && isInProfit && profitLossPercent < 15) {
        action = Action.HOLD;
      } else if (action === Action.HOLD) {
        action = Action.BUY;
      }
      reasoning.push(`Strong positive sentiment (${sentiment.score.toFixed(2)}) from ${((sentiment.details?.positive || 0) * 100).toFixed(0)}% positive news`);
      confidence += 15;
    } else if (sentiment.score > 0.15) {
      reasoning.push(`Moderately positive market sentiment (${sentiment.score.toFixed(2)})`);
      confidence += 8;
    } else if (sentiment.score < -0.4) {
      if (action === Action.BUY) action = Action.HOLD;
      else if (action === Action.HOLD && !isInProfit) action = Action.SELL;
      reasoning.push(`Strong negative sentiment (${sentiment.score.toFixed(2)}) from ${((sentiment.details?.negative || 0) * 100).toFixed(0)}% negative news`);
      confidence += 15;
      riskLevel = RiskLevel.HIGH;
    } else if (sentiment.score < -0.15) {
      reasoning.push(`Moderately negative sentiment detected (${sentiment.score.toFixed(2)})`);
      confidence += 8;
    } else {
      reasoning.push(`Neutral market sentiment (${sentiment.score.toFixed(2)})`);
    }

    // Volatility assessment
    const volatilityPercent = (technical.volatility / technical.movingAverage7d) * 100;
    if (volatilityPercent > 10) {
      riskLevel = RiskLevel.HIGH;
      reasoning.push(`High volatility (${volatilityPercent.toFixed(2)}%) indicates elevated risk`);
    } else if (volatilityPercent < 5) {
      if (riskLevel === RiskLevel.MEDIUM) riskLevel = RiskLevel.LOW;
      reasoning.push(`Low volatility (${volatilityPercent.toFixed(2)}%) suggests stable price action`);
    } else {
      reasoning.push(`Moderate volatility at ${volatilityPercent.toFixed(2)}%`);
    }

    // Final confidence adjustment
    confidence = Math.min(confidence, 85); // Cap fallback confidence at 85%

    logger.info(`Fallback recommendation for ${portfolio.assetName}: ${action} with ${confidence}% confidence`);

    return {
      action,
      reasoning,
      confidence,
      riskLevel,
    };
  }

  /**
   * Get fresh recommendations for all portfolio assets
   * Note: Recommendations are generated on-demand, not stored in database
   */
  async getRecommendations(): Promise<any[]> {
    const portfolios = await this.getPortfolio();
    const recommendations = [];

    for (const portfolio of portfolios) {
      try {
        // Generate fresh recommendation for each asset
        const recommendation = await this.analyzeAsset(portfolio.id);
        
        recommendations.push({
          portfolio: {
            id: portfolio.id,
            assetName: portfolio.assetName,
            symbol: portfolio.symbol,
            assetType: portfolio.assetType,
            amount: portfolio.amount,
          },
          recommendation: {
            id: recommendation.id,
            action: recommendation.action,
            reasoning: recommendation.reasoning,
            confidence: recommendation.confidence,
            priceTarget: recommendation.priceTarget,
            riskLevel: recommendation.riskLevel,
            currentPrice: recommendation.currentPrice,
            priceChange7d: recommendation.priceChange7d,
            volatility: recommendation.volatility,
            movingAverage: recommendation.movingAverage,
            sentimentScore: recommendation.sentimentScore,
            sentimentLabel: recommendation.sentimentLabel,
            analysisDate: recommendation.analysisDate,
          },
        });
      } catch (error) {
        logger.error(`Error generating recommendation for ${portfolio.assetName}:`, error);
        // Skip this asset if recommendation fails
      }
    }

    return recommendations;
  }

  /**
   * Normalize action to enum
   */
  private normalizeAction(action: string): Action {
    const normalized = action.toUpperCase();
    if (normalized === 'BUY') return Action.BUY;
    if (normalized === 'SELL') return Action.SELL;
    if (normalized === 'HOLD') return Action.HOLD;
    return Action.HOLD;
  }

  /**
   * Normalize risk level to enum
   */
  private normalizeRiskLevel(level: string): RiskLevel {
    const normalized = level.toUpperCase();
    if (normalized === 'LOW') return RiskLevel.LOW;
    if (normalized === 'MEDIUM') return RiskLevel.MEDIUM;
    if (normalized === 'HIGH') return RiskLevel.HIGH;
    return RiskLevel.MEDIUM;
  }
}

export default new PortfolioService();
