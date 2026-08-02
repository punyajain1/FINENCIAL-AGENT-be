import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
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
  createdAt?: Date;
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

/** All 12 Tier-1 / Tier-2 crypto RSS feeds. No API key required. */
const RSS_FEEDS: Array<{ name: string; url: string; tier: 1 | 2 }> = [
  { name: 'Bloomberg Crypto',    url: 'https://feeds.bloomberg.com/crypto/news.rss',                                                                           tier: 1 },
  { name: 'Financial Times',     url: 'https://www.ft.com/crypto?format=rss',                                                                                  tier: 1 },
  { name: 'CoinDesk',            url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',                                                                        tier: 1 },
  { name: 'The Block',           url: 'https://www.theblock.co/rss.xml',                                                                                        tier: 1 },
  { name: 'Cointelegraph',       url: 'https://cointelegraph.com/rss',                                                                                          tier: 1 },
  { name: 'Decrypt',             url: 'https://decrypt.co/feed',                                                                                                tier: 1 },
  { name: 'Bitcoin Magazine',    url: 'https://bitcoinmagazine.com/feed',                                                                                        tier: 1 },
  { name: 'The Defiant',         url: 'https://thedefiant.io/feed/',                                                                                            tier: 2 },
  { name: 'Protos',              url: 'https://protos.com/feed',                                                                                                tier: 2 },
  { name: 'Messari',             url: 'https://news.google.com/rss/search?q=site:messari.io%20(bitcoin%20OR%20ethereum%20OR%20crypto)&hl=en-US&gl=US&ceid=US:en', tier: 1 },
  { name: 'Unchained',           url: 'https://news.google.com/rss/search?q=site:unchainedcrypto.com%20crypto&hl=en-US&gl=US&ceid=US:en',                      tier: 1 },
  { name: 'CryptoSlate',         url: 'https://cryptoslate.com/feed/',                                                                                          tier: 2 },
];

/** Keywords used to filter RSS items that are relevant to a specific asset. */
const ASSET_KEYWORDS: Record<string, string[]> = {
  BTC:     ['bitcoin', 'btc', 'satoshi', 'lightning network', 'cryptocurrency'],
  ETH:     ['ethereum', 'eth', 'ether', 'evm', 'vitalik', 'solidity', 'defi', 'nft', 'cryptocurrency'],
  XAU:     ['gold', 'xau', 'bullion', 'precious metal'],
  XAG:     ['silver', 'xag', 'precious metal'],
  // generic fallbacks
  CRYPTO:  ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'blockchain', 'defi', 'nft'],
  METAL:   ['gold', 'silver', 'xau', 'xag', 'precious metal'],
};

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

    // Run paid API source + all RSS feeds in parallel
    const [paidArticles, rssArticles] = await Promise.all([
      this.fetchFromPaidApi(searchQuery, asset, assetType),
      this.fetchFromRss(asset, assetType),
    ]);

    let articles = this.deduplicateNews([...paidArticles, ...rssArticles]);

    // Analyze sentiment for each article
    if (articles.length > 0) {
      articles = await this.enrichWithSentiment(articles);
    }

    await cacheService.set(cacheKey, articles, 300); // Cache for 5 minutes
    return articles;
  }

  /**
   * Fetch news from whichever paid API source is configured (NewsAPI / GNews / Currents).
   * Returns an empty array if no key is configured — RSS will still run.
   */
  private async fetchFromPaidApi(query: string, asset: string, assetType: AssetType): Promise<NewsArticle[]> {
    try {
      if (config.apiKeys.newsApi) {
        return await this.fetchFromNewsApi(query, asset, assetType);
      } else if (config.apiKeys.gnews) {
        return await this.fetchFromGNews(query, asset, assetType);
      } else if (config.apiKeys.currentsApi) {
        return await this.fetchFromCurrentsApi(query, asset, assetType);
      }
    } catch (error) {
      logger.error(`Error fetching paid-API news for ${asset}:`, error);
    }
    return [];
  }

  /**
   * Fetch and parse all RSS feeds in parallel.
   * Failed feeds are silently skipped so one bad feed never blocks the rest.
   */
  private async fetchFromRss(asset: string, assetType: AssetType): Promise<NewsArticle[]> {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      cdataPropName: '__cdata',
    });

    // Determine which keywords to match for this asset
    const upperAsset = asset.toUpperCase();
    const keywords = [
      ...(ASSET_KEYWORDS[upperAsset] ?? []),
      ...(assetType === 'CRYPTO' ? ASSET_KEYWORDS['CRYPTO'] : ASSET_KEYWORDS['METAL']),
    ];
    const uniqueKeywords = [...new Set(keywords.map((k) => k.toLowerCase()))];

    const results = await Promise.allSettled(
      RSS_FEEDS.map(async (feed) => {
        try {
          const response = await axios.get(feed.url, {
            timeout: 8000,
            headers: {
              'User-Agent': 'FinPilot/1.0 (RSS reader; financial data aggregator)',
              'Accept': 'application/rss+xml, application/xml, text/xml, */*',
            },
          });

          const parsed = parser.parse(response.data as string);
          const channel = parsed?.rss?.channel ?? parsed?.feed;
          if (!channel) return [];

          // Support both RSS <item> and Atom <entry>
          const rawItems: any[] = [
            ...(Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : []),
            ...(Array.isArray(channel.entry) ? channel.entry : channel.entry ? [channel.entry] : []),
          ];

          const articles: NewsArticle[] = [];

          for (const item of rawItems) {
            const title: string = this.extractText(item.title) ?? '';
            const description: string = this.extractText(item.description) ?? this.extractText(item.summary) ?? '';
            const combinedText = `${title} ${description}`.toLowerCase();

            // Filter: only keep articles relevant to this asset
            const isRelevant = uniqueKeywords.some((kw) => combinedText.includes(kw));
            if (!isRelevant) continue;

            const url: string = this.extractLink(item) ?? '';
            if (!url) continue;

            const publishedAt = this.parseDate(item.pubDate ?? item.published ?? item.updated);
            const imageUrl = this.extractImageUrl(item);

            articles.push({
              title: title.trim(),
              description: description.trim(),
              content: this.extractText(item['content:encoded']) ?? description.trim(),
              source: feed.name,
              author: this.extractText(item.author) ?? this.extractText(item['dc:creator']) ?? feed.name,
              publishedAt,
              url,
              imageUrl,
              relatedAssets: [asset],
              assetType,
              sentiment: { score: 0, label: 'neutral' as const, confidence: 0 },
              relevanceScore: this.calculateRelevance(title, description, asset),
            });
          }

          logger.debug(`RSS ${feed.name}: ${articles.length} relevant articles for ${asset}`);
          return articles;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`RSS feed failed [${feed.name}]: ${msg}`);
          return [];
        }
      })
    );

    const allArticles: NewsArticle[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allArticles.push(...result.value);
      }
    }

    logger.info(`RSS: fetched ${allArticles.length} total articles for ${asset} across ${RSS_FEEDS.length} feeds`);
    return allArticles;
  }

  /** Extract plain text from an RSS field that may be a string, CDATA object, or nested object. */
  private extractText(field: any): string | undefined {
    if (!field) return undefined;
    if (typeof field === 'string') return field;
    if (typeof field === 'number') return String(field);
    if (field.__cdata) return field.__cdata;
    if (field['#text']) return field['#text'];
    return undefined;
  }

  /** Extract article URL from an RSS item (handles <link>, <guid isPermaLink>, Atom <link href=>). */
  private extractLink(item: any): string | undefined {
    if (!item) return undefined;
    // Atom: <link href="..." rel="alternate">
    if (item.link && typeof item.link === 'object') {
      if (Array.isArray(item.link)) {
        const alt = item.link.find((l: any) => l['@_rel'] === 'alternate' || !l['@_rel']);
        return alt?.['@_href'] ?? undefined;
      }
      return item.link['@_href'] ?? undefined;
    }
    // RSS: <link>url</link>
    if (typeof item.link === 'string') return item.link;
    // <guid isPermaLink="true">
    const guid = item.guid;
    if (typeof guid === 'string' && guid.startsWith('http')) return guid;
    if (guid && guid['#text'] && guid['@_isPermaLink'] !== 'false') return guid['#text'];
    return undefined;
  }

  /** Extract image URL from common RSS image fields. */
  private extractImageUrl(item: any): string | undefined {
    // <media:content url="..."> or <media:thumbnail url="...">
    const mediaContent = item['media:content'] ?? item['media:thumbnail'];
    if (mediaContent) {
      if (typeof mediaContent === 'object' && mediaContent['@_url']) return mediaContent['@_url'];
      if (Array.isArray(mediaContent) && mediaContent[0]?.['@_url']) return mediaContent[0]['@_url'];
    }
    // <enclosure url="..." type="image/...">
    const enclosure = item.enclosure;
    if (enclosure && enclosure['@_url'] && enclosure['@_type']?.startsWith('image')) {
      return enclosure['@_url'];
    }
    return undefined;
  }

  /** Parse a date string leniently; falls back to now if unparseable. */
  private parseDate(raw: any): Date {
    if (!raw) return new Date();
    const str = typeof raw === 'string' ? raw : String(raw);
    const parsed = new Date(str);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
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
          logger.debug(`New article stored: ${article.title}`);
        }
      } catch (error) {
        logger.error(`Error storing news article: ${article.url}`, error);
      }
    }

    logger.debug(`Stored news: ${newArticles.length} new out of ${articles.length} total`);
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
      createdAt: article.createdAt,
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
