import { Router } from 'express';
import portfolioRoutes from './portfolio.routes';
import newsRoutes from './news.routes';
import chatRoutes from './chat.routes';

const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Trading Agent API is running',
    timestamp: new Date().toISOString(),
  });
});

// API routes
router.use('/portfolio', portfolioRoutes);
router.use('/news', newsRoutes);
router.use('/chat', chatRoutes);

export default router;
