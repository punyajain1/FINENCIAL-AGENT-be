import { Request, Response } from 'express';
import chatbotService from '../services/chatbot.service';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Chat with AI agent
 */
export const chat = async (req: Request, res: Response) => {
  try {
    const { message, conversationId } = req.body;

    // Generate conversation ID if not provided
    const convId = conversationId || uuidv4();

    const response = await chatbotService.chat(convId, message);

    res.json({
      success: true,
      data: {
        conversationId: convId,
        message: response.message,
        sources: response.sources,
        confidence: response.confidence,
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

/**
 * Get chat history
 */
export const getChatHistory = async (req: Request, res: Response) => {
  try {
    const { conversationId, limit } = req.query;

    const history = await chatbotService.getHistory(
      conversationId as string
    );

    // Limit results if needed
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
