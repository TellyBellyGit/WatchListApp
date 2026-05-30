// ============================================================================
// FINNHUB API — Real-time Stock Data
// ============================================================================
// Free tier: 60 API calls/minute
// Documentation: https://finnhub.io/docs/api
// ============================================================================

// API key is fetched from ConfigManager (localStorage), with fallback to config.js for local dev.
const FINNHUB_BASE = 'https://finnhub.io/api/v1';

class FinnhubAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.callCount = 0;
    this.rateLimitWindow = 60000; // 60 seconds
    this.maxCallsPerWindow = 55;  // Slightly under the 60/min limit
    this.callTimestamps = [];
  }

  // ---- Rate Limiter ----
  async _checkRateLimit() {
    const now = Date.now();
    this.callTimestamps = this.callTimestamps.filter(t => now - t < this.rateLimitWindow);

    if (this.callTimestamps.length >= this.maxCallsPerWindow) {
      const oldest = this.callTimestamps[0];
      const waitTime = this.rateLimitWindow - (now - oldest) + 500;
      console.warn(`[Finnhub] Rate limit approaching. Waiting ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.callTimestamps.push(Date.now());
    this.callCount++;
  }

  // ---- Generic API Call ----
  async _call(endpoint) {
    await this._checkRateLimit();

    const url = `${FINNHUB_BASE}${endpoint}${endpoint.includes('?') ? '&' : '?'}token=${this.apiKey}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`[Finnhub] API call failed: ${endpoint}`, error);
      throw error;
    }
  }

  // ---- Get Real-Time Quote ----
  async getQuote(symbol) {
    return await this._call(`/quote?symbol=${symbol.toUpperCase()}`);
  }

  // ---- Get Company Profile ----
  async getCompanyProfile(symbol) {
    return await this._call(`/stock/profile2?symbol=${symbol.toUpperCase()}`);
  }

  // ---- Search Symbol ----
  async searchSymbol(query) {
    return await this._call(`/search?q=${encodeURIComponent(query)}`);
  }

  // ---- Scan News for Ticker Mentions ----
  static _scanNewsForSymbol(news, symbol) {
    if (!Array.isArray(news) || news.length === 0) return [];

    const tickerRegex = new RegExp(`\\b${symbol}\\b`, 'i');
    const snippets = [];

    for (const article of news) {
      if (snippets.length >= 5) break;

      const summary = article.summary || '';
      const headline = article.headline || '';

      if (summary && tickerRegex.test(summary)) {
        let snippet = summary.length > 150
          ? summary.substring(0, 150).replace(/\s+\S*$/, '') + '...'
          : summary;
        snippets.push(snippet);
      } else if (headline) {
        snippets.push(headline);
      }
    }

    return snippets;
  }

  // ---- Get Company News ----
  async getCompanyNews(symbol, fromDate, toDate) {
    return await this._call(`/company-news?symbol=${symbol.toUpperCase()}&from=${fromDate}&to=${toDate}`);
  }

  // ---- Fetch All Data for a Symbol (quote + profile + news) ----
  async getFullStockData(symbol) {
    const sym = symbol.toUpperCase();

    try {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const [quote, profile, news] = await Promise.all([
        this.getQuote(sym),
        this.getCompanyProfile(sym),
        this.getCompanyNews(sym, oneWeekAgo, todayStr).catch(() => [])
      ]);

      const newsSnippets = FinnhubAPI._scanNewsForSymbol(news, sym);
      const hasNewsOnEntry = newsSnippets.length > 0;
      const newsHeadlines = newsSnippets.join(' | ');

      return {
        symbol: sym,
        companyName: profile.name || sym,
        exchange: profile.exchange || '',
        sector: profile.finnhubIndustry || '',
        sharesFloat: null,
        sharesOutstanding: null,
        impliedSharesOutstanding: null,
        heldPercentInsiders: null,
        heldPercentInstitutions: null,

        notedPrice: quote.c || 0,
        notedPercentChange: quote.dp || 0,
        notedChange: quote.d || 0,
        notedVolume: 0,
        notedDayHigh: quote.h || 0,
        notedDayLow: quote.l || 0,
        notedOpen: quote.o || 0,
        notedPreviousClose: quote.pc || 0,

        currentPrice: quote.c || 0,
        currentPercentChange: quote.dp || 0,
        currentChange: quote.d || 0,
        currentVolume: 0,
        currentDayHigh: quote.h || 0,
        currentDayLow: quote.l || 0,
        currentOpen: quote.o || 0,
        currentPreviousClose: quote.pc || 0,

        hasNewsOnEntry,
        newsHeadlines,

        quoteTimestamp: quote.t ? new Date(quote.t * 1000).toISOString() : null,
      };
    } catch (error) {
      console.error(`[Finnhub] Failed to fetch data for ${sym}:`, error);
      throw new Error(`Could not fetch data for ${sym}. Check the symbol or your API key.`);
    }
  }

  // ---- Refresh Current Quote Only (for mass refresh) ----
  async refreshQuote(symbol) {
    try {
      const quote = await this.getQuote(symbol.toUpperCase());

      return {
        currentPrice: quote.c || 0,
        currentPercentChange: quote.dp || 0,
        currentChange: quote.d || 0,
        currentVolume: 0,
        currentDayHigh: quote.h || 0,
        currentDayLow: quote.l || 0,
        currentOpen: quote.o || 0,
        currentPreviousClose: quote.pc || 0,
        quoteTimestamp: quote.t ? new Date(quote.t * 1000).toISOString() : null,
      };
    } catch {
      return { _error: true };
    }
  }
}

// Global singleton
window._finnhub = null;

function getFinnhub() {
  if (!window._finnhub) {
    const key = ConfigManager.getFinnhubKey();
    if (!key) return null;
    window._finnhub = new FinnhubAPI(key);
  }
  return window._finnhub;
}

// Legacy alias for backward compatibility
Object.defineProperty(window, 'finnhub', {
  get() {
    return getFinnhub();
  },
  configurable: true
});