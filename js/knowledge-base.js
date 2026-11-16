/* Knowledge Base menu.
 *
 * Data-driven configuration. To add a new menu item in the future, append one
 * object to the `items` array of an existing category, or add a new category
 * block to MENU_ITEMS. No other code needs to change.
 *
 * Each item renders as a menu button; clicking opens `href` in its own tab.
 */
(function () {
  'use strict';

  const MENU_ITEMS = [
    {
      category: 'Sizer',
      items: [
        { label: 'Position Sizer', icon: '🧮', href: 'calculator.html' },
      ],
    },
    {
      category: 'Setups',
      items: [
        { label: 'Setup Reference', icon: '📚', href: 'active_trading_reference.html' },
        { label: 'Three Setups', icon: '🎯', href: 'Setups_playbook_Pro.html' },
        { label: 'Stock Strength Guide', icon: '💪', href: 'Intraday_Stock_Strength_Detail.html' },
        { label: 'Strength Validator', icon: '✅', href: 'stock-strength-guide.html' },
        { label: 'Five Point Strength Test', icon: '🖐️', href: 'FivePointTestGuide.html' },
      ],
    },
    {
      category: 'VPA',
      items: [
        { label: 'Core Ideas', icon: '💡', href: 'vpa-core.html' },
        { label: 'Market Cycles and Candle VPA', icon: '📈', href: 'VPA.html' },
        { label: 'Patterns and Axioms', icon: '🕯️', href: 'vpa_learning.html' },
        { label: 'VPA Pocket Guide', icon: '📖', href: 'vpa_guide_v5.html' },
      ],
    },
    {
      category: 'Price Action',
      items: [
        { label: 'Candlestick Patterns', icon: '📖', href: 'patterns4.html' },
        { label: 'Support & Resistance', icon: '📐', href: 'level2v2.html' },
      ],
    },
  ];

  const menuEl = document.getElementById('kb-menu');
  if (!menuEl) return;

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(text) {
    return escapeHtml(String(text)).replace(/'/g, '&#39;');
  }

  let html = '';
  MENU_ITEMS.forEach((cat) => {
    html += '<div class="kb-category">';
    html += '<div class="kb-category-title">' + escapeHtml(cat.category) + '</div>';
    cat.items.forEach((item) => {
      html += '<button class="kb-item" data-href="' + escapeAttr(item.href) + '">';
      html += '<span class="kb-icon">' + escapeHtml(item.icon) + '</span>';
      html += '<span class="kb-label">' + escapeHtml(item.label) + '</span>';
      html += '<span class="kb-arrow">&#8594;</span>';
      html += '</button>';
    });
    html += '</div>';
  });
  menuEl.innerHTML = html;

  menuEl.querySelectorAll('.kb-item').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      window.open(btn.dataset.href, '_blank');
    });
  });
})();
