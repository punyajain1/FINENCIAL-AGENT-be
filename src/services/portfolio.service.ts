import prisma from '../config/database';
import { AssetType, Action, RiskLevel } from '@prisma/client';
import marketDataService, { TechnicalIndicators } from './marketData.service';
import newsService from './news.service';
import sentimentService from './sentiment.service';
import { logger } from '../utils/logger';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
}

/**
 * Service for managing portfolio and generating recommendations
 */
class PortfolioService {
  private genAI: GoogleGenerativeAI;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
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
   * Update asset amount
   */
  async updateAsset(id: string, amount: number): Promise<PortfolioAsset> {
    try {
      const asset = await prisma.portfolio.update({
        where: { id },
        data: { amount },
      });

      logger.info(`Asset updated: ${asset.assetName} - Amount: ${amount}`);
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
        ? await marketDataService.getCryptoHistoricalPrices(portfolio.symbol)
        : await marketDataService.getMetalHistoricalPrices(portfolio.symbol);

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

      // Store recommendation
      const savedRecommendation = await prisma.recommendation.create({
        data: {
          portfolioId,
          action: recommendation.action,
          reasoning: recommendation.reasoning,
          confidence: recommendation.confidence,
          priceTarget: recommendation.priceTarget,
          riskLevel: recommendation.riskLevel,
          currentPrice: currentPrice.price,
          priceChange7d: technicalIndicators.priceChange7d,
          volatility: technicalIndicators.volatility,
          movingAverage: technicalIndicators.movingAverage7d,
          sentimentScore: aggregatedSentiment.score,
          sentimentLabel: aggregatedSentiment.label,
        },
      });

      logger.info(`Recommendation generated for ${portfolio.assetName}: ${recommendation.action}`);

      return {
        id: savedRecommendation.id,
        action: savedRecommendation.action,
        reasoning: savedRecommendation.reasoning,
        confidence: savedRecommendation.confidence,
        priceTarget: savedRecommendation.priceTarget || undefined,
        riskLevel: savedRecommendation.riskLevel,
        currentPrice: savedRecommendation.currentPrice,
        priceChange7d: savedRecommendation.priceChange7d,
        volatility: savedRecommendation.volatility,
        movingAverage: savedRecommendation.movingAverage,
        sentimentScore: savedRecommendation.sentimentScore,
        sentimentLabel: savedRecommendation.sentimentLabel,
        analysisDate: savedRecommendation.analysisDate,
      };
    } catch (error) {
      logger.error('Error analyzing asset:', error);
      throw error;
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
    const newsContext = recentNews.map(n => `- ${n.title} (Sentiment: ${n.sentiment.label})`).join('\n');

    const prompt = `You are a professional financial analyst. Analyze the following asset and provide a trading recommendation.

Asset: ${portfolio.assetName} (${portfolio.symbol})
Asset Type: ${portfolio.assetType}
Current Holdings: ${portfolio.amount} units

Market Data:
- Current Price: $${currentPrice.toFixed(2)}
- 7-Day Price Change: ${technical.priceChange7d.toFixed(2)}%
- Price Trend: ${technical.trend}
- 7-Day Moving Average: $${technical.movingAverage7d.toFixed(2)}
- Volatility: ${technical.volatility.toFixed(2)}

Sentiment Analysis:
- Overall Sentiment: ${sentiment.label} (Score: ${sentiment.score.toFixed(2)})
- Positive News: ${((sentiment.details?.positive || 0) * 100).toFixed(0)}%
- Negative News: ${((sentiment.details?.negative || 0) * 100).toFixed(0)}%
- Neutral News: ${((sentiment.details?.neutral || 0) * 100).toFixed(0)}%

Recent News Headlines:
${newsContext}

Based on this data, provide:
1. Action: BUY, SELL, or HOLD
2. Reasoning: 3-5 key points explaining your recommendation
3. Confidence: A percentage (0-100) indicating how confident you are
4. Price Target: A realistic price target for the next 7 days (optional)
5. Risk Level: LOW, MEDIUM, or HIGH

Format your response as JSON:
{
  "action": "BUY|SELL|HOLD",
  "reasoning": ["reason 1", "reason 2", "reason 3"],
  "confidence": 75,
  "priceTarget": 50000,
  "riskLevel": "MEDIUM"
}`;

    try {
      // Use Google Generative AI directly
      const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Invalid AI response format');
      }

      const recommendation = JSON.parse(jsonMatch[0]);

      // Validate and normalize
      return {
        action: this.normalizeAction(recommendation.action),
        reasoning: Array.isArray(recommendation.reasoning) ? recommendation.reasoning : [],
        confidence: Math.min(Math.max(recommendation.confidence || 50, 0), 100),
        priceTarget: recommendation.priceTarget || undefined,
        riskLevel: this.normalizeRiskLevel(recommendation.riskLevel),
      };
    } catch (error) {
      logger.error('Error generating AI recommendation:', error);
      
      // Fallback to rule-based recommendation
      return this.generateFallbackRecommendation(technical, sentiment);
    }
  }

  /**
   * Fallback rule-based recommendation
   */
  private generateFallbackRecommendation(
    technical: TechnicalIndicators,
    sentiment: any
  ): {
    action: Action;
    reasoning: string[];
    confidence: number;
    riskLevel: RiskLevel;
  } {
    const reasoning: string[] = [];
    let action: Action = 'HOLD';
    let confidence = 50;
    let riskLevel: RiskLevel = 'MEDIUM';

    // Technical analysis
    if (technical.priceChange7d > 5 && technical.trend === 'UP') {
      action = 'BUY';
      reasoning.push('Strong upward price momentum over the past 7 days');
      confidence += 15;
    } else if (technical.priceChange7d < -5 && technical.trend === 'DOWN') {
      action = 'SELL';
      reasoning.push('Significant downward trend detected');
      confidence += 15;
    } else {
      reasoning.push('Price showing stable movement, no clear trend');
    }

    // Sentiment analysis
    if (sentiment.score > 0.3) {
      if (action === 'SELL') action = 'HOLD';
      else action = 'BUY';
      reasoning.push('Positive market sentiment from recent news');
      confidence += 10;
    } else if (sentiment.score < -0.3) {
      if (action === 'BUY') action = 'HOLD';
      else action = 'SELL';
      reasoning.push('Negative market sentiment detected');
      confidence += 10;
    } else {
      reasoning.push('Neutral sentiment in recent news coverage');
    }

    // Volatility assessment
    if (technical.volatility > technical.movingAverage7d * 0.1) {
      riskLevel = 'HIGH';
      reasoning.push('High volatility indicates increased risk');
    } else if (technical.volatility < technical.movingAverage7d * 0.05) {
      riskLevel = 'LOW';
      reasoning.push('Low volatility suggests stable price action');
    }

    return {
      action,
      reasoning,
      confidence: Math.min(confidence, 100),
      riskLevel,
    };
  }

  /**
   * Get latest recommendations for all portfolio assets
   */
  async getRecommendations(): Promise<any[]> {
    const portfolios = await this.getPortfolio();
    const recommendations = [];

    for (const portfolio of portfolios) {
      const latestRec = await prisma.recommendation.findFirst({
        where: { portfolioId: portfolio.id },
        orderBy: { analysisDate: 'desc' },
        include: { portfolio: true },
      });

      if (latestRec) {
        recommendations.push({
          portfolio: {
            id: portfolio.id,
            assetName: portfolio.assetName,
            symbol: portfolio.symbol,
            assetType: portfolio.assetType,
            amount: portfolio.amount,
          },
          recommendation: {
            id: latestRec.id,
            action: latestRec.action,
            reasoning: latestRec.reasoning,
            confidence: latestRec.confidence,
            priceTarget: latestRec.priceTarget,
            riskLevel: latestRec.riskLevel,
            currentPrice: latestRec.currentPrice,
            priceChange7d: latestRec.priceChange7d,
            volatility: latestRec.volatility,
            movingAverage: latestRec.movingAverage,
            sentimentScore: latestRec.sentimentScore,
            sentimentLabel: latestRec.sentimentLabel,
            analysisDate: latestRec.analysisDate,
          },
        });
      }
    }

    return recommendations;
  }

  /**
   * Normalize action to enum
   */
  private normalizeAction(action: string): Action {
    const normalized = action.toUpperCase();
    if (normalized === 'BUY' || normalized === 'SELL' || normalized === 'HOLD') {
      return normalized as Action;
    }
    return 'HOLD';
  }

  /**
   * Normalize risk level to enum
   */
  private normalizeRiskLevel(level: string): RiskLevel {
    const normalized = level.toUpperCase();
    if (normalized === 'LOW' || normalized === 'MEDIUM' || normalized === 'HIGH') {
      return normalized as RiskLevel;
    }
    return 'MEDIUM';
  }
}

export default new PortfolioService();
