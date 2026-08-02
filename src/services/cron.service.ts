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
  private scheduledTasks: cron.ScheduledTask[] = [];

  /**
   * Initialize all cron jobs
   */
  initializeJobs(): void {
    // Analyze portfolio assets hourly
    const portfolioJob = cron.schedule('0 * * * *', async () => {
      logger.debug('Running portfolio analysis job...');
      await this.analyzeAllPortfolios();
    });
    this.scheduledTasks.push(portfolioJob);

    // Fetch news every 5 minutes
    const newsJob = cron.schedule('*/5 * * * *', async () => {
      logger.debug('Running news fetch job...');
      await this.fetchAllNews();
    });
    this.scheduledTasks.push(newsJob);

    // Clean expired cache daily at midnight
    const cacheJob = cron.schedule('0 0 * * *', async () => {
      logger.debug('Running cache cleanup job...');
      await cacheService.cleanExpired();
    });
    this.scheduledTasks.push(cacheJob);

    // Clean old news data (older than 5 days) daily at midnight
    const cleanNewsJob = cron.schedule('0 0 * * *', async () => {
      logger.debug('Running old news cleanup job...');
      await this.cleanOldNews();
    });
    this.scheduledTasks.push(cleanNewsJob);

    // Run cleanup once on startup to immediately purge anything older than 5 days
    this.cleanOldNews().catch(err => {
      logger.error('Startup news cleanup error:', err);
    });

    // Register event to wake up and refresh metrics instantly when a browser client connects
    websocketService.onConnect(() => {
      logger.info('Active client connected: triggering immediate news & portfolio refresh...');
      this.fetchAllNews().catch(err => logger.error('Immediate connection news fetch failed:', err));
      this.analyzeAllPortfolios().catch(err => logger.error('Immediate connection portfolio analysis failed:', err));
    });

    logger.info('Cron jobs initialized successfully');
  }

  /**
   * Stop all scheduled jobs
   */
  stopJobs(): void {
    logger.info(`Stopping ${this.scheduledTasks.length} scheduled cron jobs...`);
    for (const task of this.scheduledTasks) {
      task.stop();
    }
    this.scheduledTasks = [];
    logger.info('All cron jobs stopped');
  }

  /**
   * Analyze all portfolio assets
   */
  private async analyzeAllPortfolios(): Promise<void> {
    try {
      // Standby check: Skip background analysis if no browser clients are listening
      if (websocketService.getClientCount() === 0) {
        logger.debug('Skipping portfolio analysis job: Standby mode (No active clients connected)');
        return;
      }

      const portfolios = await portfolioService.getPortfolio();
      
      if (portfolios.length === 0) {
        logger.debug('No portfolio assets to analyze');
        return;
      }

      logger.debug(`Analyzing ${portfolios.length} portfolio assets...`);

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      for (const portfolio of portfolios) {
        try {
          // Skip any asset that was analyzed within the last 2 hours
          const latestAnalysis = await portfolioService.getCachedAnalysis(portfolio.id);
          if (latestAnalysis && new Date(latestAnalysis.analysisDate) > twoHoursAgo) {
            logger.debug(`Skipping analysis for ${portfolio.assetName} (${portfolio.symbol}) - analyzed recently at ${new Date(latestAnalysis.analysisDate).toISOString()}`);
            continue;
          }

          await portfolioService.analyzeAsset(portfolio.id);
          logger.debug(`Analysis completed for ${portfolio.assetName}`);
          
          // Add delay to avoid rate limits
          await this.delay(2000); // 2 seconds between each analysis
        } catch (error) {
          logger.error(`Error analyzing ${portfolio.assetName}:`, error);
        }
      }

      logger.debug('Portfolio analysis job completed');
    } catch (error) {
      logger.error('Error in portfolio analysis job:', error);
    }
  }

  /**
   * Fetch news for all portfolio assets
   */
  private async fetchAllNews(): Promise<void> {
    try {
      // Standby check: Skip background news fetch if no browser clients are listening
      if (websocketService.getClientCount() === 0) {
        logger.debug('Skipping news fetch job: Standby mode (No active clients connected)');
        return;
      }

      const portfolios = await portfolioService.getPortfolio();
      
      if (portfolios.length === 0) {
        logger.debug('No assets in portfolio for news fetching');
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
        logger.debug(`Fetching news for ${cryptoAssets.length} crypto assets...`);
        const cryptoNews = await newsService.fetchNewsForAssets(cryptoAssets, 'CRYPTO');
        allNews.push(...cryptoNews);
        logger.debug(`Found ${cryptoNews.length} new crypto news articles`);
      }

      // Fetch news for metal assets (returns only NEW news)
      if (metalAssets.length > 0) {
        logger.debug(`Fetching news for ${metalAssets.length} metal assets...`);
        const metalNews = await newsService.fetchNewsForAssets(metalAssets, 'METAL');
        allNews.push(...metalNews);
        logger.debug(`Found ${metalNews.length} new metal news articles`);
      }

      // Only broadcast if there are NEW news articles
      if (allNews.length > 0) {
        logger.debug(`Broadcasting ${allNews.length} NEW analyzed news articles via WebSocket`);
        websocketService.broadcastNews(allNews);

        // Also broadcast summary statistics
        await this.broadcastNewsSummary();
      } else {
        logger.debug('No new news articles to broadcast');
      }

      logger.debug('News fetch job completed');
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
      logger.debug('News summary broadcasted via WebSocket');
    } catch (error) {
      logger.error('Error broadcasting news summary:', error);
    }
  }

  /**
   * Clean old news data
   */
  private async cleanOldNews(): Promise<void> {
    try {
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

      const result = await prisma.news.deleteMany({
        where: {
          publishedAt: {
            lt: fiveDaysAgo,
          },
        },
      });

      logger.debug(`Cleaned ${result.count} old news articles older than 5 days`);
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
