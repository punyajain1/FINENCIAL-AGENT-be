import { HfInference } from '@huggingface/inference';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import cacheService from './cache.service';

export interface SentimentResult {
  score: number; // -1 to 1 (negative to positive)
  label: 'positive' | 'negative' | 'neutral';
  confidence: number; // 0 to 1
  details?: {
    positive: number;
    negative: number;
    neutral: number;
  };
}

/**
 * Service for analyzing sentiment using HuggingFace FinBERT model
 */
class SentimentService {
  private hf: HfInference;
  private model = 'ProsusAI/finbert'; // Financial sentiment analysis model

  constructor() {
    this.hf = new HfInference(config.apiKeys.huggingface);
  }

  /**
   * Analyze sentiment of a single text
   */
  async analyzeSentiment(text: string): Promise<SentimentResult> {
    if (!text || text.trim().length === 0) {
      return this.createNeutralSentiment();
    }

    const cacheKey = `sentiment:${this.hashText(text)}`;
    const cached = await cacheService.get<SentimentResult>(cacheKey);
    
    if (cached) {
      return cached;
    }

    try {
      const result = await this.hf.textClassification({
        model: this.model,
        inputs: text.substring(0, 512), // FinBERT has 512 token limit
      });

      const sentimentResult = this.processSentimentResult(result);
      await cacheService.set(cacheKey, sentimentResult, 3600); // Cache for 1 hour
      
      return sentimentResult;
    } catch (error) {
      logger.error('Error analyzing sentiment:', error);
      
      // Fallback to backup model if FinBERT fails
      return await this.analyzeSentimentWithBackup(text);
    }
  }

  /**
   * Analyze sentiment of multiple texts in batch
   */
  async analyzeBatchSentiment(texts: string[]): Promise<SentimentResult[]> {
    const results: SentimentResult[] = [];

    // Process in batches to avoid rate limits
    const batchSize = 5;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(text => this.analyzeSentiment(text))
      );
      results.push(...batchResults);

      // Add small delay between batches
      if (i + batchSize < texts.length) {
        await this.delay(200);
      }
    }

    return results;
  }

  /**
   * Calculate aggregate sentiment from multiple results
   */
  aggregateSentiment(sentiments: SentimentResult[]): SentimentResult {
    if (sentiments.length === 0) {
      return this.createNeutralSentiment();
    }

    const avgScore = sentiments.reduce((sum, s) => sum + s.score, 0) / sentiments.length;
    const avgConfidence = sentiments.reduce((sum, s) => sum + s.confidence, 0) / sentiments.length;

    let label: 'positive' | 'negative' | 'neutral' = 'neutral';
    if (avgScore > 0.2) label = 'positive';
    else if (avgScore < -0.2) label = 'negative';

    // Calculate aggregated details
    const details = {
      positive: sentiments.filter(s => s.label === 'positive').length / sentiments.length,
      negative: sentiments.filter(s => s.label === 'negative').length / sentiments.length,
      neutral: sentiments.filter(s => s.label === 'neutral').length / sentiments.length,
    };

    return {
      score: avgScore,
      label,
      confidence: avgConfidence,
      details,
    };
  }

  /**
   * Process HuggingFace sentiment result
   */
  private processSentimentResult(result: any): SentimentResult {
    // FinBERT returns labels: positive, negative, neutral
    const sortedResults = Array.isArray(result) ? result.sort((a: any, b: any) => b.score - a.score) : [result];
    const topResult = sortedResults[0];

    let score = 0;
    let label: 'positive' | 'negative' | 'neutral' = 'neutral';

    if (topResult.label.toLowerCase().includes('positive')) {
      score = topResult.score;
      label = 'positive';
    } else if (topResult.label.toLowerCase().includes('negative')) {
      score = -topResult.score;
      label = 'negative';
    } else {
      score = 0;
      label = 'neutral';
    }

    // Extract details
    const details = {
      positive: 0,
      negative: 0,
      neutral: 0,
    };

    sortedResults.forEach((item: any) => {
      if (item.label.toLowerCase().includes('positive')) {
        details.positive = item.score;
      } else if (item.label.toLowerCase().includes('negative')) {
        details.negative = item.score;
      } else {
        details.neutral = item.score;
      }
    });

    return {
      score,
      label,
      confidence: topResult.score,
      details,
    };
  }

  /**
   * Fallback sentiment analysis using simpler model
   */
  private async analyzeSentimentWithBackup(text: string): Promise<SentimentResult> {
    try {
      const backupModel = 'cardiffnlp/twitter-roberta-base-sentiment-latest';
      const result = await this.hf.textClassification({
        model: backupModel,
        inputs: text.substring(0, 512),
      });

      return this.processSentimentResult(result);
    } catch (error) {
      logger.error('Backup sentiment analysis also failed:', error);
      return this.createNeutralSentiment();
    }
  }

  /**
   * Create neutral sentiment result
   */
  private createNeutralSentiment(): SentimentResult {
    return {
      score: 0,
      label: 'neutral',
      confidence: 0.33,
      details: {
        positive: 0.33,
        negative: 0.33,
        neutral: 0.34,
      },
    };
  }

  /**
   * Simple hash function for caching
   */
  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default new SentimentService();
