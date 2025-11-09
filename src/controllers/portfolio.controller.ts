import { Request, Response } from 'express';
import portfolioService from '../services/portfolio.service';
import { AssetType } from '@prisma/client';
import { logger } from '../utils/logger';

/**
 * Add asset to portfolio
 */
export const addAsset = async (req: Request, res: Response) => {
  try {
    const { assetName, assetType, symbol, amount, buyingPrice } = req.body;

    const asset = await portfolioService.addAsset(
      assetName,
      assetType as AssetType,
      symbol,
      parseFloat(amount),
      parseFloat(buyingPrice)
    );

    res.status(201).json({
      success: true,
      data: asset,
      message: 'Asset added to portfolio successfully',
    });
  } catch (error) {
    logger.error('Add asset error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add asset to portfolio',
    });
  }
};

/**
 * Get all portfolio assets
 */
export const getPortfolio = async (req: Request, res: Response) => {
  try {
    // Always include current prices by default
    const portfolio = await portfolioService.getPortfolioWithCurrentPrices();
    
    // Calculate total portfolio metrics
    const totalCurrentValue = portfolio.reduce((sum, asset) => sum + asset.totalValue, 0);
    const totalCost = portfolio.reduce((sum, asset) => sum + asset.totalCost, 0);
    const totalProfitLoss = totalCurrentValue - totalCost;
    const totalProfitLossPercentage = totalCost > 0 ? ((totalCurrentValue - totalCost) / totalCost) * 100 : 0;

    res.json({
      success: true,
      data: portfolio,
      count: portfolio.length,
      summary: {
        totalCurrentValue: parseFloat(totalCurrentValue.toFixed(2)),
        totalCost: parseFloat(totalCost.toFixed(2)),
        totalProfitLoss: parseFloat(totalProfitLoss.toFixed(2)),
        totalProfitLossPercentage: parseFloat(totalProfitLossPercentage.toFixed(2)),
      }
    });
  } catch (error) {
    logger.error('Get portfolio error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch portfolio',
    });
  }
};

/**
 * Update asset amount
 */
export const updateAsset = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;

    const asset = await portfolioService.updateAsset(id, parseFloat(amount));

    res.json({
      success: true,
      data: asset,
      message: 'Asset updated successfully',
    });
  } catch (error) {
    logger.error('Update asset error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update asset',
    });
  }
};

/**
 * Remove asset from portfolio
 */
export const removeAsset = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await portfolioService.removeAsset(id);

    res.json({
      success: true,
      message: 'Asset removed from portfolio successfully',
    });
  } catch (error) {
    logger.error('Remove asset error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove asset',
    });
  }
};

/**
 * Get recommendations for all portfolio assets
 */
export const getRecommendations = async (req: Request, res: Response) => {
  try {
    const recommendations = await portfolioService.getRecommendations();

    res.json({
      success: true,
      data: recommendations,
      count: recommendations.length,
    });
  } catch (error) {
    logger.error('Get recommendations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recommendations',
    });
  }
};

/**
 * Manually trigger analysis for a specific asset
 */
export const analyzeAsset = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const recommendation = await portfolioService.analyzeAsset(id);

    res.json({
      success: true,
      data: recommendation,
      message: 'Asset analysis completed successfully',
    });
  } catch (error) {
    logger.error('Analyze asset error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze asset',
    });
  }
};
