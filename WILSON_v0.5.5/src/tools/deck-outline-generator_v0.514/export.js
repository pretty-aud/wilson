// Helper: save a blob to a FileSystemDirectoryHandle or fallback to browser download
export const saveFileToFolder = async (dirHandle, filename, blob) => {
  if (dirHandle) {
    try {
      // Verify permission (may have been revoked)
      const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        const reqPerm = await dirHandle.requestPermission({ mode: 'readwrite' });
        if (reqPerm !== 'granted') throw new Error('Permission denied');
      }
      const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      console.warn('[WILSON] Folder save failed, falling back to download:', err);
    }
  }
  // Fallback: browser download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return false;
};

// Shared helper to derive a deck title from file name or history titles
export const deriveDeckTitle = (uploadedFileName, historyItems = []) => {
  if (uploadedFileName) {
    return uploadedFileName
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50);
  }
  const allTitles = historyItems.map(h => h.title).join(' ');
  const words = allTitles.split(/\s+/).filter(w => w.length > 3);
  const commonWords = ['with', 'from', 'that', 'this', 'have', 'will', 'your', 'slide', 'page'];
  const significantWords = words.filter(w => !commonWords.includes(w.toLowerCase())).slice(0, 3);
  return significantWords.length > 0 ? significantWords.join('_') : 'Deck';
};

// Helper function to export history to markdown file
export const exportHistory = async (historyItems, uploadedFileName, dirHandle, customDeckTitle) => {
  if (historyItems.length === 0) return;

  const deckTitle = customDeckTitle || deriveDeckTitle(uploadedFileName, historyItems);

  // Sort by page number and create full deck markdown
  const sortedHistory = [...historyItems].sort((a, b) => {
    const numA = parseInt(a.pageNum) || 999;
    const numB = parseInt(b.pageNum) || 999;
    return numA - numB;
  });

  // Clean up each output - remove trailing delimiters to prevent stacking
  const cleanedOutputs = sortedHistory.map(item => {
    return item.output.replace(/\n*═{20,}\s*$/, '').trim();
  });

  // Join with single delimiter between each slide
  const content = cleanedOutputs.join('\n\n═══════════════════════════════════════════════════════════════\n\n') + '\n\n═══════════════════════════════════════════════════════════════';

  const filename = `${deckTitle}_DECKOUTLINE.md`;

  const blob = new Blob([content], { type: 'text/markdown' });
  await saveFileToFolder(dirHandle, filename, blob);
};

// Helper function to export VIS_DECKOUTLINE format (with theme colors and deck summary)
export const exportVisHistory = async (historyItems, uploadedFileName, selectedTheme, allThemes, themeIndex, deckVisualDesc, dirHandle, customDeckTitle) => {
  if (historyItems.length === 0) return;

  const deckTitle = customDeckTitle || deriveDeckTitle(uploadedFileName, historyItems);

  const sortedHistory = [...historyItems].sort((a, b) => {
    const numA = parseInt(a.pageNum) || 999;
    const numB = parseInt(b.pageNum) || 999;
    return numA - numB;
  });

  // Find deck title from page 1
  const page1 = sortedHistory.find(h => parseInt(h.pageNum) === 1);
  const deckDisplayTitle = page1 ? page1.title : deckTitle;

  // Build deck summary header
  let header = `DECK SUMMARY
═══════════════════════════════════════════════════════════════
▸ DECK TITLE: ${deckDisplayTitle}
▸ PAGE COUNT: ${sortedHistory.length}
▸ SELECTED THEME: ${selectedTheme?.name || 'Default'} — ${(selectedTheme?.colors || []).join(', ')}
${deckVisualDesc ? `▸ VISUAL DESCRIPTION: ${deckVisualDesc}` : ''}
═══════════════════════════════════════════════════════════════

`;

  // Page outlines (same as standard export)
  const cleanedOutputs = sortedHistory.map(item => {
    return item.output.replace(/\n*═{20,}\s*$/, '').trim();
  });
  const pageContent = cleanedOutputs.join('\n\n═══════════════════════════════════════════════════════════════\n\n') + '\n\n═══════════════════════════════════════════════════════════════';

  // Non-selected theme colors footer
  const otherThemes = allThemes.filter((_, i) => i !== themeIndex);
  let footer = '';
  if (otherThemes.length > 0) {
    footer = `\n\nALTERNATE THEME COLORS
═══════════════════════════════════════════════════════════════
${otherThemes.map(t => `• ${t.name}: ${t.colors.join(', ')}`).join('\n')}
═══════════════════════════════════════════════════════════════`;
  }

  const content = header + pageContent + footer;
  const filename = `${deckTitle}_VIS_DECKOUTLINE.md`;

  const blob = new Blob([content], { type: 'text/markdown' });
  await saveFileToFolder(dirHandle, filename, blob);
};
