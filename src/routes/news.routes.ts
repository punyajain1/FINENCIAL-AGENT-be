import { Router } from 'express';
import {
  getNews,
  getNewsSummary,
  newsStream,
  triggerNewsFetch,
} from '../controllers/news.controller';
import { getNewsValidation } from '../middleware/validators';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

router.get('/', getNewsValidation, asyncHandler(getNews));
router.get('/summary/:assetName', asyncHandler(getNewsSummary));
router.get('/stream', newsStream);
router.post('/trigger-fetch', asyncHandler(triggerNewsFetch));

export default router;
