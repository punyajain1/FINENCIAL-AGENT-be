import { HfInference } from '@huggingface/inference';
import { GoogleGenAI } from '@google/genai';
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
  private genAI: GoogleGenAI;
  private model = 'ProsusAI/finbert'; // Financial sentiment analysis model

  constructor() {
    this.hf = new HfInference(config.apiKeys.huggingface);
    this.genAI = new GoogleGenAI({ apiKey: config.apiKeys.gemini });
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
      logger.error('Error analyzing sentiment via HuggingFace:', error);
      
      // Fallback to Google Gemini
      return await this.analyzeSentimentWithGemini(text);
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
   * Fallback sentiment analysis using Google Gemini 2.5
   */
  private async analyzeSentimentWithGemini(text: string): Promise<SentimentResult> {
    try {
      logger.info('Performing sentiment analysis fallback using Google Gemini...');
      
      const prompt = `Analyze the sentiment of the following financial text and output a JSON object containing:
1. "score": a number from -1.0 (extremely negative) to 1.0 (extremely positive).
2. "label": one of "positive", "negative", or "neutral".
3. "confidence": a number from 0.0 to 1.0 representing your classification confidence.

Do not include any explanation or markdown formatting (like \`\`\`json). Output raw valid JSON only.

TEXT TO ANALYZE:
"${text.substring(0, 1000)}"`;

      const response = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        }
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error('Gemini returned an empty response');
      }

      const result = JSON.parse(responseText.trim());
      const score = Number(result.score) ?? 0;
      const label = (result.label || 'neutral').toLowerCase() as 'positive' | 'negative' | 'neutral';
      const confidence = Number(result.confidence) ?? 0.5;

      const details = {
        positive: label === 'positive' ? confidence : (label === 'negative' ? 0 : (1 - confidence) / 2),
        negative: label === 'negative' ? confidence : (label === 'positive' ? 0 : (1 - confidence) / 2),
        neutral: label === 'neutral' ? confidence : 1 - confidence,
      };

      logger.info(`Gemini sentiment result: ${label} (score: ${score}, confidence: ${confidence})`);

      return {
        score,
        label,
        confidence,
        details,
      };
    } catch (error) {
      logger.error('Gemini fallback sentiment analysis failed:', error);
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
