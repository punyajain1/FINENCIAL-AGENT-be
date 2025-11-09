import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import prisma from '../config/database';

export interface ChatMessage {
  role: 'USER' | 'ASSISTANT';
  message: string;
  sources?: string[];
  confidence?: number;
  toolsUsed?: string[];
}

/**
 * Simplified Chatbot service using Google Gemini AI directly
 * Note: Complex agent framework implementation available in chatbot.service.ts.backup
 */
class ChatbotService {
  private genAI: GoogleGenerativeAI;
  private conversations: Map<string, { role: string; content: string }[]>;

  constructor() {
    this.genAI = new GoogleGenerativeAI(config.apiKeys.gemini);
    this.conversations = new Map();
  }

  /**
   * Get or create conversation history
   */
  private getConversation(conversationId: string): { role: string; content: string }[] {
    if (!this.conversations.has(conversationId)) {
      this.conversations.set(conversationId, []);
    }
    return this.conversations.get(conversationId)!;
  }

  /**
   * Chat with the AI
   */
  async chat(conversationId: string, userMessage: string): Promise<ChatMessage> {
    try {
      // Save user message
      const conversation = this.getConversation(conversationId);
      conversation.push({ role: 'user', content: userMessage });

      // Create system prompt
      const systemPrompt = `You are an expert investment advisor specializing in cryptocurrencies and precious metals. 
Provide detailed, personalized investment guidance while always including appropriate risk warnings.

Available functions:
- Market data for Bitcoin (BTC), Ethereum (ETH), Gold (XAU), Silver (XAG)
- Recent news and sentiment analysis
- Portfolio analysis and recommendations
- Technical analysis and price trends

Always provide:
1. Clear, actionable advice
2. Risk assessments
3. Market context
4. Diversification suggestions`;

      // Build full prompt with context
      const contextMessages = conversation.slice(-10).map(m => 
        `${m.role}: ${m.content}`
      ).join('\n');
      
      const fullPrompt = `${systemPrompt}\n\nConversation history:\n${contextMessages}\n\nUser: ${userMessage}\n\nAssistant:`;

      // Get AI response using Google Generative AI
      const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent(fullPrompt);
      const response = await result.response;
      const assistantMessage = response.text();

      // Save assistant message
      conversation.push({ role: 'assistant', content: assistantMessage });

      // Save to database
      await Promise.all([
        prisma.chatHistory.create({
          data: {
            conversationId,
            role: 'USER',
            message: userMessage,
          },
        }),
        prisma.chatHistory.create({
          data: {
            conversationId,
            role: 'ASSISTANT',
            message: assistantMessage,
            confidence: 0.85,
          },
        }),
      ]);

      return {
        role: 'ASSISTANT',
        message: assistantMessage,
        confidence: 0.85,
        toolsUsed: [],
      };
    } catch (error) {
      logger.error('Chat error:', error);
      throw new Error('Failed to process chat message');
    }
  }

  /**
   * Get conversation history
   */
  async getHistory(conversationId: string): Promise<ChatMessage[]> {
    try {
      const history = await prisma.chatHistory.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });

      return history.map(h => ({
        role: h.role,
        message: h.message,
        sources: h.sources || undefined,
        confidence: h.confidence || undefined,
        toolsUsed: h.toolsUsed || undefined,
      }));
    } catch (error) {
      logger.error('Failed to get chat history:', error);
      throw new Error('Failed to retrieve chat history');
    }
  }

  /**
   * Clear conversation memory
   */
  clearMemory(conversationId: string): void {
    this.conversations.delete(conversationId);
    logger.info(`Cleared memory for conversation ${conversationId}`);
  }
}

export default new ChatbotService();
