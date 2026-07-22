// ============================================================================
// UTILITIES — Date formatting (EST), CSV export, number formatting
// ============================================================================

const Utils = {
  // ---- EST Date/Time Formatter ----
  // Always formats to America/New_York timezone (EST/EDT auto-detected)
  formatEST(dateOrString, options = {}) {
    const {
      showTime = true,
      showSeconds = true,
      showTimezone = true
    } = options;

    const date = dateOrString instanceof Date ? dateOrString : new Date(dateOrString);

    if (isNaN(date.getTime())) return '—';

    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: showSeconds ? '2-digit' : undefined,
        hour12: true
      });

      let formatted = formatter.format(date);

      if (showTimezone) {
        // Determine if EST or EDT by comparing UTC offset
        const nyFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          timeZoneName: 'short'
        });
        const tzPart = nyFormatter.formatToParts(date).find(p => p.type === 'timeZoneName');
        const tzName = tzPart ? tzPart.value : '';
        formatted += ' ' + (tzName.includes('D') ? 'EDT' : 'EST');
      }

      return formatted;
    } catch {
      return date.toLocaleString();
    }
  },

  // ---- EST Date Only (for filtering) ----
  formatESTDateOnly(dateOrString) {
    const date = dateOrString instanceof Date ? dateOrString : new Date(dateOrString);
    if (isNaN(date.getTime())) return '';

    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      return formatter.format(date); // Returns YYYY-MM-DD
    } catch {
      return date.toISOString().split('T')[0];
    }
  },

  // ---- Current EST Time (for auto-stamping) ----
  getCurrentEST() {
    return new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  },

  // ---- Current Timestamp (UTC) for auto-stamping ----
  // Stored as UTC; displayed in EST via formatEST()
  getCurrentESTISO() {
    return new Date().toISOString();
  },

  // ---- Format Number (e.g., 1,234.56) ----
  formatNumber(num, decimals = 2) {
    if (num == null || isNaN(num)) return '—';
    return Number(num).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  },

  // ---- Format Currency ----
  formatCurrency(num, decimals = 2) {
    if (num == null || isNaN(num)) return '—';
    return '$' + Utils.formatNumber(num, decimals);
  },

  // ---- Format Percent ----
  formatPercent(num, decimals = 2) {
    if (num == null || isNaN(num)) return '—';
    const sign = num >= 0 ? '+' : '';
    return sign + Number(num).toFixed(decimals) + '%';
  },

  // ---- Format Large Number (e.g., 1.5M, 250K) ----
  formatVolume(num) {
    if (num == null || isNaN(num)) return '—';
    if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + 'B';
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
    return num.toString();
  },

  // ---- Calculate Gain/Loss Percentage ----
  calcGainLoss(notedPrice, currentPrice) {
    if (!notedPrice || !currentPrice || notedPrice === 0) return 0;
    return ((currentPrice - notedPrice) / notedPrice) * 100;
  },

  // ---- Detect Volume Spike ----
  // Returns spike ratio (currentVolume / notedVolume)
  // null if not enough data
  detectVolumeSpike(notedVolume, currentVolume) {
    if (!notedVolume || !currentVolume || notedVolume === 0) return null;
    return currentVolume / notedVolume;
  },

  // ---- Get CSS class for value ----
  valueClass(value) {
    if (value > 0) return 'pnl-positive';
    if (value < 0) return 'pnl-negative';
    return '';
  },

  // ---- CSV Export ----
  exportCSV(entries) {
    if (!entries.length) return;

    const headers = [
      'Symbol', 'Company Name', 'Sector',
      'Noted Price', 'Current Price', 'P&L %',
      'Noted % Change', 'Current % Change',
      'Noted Day High', 'Noted Day Low',
      'Current Day High', 'Current Day Low',
      'Volume', 'Float',
      'Entry Date (EST)', 'Last Updated (EST)',
      'Tags', 'Notes'
    ];

    const rows = entries.map(e => [
      e.symbol,
      e.companyName,
      e.sector || '',
      e.notedPrice,
      e.currentPrice,
      Utils.calcGainLoss(e.notedPrice, e.currentPrice).toFixed(2),
      e.notedPercentChange,
      e.currentPercentChange,
      e.notedDayHigh,
      e.notedDayLow,
      e.currentDayHigh,
      e.currentDayLow,
      e.currentVolume || 0,
      e.sharesFloat || '',
      Utils.formatEST(e.entryDateEST || e.createdAt, { showSeconds: false }),
      Utils.formatEST(e.updatedAt, { showSeconds: false }),
      (e.tags || []).join('; '),
      e.notes || ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.map(cell => {
        // Escape cells with commas or quotes
        const str = String(cell ?? '');
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `stock-watchlist-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  // ---- Debounce ----
  debounce(fn, delay = 300) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  // ---- Download a Blob as a file ----
  downloadBlob(data, filename, mimeType = 'application/octet-stream') {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // ---- Escape HTML Attribute (for tooltips) ----
  escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&').replace(/"/g, '"').replace(/</g, '<').replace(/>/g, '>');
  },

  // ---- Show Toast Notification ----
  showToast(message, type = 'success', duration = 3000) {
    // Remove existing toasts
    document.querySelectorAll('.toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
      <span>${message}</span>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
};