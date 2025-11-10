import { Router } from 'express';
import { chat, getChatHistory } from '../controllers/chat.controller';
import { chatValidation, getChatHistoryValidation } from '../middleware/validators';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

router.post('/', chatValidation, asyncHandler(chat));
router.get('/history', getChatHistoryValidation, asyncHandler(getChatHistory));

export default router;
