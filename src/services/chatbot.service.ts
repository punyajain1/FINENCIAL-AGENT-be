import { GoogleGenAI } from '@google/genai';
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
  private genAI: GoogleGenAI;

  constructor() {
    this.genAI = new GoogleGenAI({ apiKey: config.apiKeys.gemini });
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

      // Build contents array for multi-turn Gemini conversation
      const contents = chronologicalHistory.map(msg => ({
        role: msg.role === 'USER' ? 'user' : 'model',
        parts: [{ text: msg.message }]
      }));

      // Add the new user message
      contents.push({
        role: 'user',
        parts: [{ text: userMessage }]
      });

      const systemInstruction = `You are an expert investment advisor specializing in cryptocurrencies and precious metals. 
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

      const groundingTool = {
        googleSearch: {},
      };

      const requestConfig = {
        systemInstruction,
        tools: [groundingTool],
      };

      const response = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contents,
        config: requestConfig,
      });

      const assistantMessage = response.text;

      const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
      const sources: string[] = [];
      const searchQueries: string[] = [];

      if (groundingMetadata) {
        if (groundingMetadata.webSearchQueries) {
          searchQueries.push(...groundingMetadata.webSearchQueries);
          logger.info(`Search queries used: ${searchQueries.join(', ')}`);
        }

        if (groundingMetadata.groundingChunks) {
          groundingMetadata.groundingChunks.forEach((chunk: any) => {
            if (chunk.uri) {
              sources.push(chunk.uri);
            }
          });
          logger.info(`Sources used: ${sources.length} web pages`);
        }
      }

      logger.info(`Chat response generated with Google Search grounding`);

      if (!assistantMessage) {
        throw new Error('No response generated from AI');
      }

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
            sources: sources.length > 0 ? sources : undefined,
            toolsUsed: sources.length > 0 ? ['googleSearch'] : undefined,
          },
        }),
      ]);

      return {
        role: 'ASSISTANT',
        message: assistantMessage,
        sources: sources.length > 0 ? sources : undefined,
        searchQueries: searchQueries.length > 0 ? searchQueries : undefined,
        toolsUsed: sources.length > 0 ? ['googleSearch'] : [],
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
