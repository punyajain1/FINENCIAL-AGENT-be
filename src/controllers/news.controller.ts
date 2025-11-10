import { Request, Response } from 'express';
import newsService from '../services/news.service';
import { AssetType } from '@prisma/client';
import { logger } from '../utils/logger';
import portfolioService from '../services/portfolio.service';
import websocketService from '../services/websocket.service';
import prisma from '../config/database';

export const getNews = async (req: Request, res: Response) => {
  try {
    const {
      assetType,
      assetName,
      sentiment,
      startDate,
      endDate,
      limit,
      offset,
    } = req.query;

    const filter: any = {};

    if (assetType) filter.assetType = assetType as AssetType;
    if (assetName) filter.assetName = assetName as string;
    if (sentiment) filter.sentiment = sentiment as 'positive' | 'negative' | 'neutral';
    if (startDate) filter.startDate = new Date(startDate as string);
    if (endDate) filter.endDate = new Date(endDate as string);
    if (limit) filter.limit = parseInt(limit as string);
    if (offset) filter.offset = parseInt(offset as string);

    const { articles, total } = await newsService.getNews(filter);

    res.json({
      success: true,
      data: articles,
      pagination: {
        total,
        limit: filter.limit || 20,
        offset: filter.offset || 0,
      },
    });
  } catch (error) {
    logger.error('Get news error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch news',
    });
  }
};

export const getNewsSummary = async (req: Request, res: Response) => {
  try {
    const { assetName } = req.params;

    const summary = await newsService.generateNewsSummary(assetName);

    res.json({
      success: true,
      data: {
        assetName,
        summary,
      },
    });
  } catch (error) {
    logger.error('Get news summary error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate news summary',
    });
  }
};

export const newsStream = async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const { assetType, assetName } = req.query;

  logger.info(`SSE connection established for news stream: ${assetName || 'all'}`);

  res.write('data: {"type":"connected","message":"News stream connected"}\n\n');

  const intervalId = setInterval(async () => {
    try {
      const filter: any = { limit: 5 };
      if (assetType) filter.assetType = assetType;
      if (assetName) filter.assetName = assetName;

      const { articles } = await newsService.getNews(filter);

      res.write(`data: ${JSON.stringify({
        type: 'news',
        data: articles,
        timestamp: new Date().toISOString(),
      })}\n\n`);
    } catch (error) {
      logger.error('Error in news stream:', error);
      res.write(`data: ${JSON.stringify({
        type: 'error',
        message: 'Error fetching news',
      })}\n\n`);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(intervalId);
    logger.info('SSE connection closed');
  });
};

export const triggerNewsFetch = async (req: Request, res: Response) => {
  try {
    logger.info('Manual news fetch triggered');
    
    const portfolios = await portfolioService.getPortfolio();
    
    if (portfolios.length === 0) {
      return res.json({
        success: true,
        message: 'No assets in portfolio to fetch news for',
        data: { newsCount: 0 },
      });
    }

    const cryptoAssets = portfolios
      .filter(p => p.assetType === 'CRYPTO')
      .map(p => p.assetName);
    
    const metalAssets = portfolios
      .filter(p => p.assetType === 'METAL')
      .map(p => p.assetName);

    let allNews: any[] = [];

    if (cryptoAssets.length > 0) {
      const cryptoNews = await newsService.fetchNewsForAssets(cryptoAssets, 'CRYPTO');
      allNews.push(...cryptoNews);
    }

    if (metalAssets.length > 0) {
      const metalNews = await newsService.fetchNewsForAssets(metalAssets, 'METAL');
      allNews.push(...metalNews);
    }

    if (allNews.length > 0) {
      websocketService.broadcastNews(allNews);
      
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const recentNews = await prisma.news.findMany({
        where: { createdAt: { gte: yesterday } },
      });

      const summary = {
        totalArticles: recentNews.length,
        cryptoNews: recentNews.filter(n => n.assetType === 'CRYPTO').length,
        metalNews: recentNews.filter(n => n.assetType === 'METAL').length,
        sentimentBreakdown: {
          positive: recentNews.filter(n => n.sentimentLabel === 'positive').length,
          negative: recentNews.filter(n => n.sentimentLabel === 'negative').length,
          neutral: recentNews.filter(n => n.sentimentLabel === 'neutral').length,
        },
        topAssets: [],
      };

      websocketService.broadcastNewsSummary(summary);
    }

    res.json({
      success: true,
      message: 'News fetch completed and broadcasted',
      data: {
        newsCount: allNews.length,
        connectedClients: websocketService.getClientCount(),
      },
    });
  } catch (error) {
    logger.error('Trigger news fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch and broadcast news',
    });
  }
};

