import cron from 'node-cron';
import { logger } from '../utils/logger';
import portfolioService from '../services/portfolio.service';
import newsService from '../services/news.service';
import cacheService from '../services/cache.service';
import websocketService from '../services/websocket.service';
import prisma from '../config/database';

/**
 * Scheduled jobs service
 */
class CronJobsService {
  /**
   * Initialize all cron jobs
   */
  initializeJobs(): void {
    // Analyze portfolio assets every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      logger.info('Running portfolio analysis job...');
      await this.analyzeAllPortfolios();
    });

    // Fetch news every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      logger.info('Running news fetch job...');
      await this.fetchAllNews();
    });

    // Clean expired cache daily at midnight
    cron.schedule('0 0 * * *', async () => {
      logger.info('Running cache cleanup job...');
      await cacheService.cleanExpired();
    });

    // Clean old news data (older than 30 days) weekly
    cron.schedule('0 0 * * 0', async () => {
      logger.info('Running old news cleanup job...');
      await this.cleanOldNews();
    });

    logger.info('Cron jobs initialized successfully');
  }

  /**
   * Analyze all portfolio assets
   */
  private async analyzeAllPortfolios(): Promise<void> {
    try {
      const portfolios = await portfolioService.getPortfolio();
      
      if (portfolios.length === 0) {
        logger.info('No portfolio assets to analyze');
        return;
      }

      logger.info(`Analyzing ${portfolios.length} portfolio assets...`);

      for (const portfolio of portfolios) {
        try {
          await portfolioService.analyzeAsset(portfolio.id);
          logger.info(`Analysis completed for ${portfolio.assetName}`);
          
          // Add delay to avoid rate limits
          await this.delay(2000); // 2 seconds between each analysis
        } catch (error) {
          logger.error(`Error analyzing ${portfolio.assetName}:`, error);
        }
      }

      logger.info('Portfolio analysis job completed');
    } catch (error) {
      logger.error('Error in portfolio analysis job:', error);
    }
  }

  /**
   * Fetch news for all portfolio assets
   */
  private async fetchAllNews(): Promise<void> {
    try {
      const portfolios = await portfolioService.getPortfolio();
      
      if (portfolios.length === 0) {
        logger.info('No assets in portfolio for news fetching');
        return;
      }

      // Group assets by type
      const cryptoAssets = portfolios
        .filter(p => p.assetType === 'CRYPTO')
        .map(p => p.assetName);
      
      const metalAssets = portfolios
        .filter(p => p.assetType === 'METAL')
        .map(p => p.assetName);

      let allNews: any[] = [];

      // Fetch news for crypto assets (returns only NEW news)
      if (cryptoAssets.length > 0) {
        logger.info(`Fetching news for ${cryptoAssets.length} crypto assets...`);
        const cryptoNews = await newsService.fetchNewsForAssets(cryptoAssets, 'CRYPTO');
        allNews.push(...cryptoNews);
        logger.info(`Found ${cryptoNews.length} new crypto news articles`);
      }

      // Fetch news for metal assets (returns only NEW news)
      if (metalAssets.length > 0) {
        logger.info(`Fetching news for ${metalAssets.length} metal assets...`);
        const metalNews = await newsService.fetchNewsForAssets(metalAssets, 'METAL');
        allNews.push(...metalNews);
        logger.info(`Found ${metalNews.length} new metal news articles`);
      }

      // Only broadcast if there are NEW news articles
      if (allNews.length > 0) {
        logger.info(`Broadcasting ${allNews.length} NEW analyzed news articles via WebSocket`);
        websocketService.broadcastNews(allNews);

        // Also broadcast summary statistics
        await this.broadcastNewsSummary();
      } else {
        logger.info('No new news articles to broadcast');
      }

      logger.info('News fetch job completed');
    } catch (error) {
      logger.error('Error in news fetch job:', error);
    }
  }

  /**
   * Broadcast news summary statistics via WebSocket
   */
  private async broadcastNewsSummary(): Promise<void> {
    try {
      // Get latest news from last 24 hours
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const recentNews = await prisma.news.findMany({
        where: {
          createdAt: {
            gte: yesterday,
          },
        },
      });

      const cryptoNews = recentNews.filter(n => n.assetType === 'CRYPTO');
      const metalNews = recentNews.filter(n => n.assetType === 'METAL');

      const sentimentBreakdown = {
        positive: recentNews.filter(n => n.sentimentLabel === 'positive').length,
        negative: recentNews.filter(n => n.sentimentLabel === 'negative').length,
        neutral: recentNews.filter(n => n.sentimentLabel === 'neutral').length,
      };

      // Get top mentioned assets
      const assetCounts = new Map<string, number>();
      recentNews.forEach(news => {
        news.relatedAssets.forEach(asset => {
          assetCounts.set(asset, (assetCounts.get(asset) || 0) + 1);
        });
      });

      const topAssets = Array.from(assetCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([asset]) => asset);

      const summary = {
        totalArticles: recentNews.length,
        cryptoNews: cryptoNews.length,
        metalNews: metalNews.length,
        sentimentBreakdown,
        topAssets,
      };

      websocketService.broadcastNewsSummary(summary);
      logger.info('News summary broadcasted via WebSocket');
    } catch (error) {
      logger.error('Error broadcasting news summary:', error);
    }
  }

  /**
   * Clean old news data
   */
  private async cleanOldNews(): Promise<void> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const result = await prisma.news.deleteMany({
        where: {
          publishedAt: {
            lt: thirtyDaysAgo,
          },
        },
      });

      logger.info(`Cleaned ${result.count} old news articles`);
    } catch (error) {
      logger.error('Error cleaning old news:', error);
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default new CronJobsService();
