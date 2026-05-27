import { Router } from 'express';
import { chat, getChatHistory, clearChat } from '../controllers/chat.controller';
import { chatValidation, getChatHistoryValidation } from '../middleware/validators';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

router.post('/', chatValidation, asyncHandler(chat));
router.get('/history', getChatHistoryValidation, asyncHandler(getChatHistory));
router.delete('/clear', asyncHandler(clearChat));

export default router;
