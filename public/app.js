/**
 * FinPilot - Frontend Client Logic (Vanilla JS)
 */

// --- STATE MANAGEMENT ---
const state = {
  activeTab: 'dashboard',
  conversationId: null,
  assets: [],
  newsList: [],
  wsConnection: null,
  wsReconnectTimer: null,
  wsReconnectDelay: 2000,
  wsMaxReconnectDelay: 30000,
  isPortfolioLoaded: false,
  isWsConnected: false,
};

// Dismiss loading screen when both WebSocket and portfolio are synced
function checkLoadingStatus() {
  if (state.isPortfolioLoaded && state.isWsConnected) {
    const loader = document.getElementById('app-loading-screen');
    if (loader && !loader.classList.contains('fade-out')) {
      const statusText = document.getElementById('loading-status-text');
      if (statusText) statusText.textContent = 'Engines ready. Syncing interface...';
      
      setTimeout(() => {
        loader.classList.add('fade-out');
      }, 600);
    }
  }
}

// --- DOM ELEMENTS ---
const elements = {
  // Navigation Tabs
  navTabs: document.querySelectorAll('.nav-tab'),
  tabContents: document.querySelectorAll('.tab-content'),
  
  // WS Status
  wsIndicator: document.getElementById('ws-indicator'),
  wsStatusText: document.getElementById('ws-status-text'),
  
  // Dashboard
  statTotalValue: document.getElementById('stat-total-value'),
  statTotalCost: document.getElementById('stat-total-cost'),
  statTotalPL: document.getElementById('stat-total-pl'),
  assetsList: document.getElementById('assets-list'),
  openAddAssetBtn: document.getElementById('open-add-asset-btn'),
  
  // Modals - Add Position
  addAssetModal: document.getElementById('add-asset-modal'),
  closeAddAssetBtn: document.getElementById('close-add-asset-btn'),
  cancelAddAssetBtn: document.getElementById('cancel-add-asset-btn'),
  addAssetForm: document.getElementById('add-asset-form'),
  
  // Modals - Update Position
  updateAssetModal: document.getElementById('update-asset-modal'),
  closeUpdateAssetBtn: document.getElementById('close-update-asset-btn'),
  cancelUpdateAssetBtn: document.getElementById('cancel-update-asset-btn'),
  updateAssetForm: document.getElementById('update-asset-form'),
  updateAssetIdInput: document.getElementById('update-asset-id'),
  updateAssetNameStatic: document.getElementById('update-asset-name-static'),
  updateAssetAmountInput: document.getElementById('update-asset-amount'),
  updateAssetPriceInput: document.getElementById('update-asset-price'),
  
  // Chatbot
  chatForm: document.getElementById('chat-form'),
  chatInput: document.getElementById('chat-input'),
  chatHistoryBox: document.getElementById('chat-history-box'),
  sourcesContainer: document.getElementById('sources-container'),
  clearChatBtn: document.getElementById('clear-chat-btn'),
  
  // News
  newsFeed: document.getElementById('news-feed'),
  triggerNewsFetchBtn: document.getElementById('trigger-news-fetch-btn'),
  sentimentPosVal: document.getElementById('sentiment-pos-val'),
  sentimentNeuVal: document.getElementById('sentiment-neu-val'),
  sentimentNegVal: document.getElementById('sentiment-neg-val'),
  sentimentProgressPos: document.querySelector('.sentiment-progress.positive'),
  sentimentProgressNeu: document.querySelector('.sentiment-progress.neutral'),
  sentimentProgressNeg: document.querySelector('.sentiment-progress.negative'),
  hotAssetsList: document.getElementById('hot-assets-list'),
  
  // Recommendations
  recommendationsDeck: document.getElementById('recommendations-deck'),
};

// --- HELPER FUNCTIONS ---
function getApiUrl(path) {
  if (window.location.protocol === 'file:') {
    return `http://localhost:3000${path}`;
  }
  return path;
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function getConversationId() {
  let id = localStorage.getItem('finpilot_conv_id');
  if (!id) {
    id = generateUUID();
    localStorage.setItem('finpilot_conv_id', id);
  }
  return id;
}

function formatCurrency(value) {
  if (value === undefined || value === null) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value);
}

function formatPercentage(value) {
  if (value === undefined || value === null) return '0.00%';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Basic markdown formattings for bold and line breaks to preserve AI readability
 */
function formatResponseText(text) {
  if (!text) return '';
  let formatted = escapeHTML(text);
  // Convert bold: **text** to <strong>text</strong>
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Convert bullet points starting with * or - to list items
  formatted = formatted.replace(/(?:^|\n)[-•*]\s+(.*?)(?=\n|$)/g, '<div class="chat-bullet-item">• $1</div>');
  // Replace remaining newlines with line breaks
  formatted = formatted.replace(/\n/g, '<br>');
  return formatted;
}

// --- TABS CONTROLLER ---
function setupTabs() {
  elements.navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.getAttribute('data-tab');
      if (state.activeTab === targetTab) return;
      
      // Update state
      state.activeTab = targetTab;
      
      // Update nav class
      elements.navTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Update content panels
      elements.tabContents.forEach(content => {
        if (content.id === `tab-${targetTab}`) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });
      
      // Handle tab-specific activation logic
      if (targetTab === 'dashboard') {
        fetchPortfolio();
      } else if (targetTab === 'recommendations') {
        renderRecommendationsPage();
      }
    });
  });
}

// --- MODALS ENGINE ---
function openModal(modal) {
  modal.classList.add('active');
}

function closeModal(modal) {
  modal.classList.remove('active');
}

function setupModals() {
  // Add Asset Modal Triggers
  elements.openAddAssetBtn.addEventListener('click', () => {
    elements.addAssetForm.reset();
    openModal(elements.addAssetModal);
  });
  elements.closeAddAssetBtn.addEventListener('click', () => closeModal(elements.addAssetModal));
  elements.cancelAddAssetBtn.addEventListener('click', () => closeModal(elements.addAssetModal));
  
  // Update Asset Modal Triggers
  elements.closeUpdateAssetBtn.addEventListener('click', () => closeModal(elements.updateAssetModal));
  elements.cancelUpdateAssetBtn.addEventListener('click', () => closeModal(elements.updateAssetModal));
  
  // Close Modals on Outer Overlay Click
  window.addEventListener('click', (e) => {
    if (e.target === elements.addAssetModal) closeModal(elements.addAssetModal);
    if (e.target === elements.updateAssetModal) closeModal(elements.updateAssetModal);
  });
}

// --- PORTFOLIO CRUDS ---
async function fetchPortfolio() {
  try {
    const res = await fetch(getApiUrl('/api/portfolio'));
    const result = await res.json();
    
    if (result.success) {
      state.assets = result.data;
      updateSummaryStats(result.summary);
      renderAssetsTable(result.data);
      state.isPortfolioLoaded = true;
      checkLoadingStatus();
    } else {
      console.error('Failed to retrieve portfolio data:', result.error);
    }
  } catch (error) {
    console.error('Error fetching portfolio:', error);
  }
}

function updateSummaryStats(summary) {
  if (!summary) return;
  
  elements.statTotalValue.textContent = formatCurrency(summary.totalCurrentValue);
  elements.statTotalCost.textContent = formatCurrency(summary.totalCost);
  
  const plText = `${formatCurrency(summary.totalProfitLoss)} (${formatPercentage(summary.totalProfitLossPercentage)})`;
  elements.statTotalPL.textContent = plText;
  
  // Handle profit colors
  elements.statTotalPL.className = 'summary-value';
  if (summary.totalProfitLoss > 0) {
    elements.statTotalPL.classList.add('positive');
  } else if (summary.totalProfitLoss < 0) {
    elements.statTotalPL.classList.add('negative');
  }
}

function renderAssetsTable(assets) {
  if (!assets || assets.length === 0) {
    elements.assetsList.innerHTML = `
      <tr>
        <td colspan="8" class="text-muted text-center" style="padding: 40px 0;">No assets found in your portfolio. Click '+ Add Asset' to begin.</td>
      </tr>
    `;
    return;
  }
  
  elements.assetsList.innerHTML = assets.map(asset => {
    const isProfit = asset.profitLoss >= 0;
    const plClass = isProfit ? 'positive' : 'negative';
    const plSign = isProfit ? '+' : '';
    const lastAnalyzed = asset.lastAnalyzedAt 
      ? new Date(asset.lastAnalyzedAt).toLocaleString() 
      : 'Never';
      
    return `
      <tr>
        <td><strong>${escapeHTML(asset.assetName)}</strong></td>
        <td><span class="tag neutral">${escapeHTML(asset.symbol)}</span></td>
        <td><span class="small text-muted">${escapeHTML(asset.assetType)}</span></td>
        <td>${asset.amount}</td>
        <td>${formatCurrency(asset.buyingPrice)}</td>
        <td>${formatCurrency(asset.currentPrice)}</td>
        <td>
          <span style="color: ${isProfit ? 'var(--accent-green)' : 'var(--accent-red)'}">
            ${plSign}${formatCurrency(asset.profitLoss)}<br>
            <span class="small text-muted">${formatPercentage(asset.profitLossPercentage)}</span>
          </span>
        </td>
        <td style="text-align: right;">
          <button class="btn-primary-link" onclick="triggerUpdateAssetModal('${asset.id}', '${escapeHTML(asset.assetName)}', '${escapeHTML(asset.symbol)}', ${asset.amount}, ${asset.buyingPrice})">Edit</button>
          <button class="btn-danger-link" onclick="deleteAsset('${asset.id}')">Delete</button>
        </td>
      </tr>
    `;
  }).join('');
}

// Add position
elements.addAssetForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const payload = {
    assetName: document.getElementById('asset-name').value.trim(),
    assetType: document.getElementById('asset-type').value,
    symbol: document.getElementById('asset-symbol').value.toUpperCase().trim(),
    amount: document.getElementById('asset-amount').value,
    buyingPrice: document.getElementById('asset-price').value,
  };
  
  try {
    const res = await fetch(getApiUrl('/api/portfolio/add'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    
    if (result.success) {
      closeModal(elements.addAssetModal);
      fetchPortfolio();
    } else {
      alert(`Error: ${result.error || 'Failed to add asset'}`);
    }
  } catch (error) {
    console.error('Error adding asset:', error);
  }
});

// Trigger Update Modal (global function bound to window so onclick works)
window.triggerUpdateAssetModal = function(id, name, symbol, amount, buyingPrice) {
  elements.updateAssetIdInput.value = id;
  elements.updateAssetNameStatic.textContent = `${name} (${symbol})`;
  elements.updateAssetAmountInput.value = amount;
  elements.updateAssetPriceInput.value = buyingPrice;
  openModal(elements.updateAssetModal);
};

// Update position
elements.updateAssetForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const id = elements.updateAssetIdInput.value;
  const payload = {};
  
  const amt = elements.updateAssetAmountInput.value;
  const price = elements.updateAssetPriceInput.value;
  
  if (amt !== '') payload.amount = amt;
  if (price !== '') payload.buyingPrice = price;
  
  try {
    const res = await fetch(getApiUrl(`/api/portfolio/update/${id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    
    if (result.success) {
      closeModal(elements.updateAssetModal);
      fetchPortfolio();
    } else {
      alert(`Error: ${result.error || 'Failed to update asset'}`);
    }
  } catch (error) {
    console.error('Error updating asset:', error);
  }
});

// Delete position
window.deleteAsset = async function(id) {
  if (!confirm('Are you sure you want to remove this position from your portfolio?')) return;
  
  try {
    const res = await fetch(getApiUrl(`/api/portfolio/remove/${id}`), {
      method: 'DELETE',
    });
    const result = await res.json();
    
    if (result.success) {
      fetchPortfolio();
    } else {
      alert(`Error: ${result.error || 'Failed to delete asset'}`);
    }
  } catch (error) {
    console.error('Error deleting asset:', error);
  }
};

// --- CHATBOT ASSISTANT ---
async function fetchChatHistory() {
  try {
    const res = await fetch(getApiUrl(`/api/chat/history?conversationId=${state.conversationId}`));
    const result = await res.json();
    
    if (result.success && result.data && result.data.messages) {
      renderChatHistory(result.data.messages);
    }
  } catch (error) {
    console.error('Error fetching chat history:', error);
  }
}

function renderChatHistory(messages) {
  if (!messages || messages.length === 0) return;
  
  // Clear other than initial welcome message
  elements.chatHistoryBox.innerHTML = `
    <div class="chat-message assistant">
      <div class="message-content">
        Hello, I am FinPilot, your advanced AI financial advisor powered by <strong>Groq Llama-3.3-70B</strong> and <strong>HuggingFace FinBERT</strong> sentiment models. How can I help you analyze cryptocurrencies, precious metals, or your portfolio positions today?
      </div>
    </div>
  `;
  
  let allSources = [];
  
  messages.forEach(msg => {
    const roleClass = msg.role === 'USER' ? 'user' : 'assistant';
    appendMessage(msg.message, roleClass, false);
    
    if (msg.sources && msg.sources.length > 0) {
      allSources = msg.sources; // Keep latest sources
    }
  });
  
  updateSourcesList(allSources);
  scrollToBottom(elements.chatHistoryBox);
}

function appendMessage(text, role, animate = true) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-message ${role}`;
  if (animate) msgDiv.style.animation = 'fadeIn 0.25s ease';
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.innerHTML = formatResponseText(text);
  
  msgDiv.appendChild(contentDiv);
  elements.chatHistoryBox.appendChild(msgDiv);
  scrollToBottom(elements.chatHistoryBox);
}

function showThinkingIndicator() {
  const indicator = document.createElement('div');
  indicator.className = 'chat-message assistant';
  indicator.id = 'chat-thinking-indicator';
  indicator.innerHTML = `
    <div class="message-content chat-bubble-thinking">
      <span></span><span></span><span></span>
    </div>
  `;
  elements.chatHistoryBox.appendChild(indicator);
  scrollToBottom(elements.chatHistoryBox);
}

function removeThinkingIndicator() {
  const indicator = document.getElementById('chat-thinking-indicator');
  if (indicator) indicator.remove();
}

function updateSourcesList(sources) {
  if (!sources || sources.length === 0) {
    elements.sourcesContainer.innerHTML = `
      <p class="text-muted small">Sources and references used by the AI to answer your queries will appear here.</p>
    `;
    return;
  }
  
  // Deduplicate and filter empty sources
  const uniqueSources = [...new Set(sources)].filter(Boolean);
  
  elements.sourcesContainer.innerHTML = uniqueSources.map(url => {
    let hostName = url;
    try {
      hostName = new URL(url).hostname;
    } catch (_) {}
    return `<a href="${escapeHTML(url)}" target="_blank" class="source-item">${escapeHTML(hostName)} &rarr;</a>`;
  }).join('');
}

function scrollToBottom(container) {
  container.scrollTop = container.scrollHeight;
}

// Send chat message
elements.chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const userText = elements.chatInput.value.trim();
  if (!userText) return;
  
  // Clear input
  elements.chatInput.value = '';
  
  // Render user message instantly
  appendMessage(userText, 'user');
  
  // Show AI thinking
  showThinkingIndicator();
  
  try {
    const res = await fetch(getApiUrl('/api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userText,
        conversationId: state.conversationId,
      }),
    });
    
    const result = await res.json();
    removeThinkingIndicator();
    
    if (result.success && result.data) {
      appendMessage(result.data.message, 'assistant');
      if (result.data.sources) {
        updateSourcesList(result.data.sources);
      }
    } else {
      appendMessage('I apologize, but I encountered an error while processing your request. Please try again.', 'assistant');
    }
  } catch (error) {
    console.error('Chat error:', error);
    removeThinkingIndicator();
    appendMessage('Unable to reach FinPilot advisor. Please check your network connection.', 'assistant');
  }
});

// Clear chat history
elements.clearChatBtn.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to delete your chat history? This cannot be undone.')) return;
  
  elements.clearChatBtn.disabled = true;
  elements.clearChatBtn.textContent = 'Clearing...';
  
  try {
    const res = await fetch(getApiUrl(`/api/chat/clear?conversationId=${state.conversationId}`), {
      method: 'DELETE',
    });
    
    const result = await res.json();
    if (result.success) {
      // Completely erase trace by regenerating a new conversation ID locally as well
      const newId = generateUUID();
      localStorage.setItem('finpilot_conv_id', newId);
      state.conversationId = newId;
      
      // Reset UI back to initial state
      elements.chatHistoryBox.innerHTML = `
        <div class="chat-message assistant">
          <div class="message-content">
            Hello, I am FinPilot, your advanced AI financial advisor powered by <strong>Groq Llama-3.3-70B</strong> and <strong>HuggingFace FinBERT</strong> sentiment models. How can I help you analyze cryptocurrencies, precious metals, or your portfolio positions today?
          </div>
        </div>
      `;
      updateSourcesList([]);
    } else {
      alert(`Error: ${result.error || 'Failed to clear chat history'}`);
    }
  } catch (error) {
    console.error('Error clearing chat:', error);
    alert('Failed to connect to backend server to clear chat.');
  } finally {
    elements.clearChatBtn.disabled = false;
    elements.clearChatBtn.textContent = 'Clear Chat';
  }
});

// --- REAL-TIME WEBSOCKET NEWS HUB ---
function connectNewsWebSocket() {
  let wsUrl;
  if (window.location.protocol === 'file:') {
    wsUrl = 'ws://localhost:3000/ws/news';
  } else {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl = `${protocol}//${window.location.host}/ws/news`;
  }
  
  if (state.wsConnection) {
    state.wsConnection.close();
  }
  
  console.log(`Connecting news WS to: ${wsUrl}`);
  const ws = new WebSocket(wsUrl);
  state.wsConnection = ws;
  
  ws.onopen = () => {
    console.log('News WebSocket connection established successfully');
    elements.wsIndicator.className = 'status-indicator online';
    elements.wsStatusText.textContent = 'Connected';
    state.wsReconnectDelay = 2000; // Reset delay
    if (state.wsReconnectTimer) clearTimeout(state.wsReconnectTimer);
    state.isWsConnected = true;
    checkLoadingStatus();
  };
  
  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      console.log('WS Message received:', payload.type);
      
      switch (payload.type) {
        case 'initial_news':
          state.newsList = payload.data || [];
          renderNewsFeed(state.newsList);
          break;
          
        case 'news_update':
          const newArticles = payload.data || [];
          state.newsList = [...newArticles, ...state.newsList].slice(0, 40); // Cap at 40
          renderNewsFeed(state.newsList);
          break;
          
        case 'news_summary':
          renderSentimentAndHotAssets(payload.data);
          break;
          
        case 'pong':
          // Heartbeat check if needed
          break;
          
        default:
          break;
      }
    } catch (error) {
      console.error('Error parsing WS news packet:', error);
    }
  };
  
  ws.onclose = () => {
    console.warn('News WebSocket disconnected. Retrying connection...');
    elements.wsIndicator.className = 'status-indicator offline';
    elements.wsStatusText.textContent = 'Disconnected';
    
    // Backoff reconnect
    if (state.wsReconnectTimer) clearTimeout(state.wsReconnectTimer);
    state.wsReconnectTimer = setTimeout(() => {
      state.wsReconnectDelay = Math.min(state.wsReconnectDelay * 2, state.wsMaxReconnectDelay);
      connectNewsWebSocket();
    }, state.wsReconnectDelay);
  };
  
  ws.onerror = (err) => {
    console.error('WebSocket connection error:', err);
    ws.close();
  };
}

function renderNewsFeed(news) {
  if (!news || news.length === 0) {
    elements.newsFeed.innerHTML = `
      <p class="text-muted" style="padding: 20px 0;">No news articles available. Press "Force Fetch News" to fetch articles in real-time.</p>
    `;
    return;
  }
  
  elements.newsFeed.innerHTML = news.map(article => {
    const sentiment = article.sentiment || { label: 'neutral', score: 0 };
    const dateStr = new Date(article.publishedAt).toLocaleString();
    const assetsText = (article.relatedAssets || []).map(asset => 
      `<span class="tag asset">${escapeHTML(asset)}</span>`
    ).join(' ');
    
    return `
      <div class="news-item">
        <div class="news-meta">
          <div class="news-meta-left">
            <span><strong>${escapeHTML(article.source)}</strong></span>
            <span class="text-muted">•</span>
            <span class="text-muted">${dateStr}</span>
          </div>
          <span class="tag ${sentiment.label}">${escapeHTML(sentiment.label)}</span>
        </div>
        <a href="${escapeHTML(article.url)}" target="_blank" class="news-title">${escapeHTML(article.title)}</a>
        <p class="news-description">${escapeHTML(article.description || 'No summary available.')}</p>
        <div class="news-footer">
          <div>${assetsText}</div>
          <span class="small text-muted">Relevance: ${(article.relevanceScore * 100).toFixed(0)}%</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderSentimentAndHotAssets(data) {
  if (!data) return;
  
  const { sentimentBreakdown, topAssets } = data;
  if (sentimentBreakdown) {
    const posVal = sentimentBreakdown.positive || 0;
    const neuVal = sentimentBreakdown.neutral || 0;
    const negVal = sentimentBreakdown.negative || 0;
    const total = posVal + neuVal + negVal || 1;
    
    // Set counters
    elements.sentimentPosVal.textContent = posVal;
    elements.sentimentNeuVal.textContent = neuVal;
    elements.sentimentNegVal.textContent = negVal;
    
    // Set progress bars
    elements.sentimentProgressPos.style.width = `${(posVal / total) * 100}%`;
    elements.sentimentProgressNeu.style.width = `${(neuVal / total) * 100}%`;
    elements.sentimentProgressNeg.style.width = `${(negVal / total) * 100}%`;
  }
  
  if (topAssets && topAssets.length > 0) {
    elements.hotAssetsList.innerHTML = topAssets.map(asset => `
      <li>
        <span>${escapeHTML(asset)}</span>
        <strong style="color: var(--accent-blue)">Active Mention</strong>
      </li>
    `).join('');
  } else {
    elements.hotAssetsList.innerHTML = `
      <li class="text-muted small">No assets mentioned in recent news.</li>
    `;
  }
}

// Force fetch news
elements.triggerNewsFetchBtn.addEventListener('click', async () => {
  elements.triggerNewsFetchBtn.disabled = true;
  elements.triggerNewsFetchBtn.textContent = 'Fetching News...';
  
  try {
    const res = await fetch(getApiUrl('/api/news/trigger-fetch'), { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      console.log('Force fetch news crawler triggered.');
    } else {
      console.error('Trigger news fetch error:', result.error);
    }
  } catch (error) {
    console.error('Error triggering news fetch:', error);
  } finally {
    // Return button state after 3 seconds
    setTimeout(() => {
      elements.triggerNewsFetchBtn.disabled = false;
      elements.triggerNewsFetchBtn.textContent = 'Force Fetch News';
    }, 3000);
  }
});

// --- AI PORTFOLIO RECOMMENDATIONS DECK ---
function renderRecommendationsPage() {
  if (state.assets.length === 0) {
    elements.recommendationsDeck.innerHTML = `
      <p class="text-muted" style="padding: 20px 0;">Your portfolio is currently empty. Add assets in the Dashboard tab to request recommendations.</p>
    `;
    return;
  }
  
  // Render an empty card / loader outline for each asset
  elements.recommendationsDeck.innerHTML = state.assets.map(asset => {
    return `
      <div class="rec-card" id="rec-card-${asset.id}">
        <div class="rec-header">
          <div class="rec-asset-title">${escapeHTML(asset.assetName)} <span class="tag neutral">${escapeHTML(asset.symbol)}</span></div>
          <div class="text-muted small">Position: ${asset.amount} units @ ${formatCurrency(asset.buyingPrice)}</div>
          <div class="text-muted small">Last Analyzed: <span id="last-analyzed-${asset.id}">${asset.lastAnalyzedAt ? new Date(asset.lastAnalyzedAt).toLocaleString() : 'Never'}</span></div>
          
          <button class="btn btn-secondary small" style="margin-top: 16px;" onclick="runSingleAssetAnalysis('${asset.id}')" id="btn-analyze-${asset.id}">
            ${asset.lastAnalyzedAt ? 'Recalculate Analysis' : 'Run AI Analysis'}
          </button>
        </div>
        <div class="rec-body" id="rec-body-${asset.id}">
          <p class="text-muted small" style="padding: 30px 0; text-align: center;">Click 'Run AI Analysis' to pull current technical price patterns, sentiment scores, and generate AI recomendations.</p>
        </div>
      </div>
    `;
  }).join('');
}

window.runSingleAssetAnalysis = async function(id) {
  const btn = document.getElementById(`btn-analyze-${id}`);
  const bodyDiv = document.getElementById(`rec-body-${id}`);
  const dateSpan = document.getElementById(`last-analyzed-${id}`);
  
  if (!btn || !bodyDiv) return;
  
  btn.disabled = true;
  btn.textContent = 'Analysing Data Streams...';
  
  // Helper to wait
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  
  // Step definitions
  const steps = [
    { num: 1, title: 'Syncing Live Asset Quotes', desc: 'Fetching precious metals pricing (Gold API v2) and active crypto WebSocket feeds...' },
    { num: 2, title: 'NLP News Sentiment Scanning', desc: 'Crawling recent media articles and classifying sentiment using HuggingFace FinBERT...' },
    { num: 3, title: 'Calculating Technical Indicators', desc: 'Scanning price action histories to compute active RSI, MACD, and EMA support metrics...' },
    { num: 4, title: 'Groq Llama-3.3 Synthesis', desc: 'Invoking the Groq 70B cognitive optimizer to formulate trading targets and strategies...' }
  ];

  // Render initial stepper HTML
  bodyDiv.innerHTML = `
    <div class="analysis-stepper">
      ${steps.map(s => `
        <div class="step-row" id="step-${s.num}-${id}">
          <div class="step-indicator">${s.num}</div>
          <div class="step-content">
            <span class="step-title">${s.title} <span class="step-status-icon" id="step-icon-${s.num}-${id}"></span></span>
            <span class="step-desc">${s.desc}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  let fetchCompleted = false;
  let fetchResult = null;
  let fetchError = null;

  // Fire background API call
  const apiPromise = fetch(getApiUrl(`/api/portfolio/analyze/${id}`), { method: 'POST' })
    .then(async res => {
      const data = await res.json();
      fetchCompleted = true;
      fetchResult = data;
    })
    .catch(err => {
      fetchCompleted = true;
      fetchError = err;
    });

  try {
    // Sequence through step highlights
    for (let i = 1; i <= 4; i++) {
      const row = document.getElementById(`step-${i}-${id}`);
      const iconSpan = document.getElementById(`step-icon-${i}-${id}`);
      if (row) {
        row.classList.add('active');
        if (iconSpan) iconSpan.innerHTML = '<span class="step-spinner"></span>';
      }
      
      if (i < 4) {
        // First 3 steps take ~1.2s each
        await delay(1200);
        if (row) {
          row.classList.remove('active');
          row.classList.add('completed');
        }
        if (iconSpan) iconSpan.innerHTML = ' <span style="color: var(--accent-green); font-weight: bold; margin-left: 6px;">✔</span>';
      } else {
        // Step 4: Wait for both simulation timeline AND background fetch to finish
        const simulationMinTime = delay(1200);
        while (!fetchCompleted) {
          await delay(150);
        }
        await simulationMinTime; // ensure we animate step 4 for at least 1.2s
        if (row) {
          row.classList.remove('active');
          row.classList.add('completed');
        }
        if (iconSpan) iconSpan.innerHTML = ' <span style="color: var(--accent-green); font-weight: bold; margin-left: 6px;">✔</span>';
        await delay(500); // Breathe
      }
    }

    // Now render final payload
    if (fetchResult && fetchResult.success && fetchResult.data) {
      const data = fetchResult.data;
      const act = data.action.toLowerCase(); // buy, hold, sell
      const actionLabel = data.action; // BUY, HOLD, SELL
      
      // Update last analyzed timestamp locally
      const nowStr = new Date().toLocaleString();
      if (dateSpan) dateSpan.textContent = nowStr;
      
      // Update recommendation body with premium fade-in style
      bodyDiv.style.opacity = 0;
      bodyDiv.style.transition = 'opacity 0.5s ease';
      
      bodyDiv.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr; gap: 20px;">
          <div>
            <span class="rec-action-badge ${act}">${escapeHTML(actionLabel)}</span>
            <span style="margin-left: 12px; font-size: 13px;" class="text-muted">Confidence Score: <strong>${data.confidence}%</strong></span>
          </div>
          
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 8px 0;">
            <div class="summary-card" style="padding: 12px 16px;">
              <span class="summary-label" style="font-size: 10px;">7D Price Target</span>
              <span style="font-size: 16px;" class="summary-value">${data.priceTarget ? formatCurrency(data.priceTarget) : 'N/A'}</span>
            </div>
            <div class="summary-card" style="padding: 12px 16px;">
              <span class="summary-label" style="font-size: 10px;">Risk Profile</span>
              <span style="font-size: 16px;" class="summary-value">${escapeHTML(data.riskLevel)}</span>
            </div>
            <div class="summary-card" style="padding: 12px 16px;">
              <span class="summary-label" style="font-size: 10px;">7D Price Change</span>
              <span style="font-size: 16px; color: ${data.priceChange7d >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}" class="summary-value">${formatPercentage(data.priceChange7d)}</span>
            </div>
            <div class="summary-card" style="padding: 12px 16px;">
              <span class="summary-label" style="font-size: 10px;">Media Sentiment</span>
              <span style="font-size: 16px;" class="summary-value">${escapeHTML(data.sentimentLabel)} (${(data.sentimentScore * 100).toFixed(0)}%)</span>
            </div>
          </div>

          <!-- Advanced Technical Indicators Panel -->
          <div style="border-top: 1px solid var(--border-color); padding-top: 16px;">
            <h4 style="margin-bottom: 12px; font-size: 11px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px;">Advanced Technical Indicators (30-Day Calculations)</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
              
              <div style="padding: 12px 16px; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--panel-bg);">
                <div class="summary-label" style="font-size: 9px; margin-bottom: 4px;">RSI (14-period)</div>
                <div style="font-size: 13px; font-weight: 500;">
                  ${data.rsi !== undefined ? data.rsi : 'N/A'}
                  <span class="tag ${data.rsiSignal === 'BUY' ? 'positive' : data.rsiSignal === 'SELL' ? 'negative' : 'neutral'}" style="margin-left: 6px;">
                    ${data.rsiSignal || 'NEUTRAL'}
                  </span>
                </div>
              </div>

              <div style="padding: 12px 16px; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--panel-bg);">
                <div class="summary-label" style="font-size: 9px; margin-bottom: 4px;">MACD (12/26/9 EMA)</div>
                <div style="font-size: 13px; font-weight: 500; display: flex; flex-direction: column; gap: 2px;">
                  <span>Line: ${data.macd?.macdLine ?? 'N/A'} | Signal: ${data.macd?.signalLine ?? 'N/A'}</span>
                  <span style="font-size: 11px; color: var(--text-muted);">
                    Hist: ${data.macd?.histogram ?? 'N/A'}
                    <span class="tag ${data.macd?.signal === 'BUY' ? 'positive' : data.macd?.signal === 'SELL' ? 'negative' : 'neutral'}" style="margin-left: 4px;">
                      ${data.macd?.signal || 'NEUTRAL'}
                    </span>
                  </span>
                </div>
              </div>

              <div style="padding: 12px 16px; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--panel-bg);">
                <div class="summary-label" style="font-size: 9px; margin-bottom: 4px;">Bollinger Bands (20-period)</div>
                <div style="font-size: 12px; font-weight: 500; display: flex; flex-direction: column; gap: 2px;">
                  <span>Upper: ${data.bollingerBands?.upper ? formatCurrency(data.bollingerBands.upper) : 'N/A'}</span>
                  <span>Lower: ${data.bollingerBands?.lower ? formatCurrency(data.bollingerBands.lower) : 'N/A'}</span>
                  <span style="font-size: 11px; color: var(--text-muted);">
                    BB Signal: 
                    <span class="tag ${data.bollingerBands?.signal === 'BUY' ? 'positive' : data.bollingerBands?.signal === 'SELL' ? 'negative' : 'neutral'}" style="margin-left: 4px;">
                      ${data.bollingerBands?.signal || 'NEUTRAL'}
                    </span>
                  </span>
                </div>
              </div>

              <div style="padding: 12px 16px; border: 1px solid var(--border-color); border-radius: var(--border-radius); background-color: var(--panel-bg);">
                <div class="summary-label" style="font-size: 9px; margin-bottom: 4px;">On-Balance Volume (OBV)</div>
                <div style="font-size: 13px; font-weight: 500;">
                  ${data.obv !== undefined ? new Intl.NumberFormat('en-US').format(data.obv) : 'N/A'}
                </div>
              </div>

            </div>
          </div>
          
          <div style="border-top: 1px solid var(--border-color); padding-top: 16px;">
            <h4 style="margin-bottom: 8px;">Analytical Reasoning</h4>
            <ul class="rec-reasoning-list">
              ${(data.reasoning || []).map(reason => `<li>${escapeHTML(reason)}</li>`).join('')}
            </ul>
          </div>
        </div>
      `;
      
      // Trigger fade in
      setTimeout(() => {
        bodyDiv.style.opacity = 1;
      }, 50);
    } else {
      const errMessage = (fetchResult && fetchResult.error) ? fetchResult.error : 'Server error';
      bodyDiv.innerHTML = `<p class="text-muted small" style="padding: 30px 0; text-align: center; color: var(--accent-red) !important;">Failed to complete analysis: ${escapeHTML(errMessage)}</p>`;
    }
  } catch (error) {
    console.error('Error analyzing asset:', error);
    bodyDiv.innerHTML = `<p class="text-muted small" style="padding: 30px 0; text-align: center; color: var(--accent-red) !important;">Failed to connect to backend server.</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Recalculate Analysis';
  }
};

// --- INITIALIZER ---
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Conversation session
  state.conversationId = getConversationId();
  console.log(`Initialized FinPilot Session: ${state.conversationId}`);
  
  // Set up Tabs & Modals
  setupTabs();
  setupModals();
  
  // Load Initial Data
  fetchPortfolio();
  fetchChatHistory();
  
  // Connect news streams WebSocket
  connectNewsWebSocket();

  // Maximum loading safety timeout of 6 seconds to fade out loader in case of server failures
  setTimeout(() => {
    const loader = document.getElementById('app-loading-screen');
    if (loader && !loader.classList.contains('fade-out')) {
      console.warn('Loading safety timeout reached. Dismissing loading overlay.');
      loader.classList.add('fade-out');
    }
  }, 6000);
});
