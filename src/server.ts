import express, { Application } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import rateLimit from 'express-rate-limit';
import { config, validateConfig } from './config/config';
import { logger } from './utils/logger';
import routes from './routes/index';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import cronJobsService from './services/cron.service';
import websocketService from './services/websocket.service';
import prisma from './config/database';

try {
  validateConfig();
  logger.info('Environment configuration validated successfully');
} catch (error) {
  logger.error('Configuration validation failed:', error);
  process.exit(1);
}

const app: Application = express();
const httpServer = createServer(app);

const isLocalhost = (origin: string) => {
  return (
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:') ||
    origin.startsWith('https://localhost:') ||
    origin.startsWith('https://127.0.0.1:')
  );
};

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl requests)
    if (!origin) {
      return callback(null, true);
    }
    
    if (
      origin === 'null' ||
      origin === config.cors.origin ||
      isLocalhost(origin)
    ) {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: {
    success: false,
    error: 'Too many requests, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', limiter);

app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  next();
});

app.use(express.static('public'));

app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = config.port;

httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${config.nodeEnv}`);

  websocketService.initialize(httpServer);
  logger.info('WebSocket server initialized');

  cronJobsService.initializeJobs();
  logger.info('Background jobs initialized');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Graceful Shutdown Handler
const handleGracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  try {
    // 1. Stop all cron jobs
    cronJobsService.stopJobs();

    // 2. Close all WebSocket connections
    websocketService.closeAll();

    // 3. Disconnect Prisma
    await prisma.$disconnect();

    logger.info('Graceful shutdown completed successfully. Exiting.');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Trading Agent API',
    version: '1.0.0',
    documentation: '/api/health',
  });
});

// Trigger nodemon reload for .env configuration updates.
export default app;
