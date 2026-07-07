const fs = require('fs');
let content = fs.readFileSync('StockWatchList/js/app.js', 'utf8');

// Check if the issues still exist
if (content.includes("this.exportBtn.addEventListener('click'")) {
  // Remove old export/delete block (4-space indent, CRLF lines)
  content = content.replace(
    "    // Export\r\n    this.exportBtn.addEventListener('click', () => this.exportCSV());\r\n\r\n    // Delete All\r\n    const deleteAllBtn = document.getElementById('delete-all-btn');\r\n    if (deleteAllBtn) {\r\n      deleteAllBtn.addEventListener('click', () => this.deleteAllEntries());\r\n    }\r\n",
    ''
  );
}

if (content.includes("settingsBtn.addEventListener('click', () => this._showSetup(false))")) {
  const oldSet = "    // Settings gear\r\n    const settingsBtn = document.getElementById('settings-btn');\r\n    if (settingsBtn) {\r\n      settingsBtn.addEventListener('click', () => this._showSetup(false));\r\n    }";
  const newSet = "    // Settings gear (dropdown)\r\n    const settingsBtn = document.getElementById('settings-btn');\r\n    if (settingsBtn && this.settingsDropdown) {\r\n      settingsBtn.addEventListener('click', (e) => {\r\n        e.stopPropagation();\r\n        const vis = this.settingsDropdown.classList.toggle('visible');\r\n        settingsBtn.classList.toggle('active', vis);\r\n      });\r\n      this.settingsDropdown.querySelectorAll('.price-action-dropdown-item').forEach(item => {\r\n        item.addEventListener('click', (e) => {\r\n          e.stopPropagation();\r\n          this.settingsDropdown.classList.remove('visible');\r\n          settingsBtn.classList.remove('active');\r\n          const action = item.dataset.action;\r\n          if (action === 'api-settings') this._showSetup(false);\r\n          else if (action === 'export-csv') this.exportCSV();\r\n          else if (action === 'delete-all') this.deleteAllEntries();\r\n        });\r\n      });\r\n    }";
  content = content.replace(oldSet, newSet);
}

// Add close-on-outside-click
const oldClose = "      if (this.playbookDropdown && this.playbookDropdown.classList.contains('visible')) {\r\n        if (!this.playbookBtn.contains(e.target) && !this.playbookDropdown.contains(e.target)) {\r\n          this.playbookDropdown.classList.remove('visible');\r\n          this.playbookBtn.classList.remove('active');\r\n        }\r\n      }";
if (!content.includes('this.settingsDropdown && this.settingsDropdown.classList.contains')) {
  const newClose = "      if (this.playbookDropdown && this.playbookDropdown.classList.contains('visible')) {\r\n        if (!this.playbookBtn.contains(e.target) && !this.playbookDropdown.contains(e.target)) {\r\n          this.playbookDropdown.classList.remove('visible');\r\n          this.playbookBtn.classList.remove('active');\r\n        }\r\n      }\r\n      if (this.settingsDropdown && this.settingsDropdown.classList.contains('visible')) {\r\n        const sb = document.getElementById('settings-btn');\r\n        if (sb && !sb.contains(e.target) && !this.settingsDropdown.contains(e.target)) {\r\n          this.settingsDropdown.classList.remove('visible');\r\n          sb.classList.remove('active');\r\n        }\r\n      }";
  content = content.replace(oldClose, newClose);
}

// Also check for the date-dot-strip element in the HTML - it might have disappeared if the JS calls _renderDateDotStrip but the element is missing
// But that's in the HTML file, not JS.

fs.writeFileSync('StockWatchList/js/app.js', content);
console.log('Fix applied');