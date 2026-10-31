import React, { useState, useEffect, useRef } from 'react';
import { Check, ChevronDown, FolderOpen } from 'lucide-react';
import { Dialog, Tabs, Button, Select } from '../../../ui';
import { correctGeometryIconOrder } from '../parser';
import { deriveDeckTitle, exportHistory } from '../export';

const HistoryModal = ({ isOpen, onClose, history, onImport, uploadedFileName, onExportWithResolver, onExportVis, onExportVisWithResolver, onImportThemes, enableImgPromptExport, setEnableImgPromptExport, imgPromptModel, setImgPromptModel, onGenerateImgPrompts, isGeneratingImgPrompts, imgPromptError, onExportVisualAssets, hasPlacedAssets, exportDirHandle, exportFolderPath, onPickExportFolder, onClearExportFolder }) => {
  const [importText, setImportText] = useState('');
  const [mode, setMode] = useState('export');
  const [includeVisExport, setIncludeVisExport] = useState(false);
  const [includeVisAssets, setIncludeVisAssets] = useState(false);
  const [projectName, setProjectName] = useState(() => deriveDeckTitle(uploadedFileName, history));

  // Re-derive project name when uploadedFileName or history changes
  useEffect(() => {
    setProjectName(deriveDeckTitle(uploadedFileName, history));
  }, [uploadedFileName, history.length]);
  
  const handleExport = async () => {
    if (history.length === 0) return;

    // Check for duplicates first
    const pageGroups = {};
    history.forEach(item => {
      const num = item.pageNum;
      if (!pageGroups[num]) pageGroups[num] = [];
      pageGroups[num].push(item);
    });

    const duplicates = Object.entries(pageGroups)
      .filter(([_, items]) => items.length > 1)
      .map(([pageNum, items]) => ({ pageNum, items }))
      .sort((a, b) => (parseInt(a.pageNum) || 999) - (parseInt(b.pageNum) || 999));

    // Sanitize the user-edited project name
    const sanitized = projectName.trim().replace(/[^a-zA-Z0-9\s_-]/g, '').replace(/\s+/g, '_').substring(0, 50) || 'Deck';

    if (duplicates.length > 0) {
      // Has duplicates - use resolver, passing whether this is a VIS export
      if (includeVisExport) {
        onExportVisWithResolver(duplicates, sanitized);
      } else {
        onExportWithResolver(duplicates, sanitized);
      }
      onClose();
      return;
    }

    // No duplicates - export directly
    if (includeVisExport) {
      onExportVis(sanitized);
    } else {
      exportHistory(history, uploadedFileName, exportDirHandle, sanitized);
    }

    // Trigger image prompt generation if enabled (ONLY at export time)
    if (enableImgPromptExport && onGenerateImgPrompts) {
      await onGenerateImgPrompts(history, sanitized);
    }

    // Export placed visual assets if enabled
    if (includeVisAssets && onExportVisualAssets) {
      onExportVisualAssets();
    }

    onClose();
  };
  
  const handleImport = () => {
    if (!importText.trim()) return;
    
    // Parse the DECKOUTLINE markdown into individual pages
    // Try format 1: SLIDE #X — [LAYOUT TYPE: Layout Name]
    let slidePattern = /═{20,}\s*\nSLIDE\s*#(\d+|X)\s*[—–\-]+\s*\[LAYOUT TYPE:\s*([^\]]+)\]\s*\n═{20,}\s*\n([\s\S]*?)(?=═{20,}\s*\nSLIDE\s*#|$)/gi;
    
    const newHistory = [];
    let match;
    
    while ((match = slidePattern.exec(importText)) !== null) {
      const pageNum = match[1];
      const layout = match[2].trim();
      const contentBody = match[3].trim();
      
      const titleMatch = contentBody.match(/▸ TITLE:\s*\n([^\n▸]+)/) || contentBody.match(/▸ TITLE:\s+([^\n▸]+)/);
      const title = titleMatch ? titleMatch[1].trim() : 'Untitled';
      
      // Reconstruct in simpler format
      const fullContent = correctGeometryIconOrder(`SLIDE #${pageNum} — ${layout}
═══════════════════════════════════════════════════════════════

${contentBody}

═══════════════════════════════════════════════════════════════`);

      newHistory.push({
        id: Date.now() + Math.random() * 1000,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        layout: layout,
        pageNum: pageNum,
        title: title,
        output: fullContent
      });
    }

    // Try format 2: SLIDE #X — Layout Name (no brackets)
    if (newHistory.length === 0) {
      slidePattern = /SLIDE\s*#(\d+|X)\s*[—–\-]+\s*([^\n═]+)\s*\n═{20,}\s*\n([\s\S]*?)(?=SLIDE\s*#\d|$)/gi;

      while ((match = slidePattern.exec(importText)) !== null) {
        const pageNum = match[1];
        const layout = match[2].trim();
        const contentBody = match[3].trim();

        const titleMatch = contentBody.match(/▸ TITLE:\s*\n([^\n▸]+)/) || contentBody.match(/▸ TITLE:\s+([^\n▸]+)/);
        const title = titleMatch ? titleMatch[1].trim() : 'Untitled';

        const fullContent = correctGeometryIconOrder(`SLIDE #${pageNum} — ${layout}
═══════════════════════════════════════════════════════════════

${contentBody}

═══════════════════════════════════════════════════════════════`);

        newHistory.push({
          id: Date.now() + Math.random() * 1000,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          layout: layout,
          pageNum: pageNum,
          title: title,
          output: fullContent
        });
      }
    }
    
    // Fallback: if no matches found, try single slide parse
    if (newHistory.length === 0 && importText.includes('SLIDE #')) {
      // Try format 1
      let headerMatch = importText.match(/SLIDE\s*#(\d+|X)\s*[—–\-]+\s*\[LAYOUT TYPE:\s*([^\]]+)\]/i);
      // Try format 2
      if (!headerMatch) {
        headerMatch = importText.match(/SLIDE\s*#(\d+|X)\s*[—–\-]+\s*([^\n═]+)/i);
      }
      const titleMatch = importText.match(/▸ TITLE:\s*\n([^\n▸]+)/) || importText.match(/▸ TITLE:\s+([^\n▸]+)/);
      
      if (headerMatch) {
        newHistory.push({
          id: Date.now() + Math.random() * 1000,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          layout: headerMatch[2].trim(),
          pageNum: headerMatch[1],
          title: titleMatch ? titleMatch[1].trim() : 'Untitled',
          output: correctGeometryIconOrder(importText.trim())
        });
      }
    }
    
    if (newHistory.length > 0) {
      onImport(newHistory);
      
      // Parse theme colors from VIS_DECKOUTLINE format
      const importedThemes = [];
      // Parse selected theme from header
      const selectedThemeMatch = importText.match(/▸ SELECTED THEME:\s*([^—\n]+)—\s*(#[0-9a-f]{6}(?:\s*,\s*#[0-9a-f]{6})*)/i);
      if (selectedThemeMatch) {
        const name = selectedThemeMatch[1].trim();
        const colors = selectedThemeMatch[2].split(',').map(c => c.trim());
        if (colors.length === 4) importedThemes.push({ name, colors });
      }
      // Parse alternate themes from footer
      const altSection = importText.match(/ALTERNATE THEME COLORS[\s\S]*?═{20,}\s*\n([\s\S]*?)(?:═{20,}|$)/);
      if (altSection) {
        const altLines = altSection[1].split('\n').filter(l => l.trim().startsWith('•'));
        altLines.forEach(line => {
          const m = line.match(/•\s*([^:]+):\s*(#[0-9a-f]{6}(?:\s*,\s*#[0-9a-f]{6})*)/i);
          if (m) {
            const colors = m[2].split(',').map(c => c.trim());
            if (colors.length === 4) importedThemes.push({ name: m[1].trim(), colors });
          }
        });
      }
      if (importedThemes.length > 0 && onImportThemes) {
        onImportThemes(importedThemes);
      }
      
      onClose();
    }
  };
  
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      setImportText(e.target.result);
    };
    reader.readAsText(file);
  };
  
  if (!isOpen) return null;

  // A checkbox row: A1's `.dog-check` (kit request A1-KR-4 — the kit has no
  // Checkbox), one size across the tool (review D26 counted two). The label
  // stays a plain span: it was not clickable before, and making it so is a
  // new target (C1).
  const checkRow = (checked, onToggle, label) => (
    <div className="dog-history-check">
      <button
        type="button"
        onClick={onToggle}
        className="dog-check" data-checked={checked} role="checkbox" aria-checked={checked} aria-label={label}
      >
        {checked && <Check className="dog-check-glyph" aria-hidden="true" />}
      </button>
      <span className="dog-history-check-label">{label}</span>
    </div>
  );

  // The primary action of each mode sits in the Dialog's footer: the same
  // control, the same conditions, the same handler — the kit's header /
  // body / footer contract instead of a full-width bar at the foot of the
  // body.
  const footer = mode === 'export' ? (
    <Button
      variant="primary"
      onClick={handleExport}
      disabled={history.length === 0}
      loading={isGeneratingImgPrompts}
      loadingLabel="Generating image prompts..."
    >
      {enableImgPromptExport
        ? 'Download outline & image prompts'
        : (includeVisExport ? 'Download VIS_DECKOUTLINE.md' : 'Download DECKOUTLINE.md')}
    </Button>
  ) : (importText ? (
    <Button variant="primary" onClick={handleImport}>
      Import to history
    </Button>
  ) : null);

  return (
    <Dialog
      title="History import/export"
      onClose={onClose}
      width="form"
      footer={footer}
      /* The image-prompt failure reads in the footer, beside the button that
         failed (review D31: a bare red paragraph above it). */
      error={mode === 'export' ? imgPromptError : null}
      className="dog-history-dialog"
    >
      {/* Export / Import — the kit's Tabs (review D21: the active mode was a
          white-on-orange fill, C6). */}
      <Tabs
        items={[{ id: 'export', label: 'Export' }, { id: 'import', label: 'Import' }]}
        value={mode}
        onChange={setMode}
        label="History mode"
        panelId="dog-history-panel"
        className="dog-history-modes"
      />

      <div id="dog-history-panel" role="tabpanel" className="dog-history-panel">
        {mode === 'export' ? (
          <>
            <p className="dog-history-lede">
              Export all {history.length} page(s) as a DECKOUTLINE markdown file.
            </p>

            {/* Project Name */}
            <div className="dog-history-group">
              <label className="ui-field-label dog-history-label" id="dog-history-name-label">Project Name</label>
              <div className="dog-history-name">
                <input
                  id="dog-history-name"
                  aria-labelledby="dog-history-name-label"
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="ui-input dog-history-name-input" data-size="md" data-surface="dark"
                  placeholder="Deck"
                  spellCheck={false}
                />
                <span className="dog-history-suffix">_DECKOUTLINE.md</span>
              </div>
            </div>

            {/* Export Folder — above checkboxes */}
            <div className="dog-history-group dog-history-rule">
              <div className="dog-history-label-row">
                <span className="ui-field-label">Export Folder</span>
                {exportFolderPath && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onClearExportFolder}
                    title="Reset to browser downloads"
                    className="dog-history-reset"
                  >
                    Reset
                  </Button>
                )}
              </div>
              <div className="dog-history-folder">
                <div
                  className="dog-history-path"
                  data-set={exportFolderPath ? 'true' : 'false'}
                  title={exportFolderPath || 'Browser downloads folder'}
                >
                  {exportFolderPath || 'Browser downloads folder (default)'}
                </div>
                {window.showDirectoryPicker && (
                  <Button variant="secondary" Icon={FolderOpen} onClick={onPickExportFolder}>
                    Browse
                  </Button>
                )}
              </div>
              {exportDirHandle && (
                <p className="ui-field-hint dog-history-note">Files will be saved directly to this folder.</p>
              )}
              {exportFolderPath && !exportDirHandle && (
                <p className="dog-history-note" data-tone="warning">Folder access expired. Click Browse to re-select.</p>
              )}
            </div>

            {/* Checkboxes Section — above button */}
            <div className="dog-history-group dog-history-rule dog-history-checks">
              {checkRow(includeVisExport, () => setIncludeVisExport(!includeVisExport), 'Include theme colors & deck visual description')}
              {checkRow(enableImgPromptExport, () => setEnableImgPromptExport(!enableImgPromptExport), 'Generate image prompts')}
              {/* Export Visual Assets Checkbox — only visible when placement is active */}
              {hasPlacedAssets && checkRow(includeVisAssets, () => setIncludeVisAssets(!includeVisAssets), 'Export placed visual assets')}
            </div>

            {/* Model Dropdown — visible only when image prompts enabled. It
                sat in a 24px indent no other control had (review D33); it
                belongs to the checkbox above by proximity now. */}
            {enableImgPromptExport && (
              <div className="dog-history-model">
                <label className="ui-field-label dog-history-label" id="dog-history-model-label">Image Generation Model</label>
                <div className="dog-history-select">
                  <Select
                    id="dog-history-model"
                    aria-labelledby="dog-history-model-label"
                    value={imgPromptModel}
                    onChange={setImgPromptModel}
                    options={[
                      { value: 'midjourney', label: 'Midjourney' },
                      { value: 'flux', label: 'Flux' },
                      { value: 'nanobanana', label: 'Nano Banana' },
                      { value: 'chatgpt', label: 'Chat GPT' },
                    ]}
                    className="dog-select"
                  />
                  <ChevronDown className="dog-select-chevron" aria-hidden="true" />
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="dog-history-lede">
              Import a DECKOUTLINE markdown file to restore history.
            </p>
            {/* The file picker is the kit's secondary Button, as New
                project's are (review D30). It was a <label> round a hidden
                input, which the keyboard could not reach. */}
            <Button
              variant="secondary"
              className="dog-history-upload"
              onClick={() => document.getElementById('dog-history-file-input')?.click()}
            >
              Choose DECKOUTLINE.md file
            </Button>
            <input id="dog-history-file-input" type="file" className="hidden" accept=".md,.txt" onChange={handleFileUpload} />
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              className="ui-input dog-history-paste" data-surface="dark"
              placeholder="Or paste DECKOUTLINE content here..."
              aria-label="DECKOUTLINE content"
            />
          </>
        )}
      </div>
    </Dialog>
  );
};

export default HistoryModal;
