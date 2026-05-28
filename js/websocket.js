// ============================================================================
// FINNHUB WEBSOCKET — Real-time trade streaming (free tier: max 30 symbols)
// ============================================================================
// Finnhub WebSocket API: wss://ws.finnhub.io?token=YOUR_API_KEY
// Free tier caveats: connection drops after a few hours; we handle reconnection.
// ============================================================================

class StockWebSocket {
  constructor() {
    this.ws = null;
    this.activeSymbols = new Set();       // Currently subscribed symbols
    this.desiredSymbols = new Set();      // Symbols the user wants (survives reconnect)
    this.onTradeCallbacks = [];
    this.onStatusChangeCallbacks = [];
    this._status = 'disconnected';        // disconnected | connecting | connected | reconnecting
    this._reconnectAttempt = 0;
    this._maxReconnectAttempts = Infinity; // Always retry
    this._reconnectBaseDelay = 5000;       // 5s base
    this._reconnectMaxDelay = 30000;       // 30s max
    this._reconnectTimer = null;
    this._heartbeatTimer = null;
    this._heartbeatInterval = 30000;       // 30s ping
    this._heartbeatTimeout = null;
    this._connecting = false;
    this.MAX_SYMBOLS = 30;
  }

  // ================================================================
  // PUBLIC API
  // ================================================================

  // ---- Connect to WebSocket ----
  connect() {
    if (this._connecting) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return; // Already connected or connecting
    }
    this._doConnect();
  }

  // ---- Subscribe to a symbol ----
  subscribe(symbol) {
    const sym = symbol.toUpperCase();
    if (this.desiredSymbols.has(sym)) return; // Already desired

    if (this.desiredSymbols.size >= this.MAX_SYMBOLS) {
      console.warn(`[WebSocket] Cannot subscribe ${sym}: ${this.MAX_SYMBOLS} symbol limit reached`);
      return { success: false, reason: 'limit', current: this.desiredSymbols.size, max: this.MAX_SYMBOLS };
    }

    this.desiredSymbols.add(sym);

    // Send subscribe message if connected
    if (this._status === 'connected' && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._sendSubscribe(sym);
      this.activeSymbols.add(sym);
    } else if (this._status === 'disconnected') {
      // Auto-connect
      this.connect();
    }
    // If reconnecting, it'll be picked up on reconnect

    console.log(`[WebSocket] Subscribed to ${sym} (${this.desiredSymbols.size}/${this.MAX_SYMBOLS})`);
    this._notifyStatusChange();
    return { success: true };
  }

  // ---- Unsubscribe from a symbol ----
  unsubscribe(symbol) {
    const sym = symbol.toUpperCase();
    this.desiredSymbols.delete(sym);

    if (this.activeSymbols.has(sym) && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._sendUnsubscribe(sym);
    }
    this.activeSymbols.delete(sym);

    console.log(`[WebSocket] Unsubscribed from ${sym} (${this.desiredSymbols.size}/${this.MAX_SYMBOLS})`);
    this._notifyStatusChange();
  }

  // ---- Check if a symbol is subscribed ----
  isSubscribed(symbol) {
    return this.desiredSymbols.has(symbol.toUpperCase());
  }

  // ---- Get current status ----
  get status() {
    return this._status;
  }

  // ---- Get subscription count ----
  get subscriptionCount() {
    return this.desiredSymbols.size;
  }

  // ---- Register trade callback ----
  // callback receives: { symbol, price, volume, timestamp }
  onTrade(callback) {
    this.onTradeCallbacks.push(callback);
  }

  // ---- Register status change callback ----
  // callback receives: { status, count, max }
  onStatusChange(callback) {
    this.onStatusChangeCallbacks.push(callback);
  }

  // ---- Update API key (called when user changes key in settings) ----
  updateApiKey(newKey) {
    const shouldReconnect = this._status === 'connected' || this._status === 'connecting' || this._status === 'reconnecting';
    if (shouldReconnect) {
      this.disconnect();
      // Allow a tick for old connection to fully close
      setTimeout(() => {
        this.connect();
      }, 500);
    }
  }

  // ---- Disconnect cleanly ----
  disconnect() {
    this._cancelReconnect();
    this._clearHeartbeat();
    this._connecting = false;
    this._reconnectAttempt = 0;

    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect on intentional close
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'User disconnect');
      }
      this.ws = null;
    }

    this.activeSymbols.clear();
    this._status = 'disconnected';
    this._notifyStatusChange();
    console.log('[WebSocket] Disconnected');
  }

  // ================================================================
  // INTERNALS
  // ================================================================

  _doConnect() {
    if (this._connecting) return;
    this._connecting = true;

    // Clean up any lingering socket
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.onopen = null;
        this.ws.close();
      } catch (e) { /* ignore */ }
      this.ws = null;
    }

    const key = ConfigManager.getFinnhubKey();
    if (!key) {
      console.error('[WebSocket] No API key available');
      this._connecting = false;
      this._status = 'disconnected';
      this._notifyStatusChange();
      return;
    }

    this._status = this._reconnectAttempt > 0 ? 'reconnecting' : 'connecting';
    this._notifyStatusChange();
    console.log(`[WebSocket] ${this._status}... (attempt ${this._reconnectAttempt + 1})`);

    try {
      this.ws = new WebSocket(`wss://ws.finnhub.io?token=${key}`);
    } catch (e) {
      console.error('[WebSocket] Failed to create WebSocket:', e);
      this._connecting = false;
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this._connecting = false;
      this._status = 'connected';
      this._reconnectAttempt = 0;
      console.log('[WebSocket] Connected');

      // Resubscribe to all desired symbols
      this.activeSymbols.clear();
      for (const sym of this.desiredSymbols) {
        this._sendSubscribe(sym);
        this.activeSymbols.add(sym);
      }

      this._startHeartbeat();
      this._notifyStatusChange();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Log all WebSocket messages to console for debugging
        if (data.type !== 'ping') {
          console.log('[WebSocket] ← received:', JSON.stringify(data).substring(0, 500));
        }
        if (data.type === 'trade' && data.data && data.data.length > 0) {
          for (const trade of data.data) {
            this._handleTrade(trade);
          }
        } else if (data.type === 'ping') {
          // Finnhub occasionally sends pings
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'pong' }));
          }
        }
      } catch (e) {
        // Ignore parse errors on non-JSON messages
      }
    };

    this.ws.onerror = (error) => {
      console.error('[WebSocket] Error:', error);
      // onclose will fire after this
    };

    this.ws.onclose = (event) => {
      this._connecting = false;
      this._clearHeartbeat();
      this.activeSymbols.clear();
      console.log(`[WebSocket] Closed (code: ${event.code}, reason: ${event.reason || 'none'})`);

      // Only reconnect if this wasn't an intentional close (code 1000)
      if (event.code !== 1000 && this._status !== 'disconnected') {
        this._scheduleReconnect();
      } else {
        this._status = 'disconnected';
        this._notifyStatusChange();
      }
    };
  }

  _sendSubscribe(symbol) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'subscribe',
      symbol: symbol.toUpperCase()
    }));
  }

  _sendUnsubscribe(symbol) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'unsubscribe',
      symbol: symbol.toUpperCase()
    }));
  }

  _handleTrade(trade) {
    const symbol = trade.s;
    const price = trade.p;
    const volume = trade.v;
    const timestamp = trade.t; // Unix ms

    // Notify all callbacks
    for (const cb of this.onTradeCallbacks) {
      try {
        cb({ symbol, price, volume, timestamp });
      } catch (e) {
        console.error('[WebSocket] Trade callback error:', e);
      }
    }
  }

  // ================================================================
  // HEARTBEAT
  // ================================================================

  _startHeartbeat() {
    this._clearHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      // Send a ping-like message (Finnhub doesn't support native ping, so use a no-op send)
      // Actually, WebSocket natively supports ping/pong at the protocol level.
      // But browser WebSocket API doesn't expose it. We check readyState instead.
      // If the connection is stale, readyState will eventually change.

      // Alternative: use a small timeout that resets on any message
      if (this._heartbeatTimeout) clearTimeout(this._heartbeatTimeout);
      this._heartbeatTimeout = setTimeout(() => {
        console.warn('[WebSocket] Heartbeat timeout — forcing reconnect');
        if (this.ws) {
          this.ws.close(4000, 'Heartbeat timeout');
        }
      }, 15000); // 15s without any message = dead connection
    }, this._heartbeatInterval);
  }

  _clearHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._heartbeatTimeout) {
      clearTimeout(this._heartbeatTimeout);
      this._heartbeatTimeout = null;
    }
  }

  // ================================================================
  // RECONNECTION (exponential backoff)
  // ================================================================

  _scheduleReconnect() {
    if (this._reconnectTimer) return; // Already scheduled

    const delay = Math.min(
      this._reconnectBaseDelay * Math.pow(2, this._reconnectAttempt),
      this._reconnectMaxDelay
    );

    this._status = 'reconnecting';
    this._notifyStatusChange();
    console.log(`[WebSocket] Reconnecting in ${delay / 1000}s...`);

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._reconnectAttempt++;
      this._doConnect();
    }, delay);
  }

  _cancelReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  _notifyStatusChange() {
    const payload = {
      status: this._status,
      count: this.desiredSymbols.size,
      max: this.MAX_SYMBOLS
    };
    for (const cb of this.onStatusChangeCallbacks) {
      try { cb(payload); } catch (e) { /* ignore */ }
    }
  }
}

// Global singleton
const wsClient = new StockWebSocket();