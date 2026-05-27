import { Request, Response } from 'express';
import chatbotService from '../services/chatbot.service';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export const chat = async (req: Request, res: Response) => {
  try {
    const { message, conversationId } = req.body;

    const convId = conversationId || uuidv4();

    const response = await chatbotService.chat(convId, message);

    res.json({
      success: true,
      data: {
        conversationId: convId,
        message: response.message,
        sources: response.sources,
        toolsUsed: response.toolsUsed,
      },
    });
  } catch (error) {
    logger.error('Chat error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process chat message',
    });
  }
};

export const getChatHistory = async (req: Request, res: Response) => {
  try {
    const { conversationId, limit } = req.query;

    const history = await chatbotService.getHistory(
      conversationId as string
    );

    const limitedHistory = limit 
      ? history.slice(-(parseInt(limit as string)))
      : history;

    res.json({
      success: true,
      data: {
        conversationId,
        messages: limitedHistory,
        count: limitedHistory.length,
      },
    });
  } catch (error) {
    logger.error('Get chat history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chat history',
    });
  }
};

export const clearChat = async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.query;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        error: 'conversationId is required',
      });
    }

    await chatbotService.clearMemory(conversationId as string);

    res.json({
      success: true,
      message: 'Chat history cleared successfully',
    });
  } catch (error) {
    logger.error('Clear chat error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear chat history',
    });
  }
};
