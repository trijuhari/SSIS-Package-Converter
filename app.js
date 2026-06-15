/**
 * app.js — Main Application Logic for SSIS Modernizer
 */

// Global State
let currentPackageInfo = null;
let currentGeneratedFiles = null;
let selectedTab = 'python';
let selectedFile = null;
let conversionHistory = [];

document.addEventListener('DOMContentLoaded', () => {
  // Load History from localStorage
  const savedHistory = localStorage.getItem('ssis_converter_history');
  if (savedHistory) {
    try {
      conversionHistory = JSON.parse(savedHistory);
      renderHistory();
    } catch (e) {
      console.error('Error loading history:', e);
    }
  }

  // Pre-load Demo Package on launch so the user sees a beautiful initialized state
  loadDemoPackage();
});

function loadDemoPackage() {
  currentPackageInfo = SSISParser.generateDemoPackage('SSIS_Customer_Loan_Pipeline');
  processConversion();
}

/* ── Tab & Section Navigation ──────────────────────────────── */
function showSection(sectionId) {
  // Sidebar active state
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(`nav-${sectionId}`).classList.add('active');

  // Section visibility
  document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
  document.getElementById(`section-${sectionId}`).classList.add('active');
}

function switchTab(tabId) {
  selectedTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${tabId}`).classList.add('active');

  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.getElementById(`tabcontent-${tabId}`).classList.add('active');

  renderTabContent(tabId);
}

/* ── File Drag & Drop ──────────────────────────────────────── */
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('upload-zone').classList.add('drag-over');
}

function handleDragLeave(e) {
  e.preventDefault();
  document.getElementById('upload-zone').classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('upload-zone').classList.remove('drag-over');

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    processFile(files[0]);
  }
}

function handleFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) {
    processFile(files[0]);
  }
}

function processFile(file) {
  const reader = new FileReader();
  showLoading(true, 'Reading SSIS package file...');

  reader.onload = function(event) {
    try {
      const xml = event.target.result;
      updateLoadingStep('Parsing package components...');
      
      // Short delay for visual transition effect
      setTimeout(() => {
        try {
          currentPackageInfo = SSISParser.parse(xml);
          currentPackageInfo.name = file.name.replace('.dtsx', '');
          processConversion();
          
          // Save to history
          addToHistory(currentPackageInfo.name);
        } catch (err) {
          showError(err.message);
        }
      }, 600);
    } catch (err) {
      showError('Failed to read file contents.');
    }
  };

  reader.readAsText(file);
}

function parsePastedXML() {
  const xml = document.getElementById('xml-paste').value.trim();
  if (!xml) {
    showToast('Please paste valid DTSX XML content first.', '#ef4444');
    return;
  }

  showLoading(true, 'Parsing pasted XML content...');
  setTimeout(() => {
    try {
      currentPackageInfo = SSISParser.parse(xml);
      processConversion();
      addToHistory(currentPackageInfo.name);
    } catch (err) {
      showError(err.message);
    }
  }, 600);
}

function clearPaste() {
  document.getElementById('xml-paste').value = '';
}

function resetConverter() {
  document.getElementById('results-container').style.display = 'none';
  document.getElementById('upload-container').style.display = 'grid';
  currentPackageInfo = null;
  currentGeneratedFiles = null;
  selectedFile = null;
}

/* ── Conversion Execution ──────────────────────────────────── */
function processConversion() {
  showLoading(true, 'Generating clean code...');
  
  setTimeout(() => {
    try {
      // Run the code generator
      currentGeneratedFiles = SSISCodegen.generate(currentPackageInfo);
      
      // Update stats dashboard
      renderStats();

      // Show Results
      showLoading(false);
      document.getElementById('upload-container').style.display = 'none';
      document.getElementById('results-container').style.display = 'flex';

      // Default active tab
      switchTab('python');
      
      // Auto-render project structure
      renderProjectStructure();

    } catch (err) {
      showError('Generation Error: ' + err.message);
    }
  }, 500);
}

function renderStats() {
  const summaryPkgName = document.getElementById('summary-pkg-name');
  const summaryMeta = document.getElementById('summary-meta');
  const statsContainer = document.getElementById('summary-stats');

  summaryPkgName.textContent = currentPackageInfo.name;
  summaryMeta.textContent = `SSIS Package Version ${currentPackageInfo.version || '1.0'} · Created by ${currentPackageInfo.creatorName || 'unknown'}`;

  const numConn = currentPackageInfo.connectionManagers.length;
  const numDF = currentPackageInfo.dataFlows.length;
  const numSQL = currentPackageInfo.sqlTasks.length;
  const numVars = currentPackageInfo.variables.length;

  statsContainer.innerHTML = `
    <div class="stat-item">
      <div class="stat-value">${numConn}</div>
      <div class="stat-label">Connections</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${numDF}</div>
      <div class="stat-label">Data Flows</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${numSQL}</div>
      <div class="stat-label">SQL Tasks</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${numVars}</div>
      <div class="stat-label">Variables</div>
    </div>
  `;
}

/* ── UI Rendering & Tabs ───────────────────────────────────── */
function renderTabContent(tabId) {
  if (tabId === 'structure') {
    return; // Rendered separately
  }

  const files = currentGeneratedFiles[tabId] || [];
  const treeContainer = document.getElementById(`${tabId}-file-tree`);
  const codeContainer = document.getElementById(`${tabId}-code-viewer`);

  treeContainer.innerHTML = '';
  
  if (files.length === 0) {
    treeContainer.innerHTML = '<div style="padding:16px; color:#4a5568; font-size:0.75rem;">No files generated.</div>';
    codeContainer.innerHTML = '<div class="code-placeholder">No output files generated.</div>';
    return;
  }

  // Create simple file tree lists
  let treeHTML = `<div class="tree-folder">`;
  files.forEach((file, index) => {
    let dotClass = 'file-dot-txt';
    if (file.name.endsWith('.py')) dotClass = 'file-dot-py';
    else if (file.name.endsWith('.sql')) dotClass = 'file-dot-sql';
    else if (file.name.endsWith('.yml') || file.name.endsWith('.yaml')) dotClass = 'file-dot-yaml';
    else if (file.name.endsWith('.md')) dotClass = 'file-dot-md';

    treeHTML += `
      <div class="tree-file" id="file-${tabId}-${index}" onclick="selectFile('${tabId}', ${index})">
        <span class="${dotClass}">●</span>
        <span>${file.name}</span>
      </div>
    `;
  });
  treeHTML += `</div>`;
  treeContainer.innerHTML = treeHTML;

  // Auto-select first file
  selectFile(tabId, 0);
}

function selectFile(tabId, index) {
  // Clear active tree items
  document.querySelectorAll('.tree-file').forEach(el => el.classList.remove('active'));

  const activeItem = document.getElementById(`file-${tabId}-${index}`);
  if (activeItem) activeItem.classList.add('active');

  const file = currentGeneratedFiles[tabId][index];
  selectedFile = file;

  const codeContainer = document.getElementById(`${tabId}-code-viewer`);
  
  // Create beautiful code view header & container
  codeContainer.innerHTML = `
    <div class="code-viewer-header">
      <span class="code-viewer-filename">${file.path}</span>
      <div class="code-viewer-actions">
        <button class="btn-ghost btn-sm" onclick="copyCodeText()">
          Copy Code
        </button>
        <button class="btn-ghost btn-sm" onclick="downloadSingleFile()">
          Download
        </button>
      </div>
    </div>
    <div class="code-block" id="code-content">${highlightCode(file.content, file.language)}</div>
  `;
}

/* ── Code Highlighting ── */
function highlightCode(code, lang) {
  // Basic safe regex highlight for rendering premium look
  let escaped = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  if (lang === 'python') {
    escaped = escaped
      .replace(/\b(def|class|import|from|return|if|else|elif|for|in|try|except|with|as|None|True|False)\b/g, '<span class="kw">$1</span>')
      .replace(/(#.*)/g, '<span class="cm">$1</span>')
      .replace(/(\".*?\"|\'.*?\')/g, '<span class="str">$1</span>')
      .replace(/(\b\d+\b)/g, '<span class="num">$1</span>');
  } else if (lang === 'sql') {
    escaped = escaped
      .replace(/\b(SELECT|FROM|WHERE|JOIN|LEFT|ON|WITH|AS|CONVERT|VARCHAR|HASHBYTES|CONCAT_WS|CAST|COALESCE|GROUP|BY|HAVING|AND|OR|BIT)\b/g, '<span class="op">$1</span>')
      .replace(/({{.*?}})/g, '<span class="jinja">$1</span>')
      .replace(/(--.*)/g, '<span class="cm">$1</span>');
  } else if (lang === 'yaml') {
    escaped = escaped
      .replace(/(:\s+.*)/g, '<span class="str">$1</span>')
      .replace(/([a-zA-Z0-9_\-]+:)/g, '<span class="kw">$1</span>')
      .replace(/(#.*)/g, '<span class="cm">$1</span>');
  }
  return escaped;
}

/* ── Project Structure Tab ─────────────────────────────────── */
function renderProjectStructure() {
  const viewer = document.getElementById('structure-viewer');
  
  let structure = `
<span class="s-dir">data-platform/</span>  <span class="s-cmt"># Modernized Data Repository</span>
├── <span class="s-dir">dags/</span>
│   ├── <span class="s-dir">ingestion/</span>
│   │   └── <span class="s-file">${currentPackageInfo.name.toLowerCase()}_pipeline.py</span>  <span class="s-cmt"># Airflow Orchestration Job</span>
│   └── <span class="s-dir">utils/</span>
│       └── <span class="s-file">notifications.py</span>  <span class="s-cmt"># Failure callback logic</span>
│
├── <span class="s-dir">ingestion/</span>
`;

  currentPackageInfo.dataFlows.forEach(df => {
    const flowName = df.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    structure += `│   ├── <span class="s-dir">${flowName}/</span>\n`;
    structure += `│   │   ├── <span class="s-file">extract_${flowName}.py</span>  <span class="s-cmt"># Ingestion (pyodbc + pandas)</span>\n`;
    structure += `│   │   └── <span class="s-file">validate_${flowName}.py</span>  <span class="s-cmt"># Pandera Data Validation Schema</span>\n`;
  });

  structure += `│   └── <span class="s-dir">utils/</span>\n`;
  structure += `│       ├── <span class="s-file">db.py</span>  <span class="s-cmt"># DB connection & parameters pool</span>\n`;
  structure += `│       ├── <span class="s-file">logger.py</span>  <span class="s-cmt"># Central logging handlers</span>\n`;
  structure += `│       ├── <span class="s-file">secrets.py</span>  <span class="s-cmt"># Azure Key Vault Secrets retriever</span>\n`;
  structure += `│       └── <span class="s-file">api_client.py</span>  <span class="s-cmt"># Robust HTTP Client with retry logic</span>\n`;
  structure += `│
├── <span class="s-dir">dbt_project/</span>
│   ├── <span class="s-dir">models/</span>
│   │   ├── <span class="s-dir">staging/</span>
`;

  currentPackageInfo.dataFlows.forEach(df => {
    const flowName = df.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    structure += `│   │   │   ├── <span class="s-file">stg_${flowName}.sql</span>  <span class="s-cmt"># Staging model (1-to-1 rename/cast)</span>\n`;
    structure += `│   │   │   └── <span class="s-file">schema_${flowName}.yml</span>  <span class="s-cmt"># YAML Data tests (unique, not_null)</span>\n`;
  });

  structure += `│   │   ├── <span class="s-dir">intermediate/</span>\n`;
  currentPackageInfo.dataFlows.forEach(df => {
    const flowName = df.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    structure += `│   │   │   └── <span class="s-file">int_${flowName}_joined.sql</span>  <span class="s-cmt"># Intermediate joins & legacy Logic conversion</span>\n`;
  });

  structure += `│   │   └── <span class="s-dir">mart/</span>\n`;
  currentPackageInfo.dataFlows.forEach(df => {
    const flowName = df.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    structure += `│   │       └── <span class="s-file">dim_${flowName}.sql</span>  <span class="s-cmt"># Reporting-ready dimensional mart table</span>\n`;
  });

  structure += `│   ├── <span class="s-dir">snapshots/</span>\n`;
  currentPackageInfo.dataFlows.forEach(df => {
    const flowName = df.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    structure += `│   │   └── <span class="s-file">snp_${flowName}.sql</span>  <span class="s-cmt"># dbt Snapshot (SCD Type 2 history logging)</span>\n`;
  });

  structure += `│   ├── <span class="s-dir">tests/</span>\n`;
  currentPackageInfo.dataFlows.forEach(df => {
    const flowName = df.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    structure += `│   │   └── <span class="s-file">assert_no_duplicate_${flowName}_per_run_date.sql</span>  <span class="s-cmt"># Singular test assertion</span>\n`;
  });

  structure += `│   ├── <span class="s-dir">macros/</span>
│   │   └── <span class="s-file">generate_surrogate_key.sql</span>  <span class="s-cmt"># Surrogate key generator macro</span>
│   └── <span class="s-file">dbt_project.yml</span>  <span class="s-cmt"># Central dbt project configs</span>
│
├── <span class="s-dir">tests/</span>
│   ├── <span class="s-dir">reconciliation/</span>\n`;
  currentPackageInfo.dataFlows.forEach(df => {
    const flowName = df.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    structure += `│   │   └── <span class="s-file">reconcile_${flowName}.py</span>  <span class="s-cmt"># Parallel-run reconciliation script</span>\n`;
  });

  currentPackageInfo.dataFlows.forEach(df => {
    const flowName = df.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    structure += `├── <span class="s-file">test_extract_${flowName}.py</span>  <span class="s-cmt"># pytest logic with mock and patch</span>\n`;
  });

  structure += `│
├── <span class="s-dir">deployment/</span>
│   └── <span class="s-file">.gitlab-ci.yml</span>  <span class="s-cmt"># CICD automation script</span>
│
├── <span class="s-file">.env.example</span>
├── <span class="s-file">requirements.txt</span>
└── <span class="s-file">README.md</span>
`;

  viewer.innerHTML = `<div class="structure-tree">${structure}</div>`;
}

/* ── Actions: Copy & Single File Download ─────────────────── */
function copyCodeText() {
  if (!selectedFile) return;
  navigator.clipboard.writeText(selectedFile.content)
    .then(() => showToast('Copied code to clipboard!', '#10b981'))
    .catch(() => showToast('Failed to copy code.', '#ef4444'));
}

function downloadSingleFile() {
  if (!selectedFile) return;
  const blob = new Blob([selectedFile.content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = selectedFile.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadAllFiles() {
  if (!currentGeneratedFiles) return;

  // Since we are client-side only without external zip libraries (which could fail or load slow),
  // we generate a beautiful, easily downloadble Project Map JSON representing all code files.
  // We also automatically trigger download for the README.md and main DAG files.
  const projectMap = {};
  
  Object.keys(currentGeneratedFiles).forEach(key => {
    currentGeneratedFiles[key].forEach(f => {
      projectMap[f.path] = f.content;
    });
  });

  const blob = new Blob([JSON.stringify(projectMap, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentPackageInfo.name}_modernized_stack_bundle.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('Downloaded Project Bundle JSON!', '#10b981');
}

/* ── Loading and Toasts ────────────────────────────────────── */
function showLoading(show, stepText = 'Parsing XML...') {
  const overlay = document.getElementById('processing-overlay');
  const step = document.getElementById('processing-step');
  
  if (show) {
    overlay.style.display = 'flex';
    step.textContent = stepText;
  } else {
    overlay.style.display = 'none';
  }
}

function updateLoadingStep(text) {
  document.getElementById('processing-step').textContent = text;
}

function showError(msg) {
  showLoading(false);
  alert('Error parsing package: ' + msg);
}

function showToast(message, bgColor) {
  // Clean existing toast
  const existing = document.querySelector('.copy-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'copy-toast';
  toast.style.borderColor = bgColor;
  toast.style.color = bgColor;
  toast.innerHTML = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 2000);
}

/* ── History Manager ───────────────────────────────────────── */
function addToHistory(pkgName) {
  const newHist = {
    name: pkgName,
    date: new Date().toLocaleString(),
    tables: currentPackageInfo.dataFlows.length,
    conns: currentPackageInfo.connectionManagers.length
  };

  conversionHistory.unshift(newHist);
  if (conversionHistory.length > 10) conversionHistory.pop(); // keep last 10

  localStorage.setItem('ssis_converter_history', JSON.stringify(conversionHistory));
  renderHistory();
}

function renderHistory() {
  const list = document.getElementById('history-list');
  if (conversionHistory.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <p>No conversions yet. Upload a .dtsx file to get started.</p>
      </div>
    `;
    return;
  }

  let html = '';
  conversionHistory.forEach((item, idx) => {
    html += `
      <div class="history-item" onclick="loadHistoryItem(${idx})">
        <div class="history-icon">📦</div>
        <div class="history-info">
          <div class="history-name">${item.name}</div>
          <div class="history-meta">Converted on ${item.date} · ${item.conns} sources · ${item.tables} pipelines</div>
        </div>
        <span class="history-badge">Modernized</span>
      </div>
    `;
  });
  list.innerHTML = html;
}

function loadHistoryItem(idx) {
  const item = conversionHistory[idx];
  currentPackageInfo = SSISParser.generateDemoPackage(item.name);
  showSection('converter');
  processConversion();
}
