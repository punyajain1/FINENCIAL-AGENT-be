import axios from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import cacheService from './cache.service';
import sentimentService, { SentimentResult } from './sentiment.service';
import prisma from '../config/database';
import { AssetType } from '@prisma/client';

export interface NewsArticle {
  id?: string;
  title: string;
  description: string;
  content?: string;
  source: string;
  author?: string;
  publishedAt: Date;
  url: string;
  imageUrl?: string;
  relatedAssets: string[];
  assetType?: AssetType;
  sentiment: SentimentResult;
  relevanceScore: number;
}

export interface NewsFilter {
  assetType?: 'CRYPTO' | 'METAL';
  assetName?: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Service for fetching and managing news from multiple sources
 */
class NewsService {
  /**
   * Fetch news for specific assets
   */
  async fetchNewsForAssets(assets: string[], assetType: AssetType): Promise<NewsArticle[]> {
    const allNews: NewsArticle[] = [];

    for (const asset of assets) {
      const news = await this.fetchNewsForAsset(asset, assetType);
      allNews.push(...news);
    }

    // Deduplicate based on URL
    const uniqueNews = this.deduplicateNews(allNews);

    // Store in database and return only NEW articles
    const newArticles = await this.storeNews(uniqueNews);

    return newArticles;
  }

  /**
   * Fetch news for a specific asset
   */
  private async fetchNewsForAsset(asset: string, assetType: AssetType): Promise<NewsArticle[]> {
    const cacheKey = `news:${assetType}:${asset}`;
    const cached = await cacheService.get<NewsArticle[]>(cacheKey);

    if (cached) {
      logger.debug(`Cache hit for news: ${asset}`);
      return cached;
    }

    const searchQuery = this.buildSearchQuery(asset, assetType);
    let articles: NewsArticle[] = [];

    // Try multiple news sources
    try {
      if (config.apiKeys.newsApi) {
        articles = await this.fetchFromNewsApi(searchQuery, asset, assetType);
      } else if (config.apiKeys.gnews) {
        articles = await this.fetchFromGNews(searchQuery, asset, assetType);
      } else if (config.apiKeys.currentsApi) {
        articles = await this.fetchFromCurrentsApi(searchQuery, asset, assetType);
      }
    } catch (error) {
      logger.error(`Error fetching news for ${asset}:`, error);
    }

    // Analyze sentiment for each article
    if (articles.length > 0) {
      articles = await this.enrichWithSentiment(articles);
    }

    await cacheService.set(cacheKey, articles, 300); // Cache for 5 minutes
    return articles;
  }

  /**
   * Fetch news from NewsAPI.org
   */
  private async fetchFromNewsApi(query: string, asset: string, assetType: AssetType): Promise<NewsArticle[]> {
    try {
      const response = await axios.get(`${config.apis.newsApi}/everything`, {
        params: {
          q: query,
          language: 'en',
          sortBy: 'publishedAt',
          pageSize: 10,
          apiKey: config.apiKeys.newsApi,
        },
      });

      return response.data.articles.map((article: any) => ({
        title: article.title,
        description: article.description || '',
        content: article.content,
        source: article.source.name,
        author: article.author,
        publishedAt: new Date(article.publishedAt),
        url: article.url,
        imageUrl: article.urlToImage,
        relatedAssets: [asset],
        assetType,
        sentiment: { score: 0, label: 'neutral' as const, confidence: 0 },
        relevanceScore: this.calculateRelevance(article.title, article.description, asset),
      }));
    } catch (error) {
      logger.error('NewsAPI fetch error:', error);
      return [];
    }
  }

  /**
   * Fetch news from GNews API
   */
  private async fetchFromGNews(query: string, asset: string, assetType: AssetType): Promise<NewsArticle[]> {
    try {
      const response = await axios.get(`${config.apis.gnews}/search`, {
        params: {
          q: query,
          lang: 'en',
          max: 10,
          apikey: config.apiKeys.gnews,
        },
      });

      return response.data.articles.map((article: any) => ({
        title: article.title,
        description: article.description || '',
        content: article.content,
        source: article.source.name,
        author: article.source.name,
        publishedAt: new Date(article.publishedAt),
        url: article.url,
        imageUrl: article.image,
        relatedAssets: [asset],
        assetType,
        sentiment: { score: 0, label: 'neutral' as const, confidence: 0 },
        relevanceScore: this.calculateRelevance(article.title, article.description, asset),
      }));
    } catch (error) {
      logger.error('GNews fetch error:', error);
      return [];
    }
  }

  /**
   * Fetch news from Currents API
   */
  private async fetchFromCurrentsApi(query: string, asset: string, assetType: AssetType): Promise<NewsArticle[]> {
    try {
      const response = await axios.get(`${config.apis.currentsApi}/search`, {
        params: {
          keywords: query,
          language: 'en',
          apiKey: config.apiKeys.currentsApi,
        },
      });

      return response.data.news.map((article: any) => ({
        title: article.title,
        description: article.description || '',
        content: article.description,
        source: article.author,
        author: article.author,
        publishedAt: new Date(article.published),
        url: article.url,
        imageUrl: article.image,
        relatedAssets: [asset],
        assetType,
        sentiment: { score: 0, label: 'neutral' as const, confidence: 0 },
        relevanceScore: this.calculateRelevance(article.title, article.description, asset),
      }));
    } catch (error) {
      logger.error('Currents API fetch error:', error);
      return [];
    }
  }

  /**
   * Enrich articles with sentiment analysis
   */
  private async enrichWithSentiment(articles: NewsArticle[]): Promise<NewsArticle[]> {
    const texts = articles.map(a => `${a.title}. ${a.description}`);
    const sentiments = await sentimentService.analyzeBatchSentiment(texts);

    return articles.map((article, index) => ({
      ...article,
      sentiment: sentiments[index],
    }));
  }

  /**
   * Build search query for asset
   */
  private buildSearchQuery(asset: string, assetType: AssetType): string {
    if (assetType === 'CRYPTO') {
      return `${asset} cryptocurrency OR ${asset} crypto OR ${asset} bitcoin`;
    } else {
      return `${asset} price OR ${asset} market OR ${asset} trading`;
    }
  }

  /**
   * Calculate relevance score
   */
  private calculateRelevance(title: string, description: string, asset: string): number {
    const text = `${title} ${description}`.toLowerCase();
    const assetLower = asset.toLowerCase();
    
    let score = 0;
    
    // Check for exact match
    if (text.includes(assetLower)) {
      score += 0.5;
    }
    
    // Check for related keywords
    const keywords = ['price', 'market', 'trading', 'investment', 'analysis', 'forecast'];
    keywords.forEach(keyword => {
      if (text.includes(keyword)) {
        score += 0.1;
      }
    });
    
    return Math.min(score, 1);
  }

  /**
   * Deduplicate news articles
   */
  private deduplicateNews(articles: NewsArticle[]): NewsArticle[] {
    const seen = new Set<string>();
    const unique: NewsArticle[] = [];

    for (const article of articles) {
      if (!seen.has(article.url)) {
        seen.add(article.url);
        unique.push(article);
      }
    }

    return unique;
  }

  /**
   * Store news in database and return only NEW articles
   */
  private async storeNews(articles: NewsArticle[]): Promise<NewsArticle[]> {
    const newArticles: NewsArticle[] = [];

    for (const article of articles) {
      try {
        // Check if article already exists
        const existingArticle = await prisma.news.findUnique({
          where: { url: article.url },
        });

        // If article doesn't exist, it's new
        const isNew = !existingArticle;

        await prisma.news.upsert({
          where: { url: article.url },
          update: {
            title: article.title,
            description: article.description,
            content: article.content,
            source: article.source,
            author: article.author,
            publishedAt: article.publishedAt,
            imageUrl: article.imageUrl,
            relatedAssets: article.relatedAssets,
            assetType: article.assetType,
            sentimentScore: article.sentiment.score,
            sentimentLabel: article.sentiment.label,
            relevanceScore: article.relevanceScore,
          },
          create: {
            title: article.title,
            description: article.description,
            content: article.content,
            source: article.source,
            author: article.author,
            publishedAt: article.publishedAt,
            url: article.url,
            imageUrl: article.imageUrl,
            relatedAssets: article.relatedAssets,
            assetType: article.assetType,
            sentimentScore: article.sentiment.score,
            sentimentLabel: article.sentiment.label,
            relevanceScore: article.relevanceScore,
          },
        });

        // Only add to newArticles if it was actually new
        if (isNew) {
          newArticles.push(article);
          logger.info(`New article stored: ${article.title}`);
        }
      } catch (error) {
        logger.error(`Error storing news article: ${article.url}`, error);
      }
    }

    logger.info(`Stored news: ${newArticles.length} new out of ${articles.length} total`);
    return newArticles;
  }

  /**
   * Get news from database with filters
   */
  async getNews(filter: NewsFilter): Promise<{ articles: NewsArticle[]; total: number }> {
    const where: any = {};

    if (filter.assetType) {
      where.assetType = filter.assetType;
    }

    if (filter.assetName) {
      where.relatedAssets = {
        has: filter.assetName,
      };
    }

    if (filter.sentiment) {
      where.sentimentLabel = filter.sentiment;
    }

    if (filter.startDate || filter.endDate) {
      where.publishedAt = {};
      if (filter.startDate) {
        where.publishedAt.gte = filter.startDate;
      }
      if (filter.endDate) {
        where.publishedAt.lte = filter.endDate;
      }
    }

    const [articles, total] = await Promise.all([
      prisma.news.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        take: filter.limit || 20,
        skip: filter.offset || 0,
      }),
      prisma.news.count({ where }),
    ]);

    const newsArticles: NewsArticle[] = articles.map(article => ({
      id: article.id,
      title: article.title,
      description: article.description,
      content: article.content || undefined,
      source: article.source,
      author: article.author || undefined,
      publishedAt: article.publishedAt,
      url: article.url,
      imageUrl: article.imageUrl || undefined,
      relatedAssets: article.relatedAssets,
      assetType: article.assetType || undefined,
      sentiment: {
        score: article.sentimentScore,
        label: article.sentimentLabel as 'positive' | 'negative' | 'neutral',
        confidence: Math.abs(article.sentimentScore),
      },
      relevanceScore: article.relevanceScore,
    }));

    return { articles: newsArticles, total };
  }

  /**
   * Generate news summary using aggregated sentiment
   */
  async generateNewsSummary(assetName: string): Promise<string> {
    const { articles } = await this.getNews({
      assetName,
      limit: 10,
    });

    if (articles.length === 0) {
      return `No recent news available for ${assetName}.`;
    }

    const sentiments = articles.map(a => a.sentiment);
    const aggregated = sentimentService.aggregateSentiment(sentiments);

    const posCount = sentiments.filter(s => s.label === 'positive').length;
    const negCount = sentiments.filter(s => s.label === 'negative').length;

    return `Recent news sentiment for ${assetName}: ${aggregated.label.toUpperCase()} (${posCount} positive, ${negCount} negative out of ${articles.length} articles). Overall sentiment score: ${aggregated.score.toFixed(2)}.`;
  }
}

export default new NewsService();
