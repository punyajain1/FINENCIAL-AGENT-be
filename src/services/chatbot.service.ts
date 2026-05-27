import Groq from 'groq-sdk';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import prisma from '../config/database';

export interface ChatMessage {
  role: 'USER' | 'ASSISTANT';
  message: string;
  sources?: string[];
  toolsUsed?: string[];
  searchQueries?: string[];
}

class ChatbotService {
  private groq: Groq;
  private model = 'llama-3.3-70b-versatile';

  constructor() {
    this.groq = new Groq({ apiKey: config.apiKeys.groq });
  }

  async chat(conversationId: string, userMessage: string): Promise<ChatMessage> {
    try {
      // Fetch the last 10 messages from ChatHistory DB
      const dbHistory = await prisma.chatHistory.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      // Sort chronological ascending
      const chronologicalHistory = dbHistory.reverse();

      // Build messages array for multi-turn Groq conversation
      const messages: Groq.Chat.ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: `You are an expert investment advisor specializing in cryptocurrencies and precious metals. 
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
4. Diversification suggestions`,
        },
      ];

      // Append conversation history
      for (const msg of chronologicalHistory) {
        messages.push({
          role: msg.role === 'USER' ? 'user' : 'assistant',
          content: msg.message,
        });
      }

      // Add the new user message
      messages.push({ role: 'user', content: userMessage });

      const completion = await this.groq.chat.completions.create({
        model: this.model,
        messages,
        temperature: 0.7,
        max_tokens: 2048,
      });

      const assistantMessage = completion.choices[0]?.message?.content;

      if (!assistantMessage) {
        throw new Error('No response generated from AI');
      }

      logger.info('Chat response generated via Groq');

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
          },
        }),
      ]);

      return {
        role: 'ASSISTANT',
        message: assistantMessage,
        toolsUsed: [],
      };
    } catch (error) {
      logger.error('Chat error:', error);
      throw new Error('Failed to process chat message');
    }
  }

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
        toolsUsed: h.toolsUsed || undefined,
      }));
    } catch (error) {
      logger.error('Failed to get chat history:', error);
      throw new Error('Failed to retrieve chat history');
    }
  }

  async clearMemory(conversationId: string): Promise<void> {
    try {
      await prisma.chatHistory.deleteMany({
        where: { conversationId },
      });
      logger.info(`Cleared memory for conversation ${conversationId}`);
    } catch (error) {
      logger.error(`Failed to clear memory for conversation ${conversationId}:`, error);
      throw new Error('Failed to clear conversation memory');
    }
  }
}

export default new ChatbotService();
