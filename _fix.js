const fs = require('fs');
let content = fs.readFileSync('StockWatchList/js/app.js', 'utf8');

// 1. Remove the OLD export and delete-all block
const oldExportBlock = "    // Export\n    this.exportBtn.addEventListener('click', () => this.exportCSV());\n\n    // Delete All\n    const deleteAllBtn = document.getElementById('delete-all-btn');\n    if (deleteAllBtn) {\n      deleteAllBtn.addEventListener('click', () => this.deleteAllEntries());\n    }\n";
content = content.replace(oldExportBlock, '');

// 2. Replace the OLD settings gear handler with dropdown toggle
const oldSettingsBlock = "    // Settings gear\n    const settingsBtn = document.getElementById('settings-btn');\n    if (settingsBtn) {\n      settingsBtn.addEventListener('click', () => this._showSetup(false));\n    }";
const newSettingsBlock = "    // Settings gear (dropdown)\n    const settingsBtn = document.getElementById('settings-btn');\n    if (settingsBtn && this.settingsDropdown) {\n      settingsBtn.addEventListener('click', (e) => {\n        e.stopPropagation();\n        const vis = this.settingsDropdown.classList.toggle('visible');\n        settingsBtn.classList.toggle('active', vis);\n      });\n      this.settingsDropdown.querySelectorAll('.price-action-dropdown-item').forEach(item => {\n        item.addEventListener('click', (e) => {\n          e.stopPropagation();\n          this.settingsDropdown.classList.remove('visible');\n          settingsBtn.classList.remove('active');\n          const action = item.dataset.action;\n          if (action === 'api-settings') this._showSetup(false);\n          else if (action === 'export-csv') this.exportCSV();\n          else if (action === 'delete-all') this.deleteAllEntries();\n        });\n      });\n    }";
content = content.replace(oldSettingsBlock, newSettingsBlock);

// 3. Add close-on-outside-click for settings dropdown
const oldPlaybookBlock = "      if (this.playbookDropdown && this.playbookDropdown.classList.contains('visible')) {\n        if (!this.playbookBtn.contains(e.target) && !this.playbookDropdown.contains(e.target)) {\n          this.playbookDropdown.classList.remove('visible');\n          this.playbookBtn.classList.remove('active');\n        }\n      }";
const newPlaybookBlock = "      if (this.playbookDropdown && this.playbookDropdown.classList.contains('visible')) {\n        if (!this.playbookBtn.contains(e.target) && !this.playbookDropdown.contains(e.target)) {\n          this.playbookDropdown.classList.remove('visible');\n          this.playbookBtn.classList.remove('active');\n        }\n      }\n      if (this.settingsDropdown && this.settingsDropdown.classList.contains('visible')) {\n        const sb = document.getElementById('settings-btn');\n        if (sb && !sb.contains(e.target) && !this.settingsDropdown.contains(e.target)) {\n          this.settingsDropdown.classList.remove('visible');\n          sb.classList.remove('active');\n        }\n      }";
content = content.replace(oldPlaybookBlock, newPlaybookBlock);

fs.writeFileSync('StockWatchList/js/app.js', content);
console.log('Fixed');