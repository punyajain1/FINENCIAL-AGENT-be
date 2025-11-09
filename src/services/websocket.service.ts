import { Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { logger } from '../utils/logger';
import { NewsArticle } from './news.service';
import prisma from '../config/database';

/**
 * WebSocket service for real-time news updates
 */
class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  /**
   * Initialize WebSocket server
   */
  initialize(server: HTTPServer): void {
    this.wss = new WebSocketServer({ server, path: '/ws/news' });

    this.wss.on('connection', async (ws: WebSocket) => {
      logger.info('New WebSocket client connected');
      this.clients.add(ws);

      // Send welcome message
      this.sendToClient(ws, {
        type: 'connection',
        message: 'Connected to news WebSocket',
        timestamp: new Date().toISOString(),
      });

      // Send all existing news from database to the newly connected client
      await this.sendAllNewsToClient(ws);

      // Handle client messages
      ws.on('message', (message: string) => {
        try {
          const data = JSON.parse(message.toString());
          logger.debug('Received message from client:', data);
          
          // Handle subscribe/unsubscribe requests if needed
          if (data.type === 'ping') {
            this.sendToClient(ws, { type: 'pong', timestamp: new Date().toISOString() });
          }
        } catch (error) {
          logger.error('Error parsing client message:', error);
        }
      });

      // Handle client disconnect
      ws.on('close', () => {
        logger.info('WebSocket client disconnected');
        this.clients.delete(ws);
      });

      // Handle errors
      ws.on('error', (error) => {
        logger.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
    });

    logger.info('WebSocket server initialized at /ws/news');
  }

  /**
   * Send all existing news from database to a newly connected client
   */
  private async sendAllNewsToClient(client: WebSocket): Promise<void> {
    try {
      // Fetch all news from database, ordered by most recent first
      const allNews = await prisma.news.findMany({
        orderBy: { publishedAt: 'desc' },
        take: 100, // Limit to latest 100 articles to avoid overwhelming the client
      });

      if (allNews.length === 0) {
        logger.info('No existing news in database to send to client');
        this.sendToClient(client, {
          type: 'initial_news',
          message: 'No news available yet',
          count: 0,
          data: [],
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Convert to NewsArticle format
      const newsArticles: NewsArticle[] = allNews.map(article => ({
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

      // Send all existing news to the client
      this.sendToClient(client, {
        type: 'initial_news',
        message: 'All existing news from database',
        count: newsArticles.length,
        data: newsArticles,
        timestamp: new Date().toISOString(),
      });

      logger.info(`Sent ${newsArticles.length} existing news articles to newly connected client`);
    } catch (error) {
      logger.error('Error sending existing news to client:', error);
      this.sendToClient(client, {
        type: 'error',
        message: 'Failed to fetch existing news',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Broadcast new news to all connected clients
   */
  broadcastNews(news: NewsArticle[]): void {
    if (!this.wss || news.length === 0) {
      return;
    }

    const message = {
      type: 'news_update',
      timestamp: new Date().toISOString(),
      count: news.length,
      data: news,
    };

    logger.info(`Broadcasting ${news.length} news articles to ${this.clients.size} clients`);
    this.broadcast(message);
  }

  /**
   * Broadcast news summary statistics
   */
  broadcastNewsSummary(summary: {
    totalArticles: number;
    cryptoNews: number;
    metalNews: number;
    sentimentBreakdown: {
      positive: number;
      negative: number;
      neutral: number;
    };
    topAssets: string[];
  }): void {
    if (!this.wss) {
      return;
    }

    const message = {
      type: 'news_summary',
      timestamp: new Date().toISOString(),
      data: summary,
    };

    this.broadcast(message);
  }

  /**
   * Send message to a specific client
   */
  private sendToClient(client: WebSocket, data: any): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  private broadcast(data: any): void {
    const message = JSON.stringify(data);
    
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Close all connections
   */
  closeAll(): void {
    this.clients.forEach((client) => {
      client.close();
    });
    this.clients.clear();
    
    if (this.wss) {
      this.wss.close();
    }
  }
}

export default new WebSocketService();
