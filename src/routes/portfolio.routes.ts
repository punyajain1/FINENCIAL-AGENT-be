import { Router } from 'express';
import {
  addAsset,
  getPortfolio,
  updateAsset,
  removeAsset,
  getRecommendations,
  analyzeAsset,
} from '../controllers/portfolio.controller';
import {
  addAssetValidation,
  updateAssetValidation,
  removeAssetValidation,
} from '../middleware/validators';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

/**
 * @route   POST /api/portfolio/add
 * @desc    Add asset to portfolio
 * @access  Public
 */
router.post('/add', addAssetValidation, asyncHandler(addAsset));

/**
 * @route   GET /api/portfolio
 * @desc    Get all portfolio assets
 * @access  Public
 */
router.get('/', asyncHandler(getPortfolio));

/**
 * @route   PUT /api/portfolio/update/:id
 * @desc    Update asset amount
 * @access  Public
 */
router.put('/update/:id', updateAssetValidation, asyncHandler(updateAsset));

/**
 * @route   DELETE /api/portfolio/remove/:id
 * @desc    Remove asset from portfolio
 * @access  Public
 */
router.delete('/remove/:id', removeAssetValidation, asyncHandler(removeAsset));

/**
 * @route   GET /api/portfolio/recommendations
 * @desc    Get recommendations for all portfolio assets
 * @access  Public
 */
router.get('/recommendations', asyncHandler(getRecommendations));

/**
 * @route   POST /api/portfolio/analyze/:id
 * @desc    Manually trigger analysis for specific asset
 * @access  Public
 */
router.post('/analyze/:id', asyncHandler(analyzeAsset));

export default router;
