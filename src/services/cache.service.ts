import NodeCache from 'node-cache';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import prisma from '../config/database';

/**
 * In-memory cache service with database fallback
 */
class CacheService {
  private cache: NodeCache;

  constructor() {
    this.cache = new NodeCache({
      stdTTL: config.cache.ttl,
      checkperiod: config.cache.checkPeriod,
      useClones: false,
    });

    this.cache.on('expired', (key) => {
      logger.debug(`Cache key expired: ${key}`);
    });
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    // Try in-memory cache first
    const memoryValue = this.cache.get<T>(key);
    if (memoryValue !== undefined) {
      logger.debug(`Cache hit (memory): ${key}`);
      return memoryValue;
    }

    // Fallback to database cache
    try {
      const dbCache = await prisma.analysisCache.findUnique({
        where: { cacheKey: key },
      });

      if (dbCache && dbCache.expiresAt > new Date()) {
        const data = JSON.parse(dbCache.data) as T;
        // Restore to memory cache
        this.cache.set(key, data);
        logger.debug(`Cache hit (database): ${key}`);
        return data;
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

    // Set in memory cache
    this.cache.set(key, value, actualTtl);

    // Set in database cache for persistence
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
    this.cache.del(key);
    try {
      await prisma.analysisCache.delete({
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
    this.cache.flushAll();
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
