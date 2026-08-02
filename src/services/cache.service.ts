import { config } from '../config/config';
import { logger } from '../utils/logger';
import prisma from '../config/database';

/**
 * Persistent Database Cache Service
 */
class CacheService {
  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const dbCache = await prisma.analysisCache.findUnique({
        where: { cacheKey: key },
      });

      if (dbCache) {
        if (dbCache.expiresAt > new Date()) {
          const data = JSON.parse(dbCache.data) as T;
          logger.debug(`Cache hit (database): ${key}`);
          return data;
        } else {
          // Explicitly delete expired cache to save DB space
          await prisma.analysisCache.deleteMany({
            where: { cacheKey: key },
          });
        }
      }
    } catch (error) {
      logger.error(`Error retrieving from database cache: ${error}`);
    }

    logger.debug(`Cache miss: ${key}`);
    return null;
  }

  /**
   * Set value in cache
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const actualTtl = ttl || config.cache.ttl;

    try {
      const expiresAt = new Date(Date.now() + actualTtl * 1000);
      await prisma.analysisCache.upsert({
        where: { cacheKey: key },
        update: {
          data: JSON.stringify(value),
          expiresAt,
        },
        create: {
          cacheKey: key,
          dataType: this.extractDataType(key),
          assetSymbol: this.extractAssetSymbol(key),
          data: JSON.stringify(value),
          expiresAt,
        },
      });
      logger.debug(`Cache set: ${key}`);
    } catch (error) {
      logger.error(`Error setting database cache: ${error}`);
    }
  }

  /**
   * Delete value from cache
   */
  async delete(key: string): Promise<void> {
    try {
      await prisma.analysisCache.deleteMany({
        where: { cacheKey: key },
      });
      logger.debug(`Cache deleted: ${key}`);
    } catch (error) {
      logger.error(`Error deleting from database cache: ${error}`);
    }
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    try {
      await prisma.analysisCache.deleteMany({});
      logger.info('Cache cleared');
    } catch (error) {
      logger.error(`Error clearing database cache: ${error}`);
    }
  }

  /**
   * Clean expired cache entries from database
   */
  async cleanExpired(): Promise<void> {
    try {
      const result = await prisma.analysisCache.deleteMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
        },
      });
      logger.info(`Cleaned ${result.count} expired cache entries`);
    } catch (error) {
      logger.error(`Error cleaning expired cache: ${error}`);
    }
  }

  /**
   * Extract data type from cache key
   */
  private extractDataType(key: string): string {
    const parts = key.split(':');
    return parts[0] || 'unknown';
  }

  /**
   * Extract asset symbol from cache key
   */
  private extractAssetSymbol(key: string): string | undefined {
    const parts = key.split(':');
    return parts.length > 1 ? parts[1] : undefined;
  }
}

export default new CacheService();
