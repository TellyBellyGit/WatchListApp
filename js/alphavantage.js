// ============================================================================
// ALPHA VANTAGE API — Company Fundamentals (Float, Shares Outstanding, etc.)
// ============================================================================
// Free tier: 25 API calls/day (standard), 5 calls/minute
// Documentation: https://www.alphavantage.co/documentation/
// ============================================================================

const ALPHAVANTAGE_BASE = 'https://www.alphavantage.co';

class AlphaVantageAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.callCount = 0;
    this.callTimestamps = [];
    this.rateLimitWindow = 60000; // 60 seconds
    this.maxCallsPerWindow = 4;   // Conservative: 5 calls/min limit
  }

  // ---- Rate Limiter ----
  async _checkRateLimit() {
    const now = Date.now();
    this.callTimestamps = this.callTimestamps.filter(t => now - t < this.rateLimitWindow);

    if (this.callTimestamps.length >= this.maxCallsPerWindow) {
      const oldest = this.callTimestamps[0];
      const waitTime = this.rateLimitWindow - (now - oldest) + 1000;
      console.warn(`[AlphaVantage] Rate limit approaching. Waiting ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.callTimestamps.push(Date.now());
    this.callCount++;
  }

  // ---- Generic API Call ----
  async _call(params) {
    await this._checkRateLimit();

    const queryString = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const url = `${ALPHAVANTAGE_BASE}/query?${queryString}&apikey=${this.apiKey}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`[AlphaVantage] API call failed:`, error);
      throw error;
    }
  }

  // ---- Get Company Overview (includes SharesFloat, SharesOutstanding, Sector, etc.) ----
  async getOverview(symbol) {
    const data = await this._call({
      function: 'OVERVIEW',
      symbol: symbol.toUpperCase()
    });

    // Alpha Vantage returns a "Note" field when rate-limited
    if (data.Note) {
      console.warn(`[AlphaVantage] Rate limit message: ${data.Note}`);
      return { _error: true, _reason: 'rate_limit', _message: data.Note };
    }

    // Check if we got meaningful data
    if (!data.Symbol && !data.Name) {
      console.warn(`[AlphaVantage] No data returned for ${symbol}`);
      return { _error: true, _reason: 'no_data' };
    }

    return {
      symbol: data.Symbol || symbol.toUpperCase(),
      companyName: data.Name || '',
      exchange: data.Exchange || '',
      sector: data.Sector || '',
      industry: data.Industry || '',
      sharesFloat: data.SharesFloat ? parseFloat(data.SharesFloat) : null,
      sharesOutstanding: data.SharesOutstanding ? parseFloat(data.SharesOutstanding) : null,
      marketCap: data.MarketCapitalization ? parseFloat(data.MarketCapitalization) : null,
      description: data.Description || '',
      _error: false,
    };
  }

  // ---- Fetch float data only (lightweight, for use alongside Finnhub quote) ----
  async getFloatData(symbol) {
    const overview = await this.getOverview(symbol);

    if (overview._error) {
      return {
        sharesOutstanding: null,
        impliedSharesOutstanding: null,
        sharesFloat: null,
        heldPercentInsiders: null,
        heldPercentInstitutions: null,
        _error: true,
        _reason: overview._reason,
      };
    }

    return {
      sharesOutstanding: overview.sharesOutstanding,
      impliedSharesOutstanding: overview.sharesOutstanding, // Alpha Vantage doesn't differentiate
      sharesFloat: overview.sharesFloat,
      heldPercentInsiders: null,   // Not available in free tier
      heldPercentInstitutions: null, // Not available in free tier
      sector: overview.sector,
      companyName: overview.companyName,
      exchange: overview.exchange,
      _error: false,
    };
  }
}

// Global singleton
window._alphavantage = null;

function getAlphaVantage() {
  if (!window._alphavantage) {
    const key = ConfigManager.getAlphaVantageKey();
    if (!key) return null;
    window._alphavantage = new AlphaVantageAPI(key);
  }
  return window._alphavantage;
}

// Legacy alias for backward compatibility
Object.defineProperty(window, 'alphavantage', {
  get() {
    return getAlphaVantage();
  },
  configurable: true
});