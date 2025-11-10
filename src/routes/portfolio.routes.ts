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

router.post('/add', addAssetValidation, asyncHandler(addAsset));
router.get('/', asyncHandler(getPortfolio));
router.put('/update/:id', updateAssetValidation, asyncHandler(updateAsset));
router.delete('/remove/:id', removeAssetValidation, asyncHandler(removeAsset));
router.get('/recommendations', asyncHandler(getRecommendations));
router.post('/analyze/:id', asyncHandler(analyzeAsset));

export default router;
