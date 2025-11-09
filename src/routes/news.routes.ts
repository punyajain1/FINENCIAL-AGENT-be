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

/**
 * @route   GET /api/news
 * @desc    Get news with filters
 * @access  Public
 */
router.get('/', getNewsValidation, asyncHandler(getNews));

/**
 * @route   GET /api/news/summary/:assetName
 * @desc    Get news summary for an asset
 * @access  Public
 */
router.get('/summary/:assetName', asyncHandler(getNewsSummary));

/**
 * @route   GET /api/news/stream
 * @desc    Server-Sent Events stream for real-time news
 * @access  Public
 */
router.get('/stream', newsStream);

/**
 * @route   POST /api/news/trigger-fetch
 * @desc    Manually trigger news fetch and WebSocket broadcast
 * @access  Public
 */
router.post('/trigger-fetch', asyncHandler(triggerNewsFetch));

export default router;
