import { GoogleGenAI } from '@google/genai';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import prisma from '../config/database';

export interface ChatMessage {
  role: 'USER' | 'ASSISTANT';
  message: string;
  sources?: string[];
  confidence?: number;
  toolsUsed?: string[];
  searchQueries?: string[];
}

class ChatbotService {
  private genAI: GoogleGenAI;
  private conversations: Map<string, { role: string; content: string }[]>;

  constructor() {
    this.genAI = new GoogleGenAI({ apiKey: config.apiKeys.gemini });
    this.conversations = new Map();
  }

  private getConversation(conversationId: string): { role: string; content: string }[] {
    if (!this.conversations.has(conversationId)) {
      this.conversations.set(conversationId, []);
    }
    return this.conversations.get(conversationId)!;
  }

  async chat(conversationId: string, userMessage: string): Promise<ChatMessage> {
    try {
      const conversation = this.getConversation(conversationId);
      conversation.push({ role: 'user', content: userMessage });

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

      const contextMessages = conversation.slice(-10).map(m => 
        `${m.role}: ${m.content}`
      ).join('\n');
      
      const fullPrompt = `${systemPrompt}\n\nConversation history:\n${contextMessages}\n\nUser: ${userMessage}\n\nAssistant:`;

      const groundingTool = {
        googleSearch: {},
      };

      const requestConfig = {
        tools: [groundingTool],
      };

      const response = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: fullPrompt,
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

      conversation.push({ role: 'assistant', content: assistantMessage });

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
            confidence: 0.85,
            toolsUsed: sources.length > 0 ? ['googleSearch'] : undefined,
          },
        }),
      ]);

      return {
        role: 'ASSISTANT',
        message: assistantMessage,
        sources: sources.length > 0 ? sources : undefined,
        searchQueries: searchQueries.length > 0 ? searchQueries : undefined,
        confidence: 0.85,
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
        confidence: h.confidence || undefined,
        toolsUsed: h.toolsUsed || undefined,
      }));
    } catch (error) {
      logger.error('Failed to get chat history:', error);
      throw new Error('Failed to retrieve chat history');
    }
  }

  clearMemory(conversationId: string): void {
    this.conversations.delete(conversationId);
    logger.info(`Cleared memory for conversation ${conversationId}`);
  }
}

export default new ChatbotService();
