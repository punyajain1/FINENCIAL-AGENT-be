import { Router } from 'express';
import { chat, getChatHistory } from '../controllers/chat.controller';
import { chatValidation, getChatHistoryValidation } from '../middleware/validators';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

/**
 * @route   POST /api/chat
 * @desc    Send message to AI chatbot
 * @access  Public
 */
router.post('/', chatValidation, asyncHandler(chat));

/**
 * @route   GET /api/chat/history
 * @desc    Get chat conversation history
 * @access  Public
 */
router.get('/history', getChatHistoryValidation, asyncHandler(getChatHistory));

export default router;
