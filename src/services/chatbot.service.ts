import Groq from 'groq-sdk';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import prisma from '../config/database';
import portfolioService from './portfolio.service';

export interface ChatMessage {
  role: 'USER' | 'ASSISTANT';
  message: string;
  sources?: string[];
  toolsUsed?: string[];
  searchQueries?: string[];
}

const ASSET_KEYWORDS: Record<string, string> = {
  'bitcoin': 'BTC', 'btc': 'BTC',
  'ethereum': 'ETH', 'eth': 'ETH',
  'gold': 'XAU', 'xau': 'XAU',
  'silver': 'XAG', 'xag': 'XAG',
};

class ChatbotService {
  private groq: Groq;
  private model = 'llama-3.1-8b-instant';

  constructor() {
    this.groq = new Groq({ apiKey: config.apiKeys.groq });
  }

  /**
   * Simple keyword extractor to find which assets the user is talking about
   */
  private extractAssetsFromMessage(message: string): string[] {
    const text = message.toLowerCase();
    const foundAssets = new Set<string>();
    
    for (const [keyword, symbol] of Object.entries(ASSET_KEYWORDS)) {
      if (text.includes(keyword)) {
        foundAssets.add(symbol);
      }
    }
    
    return Array.from(foundAssets);
  }

  async chat(conversationId: string, userMessage: string): Promise<ChatMessage> {
    try {
      // 1. Fetch the last 10 messages from ChatHistory DB
      const dbHistory = await prisma.chatHistory.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      const chronologicalHistory = dbHistory.reverse();

      // 2. RAG Retrieval - Extract Keywords
      const foundAssets = this.extractAssetsFromMessage(userMessage);
      let contextString = 'No specific live data available for this query.';
      
      try {
        const [newsContext, portfolioData] = await Promise.all([
          // Fetch News
          foundAssets.length > 0 
            ? prisma.news.findMany({
                where: { relatedAssets: { hasSome: foundAssets } },
                orderBy: { publishedAt: 'desc' },
                take: 5
              })
            : prisma.news.findMany({ orderBy: { publishedAt: 'desc' }, take: 3 }), // Fallback generic news
            
          // Fetch Portfolio
          portfolioService.getPortfolioWithCurrentPrices()
        ]);

        // Format Portfolio Context
        let portfolioContextStr = 'User Portfolio: No assets currently held.\n';
        if (portfolioData.length > 0) {
          portfolioContextStr = 'User Portfolio:\n' + portfolioData.map(p => 
            `- ${p.assetName} (${p.symbol}): Holdings: ${p.amount}. Entry: $${p.buyingPrice}. Current: $${p.currentPrice.toFixed(2)}. P/L: ${p.profitLossPercentage.toFixed(2)}%`
          ).join('\n') + '\n';
        }

        // Format News Context
        let newsContextStr = 'Recent News:\n';
        if (newsContext.length > 0) {
          newsContextStr += newsContext.map(n => 
            `- [${n.publishedAt.toISOString().split('T')[0]}] ${n.title} (Sentiment: ${n.sentimentLabel.toUpperCase()})`
          ).join('\n');
        } else {
          newsContextStr += 'No recent news found.\n';
        }

        contextString = `${portfolioContextStr}\n${newsContextStr}`;
        logger.debug(`Injected RAG Context for ${foundAssets.length} matched assets.`);
      } catch (err) {
        logger.error('Failed to fetch RAG context:', err);
      }

      // 3. Build messages array for Groq
      const messages: Groq.Chat.ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: `You are an expert investment advisor specializing in cryptocurrencies and precious metals. 
Provide detailed, personalized investment guidance while always including appropriate risk warnings.

LIVE DATABASE CONTEXT (Treat this as absolute truth for the current state of the world):
${contextString}

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

      // 4. Generate Response
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

      logger.info('Chat response generated via Groq (RAG enabled)');

      // 5. Save History
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
        toolsUsed: ['TimeBasedRAG'],
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
