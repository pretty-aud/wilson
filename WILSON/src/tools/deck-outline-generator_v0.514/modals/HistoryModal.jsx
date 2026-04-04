import React, { useState, useEffect, useRef } from 'react';
import { Check, X, Loader2, FolderOpen } from 'lucide-react';
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
  
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-stone-800 border-2 border-stone-600 rounded-sm w-[500px] max-h-[80vh] flex flex-col shadow-xl">
        <div className="bg-stone-700 px-4 py-3 flex items-center justify-between border-b-2 border-stone-600">
          <span className="font-bold text-orange-400 uppercase text-sm tracking-wide">History Import/Export</span>
          <button onClick={onClose} className="p-1 hover:bg-stone-600 rounded">
            <X className="w-4 h-4 text-stone-400" />
          </button>
        </div>
        
        <div className="p-4">
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setMode('export')}
              className={`flex-1 py-2 px-3 rounded-sm text-sm font-medium transition-colors ${mode === 'export' ? 'bg-orange-500 text-white' : 'bg-stone-700 text-stone-400 hover:bg-stone-600'}`}
            >
              Export
            </button>
            <button
              onClick={() => setMode('import')}
              className={`flex-1 py-2 px-3 rounded-sm text-sm font-medium transition-colors ${mode === 'import' ? 'bg-orange-500 text-white' : 'bg-stone-700 text-stone-400 hover:bg-stone-600'}`}
            >
              Import
            </button>
          </div>
          
          {mode === 'export' ? (
            <div className="space-y-3">
              <p className="text-sm text-stone-400">
                Export all {history.length} page(s) as a DECKOUTLINE markdown file.
              </p>

              {/* Project Name */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] text-stone-500 uppercase tracking-wide font-bold">Project Name</span>
                </div>
                <div className="flex items-center gap-0 bg-stone-900 border-2 border-stone-600 rounded-sm overflow-hidden">
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 bg-transparent text-xs font-mono text-orange-400 focus:outline-none"
                    placeholder="Deck"
                    spellCheck={false}
                  />
                  <span className="px-2 py-1.5 text-xs font-mono text-stone-500 bg-stone-800 border-l border-stone-600 flex-shrink-0">_DECKOUTLINE.md</span>
                </div>
              </div>

              {/* Export Folder — above checkboxes */}
              <div className="border-t border-stone-600 pt-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] text-stone-500 uppercase tracking-wide font-bold flex-shrink-0">Export Folder</span>
                  {exportFolderPath && (
                    <button
                      onClick={onClearExportFolder}
                      className="text-[10px] text-stone-600 hover:text-red-400 transition-colors ml-auto"
                      title="Reset to browser downloads"
                    >
                      Reset
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="flex-1 px-2.5 py-1.5 bg-stone-900 border-2 border-stone-600 rounded-sm text-xs font-mono truncate"
                    style={{ color: exportFolderPath ? '#f4a261' : '#78716c' }}
                    title={exportFolderPath || 'Browser downloads folder'}
                  >
                    {exportFolderPath || 'Browser downloads folder (default)'}
                  </div>
                  {window.showDirectoryPicker && (
                    <button
                      onClick={onPickExportFolder}
                      className="px-3 py-1.5 bg-stone-700 hover:bg-stone-600 border-2 border-stone-600 rounded-sm text-xs text-stone-300 font-medium transition-colors flex-shrink-0 flex items-center gap-1.5"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      Browse
                    </button>
                  )}
                </div>
                {exportDirHandle && (
                  <p className="text-[10px] text-stone-500 mt-1">Files will be saved directly to this folder.</p>
                )}
                {exportFolderPath && !exportDirHandle && (
                  <p className="text-[10px] text-amber-600 mt-1">Folder access expired. Click Browse to re-select.</p>
                )}
              </div>

              {/* Checkboxes Section — above button */}
              <div className="space-y-2 border-t border-stone-600 pt-3">
                {/* VIS Export Checkbox */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIncludeVisExport(!includeVisExport)}
                    className={`w-4 h-4 rounded-sm border-2 flex items-center justify-center transition-colors ${includeVisExport ? 'border-orange-500 bg-stone-700' : 'border-stone-500 bg-stone-700'}`}
                  >
                    {includeVisExport && <Check className="w-3 h-3 text-orange-400" />}
                  </button>
                  <span className="text-xs text-stone-400">Include theme colors & deck visual description</span>
                </div>

                {/* Image Prompt Export Checkbox */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEnableImgPromptExport(!enableImgPromptExport)}
                    className={`w-4 h-4 rounded-sm border-2 flex items-center justify-center transition-colors ${enableImgPromptExport ? 'border-orange-500 bg-stone-700' : 'border-stone-500 bg-stone-700'}`}
                  >
                    {enableImgPromptExport && <Check className="w-3 h-3 text-orange-400" />}
                  </button>
                  <span className="text-xs text-stone-400">Generate Image Prompts</span>
                </div>

                {/* Export Visual Assets Checkbox — only visible when placement is active */}
                {hasPlacedAssets && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIncludeVisAssets(!includeVisAssets)}
                      className={`w-4 h-4 rounded-sm border-2 flex items-center justify-center transition-colors ${includeVisAssets ? 'border-orange-500 bg-stone-700' : 'border-stone-500 bg-stone-700'}`}
                    >
                      {includeVisAssets && <Check className="w-3 h-3 text-orange-400" />}
                    </button>
                    <span className="text-xs text-stone-400">Export Placed Visual Assets</span>
                  </div>
                )}
              </div>

              {/* Model Dropdown — visible only when image prompts enabled */}
              {enableImgPromptExport && (
                <div className="px-6">
                  <label className="block text-[10px] text-stone-500 mb-1 uppercase tracking-wide">Image Generation Model</label>
                  <select
                    value={imgPromptModel}
                    onChange={(e) => setImgPromptModel(e.target.value)}
                    className="w-full px-3 py-1.5 bg-stone-900 border-2 border-stone-600 rounded-sm text-orange-400 text-xs font-mono focus:outline-none focus:border-orange-500 cursor-pointer"
                  >
                    <option value="midjourney">Midjourney</option>
                    <option value="flux">Flux</option>
                    <option value="nanobanana">Nano Banana</option>
                    <option value="chatgpt">Chat GPT</option>
                  </select>
                </div>
              )}

              {/* Error message */}
              {imgPromptError && (
                <p className="text-xs text-red-400 px-1">{imgPromptError}</p>
              )}

              {/* Export Button — below checkboxes and dropdown */}
              <button
                onClick={handleExport}
                disabled={history.length === 0 || isGeneratingImgPrompts}
                className="w-full py-2 px-4 bg-orange-500 hover:bg-orange-600 disabled:bg-stone-600 disabled:text-stone-400 rounded-sm font-bold text-white text-sm flex items-center justify-center gap-2"
              >
                {isGeneratingImgPrompts ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating Image Prompts...
                  </>
                ) : enableImgPromptExport ? (
                  'Download Outline & Image Prompts'
                ) : (
                  includeVisExport ? 'Download VIS_DECKOUTLINE.md' : 'Download DECKOUTLINE.md'
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-stone-400">
                Import a DECKOUTLINE markdown file to restore history.
              </p>
              <label className="block w-full py-2 px-4 bg-stone-700 hover:bg-stone-600 rounded-sm font-medium text-stone-300 text-sm text-center cursor-pointer border-2 border-dashed border-stone-500">
                Choose DECKOUTLINE.md file
                <input type="file" className="hidden" accept=".md,.txt" onChange={handleFileUpload} />
              </label>
              {importText && (
                <>
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    className="w-full h-40 p-2 bg-stone-900 border border-stone-600 rounded-sm text-stone-300 text-xs font-mono resize-none"
                    placeholder="Or paste DECKOUTLINE content here..."
                  />
                  <button
                    onClick={handleImport}
                    className="w-full py-2 px-4 bg-orange-500 hover:bg-orange-600 rounded-sm font-bold text-white text-sm"
                  >
                    Import to History
                  </button>
                </>
              )}
              {!importText && (
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  className="w-full h-40 p-2 bg-stone-900 border border-stone-600 rounded-sm text-stone-300 text-xs font-mono resize-none"
                  placeholder="Or paste DECKOUTLINE content here..."
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HistoryModal;
