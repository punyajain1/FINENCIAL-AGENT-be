#!/usr/bin/env node

/**
 * WebSocket Test Client
 * Tests the news WebSocket functionality
 */

const WebSocket = require('ws');

const WS_URL = 'ws://localhost:3001/ws/news';
let ws;

console.log('🔌 WebSocket Test Client');
console.log('========================\n');

function connect() {
  console.log(`Connecting to ${WS_URL}...`);
  
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('✅ Connected successfully!\n');
    
    // Send a ping every 30 seconds
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        console.log('📤 Sending ping...');
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log(`📨 Received message: ${message.type}`);
      console.log('─'.repeat(50));
      
      switch(message.type) {
        case 'connection':
          console.log(`💬 ${message.message}`);
          console.log(`🕐 ${message.timestamp}`);
          break;
          
        case 'initial_news':
          console.log(`📚 Initial News Load - ${message.count} articles from database`);
          console.log(`🕐 ${message.timestamp}`);
          if (message.data && message.data.length > 0) {
            message.data.slice(0, 5).forEach((article, index) => {
              console.log(`\n  ${index + 1}. ${article.title}`);
              console.log(`     Source: ${article.source}`);
              console.log(`     Assets: ${article.relatedAssets.join(', ')}`);
              console.log(`     Sentiment: ${article.sentiment.label} (${article.sentiment.score.toFixed(2)})`);
            });
            if (message.data.length > 5) {
              console.log(`\n  ... and ${message.data.length - 5} more articles`);
            }
          }
          break;
          
        case 'news_update':
          console.log(`🆕 NEW News Update - ${message.count} fresh articles`);
          console.log(`🕐 ${message.timestamp}`);
          if (message.data && message.data.length > 0) {
            message.data.forEach((article, index) => {
              console.log(`\n  ${index + 1}. ${article.title}`);
              console.log(`     Source: ${article.source}`);
              console.log(`     Assets: ${article.relatedAssets.join(', ')}`);
              console.log(`     Sentiment: ${article.sentiment.label} (${article.sentiment.score.toFixed(2)})`);
            });
          }
          break;
          
        case 'news_summary':
          console.log('📊 News Summary (Last 24h)');
          const summary = message.data;
          console.log(`   Total Articles: ${summary.totalArticles}`);
          console.log(`   Crypto: ${summary.cryptoNews} | Metal: ${summary.metalNews}`);
          console.log(`   Sentiment:`);
          console.log(`     ✅ Positive: ${summary.sentimentBreakdown.positive}`);
          console.log(`     ❌ Negative: ${summary.sentimentBreakdown.negative}`);
          console.log(`     ⚖️  Neutral: ${summary.sentimentBreakdown.neutral}`);
          console.log(`   Top Assets: ${summary.topAssets.join(', ')}`);
          break;
          
        case 'pong':
          console.log(`💓 Pong received at ${message.timestamp}`);
          break;
          
        default:
          console.log('Unknown message type:', message);
      }
      
      console.log('─'.repeat(50) + '\n');
    } catch (error) {
      console.error('❌ Error parsing message:', error);
    }
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error.message);
  });

  ws.on('close', () => {
    console.log('🔌 Disconnected from WebSocket');
    console.log('🔄 Reconnecting in 5 seconds...\n');
    setTimeout(connect, 5000);
  });
}

// Start connection
connect();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down...');
  if (ws) {
    ws.close();
  }
  process.exit(0);
});

console.log('💡 Tip: Use Ctrl+C to exit\n');
console.log('💡 To manually trigger news fetch, run:');
console.log('   curl -X POST http://localhost:3000/api/news/trigger-fetch\n');
