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

// Validate environment variables
try {
  validateConfig();
  logger.info('Environment configuration validated successfully');
} catch (error) {
  logger.error('Configuration validation failed:', error);
  process.exit(1);
}

const app: Application = express();
const httpServer = createServer(app);

// Middleware
app.use(cors({
  origin: config.cors.origin,
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
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

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  next();
});

// Routes
app.use('/api', routes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Trading Agent API',
    version: '1.0.0',
    documentation: '/api/health',
  });
});

// Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const PORT = config.port;

httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${config.nodeEnv}`);
  
  // Initialize WebSocket server
  websocketService.initialize(httpServer);
  logger.info('WebSocket server initialized');
  
  // Initialize cron jobs
  cronJobsService.initializeJobs();
  logger.info('Background jobs initialized');
});

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

export default app;
