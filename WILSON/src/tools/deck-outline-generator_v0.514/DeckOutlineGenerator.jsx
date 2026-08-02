import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Upload, FileText, Sparkles, Copy, Check, ChevronDown, ChevronRight, X, Loader2, Layers, Trash2, Download, Eye, Code, FolderUp, Plus, Image, Settings, HelpCircle, Lock, Unlock, RefreshCw, Undo2, Redo2, Scissors, ClipboardList, Bold, List, ListOrdered } from 'lucide-react';
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider';
import { callAI } from '../../cloud/aiProxy';
import { modelFor, tuningFor } from '../../lib/activeModel';
import { DOG_HELP_SIDEBAR_ITEMS, DogHelpContent } from '../../data/dogHelpContent';
import { getLuminance, getContrastRatio, ensureContrast } from './colorUtils';
import { PRESET_THEMES, SLIDE_LAYOUTS } from './constants';
import { DEFAULT_SINGLE_PAGE_SYSTEM, DEFAULT_SINGLE_PAGE_OUTPUT_FORMAT, DEFAULT_SINGLE_PAGE_INSTRUCTIONS } from './prompts/singlePagePrompts';
import { DEFAULT_FULL_DECK_SYSTEM, DEFAULT_FULL_DECK_OUTPUT_FORMAT, DEFAULT_FULL_DECK_INSTRUCTIONS } from './prompts/fullDeckPrompts';
import { DEFAULT_THEME_COLOR_PROMPT } from './prompts/themePrompt';
import { DEFAULT_IMG_PROMPT_API_SYSTEM, DEFAULT_IMG_PROMPT_SHARED_SYSTEM, DEFAULT_IMG_PROMPT_MIDJOURNEY, DEFAULT_IMG_PROMPT_FLUX, DEFAULT_IMG_PROMPT_NANOBANANA, DEFAULT_IMG_PROMPT_CHATGPT, DEFAULT_IMG_PROMPT_OUTPUT_FORMAT } from './prompts/imagePrompts';
import { parseSlideContent, correctGeometryIconOrder, parsePlacedAssets } from './parser';
import { saveFileToFolder, deriveDeckTitle, exportHistory, exportVisHistory } from './export';
import LayoutVisualizer from './LayoutVisualizer';
import DuplicateResolverModal from './modals/DuplicateResolverModal';
import HistoryModal from './modals/HistoryModal';

export default function DeckOutlineGenerator({ onNavigate, showNavMenu, onToggleNavMenu, openSettingsTrigger, zoomLevel = 0 }) {
  // Detect OS for keyboard shortcut labels
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const modKey = isMac ? '⌘' : 'Ctrl+';
  const shiftModKey = isMac ? '⌘⇧' : 'Ctrl+Shift+';
  
  // Section 1 State - Multiple files support
  const [uploadedFiles, setUploadedFiles] = useState([]); // Array of {file, content, type}
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isFileLoading, setIsFileLoading] = useState(false);
  const [fullDeckMode, setFullDeckMode] = useState(false);

  // Visual Asset Placement State
  const [useUploadedAssets, setUseUploadedAssets] = useState(false);
  const [useProjectAssets, setUseProjectAssets] = useState(false);
  
  // Section 2 State
  const [selectedLayout, setSelectedLayout] = useState('');
  const [pageNumber, setPageNumber] = useState('');
  const [pagePrompt, setPagePrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  
  // Tabs State
  const [openTabs, setOpenTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [viewMode, setViewMode] = useState('visualizer'); // 'text' or 'visualizer'
  
  // Duplicate Resolver State
  const [showDuplicateResolver, setShowDuplicateResolver] = useState(false);
  const [duplicatesToResolve, setDuplicatesToResolve] = useState([]);
  const [currentDuplicateIndex, setCurrentDuplicateIndex] = useState(0);
  const [resolvedSelections, setResolvedSelections] = useState({});
  const [pendingVisExport, setPendingVisExport] = useState(false);
  const [pendingCustomDeckTitle, setPendingCustomDeckTitle] = useState(null);

  // Export Folder State
  const [exportDirHandle, setExportDirHandle] = useState(null); // FileSystemDirectoryHandle
  const [exportFolderPath, setExportFolderPath] = useState(() => {
    try { return localStorage.getItem('wilson-export-folder-path') || ''; } catch { return ''; }
  });
  
  // History State
  const [history, setHistory] = useState([]);
  const [historyUndoStack, setHistoryUndoStack] = useState([]); // Stack of {type, items, tabs, activeId} for undo
  const [historyRedoStack, setHistoryRedoStack] = useState([]); // Stack for redo
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [section1Collapsed, setSection1Collapsed] = useState(false);
  const [section2Collapsed, setSection2Collapsed] = useState(false);
  
  // Textarea focus states for expansion
  const [systemPromptFocused, setSystemPromptFocused] = useState(false);
  const [pagePromptFocused, setPagePromptFocused] = useState(false);
  
  // Settings Menu State
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [settingsTab, setSettingsTab] = useState('prompts'); // 'prompts' or 'format'
  // showNavMenu and onToggleNavMenu are now received as props from App.jsx

  // Open settings panel when triggered from container nav strip
  const prevSettingsTrigger = useRef(openSettingsTrigger);
  useEffect(() => {
    if (openSettingsTrigger !== prevSettingsTrigger.current) {
      prevSettingsTrigger.current = openSettingsTrigger;
      setShowSettingsMenu(true);
    }
  }, [openSettingsTrigger]);

  // Project Integration State — projects come from the unified
  // RabbitProvider store (same source as the Projects page and
  // RABBIT itself). Local state only owns the new-project modal
  // form fields and the currently-selected project id.
  const rabbitCtx = useRabbit();
  const projectsIndex = rabbitCtx?.projectsIndex || {};
  const refreshProjectsIndex = rabbitCtx?.refreshProjectsIndex;
  const createUnifiedProject = rabbitCtx?.createProject;
  const updateUnifiedProject = rabbitCtx?.updateProject;
  // Session 12: cloud projects carry no documents/visualAssets (locked #17 —
  // D.O.G. gets no content model; cloud-readable file blobs are S14 work).
  // The attachment affordances degrade visibly in cloud mode instead of
  // silently losing files at the adapter.
  const cloudProjects = rabbitCtx?.adapterMode === 'supabase';

  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [newProjectStartDate, setNewProjectStartDate] = useState('');
  const [newProjectEndDate, setNewProjectEndDate] = useState('');
  const [newProjectDocuments, setNewProjectDocuments] = useState([]);
  const [newProjectAssets, setNewProjectAssets] = useState([]);

  // Derived: flattened, recency-sorted list of unified projects.
  const projects = useMemo(() => {
    return Object.values(projectsIndex).sort((a, b) => {
      const ad = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const bd = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return bd - ad;
    });
  }, [projectsIndex]);

  // Force a re-pull from the active adapter — used when the new
  // project modal closes so the dropdown reflects the new row.
  const refreshProjects = useCallback(() => {
    refreshProjectsIndex?.();
  }, [refreshProjectsIndex]);

  // Get the selected project object
  const selectedProject = useMemo(() => {
    if (!selectedProjectId) return null;
    return projects.find(p => p.id === selectedProjectId) || null;
  }, [selectedProjectId, projects]);

  // Convert project files to DOG-compatible format for injection into generation.
  // Each file carries `isCore`: files marked core are the ones that define
  // the project concept itself; the rest are reference / supporting context.
  // Default is true so existing projects keep working — explicit opt-out only.
  const projectFiles = useMemo(() => {
    if (!selectedProject) return [];
    const files = [];
    // Add project documents
    (selectedProject.documents || []).forEach(doc => {
      if (!doc.content) return;
      const isCore = doc.isCore !== false;
      const labelPrefix = isCore ? '[Project · CORE]' : '[Project · REF]';
      const base64Data = doc.content.includes(',') ? doc.content.split(',')[1] : doc.content;
      if (doc.type?.startsWith('image/')) {
        files.push({
          id: `proj-${doc.id}`,
          file: { name: `${labelPrefix} ${doc.name}`, size: doc.size || 0 },
          content: base64Data,
          type: 'image',
          mediaType: doc.type,
          isCore,
        });
      } else if (doc.type === 'application/pdf' || doc.name?.endsWith('.pdf')) {
        files.push({
          id: `proj-${doc.id}`,
          file: { name: `${labelPrefix} ${doc.name}`, size: doc.size || 0 },
          content: base64Data,
          type: 'pdf',
          mediaType: 'application/pdf',
          isCore,
        });
      } else {
        // Text-based files — decode base64 to text if needed
        let textContent = base64Data;
        try { textContent = atob(base64Data); } catch { /* already text */ }
        files.push({
          id: `proj-${doc.id}`,
          file: { name: `${labelPrefix} ${doc.name}`, size: doc.size || 0 },
          content: textContent,
          type: 'text',
          mediaType: 'text/plain',
          isCore,
        });
      }
    });
    // Add project visual assets
    (selectedProject.visualAssets || []).forEach(asset => {
      if (!asset.content) return;
      const isCore = asset.isCore !== false;
      const labelPrefix = isCore ? '[Project · CORE]' : '[Project · REF]';
      const base64Data = asset.content.includes(',') ? asset.content.split(',')[1] : asset.content;
      const isVideo = asset.type?.startsWith('video/') || asset.name?.match(/\.(mp4|mov|webm|avi|mkv)$/i);
      files.push({
        id: `proj-${asset.id}`,
        file: { name: `${labelPrefix} ${asset.name}`, size: asset.size || 0 },
        content: base64Data,
        type: isVideo ? 'video' : 'image',
        mediaType: asset.type || (isVideo ? 'video/mp4' : 'image/png'),
        isCore,
      });
    });
    return files;
  }, [selectedProject]);

  // Combined files: uploaded + project (for use in generation)
  const allFiles = useMemo(() => {
    return [...uploadedFiles, ...projectFiles];
  }, [uploadedFiles, projectFiles]);

  // Visual assets eligible for placement into deck frames
  const placementAssets = useMemo(() => {
    const assets = [];
    if (useUploadedAssets) {
      assets.push(...uploadedFiles.filter(f => f.type === 'image' || f.type === 'video'));
    }
    if (useProjectAssets) {
      assets.push(...projectFiles.filter(f => f.type === 'image' || f.type === 'video'));
    }
    return assets;
  }, [useUploadedAssets, useProjectAssets, uploadedFiles, projectFiles]);

  const assetPlacementActive = placementAssets.length > 0;

  // Project description context for injection into prompts.
  // Includes an explicit CORE / REFERENCE file split so the model
  // knows which sources actually define the project concept and which
  // are supporting context only.
  const projectContext = useMemo(() => {
    if (!selectedProject) return '';
    const parts = [];
    if (selectedProject.title) parts.push(`Project: ${selectedProject.title}`);
    if (selectedProject.description) parts.push(`Description: ${selectedProject.description}`);

    const coreNames = projectFiles.filter(f => f.isCore).map(f => f.file.name.replace(/^\[Project · (CORE|REF)\]\s*/, ''));
    const refNames  = projectFiles.filter(f => !f.isCore).map(f => f.file.name.replace(/^\[Project · (CORE|REF)\]\s*/, ''));

    if (coreNames.length > 0 || refNames.length > 0) {
      parts.push('');
      parts.push('FILE ROLES — read carefully:');
      parts.push('Files tagged [Project · CORE] are the *primary sources of truth* for what this project IS. Treat them as authoritative — the deck must faithfully reflect the concept, claims, and language they establish.');
      parts.push('Files tagged [Project · REF] are *supporting reference material only*. Use them for background, examples, or supplementary detail, but do NOT let them override or reshape the core concept.');
      if (coreNames.length > 0) {
        parts.push('');
        parts.push(`CORE files (${coreNames.length}):`);
        coreNames.forEach(n => parts.push(`  • ${n}`));
      }
      if (refNames.length > 0) {
        parts.push('');
        parts.push(`REFERENCE files (${refNames.length}):`);
        refNames.forEach(n => parts.push(`  • ${n}`));
      }
    }

    return parts.length > 0 ? parts.join('\n') : '';
  }, [selectedProject, projectFiles]);

  // Flip a project file's CORE / REFERENCE flag and persist it
  // through the unified project store. The flag lives directly on
  // the file row in `documents[]` / `visualAssets[]` — the rest of
  // the row is left untouched.
  const toggleProjectFileCore = useCallback(async (category, fileId) => {
    if (!selectedProject || !updateUnifiedProject) return;
    const list = Array.isArray(selectedProject[category]) ? selectedProject[category] : [];
    const next = list.map(f => {
      if (f.id !== fileId) return f;
      const current = f.isCore !== false; // default true
      return { ...f, isCore: !current };
    });
    try {
      await updateUnifiedProject(selectedProject.id, { [category]: next });
    } catch (err) {
      console.error('[DOG] toggle core flag failed:', err);
    }
  }, [selectedProject, updateUnifiedProject]);

  // Reset all new project modal fields
  const resetNewProjectModal = useCallback(() => {
    setNewProjectTitle('');
    setNewProjectDescription('');
    setNewProjectStartDate('');
    setNewProjectEndDate('');
    setNewProjectDocuments([]);
    setNewProjectAssets([]);
    setShowNewProjectModal(false);
  }, []);

  // Handle file upload for new project modal
  const handleNewProjectFileUpload = useCallback((category, files) => {
    const promises = Array.from(files).map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          name: file.name,
          content: reader.result,
          type: file.type,
          size: file.size,
        });
        reader.readAsDataURL(file);
      });
    });
    Promise.all(promises).then(newFiles => {
      if (category === 'documents') {
        setNewProjectDocuments(prev => [...prev, ...newFiles]);
      } else {
        setNewProjectAssets(prev => [...prev, ...newFiles]);
      }
    });
  }, []);

  // Handle creating a new project from the modal — writes through
  // the unified RabbitProvider so the same record shows up in the
  // Projects page and RABBIT itself, not just inside DOG.
  const handleCreateProjectFromModal = useCallback(async () => {
    if (!newProjectTitle.trim() || !createUnifiedProject) return;
    try {
      const created = await createUnifiedProject({
        title:        newProjectTitle.trim(),
        description:  newProjectDescription.trim(),
        startDate:    newProjectStartDate,
        endDate:      newProjectEndDate,
        documents:    newProjectDocuments,
        visualAssets: newProjectAssets,
        status:       'active',
      });
      if (created?.id) setSelectedProjectId(created.id);
    } catch (err) {
      console.error('[DOG] createProject failed:', err);
    } finally {
      resetNewProjectModal();
    }
  }, [newProjectTitle, newProjectDescription, newProjectStartDate, newProjectEndDate, newProjectDocuments, newProjectAssets, createUnifiedProject, resetNewProjectModal]);

  // Editable System Prompts
  const [singlePageSystemPrompt, setSinglePageSystemPrompt] = useState(DEFAULT_SINGLE_PAGE_SYSTEM);
  const [fullDeckSystemPrompt, setFullDeckSystemPrompt] = useState(DEFAULT_FULL_DECK_SYSTEM);
  const [singlePageInstructions, setSinglePageInstructions] = useState(DEFAULT_SINGLE_PAGE_INSTRUCTIONS);
  const [fullDeckInstructions, setFullDeckInstructions] = useState(DEFAULT_FULL_DECK_INSTRUCTIONS);
  
  // Editable Output Formats
  const [singlePageOutputFormat, setSinglePageOutputFormat] = useState(DEFAULT_SINGLE_PAGE_OUTPUT_FORMAT);
  const [fullDeckOutputFormat, setFullDeckOutputFormat] = useState(DEFAULT_FULL_DECK_OUTPUT_FORMAT);
  
  // Settings Panel Lock States
  const [promptsTabLocked, setPromptsTabLocked] = useState(true);
  const [formatTabLocked, setFormatTabLocked] = useState(true);
  
  // Settings Panel Collapsible Sections — all collapsed by default
  const [settingsCollapsed, setSettingsCollapsed] = useState({
    sp_sys: true, sp_rules: true, fd_sys: true, fd_rules: true, theme_prompt: true,
    sp_fmt: true, fd_fmt: true, vis_fmt: true, img_fmt: true,
    rw_relaxed: true, rw_formal: true, rw_extend: true, rw_shorten: true, rw_editor: true,
    img_shared: true, img_midjourney: true, img_flux: true, img_nanobanana: true, img_chatgpt: true, img_api_sys: true
  });
  
  // Help Modal State
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [helpPage, setHelpPage] = useState('overview');
  
  // Regeneration State
  const [revisionPrompt, setRevisionPrompt] = useState('');
  const [regenerateLayout, setRegenerateLayout] = useState('');
  const [previousContent, setPreviousContent] = useState({}); // {tabId: [content1, content2, ...]} — stack of up to 8
  const [redoContent, setRedoContent] = useState({}); // {tabId: [content1, content2, ...]} — stack of up to 8
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [deckThemeColors, setDeckThemeColors] = useState(null); // shared colors for all slides
  const [generatedThemes, setGeneratedThemes] = useState([]); // [{name, colors, description?}]
  const [themeIndex, setThemeIndex] = useState(0); // current index in theme list
  const [enableThemeGen, setEnableThemeGen] = useState(true); // checkbox: AI generation vs presets
  const [isGeneratingTheme, setIsGeneratingTheme] = useState(false);
  const [deckVisualDesc, setDeckVisualDesc] = useState(''); // generated deck visual description
  const [includeVisInExport, setIncludeVisInExport] = useState(false); // export checkbox for VIS format
  const [themeColorPrompt, setThemeColorPrompt] = useState(DEFAULT_THEME_COLOR_PROMPT);

  // Image Prompt Generation State
  const [enableImgPromptExport, setEnableImgPromptExport] = useState(false);
  const [imgPromptModel, setImgPromptModel] = useState('midjourney');
  const [isGeneratingImgPrompts, setIsGeneratingImgPrompts] = useState(false);
  const [imgPromptError, setImgPromptError] = useState('');

  // Image Prompt Editable System Prompts
  const [imgPromptSharedSystem, setImgPromptSharedSystem] = useState(DEFAULT_IMG_PROMPT_SHARED_SYSTEM);
  const [imgPromptMidjourneySystem, setImgPromptMidjourneySystem] = useState(DEFAULT_IMG_PROMPT_MIDJOURNEY);
  const [imgPromptFluxSystem, setImgPromptFluxSystem] = useState(DEFAULT_IMG_PROMPT_FLUX);
  const [imgPromptNanoBananaSystem, setImgPromptNanoBananaSystem] = useState(DEFAULT_IMG_PROMPT_NANOBANANA);
  const [imgPromptChatGPTSystem, setImgPromptChatGPTSystem] = useState(DEFAULT_IMG_PROMPT_CHATGPT);
  const [imgPromptApiSystem, setImgPromptApiSystem] = useState(DEFAULT_IMG_PROMPT_API_SYSTEM);
  const [imgPromptOutputFormat, setImgPromptOutputFormat] = useState(DEFAULT_IMG_PROMPT_OUTPUT_FORMAT);
  
  // Right-click Context Menu State
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, selectedText: '', selStart: 0, selEnd: 0, source: 'text' });
  const [rewritePreview, setRewritePreview] = useState({ visible: false, text: '', mode: '', isLoading: false });
  const textareaRef = useRef(null);
  const textareaContainerRef = useRef(null);
  const [clipboardContent, setClipboardContent] = useState(''); // Internal clipboard as STATE for re-renders
  const textUndoStack = useRef([]); // Text editing undo stack
  const textRedoStack = useRef([]); // Text editing redo stack
  const lastSavedContent = useRef(null); // Track last saved for undo grouping (null = not yet initialized)
  const textChangeTimerRef = useRef(null); // Debounce timer for undo checkpoints
  const [undoRedoCounts, setUndoRedoCounts] = useState({ undo: 0, redo: 0 }); // Force re-renders for disabled state

  // Editable rewrite prompts (defaults)
  const FORMATTING_PRESERVATION = ` CRITICAL FORMATTING RULES — You MUST follow ALL of these:
1. Output EXACTLY the same number of lines as the input. If the input has 1 line, output exactly 1 line. If 3 lines, output exactly 3 lines. NEVER add or remove lines.
2. Preserve ALL markdown formatting markers EXACTLY: bullet prefixes (-, •, *), bold markers (**text**), numbered prefixes (1., 2.), and indentation.
3. If the input starts with a bullet or number prefix, keep that EXACT prefix on each corresponding line.
4. Preserve **bold** markers — if a word or phrase is wrapped in **, keep ** around equivalent words.
5. Do NOT add blank lines between bullet points. Do NOT add extra bullet points. Do NOT remove bullet points.
6. For two-column text: columns are separated by --- (three dashes on its own line). NEVER remove the --- separator. Keep it exactly where it was.
7. Match the indentation level of the original exactly.
8. Do NOT wrap your output in quotes or add any extra whitespace/newlines before or after.`;
  const DEFAULT_REWRITE_PROMPTS = {
    relaxed: `You are a copy editor. Rewrite the following text in a more relaxed and informal tone. Write it how people speak day to day in a professional setting — conversational, approachable, but still work-appropriate. Keep the same meaning and key details. Output ONLY the rewritten text, no explanations.${FORMATTING_PRESERVATION}`,
    formal: `You are a copy editor. Rewrite the following text in a more formal and objective tone. Focus on delivering facts and details clearly and professionally. Remove casual language, contractions, and colloquialisms. Output ONLY the rewritten text, no explanations.${FORMATTING_PRESERVATION}`,
    extend: `You are a copy editor working on a presentation deck. Expand each line of the following text by adding more detail, context, or supporting information WITHIN that line. Keep the EXACT same number of lines — do NOT add new bullet points or new lines. Each line should become longer and more descriptive, but the line count must stay identical. Use the deck context and source documents provided for additional details when available. Maintain the same tone and formatting style. Output ONLY the expanded text, no explanations.${FORMATTING_PRESERVATION}`,
    shorten: `You are a copy editor. Rewrite the following text to be significantly shorter and more concise. Preserve the core message and key details but remove redundancy, filler words, and unnecessary elaboration. Output ONLY the shortened text, no explanations.${FORMATTING_PRESERVATION}`,
    editor: `You are a copy editor. Review the following text and ONLY fix syntax errors, grammatical mistakes, punctuation issues, and spelling errors. Do NOT change the tone, style, meaning, or structure. Make minimal corrections. Output ONLY the corrected text, no explanations.${FORMATTING_PRESERVATION}`,
  };
  const [rewritePrompts, setRewritePrompts] = useState({ ...DEFAULT_REWRITE_PROMPTS });
  
  // Get all available themes: presets (always) + generated (always kept, even when toggle is off)
  const allThemes = useMemo(() => {
    return [...PRESET_THEMES, ...generatedThemes];
  }, [generatedThemes]);

  // Clamp themeIndex when allThemes shrinks (e.g. disabling theme gen)
  useEffect(() => {
    if (allThemes.length > 0 && themeIndex >= allThemes.length) {
      setThemeIndex(0);
      setDeckThemeColors(allThemes[0].colors);
    }
  }, [allThemes, themeIndex]);

  // Generate AI theme colors via Haiku API
  const isGeneratingThemeRef = useRef(false);
  const generateAIThemes = useCallback(async (overrideHistory) => {
    if (isGeneratingThemeRef.current) return null;
    isGeneratingThemeRef.current = true;
    setIsGeneratingTheme(true);
    
    try {
      const historyToUse = overrideHistory || history;
      const contextSnippet = (systemPrompt || '').substring(0, 800);
      const titles = historyToUse.map(h => h.title).join(', ');
      const fileNames = uploadedFiles.map(f => f.file.name).join(', ');
      const textSnippets = uploadedFiles
        .filter(f => f.type === 'text')
        .slice(0, 2)
        .map(f => f.content.substring(0, 500))
        .join('\n');
      
      const userMsg = `Deck context: ${contextSnippet || 'General presentation'}
Slide titles: ${titles || 'Not yet generated'}
Source files: ${fileNames || 'None'}
${textSnippets ? `Content excerpt:\n${textSnippets}` : ''}

Generate 3 color themes for this deck.`;

      console.log('Theme gen: calling Haiku API...');
      const data = await callAI({
        model: modelFor('dog.themes'),
        max_tokens: 500,
        system: themeColorPrompt,
        messages: [{ role: 'user', content: userMsg }],
        tool: 'dog',
      });
      const text = data.content.map(i => i.text || '').join('').trim();
      console.log('Theme gen response:', text.substring(0, 200));
      const jsonStart = text.indexOf('[');
      const jsonEnd = text.lastIndexOf(']');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON array in response');
      const themes = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
      
      if (Array.isArray(themes) && themes.length > 0) {
        const validThemes = themes.filter(t => t.colors && t.colors.length === 4).map(t => ({
          name: t.name || 'Generated Theme',
          colors: t.colors,
        }));
        if (validThemes.length > 0) {
          console.log('Theme gen: got', validThemes.length, 'themes, selecting first');
          setGeneratedThemes(prev => {
            const newAll = [...prev, ...validThemes];
            const newIndex = PRESET_THEMES.length + prev.length;
            setThemeIndex(newIndex);
            return newAll;
          });
          setDeckThemeColors(validThemes[0].colors);
          return validThemes;
        }
      }
      return null;
    } catch (err) {
      console.error('Theme generation error:', err);
      return null;
    } finally {
      isGeneratingThemeRef.current = false;
      setIsGeneratingTheme(false);
    }
  }, [systemPrompt, history, uploadedFiles, themeColorPrompt]);

  // Cycle to previous/next theme in allThemes list
  const cycleTheme = useCallback((direction) => {
    if (allThemes.length === 0) return;
    const newIndex = (themeIndex + direction + allThemes.length) % allThemes.length;
    setThemeIndex(newIndex);
    setDeckThemeColors(allThemes[newIndex].colors);
  }, [allThemes, themeIndex]);

  // Refresh: always generate new AI themes (button always works regardless of checkbox)
  const refreshDeckColors = useCallback(() => {
    generateAIThemes();
  }, [generateAIThemes]);
  
  // Sort history by page number
  const sortedHistory = useMemo(() => {
    return [...history].sort((a, b) => {
      const numA = parseInt(a.pageNum) || 999;
      const numB = parseInt(b.pageNum) || 999;
      return numA - numB;
    });
  }, [history]);
  
  // Get active tab content
  const activeTab = useMemo(() => {
    return openTabs.find(tab => tab.id === activeTabId);
  }, [openTabs, activeTabId]);

  // Reset undo/redo stacks when switching tabs
  useEffect(() => {
    textUndoStack.current = [];
    textRedoStack.current = [];
    if (textChangeTimerRef.current) clearTimeout(textChangeTimerRef.current);
    lastSavedContent.current = null;
    setUndoRedoCounts({ undo: 0, redo: 0 });
  }, [activeTabId]);

  // Check if we have any file content for API calls
  const hasFileContent = useMemo(() => {
    return uploadedFiles.length > 0 || allFiles.length > 0;
  }, [uploadedFiles, allFiles]);

  const handleFileUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Check max files limit
    if (uploadedFiles.length >= 20) {
      setError('Maximum 20 files allowed');
      return;
    }

    setIsFileLoading(true);
    setError('');
    
    // Valid file types - documents, images, and videos
    const isDocument = file.type === 'application/pdf' ||
      file.type === 'text/markdown' ||
      file.type === 'text/plain' ||
      file.type === 'text/x-markdown' ||
      file.name.endsWith('.md') ||
      file.name.endsWith('.txt') ||
      file.name.endsWith('.pdf');

    const isImage = file.type.startsWith('image/') ||
      file.name.match(/\.(png|jpg|jpeg|gif|webp)$/i);

    const isVideo = file.type.startsWith('video/') ||
      file.name.match(/\.(mp4|mov|webm|avi|mkv)$/i);

    if (!isDocument && !isImage && !isVideo) {
      setError('Please upload a PDF, Markdown, Text, Image, or Video file');
      setIsFileLoading(false);
      return;
    }

    try {
      const reader = new FileReader();

      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        reader.onload = (e) => {
          const base64 = e.target.result.split(',')[1];
          setUploadedFiles(prev => [...prev, {
            id: Date.now(),
            file: file,
            content: base64,
            type: 'pdf',
            mediaType: 'application/pdf'
          }]);
          setIsFileLoading(false);
        };
        reader.onerror = () => {
          setError('Error reading PDF file');
          setIsFileLoading(false);
        };
        reader.readAsDataURL(file);
      } else if (isVideo) {
        reader.onload = (e) => {
          const base64 = e.target.result.split(',')[1];
          const mediaType = file.type || `video/${file.name.split('.').pop().toLowerCase()}`;
          setUploadedFiles(prev => [...prev, {
            id: Date.now(),
            file: file,
            content: base64,
            type: 'video',
            mediaType: mediaType
          }]);
          setIsFileLoading(false);
        };
        reader.onerror = () => {
          setError('Error reading video file');
          setIsFileLoading(false);
        };
        reader.readAsDataURL(file);
      } else if (isImage) {
        reader.onload = (e) => {
          const base64 = e.target.result.split(',')[1];
          const mediaType = file.type || `image/${file.name.split('.').pop().toLowerCase()}`;
          setUploadedFiles(prev => [...prev, {
            id: Date.now(),
            file: file,
            content: base64,
            type: 'image',
            mediaType: mediaType
          }]);
          setIsFileLoading(false);
        };
        reader.onerror = () => {
          setError('Error reading image file');
          setIsFileLoading(false);
        };
        reader.readAsDataURL(file);
      } else {
        reader.onload = (e) => {
          setUploadedFiles(prev => [...prev, {
            id: Date.now(),
            file: file,
            content: e.target.result,
            type: 'text',
            mediaType: 'text/plain'
          }]);
          setIsFileLoading(false);
        };
        reader.onerror = () => {
          setError('Error reading file');
          setIsFileLoading(false);
        };
        reader.readAsText(file);
      }
    } catch (err) {
      setError('Error processing file');
      setIsFileLoading(false);
    }
    
    // Reset the input so the same file can be uploaded again if removed
    e.target.value = '';
  }, [uploadedFiles.length]);

  const removeFile = useCallback((fileId) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
  }, []);

  const removeAllFiles = useCallback(() => {
    setUploadedFiles([]);
  }, []);

  // Parse output into individual pages
  const parseOutputToPages = useCallback((output) => {
    const pages = [];
    
    console.log('parseOutputToPages input:', output.substring(0, 500));
    
    // Try multiple parsing strategies
    
    // Strategy 1: Split by the delimiter lines with SLIDE headers
    const blocks = output.split(/═{5,}/);
    console.log('Split into blocks:', blocks.length);
    
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i].trim();
      if (!block) continue;
      
      // Look for SLIDE header in this block - try both formats
      // Format 1: SLIDE #X — [LAYOUT TYPE: Layout Name]
      let headerMatch = block.match(/SLIDE\s*#\s*(\d+|X)\s*[—–\-]+\s*\[?\s*LAYOUT\s*TYPE\s*:?\s*([^\]\n]+)/i);
      // Format 2: SLIDE #X — Layout Name (no brackets)
      if (!headerMatch) {
        headerMatch = block.match(/SLIDE\s*#\s*(\d+|X)\s*[—–\-]+\s*([^\n═]+)/i);
      }
      
      if (headerMatch) {
        const pageNum = headerMatch[1].trim();
        const layout = headerMatch[2].trim().replace(/\]$/, '').trim();
        
        // Get content - either rest of this block or next block
        let contentBody = block.replace(headerMatch[0], '').trim();
        
        // If content is empty, check next block
        if (!contentBody && blocks[i + 1]) {
          contentBody = blocks[i + 1].trim();
          i++; // Skip next block since we used it
        }
        
        // Extract title - try ▸ TITLE: format first (newline then same-line), then markdown # format
        let titleMatch = contentBody.match(/▸\s*TITLE\s*:\s*\n\s*([^\n]+)/i);
        if (!titleMatch) titleMatch = contentBody.match(/▸\s*TITLE\s*:\s+([^\n]+)/i);
        if (!titleMatch) {
          titleMatch = contentBody.match(/^#\s+([^\n]+)/m);
        }
        const title = titleMatch ? titleMatch[1].trim() : 'Untitled';

        console.log('Strategy 1 - Parsed slide:', { pageNum, layout, title: title.substring(0, 30) });
        
        // Reconstruct the full slide content - use simpler format
        const fullContentRaw = `SLIDE #${pageNum} — ${layout}
═══════════════════════════════════════════════════════════════

${contentBody}

═══════════════════════════════════════════════════════════════`;
        const fullContent = correctGeometryIconOrder(fullContentRaw);

        pages.push({
          id: Date.now() + Math.random() * 1000 + pages.length,
          pageNum: pageNum,
          layout: layout,
          title: title,
          content: fullContent,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
      }
    }

    // Strategy 2: If strategy 1 failed, try finding SLIDE # patterns directly
    if (pages.length === 0) {
      console.log('Strategy 1 failed, trying strategy 2');
      
      // Try format 1 first
      let slideMatches = [...output.matchAll(/SLIDE\s*#\s*(\d+|X)\s*[—–\-]+\s*\[?\s*LAYOUT\s*TYPE\s*:?\s*([^\]\n]+)/gi)];
      // If no matches, try format 2
      if (slideMatches.length === 0) {
        slideMatches = [...output.matchAll(/SLIDE\s*#\s*(\d+|X)\s*[—–\-]+\s*([^\n═]+)/gi)];
      }
      console.log('Found slide headers:', slideMatches.length);
      
      for (let i = 0; i < slideMatches.length; i++) {
        const match = slideMatches[i];
        const pageNum = match[1].trim();
        const layout = match[2].trim().replace(/\]$/, '').trim();
        
        // Get content until next slide or end
        const startIdx = match.index + match[0].length;
        const endIdx = slideMatches[i + 1] ? slideMatches[i + 1].index : output.length;
        let contentBody = output.substring(startIdx, endIdx).trim();
        
        // Clean up delimiters from content
        contentBody = contentBody.replace(/^[═\s]+/g, '').replace(/[═\s]+$/g, '').trim();
        
        // Extract title - try ▸ TITLE: format first (newline then same-line), then markdown # format
        let titleMatch = contentBody.match(/▸\s*TITLE\s*:\s*\n\s*([^\n]+)/i);
        if (!titleMatch) titleMatch = contentBody.match(/▸\s*TITLE\s*:\s+([^\n]+)/i);
        if (!titleMatch) {
          titleMatch = contentBody.match(/^#\s+([^\n]+)/m);
        }
        const title = titleMatch ? titleMatch[1].trim() : 'Untitled';

        console.log('Strategy 2 - Parsed slide:', { pageNum, layout, title: title.substring(0, 30) });
        
        const fullContentRaw = `SLIDE #${pageNum} — ${layout}
═══════════════════════════════════════════════════════════════

${contentBody}

═══════════════════════════════════════════════════════════════`;
        const fullContent = correctGeometryIconOrder(fullContentRaw);

        pages.push({
          id: Date.now() + Math.random() * 1000 + pages.length,
          pageNum: pageNum,
          layout: layout,
          title: title,
          content: fullContent,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
      }
    }

    // Strategy 3: Last resort - try very loose pattern
    if (pages.length === 0) {
      console.log('Strategy 2 failed, trying strategy 3');
      
      // Just look for any SLIDE # pattern
      const loosePattern = /SLIDE\s*#?\s*(\d+)/gi;
      const looseMatches = [...output.matchAll(loosePattern)];
      console.log('Loose matches found:', looseMatches.length);
      
      if (looseMatches.length > 0) {
        // Try to extract at least something
        for (let i = 0; i < looseMatches.length; i++) {
          const match = looseMatches[i];
          const pageNum = match[1];
          
          const startIdx = match.index;
          const endIdx = looseMatches[i + 1] ? looseMatches[i + 1].index : output.length;
          const blockContent = output.substring(startIdx, endIdx).trim();
          
          // Try to find layout
          const layoutMatch = blockContent.match(/LAYOUT\s*(?:TYPE)?\s*:?\s*([^\]\n]+)/i);
          let layout = layoutMatch ? layoutMatch[1].trim().replace(/\]$/, '').trim() : '';
          
          // Also try to get layout from SLIDE # — Layout Name format
          if (!layout) {
            const slideLayoutMatch = blockContent.match(/SLIDE\s*#\s*\d+\s*[—–\-]+\s*([^\n═]+)/i);
            layout = slideLayoutMatch ? slideLayoutMatch[1].trim() : 'Title and body';
          }
          
          // Try to find title - ▸ TITLE: format first (newline then same-line), then markdown # format
          let titleMatch = blockContent.match(/▸?\s*TITLE\s*:\s*\n\s*([^\n▸]+)/i);
          if (!titleMatch) titleMatch = blockContent.match(/▸?\s*TITLE\s*:\s+([^\n▸]+)/i);
          if (!titleMatch) {
            titleMatch = blockContent.match(/^#\s+([^\n]+)/m);
          }
          const title = titleMatch ? titleMatch[1].trim() : 'Slide ' + pageNum;
          
          console.log('Strategy 3 - Parsed slide:', { pageNum, layout, title: title.substring(0, 30) });
          
          pages.push({
            id: Date.now() + Math.random() * 1000 + pages.length,
            pageNum: pageNum,
            layout: layout,
            title: title,
            content: correctGeometryIconOrder(blockContent),
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          });
        }
      }
    }

    console.log('Final parsed pages:', pages.length, pages.map(p => ({ num: p.pageNum, title: p.title })));
    return pages;
  }, []);

  // Build asset placement prompt additions when placement checkboxes are active
  const buildAssetPlacementPrompt = useCallback((assets, alreadyPlacedContext = '') => {
    if (!assets || assets.length === 0) return { instructions: '', assetList: '', rules: '' };

    const assetList = assets.map((f, i) => {
      const cleanName = (f.file?.name || '').replace(/^\[Project\]\s*/, '');
      return `${i + 1}. ${cleanName} (${f.type})`;
    }).join('\n');

    const instructions = `
AVAILABLE VISUAL ASSETS FOR PLACEMENT:
${assetList}

The uploaded visual assets above are available for direct placement into slide frames. Review each asset's visual content and assign it to a frame where it contextually matches the slide content.`;

    const rules = `
ASSET PLACEMENT RULES:
- Review each uploaded visual asset and understand its content/context.
- Assign assets to specific frames where they contextually match the page content.
- Each asset should only be placed ONCE across the entire deck.
- CRITICAL: When you place an uploaded asset in a frame, you MUST include the filename with << >> markers in the ▸ REQUIRED ASSETS description for that frame. Example:
  • [Image | 3:2] - <<hero_shot.jpg>> product showcase image
  • [Video | 16:9] - <<demo_video.mp4>> product walkthrough
- The << >> markers tell the visualizer which uploaded file to render in that frame.
- The ratio you specify for placed assets (e.g. 3:2, 16:9) is a hint only — the visualizer will use the actual image's native dimensions. Pick a reasonable ratio but don't worry about matching exactly.
- Every frame that uses an uploaded asset MUST appear in ▸ REQUIRED ASSETS with the <<filename>> marker.
- Frames that do NOT use an uploaded asset should have normal descriptions without << >> markers — these will get image prompt suggestions.
- Also output a ▸ PLACED ASSETS section (AFTER ▸ REQUIRED ASSETS, BEFORE ▸ COMPONENT GEOMETRY) as a summary:
  • filename.jpg → [Image | 16:9] - description
- You MUST still create frames in REQUIRED ASSETS for ALL visual needs of the slide, including frames that use uploaded assets AND frames that need generated images.
- For video files, assign to [Video | RATIO] frames with <<filename.mp4>> marker.
${alreadyPlacedContext}`;

    return { instructions, assetList, rules };
  }, []);

  const generatePageOutline = useCallback(async () => {
    if (!hasFileContent || !pagePrompt || !selectedLayout) {
      setError('Please upload a document, select a layout, and enter a page request');
      return;
    }

    setIsGenerating(true);
    setError('');

    const layoutInfo = SLIDE_LAYOUTS.find(l => l.id === selectedLayout);
    
    const slideNumber = pageNumber || 'X';
    
    const outputInstructions = `Generate a slide outline based on the project documentation and user's request.

CRITICAL: Output ONLY the structured format below. No explanations, no commentary, no "Based on..." text.

REQUIRED FORMAT (copy this structure exactly):

SLIDE #${slideNumber} — ${layoutInfo.name}
═══════════════════════════════════════════════════════════════

▸ TITLE:
[Write your title here]

▸ SUBTITLE:
[Write your subtitle here]

▸ LAYOUT STRUCTURE:
• [Layout point 1]
• [Layout point 2]
• [Layout point 3]

▸ COPY/TEXT CONTENT:
**[SECTION NAME]:**
• [Content bullet 1]
• [Content bullet 2]

▸ VISUAL STYLING:
[1-2 sentences about visual mood, texture, typography. NO color references.]

▸ REQUIRED ASSETS:
• [Image] - description of image asset
• [Icon/Logo] - description of icon or logo

▸ COMPONENT GEOMETRY:
\`\`\`json
{
  "canvas": { "width": 720, "height": 405 },
  "frames": [
    { "type": "text_title", "description": "Title", "x": 36, "y": 30, "width": 648, "height": 50 },
    { "type": "text_body", "description": "Body text", "x": 36, "y": 100, "width": 310, "height": 270 },
    { "type": "image_placeholder", "description": "Right image", "aspect_ratio": "3:2", "x": 374, "y": 100, "width": 310, "height": 207 }
  ]
}
\`\`\`

═══════════════════════════════════════════════════════════════

EXAMPLE OF CORRECT OUTPUT:

SLIDE #1 — Title slide
═══════════════════════════════════════════════════════════════

▸ TITLE:
Project Noir: Influencer Experience

▸ SUBTITLE:
High-touch creative concepts for talent activations

▸ LAYOUT STRUCTURE:
• Large centered title with bold typography
• Subtitle beneath in lighter weight
• Clean, minimal composition

▸ COPY/TEXT CONTENT:
N/A - title slide (title and subtitle only)

▸ VISUAL STYLING:
Cinematic noir aesthetic with textured overlays. Vintage atmosphere with bold typographic hierarchy.

▸ REQUIRED ASSETS:
• [Icon/Logo] - company logo
• [Image Background] - dark textured noir backdrop

▸ COMPONENT GEOMETRY:
\`\`\`json
{
  "canvas": { "width": 720, "height": 405 },
  "frames": [
    { "type": "icon_placeholder", "description": "Company logo, large and centered", "x": 285, "y": 100, "width": 150, "height": 80 },
    { "type": "text_title", "description": "Title text centered", "x": 36, "y": 200, "width": 648, "height": 60 },
    { "type": "text_subtitle", "description": "Subtitle text centered", "x": 120, "y": 270, "width": 480, "height": 40 },
    { "type": "background_image", "description": "Dark textured noir backdrop", "x": 0, "y": 0, "width": 720, "height": 405 }
  ]
}
\`\`\`

═══════════════════════════════════════════════════════════════

RULES:
1. Start output with "SLIDE #" — nothing before it.
2. Use ▸ markers for ALL 7 sections.
3. NEVER use # or ## markdown headers.
4. No explanatory text like "Here is..." or "Based on..."
5. Keep content concise — max 4 sentences per section. HOWEVER, if the user's deck context prompt or revision prompt requests more detail, longer descriptions, or more thorough/descriptive content, honor that request: allow more sentences per section, longer bullets, and additional sections as needed while ensuring text still fits within the visible slide frame.
6. CAPTION LAYOUTS: Keep COPY/TEXT CONTENT minimal (2-3 bullet points max) — focus is on the visuals. Exception: if user explicitly requests detailed captions, allow up to 4-5 bullets.
7. TITLE-ONLY LAYOUTS: For Title slide, Section header, Title Page w/Gradient, Section Header w/Gradient, Title only, and Big number — use ONLY title and subtitle. COPY/TEXT CONTENT = "N/A - title slide". No body text.
8. REQUIRED ASSETS: Use "• [Type | RATIO] - description" format. Types needing ratios: [Image], [Video], [Infograph], [Timeline]. No ratio needed: [Icon/Logo], [Image Background]. Choose ratios thoughtfully: 21:9/32:9 wide/cinematic, 16:9 standard, 3:2 editorial, 4:3 data, 2:3/9:16 portrait, 1:1 square, 4:1/5:1 timelines.
9. IMAGE BACKGROUND: Use [Image Background] for "w/Gradient" or background image layouts.
10. BREVITY: All text MUST fit within the visible slide frame — content that overflows is invisible. Max 8 words per bullet, max 2 sections with 3 bullets each. Reduce text when large assets are present. OVERRIDE: If the user's deck context prompt or revision prompt asks for more detail, richer descriptions, or expanded content, increase these limits — allow longer bullets (up to ~15 words), more sections (up to 3-4), and more bullets per section (up to 5). Always ensure all text fits within the visible slide frame without overflow.
10a. TIMELINE/LARGE VISUAL TEXT LIMIT: When a [Timeline], [Infograph], or large visual element occupies the top portion of a slide (reducing the body text area to ~115pt or less), limit COPY/TEXT CONTENT to ≤8 lines total (max 2 sections with 3-4 bullets each). Do NOT generate 3+ full sections — the reduced body area cannot fit them.
11. LAYOUT STRUCTURE: Describe exact placement of assets and text like a layout designer — where images sit relative to text, how columns align, what spans full width vs. sits beside content.
12. LAYOUT PREFERENCE: When a slide has body text AND a visual asset (Image/Video/Infograph), prefer "One column text" with the asset on the right. Reserve "Title and body" for text-only slides or slides with only a Timeline.
13. ICONS SPARINGLY: Only include [Icon/Logo] when essential (client logos, product logos). Most slides need 0-1 icons. No decorative or generic icons.
14. DATA VIZ LIMIT: Max ONE [Timeline] OR ONE [Infograph] per slide — never both. Split across slides if needed.
15. GRADIENT LAYOUTS: For "w/Gradient" layouts, gradient MUST be dark/black — it serves as a shadow for text contrast over background images.
16. BIG NUMBER: For "Big number" layout, TITLE = the number (e.g., "$1M", "40%", "10K+"). SUBTITLE = description/context (NOT body copy). COPY/TEXT CONTENT = "N/A - title slide". In COMPONENT GEOMETRY: use text_title for the number and text_subtitle for the description — do NOT generate text_body for this layout.
17. WIDE IMAGES: Extra-wide ratio images (21:9, 32:9) must NOT go in "Title and body". Use "Caption" or "One column text" with full-width top placement.
18. TITLE AND BODY = TEXT ONLY: "Title and body" NEVER has images, videos, or infographs on the right side — it has NO side panel. If images are needed alongside text, use "One column text". A wide image ABOVE body text is acceptable.
19. NEGATIVE SPACE: Ensure all image frames are fully visible. Match image ratios to containers — wide for full-width, tall/portrait for side panels. Avoid dead space.
20. COMPANY LOGO: Only on title/opener/closer pages. NOT on content pages. When adding a logo to a title page, describe as "[Icon/Logo] - Company name logo, large and centered" for prominent placement above the title. This is optional — use when the deck benefits from brand presence.
21. ONE COLUMN TEXT: Images fill RIGHT HALF (50% width). FIXED ASPECT RATIOS: 1 asset = 8:9 (fills entire half), 2 assets = 16:9 each (stacked top/bottom), 3 assets = 8:3 each (stacked in thirds). No gaps or padding between images. No other ratios allowed.
22. TWO COLUMNS IMAGES: PREFER two per-column images over single wide. If 2+ assets, ALWAYS use per-column. Single wide: ratio between 21:9 (2.33:1) and 2.75:1. NEVER wider than 2.75:1. HEIGHT THRESHOLDS: 1-2 images use 50-57% of content height, 3 images 37-51%, 4 images 30-51%. Min 40% of page for text (1-2 imgs) or 46% (3-4 imgs). TWO COLUMNS COPY FORMAT: Use --- (three dashes on its own line) to separate left and right column content. Each column can optionally start with a **Bold Header**. Bold text is allowed freely in content without breaking columns. Columns can contain bullet points, numbered lists, or plain paragraph text.
23. THREE COLUMNS: Visual assets above columns. If 3 assets, each centered above its column. If 1-2 assets, center above. If 4, pack left. Same height thresholds as TWO COLUMNS. COPY FORMAT: Use --- separator for 3 sections.
24. FOUR COLUMNS: Visual assets above columns. If 4 assets, each centered above its column. If 1-2 assets, center above. If 3, pack left. Same height thresholds as TWO COLUMNS. COPY FORMAT: Use --- separator for 4 sections.
25. CAPTION: Image-dominant layout. Visual area ~85% of page, text ~15%. Single assets up to 21:9. Minimal text. CRITICAL: text_title and text_body must NOT overlap — stack vertically below image with gaps (title first, then body).
26. SECTION TITLE DESC: Images fill the LEFT half (x=0, width=360). Text on RIGHT half (x=378, width=306). FIXED ASPECT RATIOS: 1 asset = 8:9 (fills entire left half), 2 assets = 16:9 each (stacked top/bottom), 3 assets = 8:3 each (stacked in thirds). No gaps or padding between images. No other ratios allowed.
27. VISUAL STYLING: NO color references. Describe only mood, texture, atmosphere, typography. Colors handled by deck theme.
28. COMPONENT GEOMETRY: Every slide MUST end with ▸ COMPONENT GEOMETRY containing a JSON code block. Canvas is 720×405pt. Use 36pt left/right margins, 30pt top, 35pt bottom, 15pt gutters. Calculate x/y/width/height for every text area and asset frame based on your LAYOUT STRUCTURE. Include "type", "description", "x", "y", "width", "height" for each frame. Image/video/infograph/timeline frames also need "aspect_ratio". Use background_image type (0,0,720,405) for [Image Background] assets.
Generate the outline now:`;
    
    // Build message content array with all files (uploaded + project)
    const contentParts = [];

    // Add all files (uploaded + project)
    allFiles.forEach((fileData, index) => {
      if (fileData.type === 'pdf') {
        contentParts.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: fileData.content
          }
        });
      } else if (fileData.type === 'image') {
        contentParts.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: fileData.mediaType,
            data: fileData.content
          }
        });
      } else {
        // Text content - will be included in the text prompt
      }
    });

    // Collect all text content (uploaded + project)
    const textContents = allFiles
      .filter(f => f.type === 'text')
      .map(f => `--- ${f.file.name} ---\n${f.content}`)
      .join('\n\n');

    // Build the text prompt
    const fileDescriptions = allFiles.map((f, i) => `${i + 1}. ${f.file.name} (${f.type})`).join('\n');

    // Include existing deck pages for cohesion context
    const existingPages = history.length > 0
      ? `\nEXISTING DECK PAGES (match the visual language, structure, and style of these pages):\n${
          [...history].sort((a, b) => (parseInt(a.pageNum) || 999) - (parseInt(b.pageNum) || 999))
            .map(h => {
              const p = parseSlideContent(h.output);
              return `Page #${h.pageNum} — ${h.layout}: "${h.title}"${p.subtitle ? ` / "${p.subtitle}"` : ''}${p.visualStyling ? ` | Style: ${p.visualStyling.substring(0, 80)}` : ''}`;
            }).join('\n')
        }\n\n`
      : '';

    // Build asset placement context if active
    const placementPrompt = assetPlacementActive ? buildAssetPlacementPrompt(placementAssets) : { instructions: '', rules: '' };

    // Build already-placed context from existing history
    const alreadyPlacedList = assetPlacementActive && history.length > 0
      ? history.map(h => {
          const p = parseSlideContent(h.output || h.content || '');
          const placed = parsePlacedAssets(p.placedAssets);
          return placed.map(a => `${a.filename} (Slide #${h.pageNum})`);
        }).flat()
      : [];
    const alreadyPlacedText = alreadyPlacedList.length > 0
      ? `\nALREADY PLACED ASSETS (do not reuse these on this slide):\n${alreadyPlacedList.join('\n')}\n`
      : '';

    const textPrompt = `You are a presentation deck outline generator. Create a single slide outline based on the project documentation.

IMPORTANT: You MUST use the exact format specified below. Do NOT use markdown # headers.

${projectContext ? `PROJECT CONTEXT:\n${projectContext}\n\n` : ''}${systemPrompt ? `DECK CONTEXT & GUIDELINES:\n${systemPrompt}\n\n` : ''}${existingPages}UPLOADED FILES:
${fileDescriptions}

${textContents ? `TEXT CONTENT:\n${textContents}\n\n` : ''}${allFiles.some(f => f.type === 'pdf') ? 'The PDF document(s) above contain project details.\n\n' : ''}${allFiles.some(f => f.type === 'image') ? 'The image(s) above are visual references for the project.\n\n' : ''}${placementPrompt.instructions}${alreadyPlacedText}SELECTED SLIDE LAYOUT: ${layoutInfo.name} (${layoutInfo.description})

USER REQUEST: ${pagePrompt}

${outputInstructions}${placementPrompt.rules}`;

    contentParts.push({ type: 'text', text: textPrompt });

    const messages = [{ role: 'user', content: contentParts }];

    try {
      const data = await callAI({
        model: modelFor('dog.pageOutline'),
        max_tokens: 4096,
        system: singlePageSystemPrompt,
        messages: messages,
        tool: 'dog',
      });
      const output = data.content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n');

      // Parse output into pages
      const pages = parseOutputToPages(output);

      if (pages.length > 0) {
        // Parse user's page number input
        const userInput = pageNumber.trim();
        
        if (userInput && userInput !== 'X') {
          // Check if it's a range (e.g., "1-10" or "3-7")
          const rangeMatch = userInput.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
          
          if (rangeMatch) {
            // It's a range - assign sequential numbers within that range
            const startNum = parseInt(rangeMatch[1]);
            const endNum = parseInt(rangeMatch[2]);
            pages.forEach((page, index) => {
              const pageNum = Math.min(startNum + index, endNum).toString();
              page.pageNum = pageNum;
              page.content = page.content.replace(/SLIDE\s*#(\d+|X)/gi, `SLIDE #${pageNum}`);
            });
          } else {
            // It's a single number - use as starting point and increment
            const startNum = parseInt(userInput) || 1;
            pages.forEach((page, index) => {
              const pageNum = (startNum + index).toString();
              page.pageNum = pageNum;
              page.content = page.content.replace(/SLIDE\s*#(\d+|X)/gi, `SLIDE #${pageNum}`);
            });
          }
        }
        // If no user input or 'X', keep the AI-generated page numbers
        
        // Add pages to tabs
        setOpenTabs(prev => [...prev, ...pages]);
        setActiveTabId(pages[0].id);
        
        // Add to history
        const historyItems = pages.map(page => ({
          id: page.id,
          timestamp: page.timestamp,
          layout: page.layout,
          pageNum: page.pageNum,
          title: page.title,
          output: page.content
        }));
        setHistory(prev => [...prev, ...historyItems]);
        
        // Set deck theme colors if not already set
        if (!deckThemeColors) {
          if (enableThemeGen) {
            const result = await generateAIThemes(historyItems);
            if (!result) {
              setDeckThemeColors(PRESET_THEMES[0].colors);
              setThemeIndex(0);
            }
          } else {
            setDeckThemeColors(PRESET_THEMES[0].colors);
            setThemeIndex(0);
          }
        }
      }
      
    } catch (err) {
      setError('Error generating outline. Please try again.');
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  }, [hasFileContent, uploadedFiles, allFiles, projectContext, pagePrompt, selectedLayout, systemPrompt, pageNumber, parseOutputToPages, singlePageSystemPrompt, deckThemeColors, history, enableThemeGen, generateAIThemes, assetPlacementActive, placementAssets, buildAssetPlacementPrompt]);

  // Regenerate page with revisions
  const regeneratePage = useCallback(async () => {
    if (!activeTab || !hasFileContent) {
      setError('No page selected or no documents uploaded');
      return;
    }

    setIsRegenerating(true);
    setError('');

    // Push previous content onto undo stack (up to 8 entries)
    setPreviousContent(prev => {
      const stack = prev[activeTab.id] || [];
      return { ...prev, [activeTab.id]: [...stack.slice(-7), activeTab.content] };
    });

    // Clear redo stack on new regeneration
    setRedoContent(prev => {
      const newRedo = { ...prev };
      delete newRedo[activeTab.id];
      return newRedo;
    });

    // Use selected layout or keep current
    const layoutToUse = regenerateLayout || activeTab.layout;
    const layoutInfo = SLIDE_LAYOUTS.find(l => l.id === layoutToUse || l.name.toLowerCase() === layoutToUse.toLowerCase()) || 
                       SLIDE_LAYOUTS.find(l => l.name === 'Title and body');
    
    const slideNumber = activeTab.pageNum || 'X';
    
    const outputInstructions = `Regenerate this slide outline based on the revision request.

CURRENT SLIDE CONTENT:
${activeTab.content}

REVISION REQUEST: ${revisionPrompt || 'Improve and refine the content'}

CRITICAL: Output ONLY the structured format below. No explanations, no commentary, no "Based on..." text.

REQUIRED FORMAT (copy this structure exactly):

SLIDE #${slideNumber} — ${layoutInfo.name}
═══════════════════════════════════════════════════════════════

▸ TITLE:
[Write your title here]

▸ SUBTITLE:
[Write your subtitle here]

▸ LAYOUT STRUCTURE:
• [Layout point 1]
• [Layout point 2]
• [Layout point 3]

▸ COPY/TEXT CONTENT:
**[SECTION NAME]:**
• [Content bullet 1]
• [Content bullet 2]

▸ VISUAL STYLING:
[1-2 sentences about visual mood, texture, typography. NO color references.]

▸ REQUIRED ASSETS:
• [Image] - description of asset
• [Icon/Logo] - description of asset

▸ COMPONENT GEOMETRY:
\`\`\`json
{
  "canvas": { "width": 720, "height": 405 },
  "frames": [
    { "type": "text_title", "description": "Title", "x": 36, "y": 30, "width": 648, "height": 50 },
    { "type": "text_body", "description": "Body text", "x": 36, "y": 100, "width": 310, "height": 270 },
    { "type": "image_placeholder", "description": "Right image", "aspect_ratio": "3:2", "x": 374, "y": 100, "width": 310, "height": 207 }
  ]
}
\`\`\`

═══════════════════════════════════════════════════════════════

RULES:
1. Start output with "SLIDE #" — nothing before it.
2. Use ▸ markers for ALL 7 sections.
3. NEVER use # or ## markdown headers.
4. No explanatory text like "Here is..." or "Based on..."
5. Keep content concise — max 4 sentences per section.
6. Apply the revision request while maintaining the overall structure.
7. Keep the same page number (${slideNumber}).
7b. CRITICAL — KEEP THE LAYOUT: You MUST output "SLIDE #${slideNumber} — ${layoutInfo.name}" as the header. Do NOT switch to a different layout type. The user selected "${layoutInfo.name}" and it must remain "${layoutInfo.name}" in the output.
8. CAPTION LAYOUTS: Keep COPY/TEXT CONTENT minimal (2-3 bullet points max) — focus is on the visuals.
9. TITLE-ONLY LAYOUTS: For Title slide, Section header, Title Page w/Gradient, Section Header w/Gradient, Title only, and Big number — use ONLY title and subtitle. COPY/TEXT CONTENT = "N/A - title slide". No body text.
10. REQUIRED ASSETS: Use "• [Type | RATIO] - description" format. Types needing ratios: [Image], [Video], [Infograph], [Timeline]. No ratio needed: [Icon/Logo], [Image Background].
10b. PRESERVE PLACED ASSETS: If the current slide content has <<filename>> markers in REQUIRED ASSETS (indicating uploaded assets placed in frames), you MUST preserve those EXACT entries — same marker, same type, same aspect ratio. Do NOT remove, rename, change the ratio, or alter any <<filename>> entries in any way. Copy them verbatim from the current content. They link to real uploaded files with fixed dimensions. Add or modify other assets freely, but placed asset lines must be identical to the original.
11. IMAGE BACKGROUND: Use [Image Background] for "w/Gradient" or background image layouts.
12. BREVITY: All text MUST fit within the visible slide frame — content that overflows is invisible. Max 8 words per bullet, max 2 sections with 3 bullets each. Reduce text when large assets are present.
12a. TIMELINE/LARGE VISUAL TEXT LIMIT: When a [Timeline], [Infograph], or large visual element occupies the top portion of a slide (reducing the body text area to ~115pt or less), limit COPY/TEXT CONTENT to ≤8 lines total (max 2 sections with 3-4 bullets each). Do NOT generate 3+ full sections — the reduced body area cannot fit them.
13. LAYOUT STRUCTURE: Describe exact placement of assets and text like a layout designer — where images sit relative to text, how columns align, what spans full width vs. sits beside content.
14. LAYOUT PREFERENCE: When a slide has body text AND a visual asset (Image/Video/Infograph), prefer "One column text" with the asset on the right. Reserve "Title and body" for text-only slides or slides with only a Timeline.
15. ICONS SPARINGLY: Only include [Icon/Logo] when essential (client logos, product logos). Most slides need 0-1 icons. No decorative or generic icons.
16. DATA VIZ LIMIT: Max ONE [Timeline] OR ONE [Infograph] per slide — never both. Split across slides if needed.
17. GRADIENT LAYOUTS: For "w/Gradient" layouts, gradient MUST be dark/black — it serves as a shadow for text contrast over background images.
18. BIG NUMBER: For "Big number" layout, TITLE = the number (e.g., "$1M", "40%", "10K+"). SUBTITLE = description/context (NOT body copy). COPY/TEXT CONTENT = "N/A - title slide". In COMPONENT GEOMETRY: use text_title for the number and text_subtitle for the description — do NOT generate text_body for this layout.
19. WIDE IMAGES: Extra-wide ratio images (21:9, 32:9) must NOT go in "Title and body". Use "Caption" or "One column text" with full-width top placement.
20. TITLE AND BODY = TEXT ONLY: "Title and body" NEVER has images, videos, or infographs on the right side — it has NO side panel. If images are needed alongside text, use "One column text". A wide image ABOVE body text is acceptable.
21. NEGATIVE SPACE: Ensure all image frames are fully visible. Match image ratios to containers — wide for full-width, tall/portrait for side panels. Avoid dead space.
22. COMPANY LOGO: Only on title/opener/closer pages. NOT on content pages. When adding a logo to a title page, describe as "[Icon/Logo] - Company name logo, large and centered" for prominent placement above the title. This is optional — use when the deck benefits from brand presence.
23. ONE COLUMN TEXT: Images fill RIGHT HALF (50% width). FIXED ASPECT RATIOS: 1 asset = 8:9 (fills entire half), 2 assets = 16:9 each (stacked top/bottom), 3 assets = 8:3 each (stacked in thirds). No gaps or padding between images. No other ratios allowed.
24. TWO COLUMNS IMAGES: PREFER two per-column images over single wide. If 2+ assets, ALWAYS use per-column. Single wide: ratio between 21:9 (2.33:1) and 2.75:1. NEVER wider than 2.75:1. HEIGHT THRESHOLDS: 1-2 images use 50-57% of content height, 3 images 37-51%, 4 images 30-51%. Min 40% of page for text (1-2 imgs) or 46% (3-4 imgs). TWO COLUMNS COPY FORMAT: Use --- (three dashes on its own line) to separate left and right column content. Each column can optionally start with a **Bold Header**. Bold text is allowed freely in content without breaking columns. Columns can contain bullet points, numbered lists, or plain paragraph text.
25. THREE COLUMNS: Visual assets above columns. If 3 assets, each centered above its column. If 1-2 assets, center above. If 4, pack left. Same height thresholds as TWO COLUMNS. COPY FORMAT: Use --- separator for 3 sections.
26. FOUR COLUMNS: Visual assets above columns. If 4 assets, each centered above its column. If 1-2 assets, center above. If 3, pack left. Same height thresholds as TWO COLUMNS. COPY FORMAT: Use --- separator for 4 sections.
27. CAPTION: Image-dominant layout. Visual area ~85% of page, text ~15%. Single assets up to 21:9. Minimal text. CRITICAL: text_title and text_body must NOT overlap — stack vertically below image with gaps (title first, then body).
28. SECTION TITLE DESC: Images fill the LEFT half (x=0, width=360). Text on RIGHT half (x=378, width=306). FIXED ASPECT RATIOS: 1 asset = 8:9 (fills entire left half), 2 assets = 16:9 each (stacked top/bottom), 3 assets = 8:3 each (stacked in thirds). No gaps or padding between images. No other ratios allowed.
29. VISUAL STYLING: NO color references. Describe only mood, texture, atmosphere, typography. Colors handled by deck theme.
30. COMPONENT GEOMETRY: Every slide MUST end with ▸ COMPONENT GEOMETRY containing a JSON code block. Canvas is 720×405pt. Use 36pt left/right margins, 30pt top, 35pt bottom, 15pt gutters. Calculate x/y/width/height for every text area and asset frame based on your LAYOUT STRUCTURE. Include "type", "description", "x", "y", "width", "height" for each frame. Image/video/infograph/timeline frames also need "aspect_ratio". Use background_image type (0,0,720,405) for [Image Background] assets.
Generate the revised outline now:`;
    
    // Build message content array with all files (uploaded + project)
    const contentParts = [];

    // Add all files (uploaded + project)
    allFiles.forEach((fileData) => {
      if (fileData.type === 'pdf') {
        contentParts.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: fileData.content
          }
        });
      } else if (fileData.type === 'image') {
        contentParts.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: fileData.mediaType,
            data: fileData.content
          }
        });
      }
    });

    // Collect all text content (uploaded + project)
    const textContents = allFiles
      .filter(f => f.type === 'text')
      .map(f => `--- ${f.file.name} ---\n${f.content}`)
      .join('\n\n');

    // Build the text prompt
    const fileDescriptions = allFiles.map((f, i) => `${i + 1}. ${f.file.name} (${f.type})`).join('\n');

    // Include existing deck pages for cohesion context
    const existingPagesRegen = history.length > 0
      ? `\nEXISTING DECK PAGES (maintain cohesion with these pages):\n${
          [...history].sort((a, b) => (parseInt(a.pageNum) || 999) - (parseInt(b.pageNum) || 999))
            .filter(h => h.id !== activeTab.id)
            .map(h => {
              const p = parseSlideContent(h.output);
              return `Page #${h.pageNum} — ${h.layout}: "${h.title}"${p.subtitle ? ` / "${p.subtitle}"` : ''}`;
            }).join('\n')
        }\n\n`
      : '';

    // Build asset placement context for regeneration
    const regenAlreadyPlaced = assetPlacementActive
      ? history.filter(h => h.id !== activeTab.id).map(h => {
          const p = parseSlideContent(h.output || h.content || '');
          return parsePlacedAssets(p.placedAssets).map(a => `${a.filename} (Slide #${h.pageNum})`);
        }).flat()
      : [];
    const regenAlreadyPlacedText = regenAlreadyPlaced.length > 0
      ? `\nALREADY PLACED ON OTHER SLIDES (do not reuse unless user requests):\n${regenAlreadyPlaced.join('\n')}\n`
      : '';
    const regenPlacementPrompt = assetPlacementActive
      ? buildAssetPlacementPrompt(placementAssets, regenAlreadyPlacedText)
      : { instructions: '', rules: '' };

    const textPrompt = `You are a presentation deck outline generator. Revise this slide outline based on the user's request.

IMPORTANT: You MUST use the exact format specified below. Do NOT use markdown # headers.

${projectContext ? `PROJECT CONTEXT:\n${projectContext}\n\n` : ''}${systemPrompt ? `DECK CONTEXT & GUIDELINES:\n${systemPrompt}\n\n` : ''}${existingPagesRegen}UPLOADED FILES:
${fileDescriptions}

${textContents ? `TEXT CONTENT:\n${textContents}\n\n` : ''}${allFiles.some(f => f.type === 'pdf') ? 'The PDF document(s) above contain project details.\n\n' : ''}${allFiles.some(f => f.type === 'image') ? 'The image(s) above are visual references for the project.\n\n' : ''}${regenPlacementPrompt.instructions}TARGET SLIDE LAYOUT: ${layoutInfo.name} (${layoutInfo.description})

${outputInstructions}${regenPlacementPrompt.rules}`;

    contentParts.push({ type: 'text', text: textPrompt });

    const messages = [{ role: 'user', content: contentParts }];

    try {
      const data = await callAI({
        model: modelFor('dog.regeneratePage'),
        max_tokens: 4096,
        system: singlePageSystemPrompt,
        messages: messages,
        tool: 'dog',
      });
      const output = data.content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n');

      // Parse the output to extract the new content
      const pages = parseOutputToPages(output);

      if (pages.length > 0) {
        const newContent = pages[0].content;
        const newTitle = pages[0].title;
        const newLayout = pages[0].layout || layoutInfo.name;

        // Update the tab content
        setOpenTabs(prev => prev.map(tab =>
          tab.id === activeTab.id
            ? { ...tab, content: newContent, title: newTitle, layout: newLayout }
            : tab
        ));

        // Update history
        setHistory(prev => prev.map(item =>
          item.id === activeTab.id
            ? { ...item, output: newContent, title: newTitle, layout: newLayout }
            : item
        ));

        // Clear the revision prompt
        setRevisionPrompt('');
      }

    } catch (err) {
      setError('Error regenerating page. Please try again.');
      console.error(err);
      // Pop from undo stack since regeneration failed
      setPreviousContent(prev => {
        const stack = [...(prev[activeTab.id] || [])];
        stack.pop();
        if (stack.length === 0) {
          const newPrev = { ...prev };
          delete newPrev[activeTab.id];
          return newPrev;
        }
        return { ...prev, [activeTab.id]: stack };
      });
    } finally {
      setIsRegenerating(false);
    }
  }, [activeTab, hasFileContent, uploadedFiles, allFiles, projectContext, systemPrompt, revisionPrompt, regenerateLayout, singlePageSystemPrompt, parseOutputToPages, history, assetPlacementActive, placementAssets, buildAssetPlacementPrompt]);

  // Undo regeneration
  const undoRegeneration = useCallback(() => {
    if (!activeTab) return;
    const stack = previousContent[activeTab.id];
    if (!stack || stack.length === 0) return;

    // Pop the most recent entry from the undo stack
    const prevContent = stack[stack.length - 1];

    // Push current content onto redo stack (up to 8)
    setRedoContent(prev => {
      const redoStack = prev[activeTab.id] || [];
      return { ...prev, [activeTab.id]: [...redoStack.slice(-7), activeTab.content] };
    });

    // Parse the previous content to get title and layout
    const parsed = parseSlideContent(prevContent);

    // Restore the tab content
    setOpenTabs(prev => prev.map(tab =>
      tab.id === activeTab.id
        ? { ...tab, content: prevContent, title: parsed.title || tab.title, layout: parsed.layoutType || tab.layout }
        : tab
    ));

    // Restore history
    setHistory(prev => prev.map(item =>
      item.id === activeTab.id
        ? { ...item, output: prevContent, title: parsed.title || item.title, layout: parsed.layoutType || item.layout }
        : item
    ));

    // Pop from undo stack
    setPreviousContent(prev => {
      const newStack = [...(prev[activeTab.id] || [])];
      newStack.pop();
      if (newStack.length === 0) {
        const newPrev = { ...prev };
        delete newPrev[activeTab.id];
        return newPrev;
      }
      return { ...prev, [activeTab.id]: newStack };
    });
  }, [activeTab, previousContent]);

  // Redo regeneration
  const redoRegeneration = useCallback(() => {
    if (!activeTab) return;
    const stack = redoContent[activeTab.id];
    if (!stack || stack.length === 0) return;

    // Pop the most recent entry from the redo stack
    const redoData = stack[stack.length - 1];

    // Push current content onto undo stack (up to 8)
    setPreviousContent(prev => {
      const undoStack = prev[activeTab.id] || [];
      return { ...prev, [activeTab.id]: [...undoStack.slice(-7), activeTab.content] };
    });

    // Parse the redo content to get title and layout
    const parsed = parseSlideContent(redoData);

    // Apply the redo content
    setOpenTabs(prev => prev.map(tab =>
      tab.id === activeTab.id
        ? { ...tab, content: redoData, title: parsed.title || tab.title, layout: parsed.layoutType || tab.layout }
        : tab
    ));

    // Update history
    setHistory(prev => prev.map(item =>
      item.id === activeTab.id
        ? { ...item, output: redoData, title: parsed.title || item.title, layout: parsed.layoutType || item.layout }
        : item
    ));

    // Pop from redo stack
    setRedoContent(prev => {
      const newStack = [...(prev[activeTab.id] || [])];
      newStack.pop();
      if (newStack.length === 0) {
        const newPrev = { ...prev };
        delete newPrev[activeTab.id];
        return newPrev;
      }
      return { ...prev, [activeTab.id]: newStack };
    });
  }, [activeTab, redoContent]);

  const generateFullDeck = useCallback(async () => {
    console.log('generateFullDeck called', { hasFileContent, uploadedFiles: uploadedFiles.length });
    
    if (!hasFileContent) {
      setError('Please upload a document first');
      return;
    }

    setIsGenerating(true);
    setError('');
    
    const outputInstructions = `Generate a complete deck outline with multiple slides.

CRITICAL: Output ONLY the structured format below. No explanations, no commentary, no "Based on..." or "Here is..." text.

REQUIRED FORMAT FOR EACH SLIDE:

SLIDE #[NUMBER] — [Layout Name]
═══════════════════════════════════════════════════════════════

▸ TITLE:
[Write title here]

▸ SUBTITLE:
[Write subtitle here]

▸ LAYOUT STRUCTURE:
• [Layout point 1]
• [Layout point 2]

▸ COPY/TEXT CONTENT:
**[SECTION NAME]:**
• [Content bullet 1]
• [Content bullet 2]

▸ VISUAL STYLING:
[1-2 sentences about visual mood, texture, typography. NO color references.]

▸ REQUIRED ASSETS:
• [Image] - description of asset
• [Icon/Logo] - description of asset

▸ COMPONENT GEOMETRY:
\`\`\`json
{
  "canvas": { "width": 720, "height": 405 },
  "frames": [
    { "type": "text_title", "description": "Title", "x": 36, "y": 30, "width": 648, "height": 50 },
    { "type": "text_body", "description": "Body text", "x": 36, "y": 100, "width": 310, "height": 270 },
    { "type": "image_placeholder", "description": "Right image", "aspect_ratio": "3:2", "x": 374, "y": 100, "width": 310, "height": 207 }
  ]
}
\`\`\`

═══════════════════════════════════════════════════════════════

EXAMPLE OF CORRECT OUTPUT:

SLIDE #1 — Title Page w/Gradient
═══════════════════════════════════════════════════════════════

▸ TITLE:
Project Noir: Influencer Experience

▸ SUBTITLE:
High-touch creative concepts for talent activations

▸ LAYOUT STRUCTURE:
• Large centered title with bold typography
• Subtitle beneath in lighter weight
• Gradient background dark to accent color

▸ COPY/TEXT CONTENT:
N/A - title slide (title and subtitle only)

▸ VISUAL STYLING:
Cinematic noir aesthetic with dramatic gradient shadows. Bold typographic hierarchy evoking vintage prestige.

▸ REQUIRED ASSETS:
• [Icon/Logo] - company logo
• [Image Background] - dark cinematic noir texture behind gradient

▸ COMPONENT GEOMETRY:
\`\`\`json
{
  "canvas": { "width": 720, "height": 405 },
  "frames": [
    { "type": "icon_placeholder", "description": "Company logo, large and centered", "x": 285, "y": 100, "width": 150, "height": 80 },
    { "type": "text_title", "description": "Title text centered", "x": 36, "y": 200, "width": 648, "height": 60 },
    { "type": "text_subtitle", "description": "Subtitle text centered", "x": 120, "y": 270, "width": 480, "height": 40 },
    { "type": "background_image", "description": "Dark cinematic noir texture", "x": 0, "y": 0, "width": 720, "height": 405 }
  ]
}
\`\`\`

═══════════════════════════════════════════════════════════════

SLIDE #2 — One column text
═══════════════════════════════════════════════════════════════

▸ TITLE:
The Concept

▸ SUBTITLE:
Creating unforgettable moments

▸ LAYOUT STRUCTURE:
• Text column left (55% width), 2:3 portrait image right (45% width)
• Title at top left above body content
• Two text sections aligned vertically on left side

▸ COPY/TEXT CONTENT:
**CORE IDEA:**
• Transform spaces into immersive experiences
• Capture authentic content moments

**KEY ELEMENTS:**
• Themed environments
• Professional production support

▸ VISUAL STYLING:
Consistent dramatic lighting with high contrast composition. Professional cinematic quality.

▸ REQUIRED ASSETS:
• [Image | 2:3] - concept mood board of immersive environment, portrait orientation

▸ COMPONENT GEOMETRY:
\`\`\`json
{
  "canvas": { "width": 720, "height": 405 },
  "frames": [
    { "type": "text_title", "description": "Title text", "x": 36, "y": 30, "width": 380, "height": 50 },
    { "type": "text_subtitle", "description": "Subtitle text", "x": 36, "y": 85, "width": 380, "height": 30 },
    { "type": "text_body", "description": "Left column body text", "x": 36, "y": 130, "width": 380, "height": 240 },
    { "type": "image_placeholder", "description": "Concept mood board", "aspect_ratio": "2:3", "x": 431, "y": 30, "width": 253, "height": 340 }
  ]
}
\`\`\`

═══════════════════════════════════════════════════════════════

AVAILABLE LAYOUTS:
Title slide, Section header, Title and body, Title and two columns, Title and three columns, Title and four columns, Title only, One column text, Main point, Section title and description, Caption, Big number, Blank, Section Header w/Gradient, Title Page w/Gradient

RULES:
1. Start with "SLIDE #1" — no text before it.
2. Use ▸ markers for ALL 7 sections on EVERY slide.
3. NEVER use # or ## markdown headers.
4. No explanatory text like "Here is..." or "Based on..."
5. Keep content concise — max 4 sentences per section. HOWEVER, if the user's deck context prompt or revision prompt requests more detail, longer descriptions, or more thorough/descriptive content, honor that request: allow more sentences per section, longer bullets, and additional sections as needed while ensuring text still fits within the visible slide frame.
6. CAPTION LAYOUTS: Keep COPY/TEXT CONTENT minimal (2-3 bullet points max) — focus is on the visuals. Exception: if user explicitly requests detailed captions, allow up to 4-5 bullets.
7. TITLE-ONLY LAYOUTS: For Title slide, Section header, Title Page w/Gradient, Section Header w/Gradient, Title only, and Big number — use ONLY title and subtitle. COPY/TEXT CONTENT = "N/A - title slide". No body text.
8. REQUIRED ASSETS: Use "• [Type | RATIO] - description" format. Types needing ratios: [Image], [Video], [Infograph], [Timeline]. No ratio needed: [Icon/Logo], [Image Background]. Choose ratios thoughtfully: 21:9/32:9 wide/cinematic, 16:9 standard, 3:2 editorial, 4:3 data, 2:3/9:16 portrait, 1:1 square, 4:1/5:1 timelines.
9. IMAGE BACKGROUND: Use [Image Background] for "w/Gradient" or background image layouts.
10. BREVITY: All text MUST fit within the visible slide frame — content that overflows is invisible. Max 8 words per bullet, max 2 sections with 3 bullets each. Reduce text when large assets are present. OVERRIDE: If the user's deck context prompt or revision prompt asks for more detail, richer descriptions, or expanded content, increase these limits — allow longer bullets (up to ~15 words), more sections (up to 3-4), and more bullets per section (up to 5). Always ensure all text fits within the visible slide frame without overflow.
10a. TIMELINE/LARGE VISUAL TEXT LIMIT: When a [Timeline], [Infograph], or large visual element occupies the top portion of a slide (reducing the body text area to ~115pt or less), limit COPY/TEXT CONTENT to ≤8 lines total (max 2 sections with 3-4 bullets each). Do NOT generate 3+ full sections — the reduced body area cannot fit them.
11. LAYOUT STRUCTURE: Describe exact placement of assets and text like a layout designer — where images sit relative to text, how columns align, what spans full width vs. sits beside content.
12. LAYOUT PREFERENCE: When a slide has body text AND a visual asset (Image/Video/Infograph), prefer "One column text" with the asset on the right. Reserve "Title and body" for text-only slides or slides with only a Timeline.
13. ICONS SPARINGLY: Only include [Icon/Logo] when essential (client logos, product logos). Most slides need 0-1 icons. No decorative or generic icons.
14. DATA VIZ LIMIT: Max ONE [Timeline] OR ONE [Infograph] per slide — never both. Split across slides if needed.
15. GRADIENT LAYOUTS: For "w/Gradient" layouts, gradient MUST be dark/black — it serves as a shadow for text contrast over background images. Never describe bright/colorful gradients.
16. BIG NUMBER: For "Big number" layout, TITLE = the number (e.g., "$1M", "40%", "10K+"). SUBTITLE = description/context (NOT body copy). COPY/TEXT CONTENT = "N/A - title slide". In COMPONENT GEOMETRY: use text_title for the number and text_subtitle for the description — do NOT generate text_body for this layout.
17. WIDE IMAGES: Extra-wide ratio images (21:9, 32:9) must NOT go in "Title and body". Use "Caption" or "One column text" with full-width top placement.
18. TITLE AND BODY = TEXT ONLY: "Title and body" NEVER has images, videos, or infographs on the right side — it has NO side panel. If images are needed alongside text, use "One column text". A wide image ABOVE body text is acceptable.
19. LAYOUT VARIETY: Do not over-rely on "Title and body". Mix layouts — "One column text" for text+image, "Caption" for image-focused, "Two columns" for comparisons, "Section title and description" for visual storytelling.
20. NEGATIVE SPACE: Ensure all image frames are fully visible. Match image ratios to containers — wide for full-width, tall/portrait for side panels. Avoid dead space.
21. COMPANY LOGO: Only on title/opener/closer pages. NOT on content pages. When adding a logo to a title page, describe as "[Icon/Logo] - Company name logo, large and centered" for prominent placement above the title. This is optional — use when the deck benefits from brand presence.
22. ICON CONSISTENCY: If using [Icon/Logo] badges next to titles on content pages, apply to ALL content pages consistently. Don't start then skip pages.
23. OUTRO: Deck MUST end with a clean closing page. Minimal text — CTA or thank you. Include contact info ONLY if provided in source docs or deck context prompt.
24. ONE COLUMN TEXT: Images fill RIGHT HALF (50% width). FIXED ASPECT RATIOS: 1 asset = 8:9 (fills entire half), 2 assets = 16:9 each (stacked top/bottom), 3 assets = 8:3 each (stacked in thirds). No gaps or padding between images. No other ratios allowed.
25. TWO COLUMNS IMAGES: PREFER two per-column images over single wide. If 2+ assets, ALWAYS use per-column. Single wide: ratio between 21:9 (2.33:1) and 2.75:1. NEVER wider than 2.75:1. HEIGHT THRESHOLDS: 1-2 images use 50-57% of content height, 3 images 37-51%, 4 images 30-51%. Min 40% of page for text (1-2 imgs) or 46% (3-4 imgs). TWO COLUMNS COPY FORMAT: Use --- (three dashes on its own line) to separate left and right column content. Each column can optionally start with a **Bold Header**. Bold text is allowed freely in content without breaking columns. Columns can contain bullet points, numbered lists, or plain paragraph text.
26. THREE COLUMNS: Visual assets above columns. If 3 assets, each centered above its column. If 1-2 assets, center above. If 4, pack left. Same height thresholds as TWO COLUMNS. COPY FORMAT: Use --- separator for 3 sections.
27. FOUR COLUMNS: Visual assets above columns. If 4 assets, each centered above its column. If 1-2 assets, center above. If 3, pack left. Same height thresholds as TWO COLUMNS. COPY FORMAT: Use --- separator for 4 sections.
28. CAPTION: Image-dominant layout. Visual area ~85% of page, text ~15%. Single assets up to 21:9. Minimal text. CRITICAL: text_title and text_body must NOT overlap — stack vertically below image with gaps (title first, then body).
29. SECTION TITLE DESC: Images fill the LEFT half (x=0, width=360). Text on RIGHT half (x=378, width=306). FIXED ASPECT RATIOS: 1 asset = 8:9 (fills entire left half), 2 assets = 16:9 each (stacked top/bottom), 3 assets = 8:3 each (stacked in thirds). No gaps or padding between images. No other ratios allowed.
30. VISUAL STYLING: NO color references. Describe only mood, texture, atmosphere, typography. Colors handled by deck theme.
31. COMPONENT GEOMETRY: Every slide MUST end with ▸ COMPONENT GEOMETRY containing a JSON code block. Canvas is 720×405pt. Use 36pt left/right margins, 30pt top, 35pt bottom, 15pt gutters. Calculate x/y/width/height for every text area and asset frame based on your LAYOUT STRUCTURE. Include "type", "description", "x", "y", "width", "height" for each frame. Image/video/infograph/timeline frames also need "aspect_ratio". Use background_image type (0,0,720,405) for [Image Background] assets.
Generate the complete deck now:`;
    
    // Build message content array with all files (uploaded + project)
    const contentParts = [];

    // Add all files (uploaded + project)
    allFiles.forEach((fileData, index) => {
      if (fileData.type === 'pdf') {
        contentParts.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: fileData.content
          }
        });
      } else if (fileData.type === 'image') {
        contentParts.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: fileData.mediaType,
            data: fileData.content
          }
        });
      }
    });

    // Collect all text content (uploaded + project)
    const textContents = allFiles
      .filter(f => f.type === 'text')
      .map(f => `--- ${f.file.name} ---\n${f.content}`)
      .join('\n\n');

    // Build the text prompt
    const fileDescriptions = allFiles.map((f, i) => `${i + 1}. ${f.file.name} (${f.type})`).join('\n');

    // Build asset placement context for full deck
    const fullDeckPlacementPrompt = assetPlacementActive
      ? buildAssetPlacementPrompt(placementAssets)
      : { instructions: '', rules: '' };

    const textPrompt = `You are a presentation deck outline generator. Create a complete deck outline with multiple slides based on the project documentation.

IMPORTANT: You MUST use the exact format specified below. Do NOT use markdown # headers.

${projectContext ? `PROJECT CONTEXT:\n${projectContext}\n\n` : ''}${systemPrompt ? `DECK CONTEXT & GUIDELINES:\n${systemPrompt}\n\n` : ''}UPLOADED FILES:
${fileDescriptions}

${textContents ? `TEXT CONTENT:\n${textContents}\n\n` : ''}${allFiles.some(f => f.type === 'pdf') ? 'The PDF document(s) above contain project details.\n\n' : ''}${allFiles.some(f => f.type === 'image') ? 'The image(s) above are visual references for the project.\n\n' : ''}${fullDeckPlacementPrompt.instructions}${outputInstructions}${fullDeckPlacementPrompt.rules}`;

    contentParts.push({ type: 'text', text: textPrompt });

    const messages = [{ role: 'user', content: contentParts }];

    try {
      // Initial API call with high token limit for large decks
      let fullOutput = '';
      let currentMessages = messages;
      let continuationAttempts = 0;
      const MAX_CONTINUATIONS = 3; // Allow up to 3 continuation calls

      while (continuationAttempts <= MAX_CONTINUATIONS) {
        const data = await callAI({
          model: modelFor('dog.fullDeck'),
          // Caps how hard the model thinks. Measured, not guessed — the
          // rationale and the numbers are on the REGISTRY entry. Without it
          // this call runs ~138s against ai-proxy's ~150s Edge deadline.
          ...tuningFor('dog.fullDeck'),
          max_tokens: 16384,
          system: fullDeckSystemPrompt,
          messages: currentMessages,
          tool: 'dog',
        });
        console.log(`API Response (attempt ${continuationAttempts}):`, data);

        const chunkOutput = data.content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join('\n');

        fullOutput += chunkOutput;

        // Check if output was truncated
        if (data.stop_reason === 'max_tokens') {
          console.log(`[WILSON] Output truncated at attempt ${continuationAttempts}, continuing...`);
          continuationAttempts++;
          // Build continuation messages: original user message + assistant partial response + user continuation request
          currentMessages = [
            ...messages,
            { role: 'assistant', content: fullOutput },
            { role: 'user', content: 'Continue generating the remaining slides from exactly where you left off. Do not repeat any slides already generated. Continue with the same format.' }
          ];
        } else {
          // Output complete
          break;
        }
      }

      if (continuationAttempts > MAX_CONTINUATIONS) {
        console.warn('[WILSON] Reached max continuation attempts, using partial output');
      }

      const output = fullOutput;

      console.log('Extracted output length:', output.length);
      console.log('First 1000 chars of output:', output.substring(0, 1000));
      console.log('Contains SLIDE:', output.includes('SLIDE'));
      console.log('Contains ═:', output.includes('═'));

      // Parse output into pages
      const pages = parseOutputToPages(output);
      
      if (pages.length > 0) {
        // Add pages to tabs
        setOpenTabs(prev => [...prev, ...pages]);
        setActiveTabId(pages[0].id);
        
        // Add to history
        const historyItems = pages.map(page => ({
          id: page.id,
          timestamp: page.timestamp,
          layout: page.layout,
          pageNum: page.pageNum,
          title: page.title,
          output: page.content
        }));
        setHistory(prev => [...prev, ...historyItems]);
        
        // Generate AI themes if enabled, otherwise use first preset
        if (enableThemeGen) {
          // Pass the new history items so theme gen has slide titles
          const result = await generateAIThemes(historyItems);
          if (!result) {
            // Fallback to preset if AI generation fails
            setDeckThemeColors(PRESET_THEMES[0].colors);
            setThemeIndex(0);
          }
        } else {
          setDeckThemeColors(PRESET_THEMES[0].colors);
          setThemeIndex(0);
        }
      } else {
        // Log the raw output for debugging
        console.log('Raw API output:', output);
        setError('Failed to parse deck output. Check console for details.');
      }
      
    } catch (err) {
      setError('Error generating full deck outline. Please try again.');
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  }, [hasFileContent, uploadedFiles, allFiles, projectContext, systemPrompt, parseOutputToPages, fullDeckSystemPrompt, enableThemeGen, generateAIThemes, assetPlacementActive, placementAssets, buildAssetPlacementPrompt]);

  const copyToClipboard = useCallback(() => {
    if (!activeTab) return;
    navigator.clipboard.writeText(activeTab.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [activeTab]);

  const downloadMarkdown = useCallback(async () => {
    if (!activeTab) return;

    const sanitizedTitle = activeTab.title
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50);

    const formattedPageNum = (activeTab.pageNum === 'X' ? '000' : activeTab.pageNum).toString().padStart(3, '0');
    const filename = `${formattedPageNum}_${sanitizedTitle}.md`;

    const blob = new Blob([activeTab.content], { type: 'text/markdown' });
    await saveFileToFolder(exportDirHandle, filename, blob);
  }, [activeTab, exportDirHandle]);

  const closeTab = useCallback((tabId, e) => {
    e.stopPropagation();
    setOpenTabs(prev => {
      const newTabs = prev.filter(t => t.id !== tabId);
      if (activeTabId === tabId && newTabs.length > 0) {
        setActiveTabId(newTabs[0].id);
      } else if (newTabs.length === 0) {
        setActiveTabId(null);
      }
      return newTabs;
    });
  }, [activeTabId]);

  const openFromHistory = useCallback((item) => {
    // Check if already open
    const existingTab = openTabs.find(t => t.id === item.id);
    if (existingTab) {
      setActiveTabId(item.id);
      return;
    }
    
    // Add as new tab
    const newTab = {
      id: item.id,
      pageNum: item.pageNum,
      layout: item.layout,
      title: item.title,
      content: item.output,
      timestamp: item.timestamp
    };
    setOpenTabs(prev => [...prev, newTab]);
    setActiveTabId(item.id);
  }, [openTabs]);

  const updateTabContent = useCallback((newContent) => {
    if (!activeTabId) return;
    setOpenTabs(prev => prev.map(tab => 
      tab.id === activeTabId ? { ...tab, content: newContent } : tab
    ));
    // Also update history
    setHistory(prev => prev.map(item =>
      item.id === activeTabId ? { ...item, output: newContent } : item
    ));
  }, [activeTabId]);

  // Right-click Context Menu: rewrite labels
  const REWRITE_LABELS = {
    relaxed: 'Relaxed',
    formal: 'Formal',
    extend: 'Extend',
    shorten: 'Shorten',
    editor: 'Editor Pass',
  };

  // Handle right-click on textarea
  const handleTextareaContextMenu = useCallback((e) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const selStart = textarea.selectionStart;
    const selEnd = textarea.selectionEnd;
    const selectedText = textarea.value.substring(selStart, selEnd);

    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      selectedText,
      selStart,
      selEnd,
      source: 'text',
    });
  }, []);

  // Context menu handler for visualizer text (read-only, rewrite only)
  const handleVisualizerContextMenu = useCallback((e, selectedText, field) => {
    const content = activeTab?.content || '';
    // Find the field's position in the markdown content to enable AI rewrite
    // Handles both formats: "▸ TITLE:\n  text" (newline) and "▸ TITLE: text" (same line)
    let selStart = 0;
    let selEnd = content.length;
    let fieldFound = false;
    if (field === 'title') {
      // Try newline format first, then same-line format
      let m = content.match(/▸\s*TITLE\s*:\s*\n\s*/i);
      if (!m) m = content.match(/▸\s*TITLE\s*:\s+/i);
      if (m) {
        selStart = m.index + m[0].length;
        const lineEnd = content.indexOf('\n', selStart);
        selEnd = lineEnd > selStart ? lineEnd : selStart + (selectedText?.length || 0);
        fieldFound = true;
      }
    } else if (field === 'subtitle') {
      // Try newline format first, then same-line format
      let m = content.match(/▸\s*SUBTITLE\s*:\s*\n\s*/i);
      if (!m) m = content.match(/▸\s*SUBTITLE\s*:\s+/i);
      if (m) {
        selStart = m.index + m[0].length;
        const lineEnd = content.indexOf('\n', selStart);
        selEnd = lineEnd > selStart ? lineEnd : selStart + (selectedText?.length || 0);
        fieldFound = true;
      }
    } else if (field === 'copyContent') {
      const m = content.match(/▸\s*COPY\/TEXT CONTENT\s*:\s*\n/i);
      if (m) {
        selStart = m.index + m[0].length;
        const nextSection = content.indexOf('\n▸', selStart);
        selEnd = nextSection > selStart ? nextSection : content.length;
        fieldFound = true;
      }
    }
    // Safety: if field wasn't found in markdown, don't allow rewrite (would corrupt content)
    if (!fieldFound) return;
    // If user selected text within the field, narrow to that
    if (selectedText && selectedText.length > 0) {
      const fieldContent = content.substring(selStart, selEnd);
      // First try exact match (works when visualizer selection includes markdown formatting)
      let idx = fieldContent.indexOf(selectedText);
      if (idx >= 0) {
        selStart = selStart + idx;
        selEnd = selStart + selectedText.length;
      } else {
        // Visualizer selection may include blank lines between items (from div rendering),
        // may have truncated last line, and may or may not include bullet prefixes.
        // Use fuzzy line-by-line matching against the markdown.
        const selLines = selectedText.split('\n').map(l => l.trim()).filter(l => l);
        if (selLines.length > 0) {
          const mdLines = fieldContent.split('\n');
          // Strip markdown formatting from a line for comparison
          const stripMd = (line) => line.replace(/^\s*[-•*▸▹►]\s*/, '').replace(/\*\*/g, '').trim();

          const firstSelStripped = stripMd(selLines[0]);
          const lastSelStripped = stripMd(selLines[selLines.length - 1]);

          // Find the first markdown line matching the first selected line
          let firstMdIdx = -1;
          let lastMdIdx = -1;
          for (let i = 0; i < mdLines.length; i++) {
            const stripped = stripMd(mdLines[i]);
            if (stripped && stripped === firstSelStripped) {
              firstMdIdx = i;
              break;
            }
          }
          if (firstMdIdx >= 0) {
            // Find the last markdown line matching the last selected line
            // Use startsWith to handle truncated selections from the browser
            for (let i = mdLines.length - 1; i >= firstMdIdx; i--) {
              const stripped = stripMd(mdLines[i]);
              if (!stripped) continue;
              if (stripped === lastSelStripped) {
                lastMdIdx = i;
                break;
              }
              // Handle truncated last line: if the selected text is a prefix of the markdown line
              if (lastSelStripped.length >= 8 && stripped.startsWith(lastSelStripped)) {
                lastMdIdx = i;
                break;
              }
            }
            // If only 1 selected line but last line wasn't found, use firstMdIdx
            if (lastMdIdx < 0 && selLines.length === 1) {
              lastMdIdx = firstMdIdx;
            }
          }
          if (firstMdIdx >= 0 && lastMdIdx >= 0) {
            // Calculate character offsets within fieldContent
            let charOffset = 0;
            for (let i = 0; i < firstMdIdx; i++) {
              charOffset += mdLines[i].length + 1; // +1 for \n
            }
            const matchStart = charOffset;
            for (let i = firstMdIdx; i <= lastMdIdx; i++) {
              charOffset += mdLines[i].length + 1;
            }
            const matchEnd = charOffset - 1; // -1 to exclude trailing \n
            selStart = selStart + matchStart;
            selEnd = selStart + (matchEnd - matchStart);
          }
        }
      }
    }
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      selectedText: selectedText || content.substring(selStart, selEnd),
      selStart,
      selEnd,
      source: 'visualizer',
    });
  }, [activeTab]);

  // Close context menu
  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }));
  }, []);

  // Close context menu on click outside
  useEffect(() => {
    if (contextMenu.visible) {
      const handler = () => closeContextMenu();
      window.addEventListener('click', handler);
      return () => window.removeEventListener('click', handler);
    }
  }, [contextMenu.visible, closeContextMenu]);

  // Flush any pending debounced undo checkpoint from textarea typing
  const flushPendingUndo = useCallback(() => {
    if (textChangeTimerRef.current) {
      clearTimeout(textChangeTimerRef.current);
      textChangeTimerRef.current = null;
      // Push the pre-typing snapshot if we have one
      if (lastSavedContent.current !== null) {
        const stack = textUndoStack.current;
        if (stack.length === 0 || stack[stack.length - 1] !== lastSavedContent.current) {
          textUndoStack.current = [...stack.slice(-13), lastSavedContent.current];
          textRedoStack.current = [];
        }
      }
    }
  }, []);

  // Push to text undo stack - saves a snapshot of content before a change
  const pushTextUndo = useCallback((contentBeforeChange) => {
    if (!contentBeforeChange && contentBeforeChange !== '') return;
    // Flush any pending debounced checkpoint first
    flushPendingUndo();
    // Don't push if identical to the top of the stack
    const stack = textUndoStack.current;
    if (stack.length > 0 && stack[stack.length - 1] === contentBeforeChange) return;
    textUndoStack.current = [...stack.slice(-13), contentBeforeChange];
    textRedoStack.current = [];
    setUndoRedoCounts({ undo: textUndoStack.current.length, redo: 0 });
  }, [flushPendingUndo]);

  // Text undo
  const handleTextUndo = useCallback(() => {
    if (!activeTab) return;
    // Flush any pending debounce so the latest typing gets saved to undo stack
    flushPendingUndo();
    // Re-check after flush
    if (textUndoStack.current.length === 0) {
      setUndoRedoCounts({ undo: 0, redo: textRedoStack.current.length });
      return;
    }
    const currentContent = activeTab.content;
    textRedoStack.current = [...textRedoStack.current, currentContent];
    const prevContent = textUndoStack.current[textUndoStack.current.length - 1];
    textUndoStack.current = textUndoStack.current.slice(0, -1);
    setUndoRedoCounts({ undo: textUndoStack.current.length, redo: textRedoStack.current.length });
    if (textChangeTimerRef.current) clearTimeout(textChangeTimerRef.current);
    lastSavedContent.current = prevContent;
    updateTabContent(prevContent);
  }, [activeTab, updateTabContent, flushPendingUndo]);

  // Text redo
  const handleTextRedo = useCallback(() => {
    if (!activeTab) return;
    flushPendingUndo();
    if (textRedoStack.current.length === 0) {
      setUndoRedoCounts({ undo: textUndoStack.current.length, redo: 0 });
      return;
    }
    const currentContent = activeTab.content;
    textUndoStack.current = [...textUndoStack.current, currentContent];
    const nextContent = textRedoStack.current[textRedoStack.current.length - 1];
    textRedoStack.current = textRedoStack.current.slice(0, -1);
    setUndoRedoCounts({ undo: textUndoStack.current.length, redo: textRedoStack.current.length });
    if (textChangeTimerRef.current) clearTimeout(textChangeTimerRef.current);
    lastSavedContent.current = nextContent;
    updateTabContent(nextContent);
  }, [activeTab, updateTabContent, flushPendingUndo]);

  // ═══════════════════════════════════════════════════════════
  // FORMATTING TOOLBAR — Helper functions and action handlers
  // ═══════════════════════════════════════════════════════════

  // Get the character range of the COPY/TEXT CONTENT section body (excluding the marker line)
  const getCopyContentBounds = useCallback((content) => {
    if (!content) return null;
    const match = content.match(/▸\s*COPY\/TEXT CONTENT\s*:\s*\n/i);
    if (!match) return null;
    const bodyStart = match.index + match[0].length;
    const nextSection = content.indexOf('\n▸', bodyStart);
    const sectionSep = content.indexOf('\n═', bodyStart);
    let bodyEnd = content.length;
    if (nextSection > bodyStart && nextSection < bodyEnd) bodyEnd = nextSection;
    if (sectionSep > bodyStart && sectionSep < bodyEnd) bodyEnd = sectionSep;
    return { start: bodyStart, end: bodyEnd };
  }, []);

  // Get all lines that a selection range touches
  const getSelectedLines = useCallback((content, selStart, selEnd) => {
    const lines = [];
    // Walk back to the start of the first selected line
    let firstLineStart = content.lastIndexOf('\n', selStart - 1) + 1;
    let pos = firstLineStart;
    while (pos <= selEnd && pos < content.length) {
      let lineEnd = content.indexOf('\n', pos);
      if (lineEnd === -1) lineEnd = content.length;
      lines.push({ lineStart: pos, lineEnd, lineText: content.substring(pos, lineEnd) });
      pos = lineEnd + 1;
    }
    return lines;
  }, []);

  // Detect the formatting type of a single line of text
  const getLineFormat = useCallback((lineText) => {
    const trimmed = lineText.trimStart();
    const indent = lineText.substring(0, lineText.length - trimmed.length);

    // Section header: **Header Text:** or **Header Text**
    if (/^\*\*[^*]+\*\*:?\s*$/.test(trimmed)) {
      const headerMatch = trimmed.match(/^\*\*([^*]+)\*\*:?\s*$/);
      return { type: 'header', content: headerMatch[1].replace(/:$/, ''), prefix: indent };
    }
    // Bullet: starts with •
    if (trimmed.startsWith('•')) {
      return { type: 'bullet', content: trimmed.substring(1).trim(), prefix: indent };
    }
    // Also detect - bullets from imported outlines
    if (trimmed.startsWith('- ')) {
      return { type: 'bullet', content: trimmed.substring(2).trim(), prefix: indent };
    }
    // Numbered: starts with digit(s) followed by . or )
    const numMatch = trimmed.match(/^(\d+)[.)]\s*(.*)/);
    if (numMatch) {
      return { type: 'numbered', content: numMatch[2], prefix: indent, number: parseInt(numMatch[1]) };
    }
    // Plain text
    return { type: 'plain', content: trimmed, prefix: indent };
  }, []);

  // Check if a line contains structural markers that must never be modified
  const isStructuralLine = useCallback((lineText) => {
    const trimmed = lineText.trim();
    if (!trimmed) return true; // Skip empty lines
    return (
      /^SLIDE\s*#/i.test(trimmed) ||
      /^═{5,}/.test(trimmed) ||
      /^▸\s*[A-Z]/i.test(trimmed) ||
      /^```/.test(trimmed) ||
      /^\[Image/i.test(trimmed) ||
      /^\[Video/i.test(trimmed) ||
      /^\[Icon/i.test(trimmed) ||
      /^\[Infograph/i.test(trimmed) ||
      /^\[Timeline/i.test(trimmed)
    );
  }, []);

  // ── Toolbar Action: Toggle Bold ──
  // Wraps/unwraps selected text with **...** in the underlying markdown.
  // Works in both text view (using textarea selection) and visualizer view (using window.getSelection).
  const handleToggleBold = useCallback(() => {
    const content = activeTab?.content || '';

    if (viewMode === 'text') {
      // Text view: use textarea selection positions directly
      const textarea = textareaRef.current;
      if (!textarea) return;
      const selStart = textarea.selectionStart;
      const selEnd = textarea.selectionEnd;
      if (selStart === selEnd) return; // No selection
      const selectedText = content.substring(selStart, selEnd);
      if (!selectedText.trim()) return;

      pushTextUndo(content);

      // Check if selection is already wrapped in **
      const before2 = content.substring(Math.max(0, selStart - 2), selStart);
      const after2 = content.substring(selEnd, selEnd + 2);
      let newContent;
      let newSelStart, newSelEnd;

      if (before2 === '**' && after2 === '**') {
        // Unbold: remove surrounding ** markers
        newContent = content.substring(0, selStart - 2) + selectedText + content.substring(selEnd + 2);
        newSelStart = selStart - 2;
        newSelEnd = selEnd - 2;
      } else {
        // Bold: wrap selection with **
        newContent = content.substring(0, selStart) + `**${selectedText}**` + content.substring(selEnd);
        newSelStart = selStart + 2;
        newSelEnd = selEnd + 2;
      }

      updateTabContent(newContent);
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(newSelStart, newSelEnd);
      }, 0);
    } else {
      // Visualizer view: use window.getSelection to find text, then map to markdown
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      const selectedText = selection.toString();
      if (!selectedText.trim()) return;

      pushTextUndo(content);

      const boldPattern = `**${selectedText}**`;
      // Check if already bold
      const boldIdx = content.indexOf(boldPattern);
      if (boldIdx >= 0) {
        const newContent = content.substring(0, boldIdx) + selectedText + content.substring(boldIdx + boldPattern.length);
        updateTabContent(newContent);
      } else {
        // Search within copy content first, then full content
        const bounds = getCopyContentBounds(content);
        let searchStart = bounds ? bounds.start : 0;
        const textIdx = content.indexOf(selectedText, searchStart);
        if (textIdx >= 0) {
          const before = content.substring(Math.max(0, textIdx - 2), textIdx);
          const after = content.substring(textIdx + selectedText.length, textIdx + selectedText.length + 2);
          if (before === '**' && after === '**') {
            const newContent = content.substring(0, textIdx - 2) + selectedText + content.substring(textIdx + selectedText.length + 2);
            updateTabContent(newContent);
          } else {
            const newContent = content.substring(0, textIdx) + `**${selectedText}**` + content.substring(textIdx + selectedText.length);
            updateTabContent(newContent);
          }
        } else {
          const fullIdx = content.indexOf(selectedText);
          if (fullIdx >= 0) {
            const before = content.substring(Math.max(0, fullIdx - 2), fullIdx);
            const after = content.substring(fullIdx + selectedText.length, fullIdx + selectedText.length + 2);
            if (before === '**' && after === '**') {
              const newContent = content.substring(0, fullIdx - 2) + selectedText + content.substring(fullIdx + selectedText.length + 2);
              updateTabContent(newContent);
            } else {
              const newContent = content.substring(0, fullIdx) + `**${selectedText}**` + content.substring(fullIdx + selectedText.length);
              updateTabContent(newContent);
            }
          }
        }
      }
    }
  }, [activeTab, viewMode, pushTextUndo, updateTabContent, getCopyContentBounds]);

  // ── Toolbar Action: Toggle Bullet Point ──
  // Works in both text view and visualizer view.
  const handleToggleBullet = useCallback(() => {
    const content = activeTab?.content || '';
    let selStart, selEnd;

    if (viewMode === 'text') {
      const textarea = textareaRef.current;
      if (!textarea) return;
      selStart = textarea.selectionStart;
      selEnd = textarea.selectionEnd;
    } else {
      // Visualizer: map selection to markdown position
      const selection = window.getSelection();
      const selectedText = selection ? selection.toString() : '';
      const bounds = getCopyContentBounds(content);
      if (!bounds) return;
      if (selectedText && selectedText.trim()) {
        const copySection = content.substring(bounds.start, bounds.end);
        const idx = copySection.indexOf(selectedText);
        if (idx >= 0) {
          selStart = bounds.start + idx;
          selEnd = selStart + selectedText.length;
        } else {
          selStart = bounds.start;
          selEnd = bounds.start;
        }
      } else {
        return; // No selection in visualizer
      }
    }

    const bounds = getCopyContentBounds(content);
    if (!bounds || selStart < bounds.start || selStart > bounds.end) return;

    pushTextUndo(content);

    const lines = getSelectedLines(content, Math.max(selStart, bounds.start), Math.min(selEnd, bounds.end));
    let offset = 0;
    let newContent = content;
    let newCursorPos = selStart;

    for (const line of lines) {
      const trimmed = line.lineText.trim();
      const adjStart = line.lineStart + offset;
      const adjEnd = line.lineEnd + offset;

      // Allow blank lines — insert bullet on them (skip only true structural lines)
      if (trimmed && isStructuralLine(line.lineText)) continue;

      const fmt = getLineFormat(line.lineText);
      if (fmt.type === 'header') continue; // Don't convert headers

      let replacement;

      if (!trimmed) {
        // Blank line: insert bullet prefix
        replacement = `${fmt.prefix}• `;
        newCursorPos = adjStart + replacement.length;
      } else if (fmt.type === 'bullet') {
        // Toggle off: remove bullet prefix
        replacement = `${fmt.prefix}${fmt.content}`;
        newCursorPos = adjStart + replacement.length;
      } else if (fmt.type === 'numbered') {
        // Switch: numbered → bullet
        replacement = `${fmt.prefix}• ${fmt.content}`;
      } else {
        // Add bullet
        replacement = `${fmt.prefix}• ${fmt.content}`;
      }

      newContent = newContent.substring(0, adjStart) + replacement + newContent.substring(adjEnd);
      offset += replacement.length - (adjEnd - adjStart);
    }

    if (newContent !== content) {
      updateTabContent(newContent);
      if (viewMode === 'text') {
        const textarea = textareaRef.current;
        if (textarea) {
          setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(newCursorPos + offset, newCursorPos + offset);
          }, 0);
        }
      }
    }
  }, [activeTab, viewMode, pushTextUndo, updateTabContent, getCopyContentBounds, getSelectedLines, getLineFormat, isStructuralLine]);

  // ── Toolbar Action: Toggle Numbered List ──
  // Works in both text view and visualizer view.
  const handleToggleNumbered = useCallback(() => {
    const content = activeTab?.content || '';
    let selStart, selEnd;

    if (viewMode === 'text') {
      const textarea = textareaRef.current;
      if (!textarea) return;
      selStart = textarea.selectionStart;
      selEnd = textarea.selectionEnd;
    } else {
      // Visualizer: map selection to markdown position
      const selection = window.getSelection();
      const selectedText = selection ? selection.toString() : '';
      const bounds = getCopyContentBounds(content);
      if (!bounds) return;
      if (selectedText && selectedText.trim()) {
        const copySection = content.substring(bounds.start, bounds.end);
        const idx = copySection.indexOf(selectedText);
        if (idx >= 0) {
          selStart = bounds.start + idx;
          selEnd = selStart + selectedText.length;
        } else {
          return;
        }
      } else {
        return;
      }
    }

    const bounds = getCopyContentBounds(content);
    if (!bounds || selStart < bounds.start || selStart > bounds.end) return;

    pushTextUndo(content);

    const lines = getSelectedLines(content, Math.max(selStart, bounds.start), Math.min(selEnd, bounds.end));

    // Check if ALL qualifying lines are already numbered (determines toggle direction)
    // Treat blank lines as non-numbered for toggle direction
    const qualifyingLines = lines.filter(l => {
      const trimmed = l.lineText.trim();
      if (!trimmed) return true; // blank lines count as qualifying
      if (isStructuralLine(l.lineText)) return false;
      return getLineFormat(l.lineText).type !== 'header';
    });
    const allNumbered = qualifyingLines.length > 0 && qualifyingLines.every(l => {
      const trimmed = l.lineText.trim();
      if (!trimmed) return false; // blank lines aren't numbered
      return getLineFormat(l.lineText).type === 'numbered';
    });

    let offset = 0;
    let newContent = content;
    let newCursorPos = selStart;

    // Determine starting counter by checking lines above the selection for existing numbered list
    let counter = 1;
    if (!allNumbered && lines.length > 0) {
      const firstLineStart = lines[0].lineStart;
      // Walk backwards from the line above to find a numbered line
      let checkPos = firstLineStart - 1;
      while (checkPos > 0) {
        const lineStart = content.lastIndexOf('\n', checkPos - 1) + 1;
        const prevLineText = content.substring(lineStart, checkPos);
        const prevTrimmed = prevLineText.trim();
        if (!prevTrimmed) { checkPos = lineStart - 1; continue; } // skip blank lines
        const prevFmt = getLineFormat(prevLineText);
        if (prevFmt.type === 'numbered') {
          counter = prevFmt.number + 1;
        }
        break; // Only check the immediate non-blank line above
      }
    }

    for (const line of lines) {
      const trimmed = line.lineText.trim();
      const adjStart = line.lineStart + offset;
      const adjEnd = line.lineEnd + offset;

      // Allow blank lines — insert number on them (skip only true structural lines)
      if (trimmed && isStructuralLine(line.lineText)) continue;

      const fmt = getLineFormat(line.lineText);
      if (fmt.type === 'header') continue;

      let replacement;

      if (!trimmed) {
        // Blank line: insert numbered prefix
        if (!allNumbered) {
          replacement = `${fmt.prefix}${counter}. `;
          counter++;
          newCursorPos = adjStart + replacement.length;
        } else {
          continue; // Toggling off but line is blank, skip
        }
      } else if (allNumbered) {
        // Toggle off: remove numbered prefix
        replacement = `${fmt.prefix}${fmt.content}`;
        newCursorPos = adjStart + replacement.length;
      } else {
        // Convert to numbered
        replacement = `${fmt.prefix}${counter}. ${fmt.content}`;
        counter++;
      }

      newContent = newContent.substring(0, adjStart) + replacement + newContent.substring(adjEnd);
      offset += replacement.length - (adjEnd - adjStart);
    }

    if (newContent !== content) {
      updateTabContent(newContent);
      if (viewMode === 'text') {
        const textarea = textareaRef.current;
        if (textarea) {
          setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(newCursorPos + offset, newCursorPos + offset);
          }, 0);
        }
      }
    }
  }, [activeTab, viewMode, pushTextUndo, updateTabContent, getCopyContentBounds, getSelectedLines, getLineFormat, isStructuralLine]);

  // Execute clipboard action from context menu
  const handleClipboardAction = useCallback((action) => {
    const content = activeTab?.content || '';
    const textarea = textareaRef.current;
    
    if (action === 'copy') {
      if (contextMenu.selectedText) {
        setClipboardContent(contextMenu.selectedText);
        try { navigator.clipboard.writeText(contextMenu.selectedText); } catch(e) {}
      }
      closeContextMenu();
    } else if (action === 'cut') {
      if (contextMenu.selectedText) {
        setClipboardContent(contextMenu.selectedText);
        try { navigator.clipboard.writeText(contextMenu.selectedText); } catch(e) {}
        pushTextUndo(content);
        const newContent = content.substring(0, contextMenu.selStart) + content.substring(contextMenu.selEnd);
        updateTabContent(newContent);
      }
      closeContextMenu();
    } else if (action === 'paste') {
      closeContextMenu();
      if (clipboardContent) {
        pushTextUndo(content);
        // Use cursor position from textarea if no selection range from context menu
        const selStart = contextMenu.selStart;
        const selEnd = contextMenu.selEnd;
        const newContent = content.substring(0, selStart) + clipboardContent + content.substring(selEnd);
        updateTabContent(newContent);
        // Position cursor after pasted text
        if (textarea) {
          setTimeout(() => {
            const newPos = selStart + clipboardContent.length;
            textarea.selectionStart = newPos;
            textarea.selectionEnd = newPos;
            textarea.focus();
          }, 0);
        }
      }
    } else if (action === 'undo') {
      closeContextMenu();
      handleTextUndo();
    } else if (action === 'redo') {
      closeContextMenu();
      handleTextRedo();
    }
    
    if (textarea) textarea.focus();
  }, [contextMenu, activeTab, clipboardContent, updateTabContent, closeContextMenu, pushTextUndo, handleTextUndo, handleTextRedo]);

  // Keyboard shortcuts handler for textarea
  const handleTextareaKeyDown = useCallback((e) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const content = activeTab?.content || '';
    const isMod = e.ctrlKey || e.metaKey;

    // ENTER key — continue numbered list on new line
    if (e.key === 'Enter' && !isMod && !e.shiftKey) {
      const cursorPos = textarea.selectionStart;
      // Find the current line
      const lineStart = content.lastIndexOf('\n', cursorPos - 1) + 1;
      const currentLine = content.substring(lineStart, cursorPos);
      const numMatch = currentLine.match(/^(\s*)(\d+)[.)]\s/);
      if (numMatch) {
        const indent = numMatch[1];
        const currentNum = parseInt(numMatch[2]);
        // Check if the current line has actual content after the number prefix
        const afterPrefix = currentLine.substring(numMatch[0].length).trim();
        if (afterPrefix) {
          // Line has content — continue the numbered list
          e.preventDefault();
          const nextNum = currentNum + 1;
          const insertion = `\n${indent}${nextNum}. `;
          pushTextUndo(content);
          const newContent = content.substring(0, cursorPos) + insertion + content.substring(textarea.selectionEnd);
          updateTabContent(newContent);
          setTimeout(() => {
            const newPos = cursorPos + insertion.length;
            textarea.focus();
            textarea.setSelectionRange(newPos, newPos);
          }, 0);
          return;
        }
        // Line is empty after prefix (e.g. user pressed enter on "3. ") — remove the prefix and insert blank line
        // This ends the numbered list, like Google Docs
        e.preventDefault();
        pushTextUndo(content);
        const newContent = content.substring(0, lineStart) + '\n' + content.substring(cursorPos);
        updateTabContent(newContent);
        setTimeout(() => {
          const newPos = lineStart + 1;
          textarea.focus();
          textarea.setSelectionRange(newPos, newPos);
        }, 0);
        return;
      }
      // Also handle bullet continuation
      const bulletMatch = currentLine.match(/^(\s*)[•]\s/);
      if (bulletMatch) {
        const indent = bulletMatch[1];
        const afterPrefix = currentLine.substring(bulletMatch[0].length).trim();
        if (afterPrefix) {
          e.preventDefault();
          const insertion = `\n${indent}• `;
          pushTextUndo(content);
          const newContent = content.substring(0, cursorPos) + insertion + content.substring(textarea.selectionEnd);
          updateTabContent(newContent);
          setTimeout(() => {
            const newPos = cursorPos + insertion.length;
            textarea.focus();
            textarea.setSelectionRange(newPos, newPos);
          }, 0);
          return;
        }
        // Empty bullet — remove it
        e.preventDefault();
        pushTextUndo(content);
        const newContent = content.substring(0, lineStart) + '\n' + content.substring(cursorPos);
        updateTabContent(newContent);
        setTimeout(() => {
          const newPos = lineStart + 1;
          textarea.focus();
          textarea.setSelectionRange(newPos, newPos);
        }, 0);
        return;
      }
    }

    // Ctrl+C / Cmd+C - Copy (also store internally)
    if (isMod && e.key === 'c') {
      const selStart = textarea.selectionStart;
      const selEnd = textarea.selectionEnd;
      const selectedText = textarea.value.substring(selStart, selEnd);
      if (selectedText) {
        setClipboardContent(selectedText);
        // Let native copy also happen (don't preventDefault)
      }
    }
    
    // Ctrl+X / Cmd+X - Cut (also store internally)
    if (isMod && e.key === 'x') {
      const selStart = textarea.selectionStart;
      const selEnd = textarea.selectionEnd;
      const selectedText = textarea.value.substring(selStart, selEnd);
      if (selectedText) {
        setClipboardContent(selectedText);
        pushTextUndo(content);
        // Let native cut also happen
      }
    }
    
    // Ctrl+V / Cmd+V - Paste from internal clipboard
    if (isMod && e.key === 'v') {
      if (clipboardContent) {
        e.preventDefault();
        const selStart = textarea.selectionStart;
        const selEnd = textarea.selectionEnd;
        pushTextUndo(content);
        const newContent = content.substring(0, selStart) + clipboardContent + content.substring(selEnd);
        updateTabContent(newContent);
        setTimeout(() => {
          const newPos = selStart + clipboardContent.length;
          textarea.selectionStart = newPos;
          textarea.selectionEnd = newPos;
        }, 0);
      }
    }
    
    // Ctrl+Z / Cmd+Z - Undo (key is lowercase 'z' without shift)
    if (isMod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      e.preventDefault();
      handleTextUndo();
    }
    
    // Ctrl+Shift+Z / Cmd+Shift+Z or Ctrl+Y - Redo
    if (isMod && (((e.key === 'z' || e.key === 'Z') && e.shiftKey) || e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      handleTextRedo();
    }
  }, [activeTab, clipboardContent, updateTabContent, pushTextUndo, handleTextUndo, handleTextRedo]);

  // Global keyboard handler for Ctrl+Z/Ctrl+Shift+Z — works in BOTH text and visualizer views
  // Only for text edits + rewrites, NOT page regenerations
  useEffect(() => {
    const handler = (e) => {
      if (!activeTab) return;
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;

      // Don't double-handle when textarea is focused (handleTextareaKeyDown handles it)
      if (e.target === textareaRef.current) return;

      // Ctrl+Z / Cmd+Z - Undo
      if ((e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        e.preventDefault();
        handleTextUndo();
      }

      // Ctrl+Shift+Z / Cmd+Shift+Z or Ctrl+Y - Redo
      if (((e.key === 'z' || e.key === 'Z') && e.shiftKey) || e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        handleTextRedo();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [activeTab, handleTextUndo, handleTextRedo]);

  // Arrow key navigation for page tabs — Left/Right arrows switch between open tabs
  useEffect(() => {
    const handler = (e) => {
      // Only handle arrow keys
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      // Don't handle if no tabs are open
      if (openTabs.length === 0) return;
      // Don't handle if user is typing in an input, textarea, or contenteditable
      const tag = e.target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      // Don't handle if modifier keys are held (Ctrl, Alt, Shift, Meta)
      if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;

      // Clear any text selection (e.g. from visualizer userSelect:text) so arrow keys
      // navigate pages instead of moving the text cursor
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();

      const currentIndex = openTabs.findIndex(tab => tab.id === activeTabId);
      if (currentIndex === -1) return;

      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        e.preventDefault();
        setActiveTabId(openTabs[currentIndex - 1].id);
      } else if (e.key === 'ArrowRight' && currentIndex < openTabs.length - 1) {
        e.preventDefault();
        setActiveTabId(openTabs[currentIndex + 1].id);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [openTabs, activeTabId]);

  // Alt key toggle for Full Deck mode
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== 'Alt') return;
      // Don't toggle if user is typing in an input, textarea, or contenteditable
      const tag = e.target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      // Don't toggle if other modifier keys are held
      if (e.ctrlKey || e.shiftKey || e.metaKey) return;
      e.preventDefault();
      setFullDeckMode(prev => !prev);
    };
    document.addEventListener('keyup', handler);
    return () => document.removeEventListener('keyup', handler);
  }, []);

  // Global Enter key — triggers generation when outliner is empty and user is not in a text field
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== 'Enter') return;
      if (history.length > 0) return; // only when outliner is empty
      if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
      const tag = e.target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      if (isGenerating || !hasFileContent) return;

      e.preventDefault();
      if (fullDeckMode) {
        generateFullDeck();
      } else if (pagePrompt && selectedLayout) {
        generatePageOutline();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [history.length, isGenerating, hasFileContent, fullDeckMode, pagePrompt, selectedLayout, generateFullDeck, generatePageOutline]);

  // Save undo checkpoint on textarea change (debounced grouping)
  const handleTextareaChange = useCallback((e) => {
    const newValue = e.target.value;
    // Capture the state before this batch of typing started
    const snapshotBefore = lastSavedContent.current !== null ? lastSavedContent.current : (activeTab?.content || '');

    // Initialize lastSavedContent on first change if not set
    if (lastSavedContent.current === null) {
      lastSavedContent.current = activeTab?.content || '';
    }

    // Debounce: group rapid keystrokes into one undo step
    if (textChangeTimerRef.current) clearTimeout(textChangeTimerRef.current);
    textChangeTimerRef.current = setTimeout(() => {
      // Push the snapshot from before this batch of typing
      if (snapshotBefore !== newValue) {
        pushTextUndo(snapshotBefore);
      }
      lastSavedContent.current = newValue;
    }, 600);

    updateTabContent(newValue);
  }, [activeTab, updateTabContent, pushTextUndo]);

  // AI Rewrite selected text
  const handleRewriteRequest = useCallback(async (mode) => {
    if (!contextMenu.selectedText.trim()) return;
    closeContextMenu();
    setRewritePreview({ visible: true, text: '', mode, isLoading: true });

    try {
      const deckContext = (systemPrompt || '').substring(0, 600);
      const docSnippets = uploadedFiles
        .filter(f => f.type === 'text')
        .slice(0, 2)
        .map(f => f.content.substring(0, 400))
        .join('\n');

      // Build formatting context from surrounding markdown
      const fullContent = activeTab?.content || '';
      const selText = contextMenu.selectedText;
      const selStart = contextMenu.selStart;
      const selEnd = contextMenu.selEnd;

      // Count lines in selected text for strict enforcement
      const selLines = selText.split('\n');
      const lineCount = selLines.length;
      const nonEmptyLineCount = selLines.filter(l => l.trim()).length;

      // Get surrounding context (lines before and after selection) to help AI understand formatting
      const beforeSel = fullContent.substring(Math.max(0, selStart - 200), selStart);
      const afterSel = fullContent.substring(selEnd, Math.min(fullContent.length, selEnd + 200));

      // Detect formatting patterns in the selected text
      const hasBold = /\*\*[^*]+\*\*/.test(selText);
      const hasBullets = /^[\s]*[-•*▸▹►]\s/m.test(selText);
      const hasNumbered = /^[\s]*\d+\.\s/m.test(selText);
      const hasMultiLine = lineCount > 1;
      const hasHeaders = /\*\*[^*]+\*\*\s*\n/.test(selText);

      let formatHint = `\n\nSTRICT LINE COUNT: The input has exactly ${nonEmptyLineCount} non-empty line(s). Your output MUST have exactly ${nonEmptyLineCount} non-empty line(s). Do NOT add extra lines, blank lines, or remove lines.`;
      if (mode === 'extend') {
        formatHint += ' Expand the text WITHIN each existing line — make each line longer and more detailed. Do NOT add new lines or bullet points.';
      } else if (mode === 'shorten') {
        formatHint += ' Condense the text WITHIN each existing line — make each line shorter. Do NOT remove lines.';
      }
      if (hasBold || hasBullets || hasNumbered || hasMultiLine || hasHeaders) {
        formatHint += '\nFORMATTING DETECTED:';
        if (hasBullets) formatHint += ` Bullet points (${nonEmptyLineCount} bullets) — output exactly ${nonEmptyLineCount} bullets, same style.`;
        if (hasBold) formatHint += ' **Bold** markers — keep ** around equivalent words.';
        if (hasNumbered) formatHint += ' Numbered list — keep same numbering style.';
        if (hasHeaders) formatHint += ' Bold section headers — keep exactly as-is.';
      }

      let userContent = `Selected text to rewrite:\n"""${selText}"""${formatHint}`;

      // Add surrounding context so AI understands the formatting environment
      if (beforeSel.trim() || afterSel.trim()) {
        userContent += `\n\nSurrounding markdown context (for formatting reference only, do NOT rewrite this):\nBEFORE: """${beforeSel.trim().slice(-100)}"""\nAFTER: """${afterSel.trim().slice(0, 100)}"""`;
      }

      if (mode === 'extend' && (deckContext || docSnippets)) {
        userContent += `\n\nDeck context: ${deckContext || 'None'}`;
        if (docSnippets) userContent += `\n\nSource document excerpts:\n${docSnippets}`;
      }

      const data = await callAI({
        model: modelFor('dog.rewrite'),
        max_tokens: 1000,
        system: rewritePrompts[mode],
        messages: [{ role: 'user', content: userContent }],
        tool: 'dog',
      });
      const rewrittenText = data.content.map(i => i.text || '').join('').trim();
      setRewritePreview(prev => ({ ...prev, text: rewrittenText, isLoading: false }));
    } catch (err) {
      console.error('Rewrite error:', err);
      setRewritePreview(prev => ({ ...prev, text: `Error: ${err.message}`, isLoading: false }));
    }
  }, [contextMenu, activeTab, systemPrompt, uploadedFiles, closeContextMenu]);

  // Redo rewrite with same mode
  const handleRewriteRedo = useCallback(() => {
    if (!rewritePreview.mode) return;
    setRewritePreview(prev => ({ ...prev, isLoading: true, text: '' }));

    const mode = rewritePreview.mode;
    const selectedText = contextMenu.selectedText;

    (async () => {
      try {
        const deckContext = (systemPrompt || '').substring(0, 600);
        const docSnippets = uploadedFiles
          .filter(f => f.type === 'text')
          .slice(0, 2)
          .map(f => f.content.substring(0, 400))
          .join('\n');

        // Build formatting context from surrounding markdown
        const fullContent = activeTab?.content || '';
        const selStart = contextMenu.selStart;
        const selEnd = contextMenu.selEnd;

        // Count lines for strict enforcement
        const selLines = selectedText.split('\n');
        const lineCount = selLines.length;
        const nonEmptyLineCount = selLines.filter(l => l.trim()).length;

        const beforeSel = fullContent.substring(Math.max(0, selStart - 200), selStart);
        const afterSel = fullContent.substring(selEnd, Math.min(fullContent.length, selEnd + 200));

        // Detect formatting patterns
        const hasBold = /\*\*[^*]+\*\*/.test(selectedText);
        const hasBullets = /^[\s]*[-•*▸▹►]\s/m.test(selectedText);
        const hasNumbered = /^[\s]*\d+\.\s/m.test(selectedText);
        const hasMultiLine = lineCount > 1;
        const hasHeaders = /\*\*[^*]+\*\*\s*\n/.test(selectedText);

        let formatHint = `\n\nSTRICT LINE COUNT: The input has exactly ${nonEmptyLineCount} non-empty line(s). Your output MUST have exactly ${nonEmptyLineCount} non-empty line(s). Do NOT add extra lines, blank lines, or remove lines.`;
        if (mode === 'extend') {
          formatHint += ' Expand the text WITHIN each existing line — make each line longer and more detailed. Do NOT add new lines or bullet points.';
        } else if (mode === 'shorten') {
          formatHint += ' Condense the text WITHIN each existing line — make each line shorter. Do NOT remove lines.';
        }
        if (hasBold || hasBullets || hasNumbered || hasMultiLine || hasHeaders) {
          formatHint += '\nFORMATTING DETECTED:';
          if (hasBullets) formatHint += ` Bullet points (${nonEmptyLineCount} bullets) — output exactly ${nonEmptyLineCount} bullets, same style.`;
          if (hasBold) formatHint += ' **Bold** markers — keep ** around equivalent words.';
          if (hasNumbered) formatHint += ' Numbered list — keep same numbering style.';
          if (hasHeaders) formatHint += ' Bold section headers — keep exactly as-is.';
        }

        let userContent = `Selected text to rewrite:\n"""${selectedText}"""${formatHint}`;

        if (beforeSel.trim() || afterSel.trim()) {
          userContent += `\n\nSurrounding markdown context (for formatting reference only, do NOT rewrite this):\nBEFORE: """${beforeSel.trim().slice(-100)}"""\nAFTER: """${afterSel.trim().slice(0, 100)}"""`;
        }

        if (mode === 'extend' && (deckContext || docSnippets)) {
          userContent += `\n\nDeck context: ${deckContext || 'None'}`;
          if (docSnippets) userContent += `\n\nSource document excerpts:\n${docSnippets}`;
        }

        const data = await callAI({
          model: modelFor('dog.rewriteRedo'),
          max_tokens: 1000,
          system: rewritePrompts[mode],
          messages: [{ role: 'user', content: userContent }],
          tool: 'dog',
        });
        const rewrittenText = data.content.map(i => i.text || '').join('').trim();
        setRewritePreview(prev => ({ ...prev, text: rewrittenText, isLoading: false }));
      } catch (err) {
        setRewritePreview(prev => ({ ...prev, text: `Error: ${err.message}`, isLoading: false }));
      }
    })();
  }, [rewritePreview.mode, contextMenu, activeTab, systemPrompt, uploadedFiles]);

  // Replace selected text with rewrite - preserve formatting, bullets, bold, line breaks
  const handleRewriteReplace = useCallback(() => {
    if (!rewritePreview.text || rewritePreview.isLoading) return;
    const content = activeTab?.content || '';
    const before = content.substring(0, contextMenu.selStart);
    const after = content.substring(contextMenu.selEnd);
    const originalSelected = content.substring(contextMenu.selStart, contextMenu.selEnd);
    let replacement = rewritePreview.text;

    const bulletRegex = /^(\s*(?:[-•*▸▹►]\s+|\d+\.\s+))/;

    const originalLines = originalSelected.split('\n');

    // --- Step 0: Preserve --- column separator ---
    // If original had a --- line, ensure replacement keeps it in the same relative position
    const isSep = l => /^\s*---\s*$/.test(l);
    const origHasSeparator = originalLines.some(isSep);
    const repHasSeparator = replacement.split('\n').some(isSep);
    const origSepIndex = originalLines.findIndex(isSep);

    // --- Step 1: Strip extra blank lines the AI might have added ---
    let replacementLines = replacement.split('\n');

    // Filter out blank lines that the AI added (if original had no blank lines between content)
    const origHasBlankLines = originalLines.some((l, i) => i > 0 && i < originalLines.length - 1 && l.trim() === '' && !isSep(l));
    if (!origHasBlankLines) {
      // Original had no blank lines between content — strip any blank lines from replacement (keep --- separators)
      replacementLines = replacementLines.filter(l => l.trim() !== '' || isSep(l));
    }

    // If original had --- but replacement lost it, re-insert it
    if (origHasSeparator && !repHasSeparator && origSepIndex >= 0) {
      // Insert --- at the same relative position
      const insertAt = Math.min(origSepIndex, replacementLines.length);
      replacementLines.splice(insertAt, 0, '---');
    }

    // --- Step 2: Enforce line count (all modes) ---
    // Count non-empty, non-separator lines
    const origNonEmpty = originalLines.filter(l => l.trim() !== '' && !isSep(l));
    const repNonEmpty = replacementLines.filter(l => l.trim() !== '' && !isSep(l));

    if (origNonEmpty.length > 0 && repNonEmpty.length > origNonEmpty.length) {
      // AI added extra content lines — trim to match original count
      let kept = 0;
      replacementLines = replacementLines.filter(l => {
        if (l.trim() === '' || isSep(l)) return true; // keep blank lines and separators
        if (kept < origNonEmpty.length) { kept++; return true; }
        return false;
      });
    }

    replacement = replacementLines.join('\n');

    // --- Step 3: Multi-line bullet prefix preservation ---
    if (originalLines.length > 1 && replacementLines.length > 1) {
      const finalLines = replacementLines.map((repLine, i) => {
        const origLine = i < originalLines.length ? originalLines[i] : originalLines[originalLines.length - 1];
        const origBulletMatch = origLine.match(bulletRegex);
        const repBulletMatch = repLine.match(bulletRegex);
        if (origBulletMatch && !repBulletMatch && repLine.trim()) {
          return origBulletMatch[1] + repLine.trimStart();
        } else if (origBulletMatch && repBulletMatch && origBulletMatch[1] !== repBulletMatch[1]) {
          return origBulletMatch[1] + repLine.substring(repBulletMatch[1].length);
        }
        return repLine;
      });
      replacement = finalLines.join('\n');
    } else {
      // Single-line bullet fix
      const bulletMatch = originalSelected.match(bulletRegex);
      const originalPrefix = bulletMatch ? bulletMatch[1] : '';
      const replacementBulletMatch = replacement.match(bulletRegex);
      const replacementPrefix = replacementBulletMatch ? replacementBulletMatch[1] : '';

      const beforeLineStart = before.lastIndexOf('\n') + 1;
      const beforeLineContent = before.substring(beforeLineStart);
      const beforeHasBullet = bulletRegex.test(beforeLineContent);

      if (originalPrefix && !replacementPrefix) {
        replacement = originalPrefix + replacement.trimStart();
      } else if (originalPrefix && replacementPrefix && originalPrefix !== replacementPrefix) {
        replacement = originalPrefix + replacement.substring(replacementPrefix.length);
      } else if (!originalPrefix && replacementPrefix && beforeHasBullet) {
        replacement = replacement.substring(replacementPrefix.length);
      }
    }

    // --- Step 4: Bold header preservation ---
    const origBoldHeaders = [...originalSelected.matchAll(/\*\*([^*]+)\*\*/g)].map(m => m[1]);
    if (origBoldHeaders.length > 0) {
      for (const header of origBoldHeaders) {
        const plainIdx = replacement.indexOf(header);
        const boldIdx = replacement.indexOf(`**${header}**`);
        if (plainIdx >= 0 && boldIdx < 0) {
          replacement = replacement.replace(header, `**${header}**`);
        }
      }
    }

    // --- Step 5: Preserve leading/trailing newlines from original ---
    const leadingNewlines = originalSelected.match(/^\n*/)[0];
    const trailingNewlines = originalSelected.match(/\n*$/)[0];

    if (leadingNewlines && !replacement.startsWith('\n')) {
      replacement = leadingNewlines + replacement.replace(/^\n+/, '');
    }
    if (trailingNewlines && !replacement.endsWith('\n')) {
      replacement = replacement.replace(/\n+$/, '') + trailingNewlines;
    }

    pushTextUndo(content);
    const newContent = before + replacement + after;
    updateTabContent(newContent);
    setRewritePreview({ visible: false, text: '', mode: '', isLoading: false });
  }, [rewritePreview, contextMenu, activeTab, updateTabContent, pushTextUndo]);

  // Cancel rewrite
  const handleRewriteCancel = useCallback(() => {
    setRewritePreview({ visible: false, text: '', mode: '', isLoading: false });
  }, []);

  const clearHistory = useCallback(() => {
    // Save current state to undo stack before clearing
    setHistoryUndoStack(prev => [...prev, { type: 'clear', items: history, tabs: openTabs, activeId: activeTabId }]);
    setHistoryRedoStack([]);
    setHistory([]);
    setOpenTabs([]);
    setActiveTabId(null);
    setDeckThemeColors(null);
    setThemeIndex(0);
  }, [history, openTabs, activeTabId]);

  const removeHistoryItem = useCallback((itemId, e) => {
    e.stopPropagation();
    // Save removed item to undo stack
    const removedItem = history.find(item => item.id === itemId);
    if (removedItem) {
      setHistoryUndoStack(prev => [...prev, { type: 'remove', items: [removedItem], tabs: openTabs, activeId: activeTabId }]);
      setHistoryRedoStack([]);
    }
    setHistory(prev => prev.filter(item => item.id !== itemId));
    setOpenTabs(prev => {
      const newTabs = prev.filter(t => t.id !== itemId);
      if (activeTabId === itemId && newTabs.length > 0) {
        setActiveTabId(newTabs[0].id);
      } else if (newTabs.length === 0) {
        setActiveTabId(null);
      }
      return newTabs;
    });
  }, [activeTabId, history, openTabs]);

  const undoHistoryDelete = useCallback(() => {
    if (historyUndoStack.length === 0) return;
    const lastAction = historyUndoStack[historyUndoStack.length - 1];
    setHistoryUndoStack(prev => prev.slice(0, -1));
    
    if (lastAction.type === 'clear') {
      // Push current (empty) state to redo
      setHistoryRedoStack(prev => [...prev, { type: 'clear', items: history, tabs: openTabs, activeId: activeTabId }]);
      setHistory(lastAction.items);
      setOpenTabs(lastAction.tabs);
      setActiveTabId(lastAction.activeId);
    } else if (lastAction.type === 'remove') {
      setHistoryRedoStack(prev => [...prev, { type: 'remove', items: lastAction.items, tabs: openTabs, activeId: activeTabId }]);
      setHistory(prev => [...prev, ...lastAction.items]);
    }
  }, [historyUndoStack, history, openTabs, activeTabId]);

  const redoHistoryDelete = useCallback(() => {
    if (historyRedoStack.length === 0) return;
    const lastAction = historyRedoStack[historyRedoStack.length - 1];
    setHistoryRedoStack(prev => prev.slice(0, -1));
    
    if (lastAction.type === 'clear') {
      setHistoryUndoStack(prev => [...prev, { type: 'clear', items: history, tabs: openTabs, activeId: activeTabId }]);
      setHistory(lastAction.items);
      setOpenTabs(lastAction.tabs);
      setActiveTabId(lastAction.activeId);
    } else if (lastAction.type === 'remove') {
      const removeIds = lastAction.items.map(i => i.id);
      setHistoryUndoStack(prev => [...prev, { type: 'remove', items: lastAction.items, tabs: openTabs, activeId: activeTabId }]);
      setHistory(prev => prev.filter(item => !removeIds.includes(item.id)));
      setOpenTabs(prev => prev.filter(t => !removeIds.includes(t.id)));
    }
  }, [historyRedoStack, history, openTabs, activeTabId]);

  const handleHistoryImport = useCallback((newHistory) => {
    setHistory(prev => [...prev, ...newHistory]);
  }, []);

  // ─── Image Prompt Generation (triggered ONLY at export) ───
  const generateImagePrompts = useCallback(async (historyToExport, customDeckTitle) => {
    setIsGeneratingImgPrompts(true);
    setImgPromptError('');

    try {
      // 1. Sort history by page number
      const sortedHistory = [...historyToExport].sort((a, b) => {
        const numA = parseInt(a.pageNum) || 999;
        const numB = parseInt(b.pageNum) || 999;
        return numA - numB;
      });

      // 2. Extract all visual assets from all slides
      const allAssets = [];
      sortedHistory.forEach(item => {
        const parsed = parseSlideContent(item.output || item.content || '');
        if (parsed.requiredAssets) {
          const assetLines = parsed.requiredAssets.split('\n').filter(l => l.trim().startsWith('•'));
          assetLines.forEach(line => {
            const assetMatch = line.match(/•\s*\[([^\]]+)\]\s*-\s*(.+)/);
            if (assetMatch) {
              const typeAndRatio = assetMatch[1].trim();
              const description = assetMatch[2].trim();
              const ratioParts = typeAndRatio.split('|').map(s => s.trim());
              const assetType = ratioParts[0];
              const ratio = ratioParts[1] || 'N/A';
              allAssets.push({
                slideNum: item.pageNum,
                layoutName: parsed.layoutType || item.layout || '',
                assetType,
                ratio,
                description
              });
            }
          });
        }
      });

      // Filter out Icon/Logo assets — these are existing assets, not generated images
      let filteredAssets = allAssets.filter(asset => {
        const typeLower = asset.assetType.toLowerCase();
        return !typeLower.includes('icon') && !typeLower.includes('logo');
      });

      // Filter out assets that have <<filename>> markers (placed from uploaded/project files)
      if (assetPlacementActive) {
        filteredAssets = filteredAssets.filter(asset => !(/<<.+?>>/.test(asset.description)));
      }

      if (filteredAssets.length === 0) {
        const msg = assetPlacementActive
          ? 'All visual assets have been covered by placed uploads — no image prompts needed.'
          : 'No visual assets found in the deck outline (logo/icon assets are skipped).';
        setImgPromptError(msg);
        setIsGeneratingImgPrompts(false);
        return null;
      }

      // 3. Build the user message
      const MODEL_DISPLAY_NAMES = {
        midjourney: 'Midjourney',
        flux: 'Flux',
        nanobanana: 'Nano Banana',
        chatgpt: 'Chat GPT / DALL-E 3'
      };

      const modelName = MODEL_DISPLAY_NAMES[imgPromptModel] || imgPromptModel;

      const assetsText = filteredAssets.map(a =>
        `SLIDE #${a.slideNum} — ${a.layoutName}\n  Asset Type: ${a.assetType}\n  Aspect Ratio: ${a.ratio}\n  Description: ${a.description}`
      ).join('\n\n');

      const userMessage = `TARGET IMAGE GENERATION MODEL: ${modelName}

DECK VISUAL LANGUAGE:
${deckVisualDesc || 'No visual description available. Use professional, clean presentation style.'}

${systemPrompt ? `DECK CONTEXT & GUIDELINES:\n${systemPrompt}\n\n` : ''}ALL VISUAL ASSETS TO GENERATE PROMPTS FOR:
${assetsText}

Generate an optimized ${modelName} prompt for each asset listed above. Follow your output format exactly: SLIDE #[number] | [Asset Title] | [Aspect Ratio] | [Prompt Text]`;

      // 4. Build combined system prompt
      const modelPromptMap = {
        midjourney: imgPromptMidjourneySystem,
        flux: imgPromptFluxSystem,
        nanobanana: imgPromptNanoBananaSystem,
        chatgpt: imgPromptChatGPTSystem
      };
      const modelSpecificPrompt = modelPromptMap[imgPromptModel] || '';
      const combinedSystem = `${imgPromptApiSystem}\n\n${modelSpecificPrompt}\n\n${imgPromptSharedSystem}`;

      // 5. API call
      const data = await callAI({
        model: modelFor('dog.imagePrompts'),
        max_tokens: 8192,
        system: combinedSystem,
        messages: [{ role: 'user', content: userMessage }],
        tool: 'dog',
      });
      const rawOutput = data.content.map(i => i.text || '').join('').trim();

      // 6. Parse output lines
      const promptLines = rawOutput.split('\n').filter(l => l.trim().startsWith('SLIDE #'));

      // 7. Build markdown file content
      const exportFileName = uploadedFiles.length > 0 ? uploadedFiles[0].file.name : null;
      const deckTitle = customDeckTitle || deriveDeckTitle(exportFileName, historyToExport);

      let mdContent = `DECK IMAGE PROMPTS — ${modelName}\n═══════════════════════════════════════════════════════════════\n▸ DECK VISUAL LANGUAGE: ${deckVisualDesc || 'N/A'}\n═══════════════════════════════════════════════════════════════\n\n`;

      // Group prompts by slide and format
      let currentSlide = '';
      promptLines.forEach(line => {
        const parts = line.split('|').map(s => s.trim());
        if (parts.length >= 4) {
          const slideRef = parts[0]; // "SLIDE #1"
          const assetTitle = parts[1];
          const ratio = parts[2];
          const prompt = parts.slice(3).join('|').trim();

          const slideNumMatch = slideRef.match(/SLIDE\s*#(\d+)/);
          const slideNum = slideNumMatch ? slideNumMatch[1] : '?';

          // Find layout name from history
          const slideItem = sortedHistory.find(h => h.pageNum === slideNum);
          const layoutName = slideItem ? (parseSlideContent(slideItem.output || slideItem.content || '').layoutType || slideItem.layout || '') : '';

          const slideHeader = `SLIDE #${slideNum} — ${layoutName}`;
          if (slideHeader !== currentSlide) {
            if (currentSlide) mdContent += '\n';
            mdContent += `${slideHeader}\n───────────────────────────────────────────────────────────────\n`;
            currentSlide = slideHeader;
          }

          mdContent += `▸ ASSET TITLE: ${assetTitle}\n▸ ASPECT RATIO: ${ratio}\n▸ PROMPT: ${prompt}\n───────────────────────────────────────────────────────────────\n`;
        }
      });

      // 8. Download the file
      const filename = `${deckTitle}_IMG_PROMPTS.md`;
      const blob = new Blob([mdContent], { type: 'text/markdown' });
      await saveFileToFolder(exportDirHandle, filename, blob);

      return mdContent;
    } catch (err) {
      console.error('Image prompt generation error:', err);
      setImgPromptError(`Failed to generate image prompts: ${err.message}`);
      return null;
    } finally {
      setIsGeneratingImgPrompts(false);
    }
  }, [systemPrompt, deckVisualDesc, imgPromptModel, imgPromptSharedSystem, imgPromptMidjourneySystem, imgPromptFluxSystem, imgPromptNanoBananaSystem, imgPromptChatGPTSystem, imgPromptApiSystem, uploadedFiles, assetPlacementActive, exportDirHandle]);

  // Export folder picker
  const pickExportFolder = useCallback(async () => {
    try {
      if (!window.showDirectoryPicker) {
        console.warn('[WILSON] File System Access API not supported');
        return;
      }
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      setExportDirHandle(handle);
      setExportFolderPath(handle.name);
      try { localStorage.setItem('wilson-export-folder-path', handle.name); } catch {}
    } catch (err) {
      // User cancelled the picker — do nothing
      if (err.name !== 'AbortError') {
        console.error('[WILSON] Folder picker error:', err);
      }
    }
  }, []);

  const clearExportFolder = useCallback(() => {
    setExportDirHandle(null);
    setExportFolderPath('');
    try { localStorage.removeItem('wilson-export-folder-path'); } catch {}
  }, []);

  // Duplicate resolver handlers
  const handleExportWithResolver = useCallback((duplicates, customTitle) => {
    setDuplicatesToResolve(duplicates);
    setCurrentDuplicateIndex(0);
    setResolvedSelections({});
    setPendingVisExport(false);
    setPendingCustomDeckTitle(customTitle || null);
    setShowDuplicateResolver(true);
  }, []);

  const handleExportVisWithResolver = useCallback((duplicates, customTitle) => {
    setDuplicatesToResolve(duplicates);
    setCurrentDuplicateIndex(0);
    setResolvedSelections({});
    setPendingVisExport(true);
    setPendingCustomDeckTitle(customTitle || null);
    setShowDuplicateResolver(true);
  }, []);

  const handleDuplicateSelect = useCallback((selectedId) => {
    const currentDuplicate = duplicatesToResolve[currentDuplicateIndex];
    
    // Store the selection
    const newSelections = {
      ...resolvedSelections,
      [currentDuplicate.pageNum]: selectedId
    };
    setResolvedSelections(newSelections);
    
    // Move to next duplicate or finish
    if (currentDuplicateIndex < duplicatesToResolve.length - 1) {
      setCurrentDuplicateIndex(currentDuplicateIndex + 1);
    } else {
      // All resolved - perform export
      setShowDuplicateResolver(false);
      
      // Build final history with resolved selections
      const finalHistory = history.filter(item => {
        const isDuplicate = duplicatesToResolve.some(d => d.pageNum === item.pageNum);
        if (isDuplicate) {
          return newSelections[item.pageNum] === item.id;
        }
        return true;
      });
      
      // Export the resolved history — use deckThemeColors (the actual visualizer colors) for the selected theme
      const uploadedFileName = uploadedFiles.length > 0 ? uploadedFiles[0].file.name : null;
      if (pendingVisExport) {
        const themeEntry = allThemes[themeIndex] || PRESET_THEMES[0];
        const selectedTheme = { name: themeEntry.name, colors: ensureContrast(deckThemeColors || themeEntry.colors) };
        exportVisHistory(finalHistory, uploadedFileName, selectedTheme, allThemes, themeIndex, deckVisualDesc, exportDirHandle, pendingCustomDeckTitle);
      } else {
        exportHistory(finalHistory, uploadedFileName, exportDirHandle, pendingCustomDeckTitle);
      }

      // Trigger image prompt generation if enabled
      if (enableImgPromptExport) {
        generateImagePrompts(finalHistory, pendingCustomDeckTitle);
      }

      setPendingVisExport(false);
      setPendingCustomDeckTitle(null);
    }
  }, [duplicatesToResolve, currentDuplicateIndex, resolvedSelections, history, uploadedFiles, pendingVisExport, pendingCustomDeckTitle, allThemes, themeIndex, deckThemeColors, deckVisualDesc, enableImgPromptExport, generateImagePrompts, exportDirHandle]);

  const handleDuplicateCancel = useCallback(() => {
    setShowDuplicateResolver(false);
    setDuplicatesToResolve([]);
    setCurrentDuplicateIndex(0);
    setResolvedSelections({});
    setPendingVisExport(false);
    setPendingCustomDeckTitle(null);
  }, []);

  const handleExportAll = useCallback(() => {
    // Export all history items including duplicates
    setShowDuplicateResolver(false);
    setDuplicatesToResolve([]);
    setCurrentDuplicateIndex(0);
    setResolvedSelections({});

    const uploadedFileName = uploadedFiles.length > 0 ? uploadedFiles[0].file.name : null;
    if (pendingVisExport) {
      const themeEntry = allThemes[themeIndex] || PRESET_THEMES[0];
      const selectedTheme = { name: themeEntry.name, colors: ensureContrast(deckThemeColors || themeEntry.colors) };
      exportVisHistory(history, uploadedFileName, selectedTheme, allThemes, themeIndex, deckVisualDesc, exportDirHandle, pendingCustomDeckTitle);
    } else {
      exportHistory(history, uploadedFileName, exportDirHandle, pendingCustomDeckTitle);
    }

    // Trigger image prompt generation if enabled
    if (enableImgPromptExport) {
      generateImagePrompts(history, pendingCustomDeckTitle);
    }

    setPendingVisExport(false);
    setPendingCustomDeckTitle(null);
  }, [history, uploadedFiles, pendingVisExport, pendingCustomDeckTitle, allThemes, themeIndex, deckThemeColors, deckVisualDesc, enableImgPromptExport, generateImagePrompts, exportDirHandle]);

  // VIS export handler — use deckThemeColors (the actual visualizer colors) for the selected theme
  const handleExportVis = useCallback((customTitle) => {
    const uploadedFileName = uploadedFiles.length > 0 ? uploadedFiles[0].file.name : null;
    const themeEntry = allThemes[themeIndex] || PRESET_THEMES[0];
    const selectedTheme = { name: themeEntry.name, colors: ensureContrast(deckThemeColors || themeEntry.colors) };
    exportVisHistory(history, uploadedFileName, selectedTheme, allThemes, themeIndex, deckVisualDesc, exportDirHandle, customTitle);
  }, [history, uploadedFiles, allThemes, themeIndex, deckThemeColors, deckVisualDesc, exportDirHandle]);

  // Export placed visual assets as individual file downloads
  const exportVisualAssets = useCallback(async () => {
    if (!assetPlacementActive || history.length === 0) return;

    // Collect all placed assets from history by scanning <<filename>> markers in REQUIRED ASSETS
    const placedFiles = new Map(); // filename → fileData (dedup)
    let counter = 0;
    history.forEach(item => {
      const p = parseSlideContent(item.output || item.content || '');
      // Scan REQUIRED ASSETS for <<filename>> markers
      if (p.requiredAssets) {
        const markerMatches = p.requiredAssets.matchAll(/<<(.+?)>>/g);
        for (const m of markerMatches) {
          const fname = m[1].trim();
          if (placedFiles.has(fname)) continue;
          const fileData = placementAssets.find(f => {
            const name = f.file?.name || '';
            const cleanName = name.replace(/^\[Project\]\s*/, '');
            return cleanName.toLowerCase() === fname.toLowerCase() || name.toLowerCase() === fname.toLowerCase();
          });
          if (fileData) placedFiles.set(fname, fileData);
        }
      }
      // Also check PLACED ASSETS section as fallback
      const placements = parsePlacedAssets(p.placedAssets);
      placements.forEach(pa => {
        if (placedFiles.has(pa.filename)) return;
        const fileData = placementAssets.find(f => {
          const name = f.file?.name || '';
          const cleanName = name.replace(/^\[Project\]\s*/, '');
          return cleanName === pa.filename || name === pa.filename;
        });
        if (fileData) placedFiles.set(pa.filename, fileData);
      });
    });

    if (placedFiles.size === 0) return;

    // Determine project name prefix
    const projName = selectedProject?.title
      ? selectedProject.title.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_').substring(0, 30)
      : 'UPLOAD';

    // Download each file with sequential numbering
    for (const [filename, fileData] of placedFiles) {
      counter++;
      const num = String(counter).padStart(2, '0');
      const ext = filename.split('.').pop() || 'bin';
      const baseName = filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
      const downloadName = `${projName}_VIS_ASSETS_${num}_${baseName}.${ext}`;

      const byteChars = atob(fileData.content);
      const byteNums = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
      const byteArray = new Uint8Array(byteNums);
      const blob = new Blob([byteArray], { type: fileData.mediaType });

      await saveFileToFolder(exportDirHandle, downloadName, blob);
    }
  }, [assetPlacementActive, history, placementAssets, selectedProject, exportDirHandle]);

  // Import themes from VIS_DECKOUTLINE
  const handleImportThemes = useCallback((importedThemes) => {
    if (importedThemes.length > 0) {
      setGeneratedThemes(prev => [...prev, ...importedThemes]);
      // Set first imported theme as active
      const newIndex = PRESET_THEMES.length + generatedThemes.length;
      setThemeIndex(newIndex);
      setDeckThemeColors(importedThemes[0].colors);
      setEnableThemeGen(true);
    }
  }, [generatedThemes]);

  // Generate deck visual description via Haiku
  const generateDeckVisualDesc = useCallback(async () => {
    if (!history.length) return;
    try {
      const titles = history.map(h => h.title).join(', ');
      const context = (systemPrompt || '').substring(0, 400);
      const data = await callAI({
        model: modelFor('dog.visualDesc'),
        max_tokens: 200,
        system: 'Write exactly 3-4 short sentences describing the recommended visual look/style for a presentation deck. Focus on mood, typography, texture, lighting. Use language suitable as a visual generation prompt. No color references. Be concise.',
        messages: [{ role: 'user', content: `Deck context: ${context}\nSlide titles: ${titles}\nDescribe the visual style.` }],
        tool: 'dog',
      });
      const desc = data.content.map(i => i.text || '').join('').trim();
      setDeckVisualDesc(desc);
    } catch (err) {
      console.error('Deck desc generation error:', err);
    }
  }, [history, systemPrompt]);

  // Auto-generate visual desc when enableThemeGen is on and we generate themes for first time
  useEffect(() => {
    if (enableThemeGen && generatedThemes.length > 0 && !deckVisualDesc && history.length > 0) {
      generateDeckVisualDesc();
    }
  }, [enableThemeGen, generatedThemes, deckVisualDesc, history, generateDeckVisualDesc]);

  return (
    <div className="h-full bg-stone-900 text-stone-300 font-sans flex flex-col overflow-hidden" style={{ flex: 1 }}>
      {/* Global Scrollbar Styles */}
      <style>{`
        /* Custom scrollbar for the entire app */
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        ::-webkit-scrollbar-track {
          background: #1c1917;
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb {
          background: #57534e;
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #f97316;
        }
        /* Firefox scrollbar */
        * {
          scrollbar-width: thin;
          scrollbar-color: #57534e #1c1917;
        }
        /* Settings panel specific scrollbar */
        .settings-scrollbar::-webkit-scrollbar-thumb {
          background: #78716c;
        }
        .settings-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #f97316;
        }
      `}</style>
      
      {/* Header and nav strip are now managed by App.jsx container */}

      <div className="flex-1 flex min-h-0">
        {/* Left Sidebar - Deck Outline */}
        <aside className="w-56 flex-shrink-0 bg-stone-800 border-r-2 border-stone-700 flex flex-col min-h-0">
          <div className="bg-stone-700 text-orange-400 px-2 py-2 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Layers className="w-3 h-3 text-orange-400" />
              <span className="font-bold uppercase text-xs tracking-wide">Deck Outline</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={undoHistoryDelete}
                disabled={historyUndoStack.length === 0}
                className={`p-0.5 rounded transition-colors ${historyUndoStack.length > 0 ? 'hover:bg-stone-600 text-stone-400' : 'text-stone-600 cursor-not-allowed'}`}
                title="Undo delete"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                onClick={redoHistoryDelete}
                disabled={historyRedoStack.length === 0}
                className={`p-0.5 rounded transition-colors ${historyRedoStack.length > 0 ? 'hover:bg-stone-600 text-stone-400' : 'text-stone-600 cursor-not-allowed'}`}
                title="Redo delete"
              >
                <Redo2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowHistoryModal(true)}
                className="p-0.5 hover:bg-stone-600 rounded transition-colors"
                title="Import/Export History"
              >
                <FolderUp className="w-4 h-4 text-stone-400" />
              </button>
              {history.length > 0 ? (
                <button
                  onClick={clearHistory}
                  className="p-0.5 hover:bg-stone-600 rounded transition-colors"
                  title="Clear history"
                >
                  <Trash2 className="w-4 h-4 text-stone-400" />
                </button>
              ) : (
                <button
                  disabled
                  className="p-0.5 rounded transition-colors text-stone-600 cursor-not-allowed"
                  title="Clear history"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {sortedHistory.length === 0 ? (
              <div className="p-2 text-center text-stone-500 text-xs">
                <div className="w-10 h-10 mx-auto mb-2 bg-stone-700 rounded-full flex items-center justify-center">
                  <FileText className="w-5 h-5 text-stone-500" />
                </div>
                <p>No pages yet</p>
              </div>
            ) : (
              <div className="divide-y divide-stone-700">
                {sortedHistory.map((item) => (
                  <div
                    key={item.id}
                    className={`relative group ${openTabs.some(t => t.id === item.id) ? 'bg-stone-700/50' : ''}`}
                  >
                    <button
                      onClick={() => openFromHistory(item)}
                      className="w-full p-2 text-left hover:bg-stone-700 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[10px] font-mono text-orange-400 font-bold">#{item.pageNum}</span>
                        <span className="text-[10px] text-stone-500 group-hover:opacity-0 transition-opacity">{item.timestamp}</span>
                      </div>
                      <p className="text-xs font-medium text-stone-300 group-hover:text-orange-400 leading-tight break-words pr-5">
                        {item.title}
                      </p>
                      <p className="text-[10px] text-stone-500 mt-0.5">{item.layout}</p>
                    </button>
                    {/* Delete button - appears on hover */}
                    <button
                      onClick={(e) => removeHistoryItem(item.id, e)}
                      className="absolute top-2 right-2 p-1 bg-stone-600 hover:bg-red-600 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove from outline"
                    >
                      <X className="w-3 h-3 text-stone-300" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-h-0 p-4 space-y-4 overflow-y-auto bg-stone-900">
          {error && (
            <div className="p-3 bg-red-900/50 border-2 border-red-600 rounded-sm text-red-300 font-medium text-sm">
              {error}
            </div>
          )}

          {/* Section 1: Document & Context Input */}
          <section className="bg-stone-800 border-2 border-stone-700 rounded-sm shadow-[3px_3px_0px_0px_rgba(0,0,0,0.3)]">
            <div 
              className="bg-stone-700 text-orange-400 px-3 py-2 border-b-2 border-stone-600 cursor-pointer hover:bg-stone-600 transition-colors"
              onClick={() => setSection1Collapsed(!section1Collapsed)}
            >
              <h2 className="font-bold uppercase tracking-wide flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 bg-orange-500 rounded-full flex items-center justify-center text-white font-mono text-xs">1</span>
                  Project Documentation & Deck Context
                </div>
                {section1Collapsed ? (
                  <ChevronRight className="w-5 h-5 text-orange-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-orange-400" />
                )}
              </h2>
            </div>

            {!section1Collapsed && (
            <div className="p-4 space-y-3">
              {/* Project Selection */}
              <div>
                <label className="block text-xs font-bold text-orange-400 mb-0.5 uppercase tracking-wide">
                  Project
                </label>
                <p className="text-[10px] text-stone-500 mb-1.5">Link a project to include its documents and assets in generation</p>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1" style={{ maxWidth: '360px' }}>
                    <select
                      value={selectedProjectId}
                      onChange={(e) => { setSelectedProjectId(e.target.value); refreshProjects(); }}
                      onFocus={refreshProjects}
                      className={`w-full px-3 py-1.5 text-xs bg-stone-900 border-2 border-stone-600 rounded-sm focus:outline-none focus:border-orange-500 transition-colors appearance-none cursor-pointer font-medium ${selectedProjectId ? 'text-stone-300' : 'text-orange-400'}`}
                    >
                      <option value="" className="text-orange-400">No project selected</option>
                      {projects.map(p => (
                        <option key={p.id} value={p.id} className="text-stone-300">{p.title}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500 pointer-events-none" />
                  </div>
                  <button
                    onClick={() => setShowNewProjectModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-stone-700 border-2 border-stone-600 rounded-sm text-xs font-medium text-orange-400 hover:border-orange-500 hover:bg-stone-600 transition-all"
                  >
                    <Plus className="w-3 h-3" />
                    New Project
                  </button>
                </div>
                {selectedProject && (
                  <div className="mt-1.5 px-2 py-1.5 bg-stone-900/50 rounded-sm border border-stone-700">
                    {selectedProject.description && (
                      <p className="text-[10px] text-stone-400 mb-0.5">{selectedProject.description}</p>
                    )}
                    {cloudProjects ? (
                      <p className="text-[10px] text-stone-500 mb-1.5">
                        Cloud project — the title and description above feed generation.
                        File attachments on cloud projects arrive with the storage work;
                        until then, upload files below to include them.
                      </p>
                    ) : (
                    <p className="text-[10px] text-stone-500 mb-1.5">
                      {(selectedProject.documents || []).length} document{(selectedProject.documents || []).length !== 1 ? 's' : ''}
                      {' · '}
                      {(selectedProject.visualAssets || []).length} visual asset{(selectedProject.visualAssets || []).length !== 1 ? 's' : ''}
                    </p>
                    )}

                    {/* CORE / REFERENCE classifier — tells the AI which files
                        actually define the project concept vs. which are just
                        supporting reference. Click a tag to flip it. */}
                    {((selectedProject.documents || []).length + (selectedProject.visualAssets || []).length) > 0 && (
                      <div className="border-t border-stone-700 pt-1.5">
                        <p className="text-[9px] uppercase tracking-wider text-stone-500 mb-1">
                          File roles · click to toggle
                        </p>
                        <div className="space-y-0.5">
                          {(selectedProject.documents || []).map(doc => {
                            const isCore = doc.isCore !== false;
                            return (
                              <div key={doc.id} className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => toggleProjectFileCore('documents', doc.id)}
                                  className="px-1.5 py-0.5 rounded-sm text-[9px] font-mono uppercase tracking-wider transition-colors flex-shrink-0"
                                  style={{
                                    width: '52px',
                                    backgroundColor: isCore ? '#ea580c' : '#44403c',
                                    color: isCore ? '#fff7ed' : '#a8a29e',
                                    border: `1px solid ${isCore ? '#c2410c' : '#57534e'}`,
                                  }}
                                  title={isCore ? 'CORE — defines the project concept (click to demote)' : 'REFERENCE — supporting context only (click to promote to core)'}
                                >
                                  {isCore ? 'Core' : 'Ref'}
                                </button>
                                <span className="text-[10px] text-stone-400 truncate flex-1">{doc.name}</span>
                              </div>
                            );
                          })}
                          {(selectedProject.visualAssets || []).map(asset => {
                            const isCore = asset.isCore !== false;
                            return (
                              <div key={asset.id} className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => toggleProjectFileCore('visualAssets', asset.id)}
                                  className="px-1.5 py-0.5 rounded-sm text-[9px] font-mono uppercase tracking-wider transition-colors flex-shrink-0"
                                  style={{
                                    width: '52px',
                                    backgroundColor: isCore ? '#ea580c' : '#44403c',
                                    color: isCore ? '#fff7ed' : '#a8a29e',
                                    border: `1px solid ${isCore ? '#c2410c' : '#57534e'}`,
                                  }}
                                  title={isCore ? 'CORE — defines the project concept (click to demote)' : 'REFERENCE — supporting context only (click to promote to core)'}
                                >
                                  {isCore ? 'Core' : 'Ref'}
                                </button>
                                <span className="text-[10px] text-stone-400 truncate flex-1">{asset.name}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* File Upload and Full Deck Toggle Row */}
              <div className="flex items-start gap-8">
                {/* File Upload - Multiple files support */}
                <div className="flex-1">
                  <label className="block text-xs font-bold text-orange-400 mb-0.5 uppercase tracking-wide">
                    Upload Documents
                  </label>
                  <p className="text-[10px] text-stone-500 mb-1.5">Source material for generating slide content (max 20 files)</p>
                  
                  {uploadedFiles.length === 0 ? (
                    <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone-700 border-2 border-stone-600 rounded-sm cursor-pointer hover:border-orange-500 hover:bg-stone-600 transition-all">
                      {isFileLoading ? (
                        <Loader2 className="w-4 h-4 text-orange-500 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4 text-orange-400" />
                      )}
                      <span className="text-xs font-medium text-orange-400">Choose file</span>
                      <span className="text-[10px] text-stone-500">(PDF, MD, TXT, Images)</span>
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.md,.txt,text/plain,text/markdown,application/pdf,image/*,video/*"
                        onChange={handleFileUpload}
                      />
                    </label>
                  ) : (
                    <div className="flex gap-2">
                      {/* Grid: up to 4 columns of 5 rows */}
                      {Array.from({ length: Math.ceil(uploadedFiles.length / 5) }, (_, colIdx) => (
                        <div key={colIdx} className="flex flex-col gap-1.5">
                          {uploadedFiles.slice(colIdx * 5, colIdx * 5 + 5).map((fileData, index) => {
                            const globalIndex = colIdx * 5 + index;
                            const isLast = globalIndex === uploadedFiles.length - 1;
                            return (
                              <div key={fileData.id} className="flex items-center gap-2 px-2 py-1.5 bg-stone-700 rounded-sm border border-stone-600 w-72 h-8">
                                {fileData.type === 'image' ? (
                                  <Image className="w-4 h-4 text-orange-500 flex-shrink-0" />
                                ) : (
                                  <FileText className="w-4 h-4 text-orange-500 flex-shrink-0" />
                                )}
                                <span className="text-xs font-medium text-stone-300 flex-1 truncate">{fileData.file.name}</span>
                                <span className="text-[10px] text-stone-500 flex-shrink-0">({(fileData.file.size / 1024).toFixed(1)} KB)</span>
                                <button
                                  onClick={() => removeFile(fileData.id)}
                                  className="p-0.5 hover:bg-stone-600 rounded-sm transition-colors flex-shrink-0"
                                >
                                  <X className="w-3 h-3 text-stone-400" />
                                </button>
                                {/* Add button on last file if under limit */}
                                {isLast && uploadedFiles.length < 20 && (
                                  <label className="p-0.5 hover:bg-stone-600 rounded-sm transition-colors flex-shrink-0 cursor-pointer">
                                    {isFileLoading ? (
                                      <Loader2 className="w-3 h-3 text-orange-400 animate-spin" />
                                    ) : (
                                      <Plus className="w-3 h-3 text-orange-400" />
                                    )}
                                    <input
                                      type="file"
                                      className="hidden"
                                      accept=".pdf,.md,.txt,text/plain,text/markdown,application/pdf,image/*,video/*"
                                      onChange={handleFileUpload}
                                    />
                                  </label>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* System Prompt with Full Deck Toggle aligned to title */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-3">
                    <label className="block text-xs font-bold text-orange-400 uppercase tracking-wide">
                      Deck Context & Guidelines
                    </label>
                    {/* Theme Generator Checkbox */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setEnableThemeGen(!enableThemeGen)}
                        className={`w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center transition-colors ${enableThemeGen ? 'border-orange-500 bg-stone-700' : 'border-stone-500 bg-stone-700'}`}
                      >
                        {enableThemeGen && <Check className="w-2.5 h-2.5 text-orange-400" />}
                      </button>
                      <span className="text-[10px] text-stone-400 uppercase tracking-wide">Theme Generator</span>
                    </div>
                    {/* Use Uploaded Assets Checkbox */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setUseUploadedAssets(!useUploadedAssets)}
                        className={`w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center transition-colors ${useUploadedAssets ? 'border-orange-500 bg-stone-700' : 'border-stone-500 bg-stone-700'}`}
                      >
                        {useUploadedAssets && <Check className="w-2.5 h-2.5 text-orange-400" />}
                      </button>
                      <span className="text-[10px] text-stone-400 uppercase tracking-wide">Use Uploaded Assets</span>
                    </div>
                    {/* Use Project Assets Checkbox */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setUseProjectAssets(!useProjectAssets)}
                        className={`w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center transition-colors ${useProjectAssets ? 'border-orange-500 bg-stone-700' : 'border-stone-500 bg-stone-700'}`}
                      >
                        {useProjectAssets && <Check className="w-2.5 h-2.5 text-orange-400" />}
                      </button>
                      <span className="text-[10px] text-stone-400 uppercase tracking-wide">Use Project Assets</span>
                    </div>
                  </div>
                  {/* Full Deck Toggle */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const newMode = !fullDeckMode;
                        setFullDeckMode(newMode);
                        // Auto-collapse section 2 when enabling full deck, expand when disabling
                        if (newMode) {
                          setSection2Collapsed(true);
                        } else {
                          setSection2Collapsed(false);
                        }
                      }}
                      className={`relative w-11 h-6 rounded-full transition-colors ${fullDeckMode ? 'bg-orange-500' : 'bg-stone-600'}`}
                    >
                      <span 
                        className={`absolute top-1 w-4 h-4 bg-stone-500 rounded-full transition-transform ${fullDeckMode ? 'left-6' : 'left-1'}`}
                      />
                    </button>
                    <span className="text-xs font-bold text-orange-400 uppercase tracking-wide">Full Deck</span>
                  </div>
                </div>
                <p className="text-[10px] text-stone-500 mb-1.5">
                  Set the overall tone, style, and objectives for the deck
                  {fullDeckMode && <span className="text-orange-400"> • Include desired page count</span>}
                </p>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  onFocus={() => setSystemPromptFocused(true)}
                  onBlur={() => setSystemPromptFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && fullDeckMode) {
                      e.preventDefault();
                      if (!isGenerating && hasFileContent) {
                        generateFullDeck();
                      }
                    }
                  }}
                  placeholder="Example: This is a pitch deck for a luxury brand activation. The tone should be sophisticated and aspirational..."
                  className={`w-full px-3 py-2 bg-stone-900 border-2 border-stone-600 rounded-sm text-stone-300 placeholder-stone-500 focus:outline-none focus:border-orange-500 resize-none text-sm transition-all duration-200 ${systemPromptFocused ? 'h-40' : 'h-20'}`}
                />
              </div>

              {/* Generate Full Deck Button - Only visible in Full Deck Mode */}
              {fullDeckMode && (
                <button
                  onClick={generateFullDeck}
                  disabled={isGenerating || !hasFileContent}
                  className="w-full py-2.5 px-4 bg-orange-500 hover:bg-orange-600 disabled:bg-stone-600 disabled:cursor-not-allowed border-2 border-stone-600 rounded-sm font-bold text-stone-900 uppercase tracking-wide flex items-center justify-center gap-2 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,0.3)] active:shadow-none disabled:shadow-none disabled:text-stone-400 text-sm"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating Full Deck...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Generate Full Deck Outline
                    </>
                  )}
                </button>
              )}
            </div>
            )}
          </section>

          {/* Section 2: Page Generation */}
          <section className={`bg-stone-800 border-2 border-stone-700 rounded-sm shadow-[3px_3px_0px_0px_rgba(0,0,0,0.3)] ${fullDeckMode ? 'opacity-50' : ''}`}>
            <div 
              className={`bg-stone-700 px-3 py-2 border-b-2 border-stone-600 ${fullDeckMode ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-stone-600'} transition-colors`}
              onClick={() => !fullDeckMode && setSection2Collapsed(!section2Collapsed)}
            >
              <h2 className="font-bold uppercase tracking-wide flex items-center justify-between text-sm">
                <div className={`flex items-center gap-2 ${fullDeckMode ? 'text-stone-500' : 'text-orange-400'}`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-white font-mono text-xs ${fullDeckMode ? 'bg-stone-500' : 'bg-orange-500'}`}>2</span>
                  Generate Page Outline
                  {fullDeckMode && <span className="text-[10px] font-normal normal-case ml-2">(Disabled in Full Deck mode)</span>}
                </div>
                {(section2Collapsed || fullDeckMode) ? (
                  <ChevronRight className={`w-5 h-5 ${fullDeckMode ? 'text-stone-500' : 'text-orange-400'}`} />
                ) : (
                  <ChevronDown className={`w-5 h-5 ${fullDeckMode ? 'text-stone-500' : 'text-orange-400'}`} />
                )}
              </h2>
            </div>

            {!section2Collapsed && !fullDeckMode && (
            <div className="p-4 space-y-3">
              <div className="flex gap-4">
                {/* Layout Dropdown */}
                <div>
                  <label className={`block text-xs font-bold mb-0.5 uppercase tracking-wide ${fullDeckMode ? 'text-stone-500' : 'text-orange-400'}`}>
                    Slide Layout Type
                  </label>
                  <p className="text-[10px] text-stone-500 mb-1.5">Choose how content will be arranged on the slide</p>
                  <div className="relative w-56">
                    <select
                      value={selectedLayout}
                      onChange={(e) => setSelectedLayout(e.target.value)}
                      disabled={fullDeckMode}
                      className={`w-full px-3 py-2 border-2 border-stone-600 rounded-sm focus:outline-none appearance-none font-medium text-sm ${fullDeckMode ? 'bg-stone-700 text-stone-500 cursor-not-allowed' : 'bg-stone-900 text-orange-400 cursor-pointer focus:border-orange-500'}`}
                    >
                      <option value="" className="text-orange-400">Select layout...</option>
                      {SLIDE_LAYOUTS.map((layout) => (
                        <option key={layout.id} value={layout.id} className="text-stone-300">
                          {layout.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500 pointer-events-none" />
                  </div>
                  {selectedLayout && !fullDeckMode && (
                    <p className="mt-1 text-[10px] text-stone-500 italic">
                      {SLIDE_LAYOUTS.find(l => l.id === selectedLayout)?.description}
                    </p>
                  )}
                </div>

                {/* Page Number */}
                <div>
                  <label className={`block text-xs font-bold mb-0.5 uppercase tracking-wide ${fullDeckMode ? 'text-stone-500' : 'text-orange-400'}`}>
                    Page #
                  </label>
                  <p className="text-[10px] text-stone-500 mb-1.5">Single number or range (e.g. 3-7)</p>
                  <input
                    type="text"
                    value={pageNumber}
                    onChange={(e) => setPageNumber(e.target.value)}
                    disabled={fullDeckMode}
                    placeholder="5 or 1-10"
                    className={`w-24 px-3 py-2 border-2 border-stone-600 rounded-sm placeholder-stone-500 focus:outline-none text-sm ${fullDeckMode ? 'bg-stone-700 text-stone-500 cursor-not-allowed' : 'bg-stone-900 text-stone-300 focus:border-orange-500'}`}
                  />
                </div>
              </div>

              {/* Page Request Prompt - Full Width */}
              <div>
                <label className={`block text-xs font-bold mb-0.5 uppercase tracking-wide ${fullDeckMode ? 'text-stone-500' : 'text-orange-400'}`}>
                  Page Request
                </label>
                <p className="text-[10px] text-stone-500 mb-1.5">
                  Describe the specific content you want on this slide
                </p>
                <textarea
                  value={pagePrompt}
                  onChange={(e) => setPagePrompt(e.target.value)}
                  onFocus={() => setPagePromptFocused(true)}
                  onBlur={() => setPagePromptFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !fullDeckMode) {
                      e.preventDefault();
                      if (!isGenerating && hasFileContent && pagePrompt && selectedLayout) {
                        generatePageOutline();
                      }
                    }
                  }}
                  disabled={fullDeckMode}
                  placeholder="Example: I need a page listing all the main characters with summaries for each..."
                  className={`w-full px-3 py-2 border-2 border-stone-600 rounded-sm placeholder-stone-500 focus:outline-none resize-none text-sm transition-all duration-200 ${fullDeckMode ? 'bg-stone-700 text-stone-500 cursor-not-allowed h-24' : `bg-stone-900 text-stone-300 focus:border-orange-500 ${pagePromptFocused ? 'h-40' : 'h-24'}`}`}
                />
              </div>

              {/* Generate Button */}
              <button
                onClick={generatePageOutline}
                disabled={isGenerating || !hasFileContent || !pagePrompt || !selectedLayout || fullDeckMode}
                className="w-full py-2.5 px-4 bg-orange-500 hover:bg-orange-600 disabled:bg-stone-600 disabled:cursor-not-allowed border-2 border-stone-600 rounded-sm font-bold text-stone-900 uppercase tracking-wide flex items-center justify-center gap-2 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,0.3)] active:shadow-none disabled:shadow-none disabled:text-stone-400 text-sm"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generate Page Outline
                  </>
                )}
              </button>
            </div>
            )}
          </section>

          {/* Output Section - Below Input */}
          <section className="bg-stone-800 border-2 border-stone-700 rounded-sm shadow-[3px_3px_0px_0px_rgba(0,0,0,0.3)]">
            <div className="bg-stone-700 text-orange-400 px-3 py-2 flex items-center justify-between border-b-2 border-stone-600">
              <span className="font-bold uppercase text-xs tracking-wide">Generated Output</span>
              {activeTab && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={downloadMarkdown}
                    className="flex items-center gap-1.5 px-2 py-1 bg-orange-500 hover:bg-orange-600 rounded-sm transition-colors text-xs font-medium text-white"
                  >
                    <Download className="w-3 h-3" />
                    Export .md
                  </button>
                  <button
                    onClick={copyToClipboard}
                    className="flex items-center gap-1.5 px-2 py-1 bg-orange-500 hover:bg-orange-600 rounded-sm transition-colors text-xs font-medium text-white"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3 h-3" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
            
            {/* Tabs Bar + View Toggle */}
            {openTabs.length > 0 && (
              <div className="bg-stone-800 px-2 pt-1 flex items-end justify-between border-b-2 border-stone-600">
                {/* Page Tabs */}
                <div className="flex items-end gap-1 flex-1 overflow-x-auto overflow-y-hidden">
                  {[...openTabs].sort((a, b) => {
                    const numA = parseInt(a.pageNum) || 999;
                    const numB = parseInt(b.pageNum) || 999;
                    return numA - numB;
                  }).map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTabId(tab.id)}
                      className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        activeTabId === tab.id 
                          ? 'bg-stone-950 text-orange-400 border-t-2 border-l-2 border-r-2 border-stone-600 border-b-2 border-b-stone-950 rounded-t-sm -mb-[2px] relative z-10' 
                          : 'bg-stone-700 text-stone-400 hover:text-stone-300 border-2 border-stone-600 border-b-0 rounded-t-sm mb-0'
                      }`}
                    >
                      <span className="font-mono">#{tab.pageNum}</span>
                      <span className="max-w-[100px] truncate">{tab.title}</span>
                      <button
                        onClick={(e) => closeTab(tab.id, e)}
                        className="ml-1 p-0.5 hover:bg-stone-600 rounded"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </button>
                  ))}
                </div>
                
                {/* View Toggle */}
                <div className="flex items-center gap-1 ml-2 flex-shrink-0 pb-1">
                  <button
                    onClick={() => setViewMode('text')}
                    className={`p-1.5 rounded-sm transition-colors ${viewMode === 'text' ? 'bg-orange-500 text-white' : 'bg-stone-700 text-stone-400 hover:text-stone-300'}`}
                    title="Text View"
                  >
                    <Code className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('visualizer')}
                    className={`p-1.5 rounded-sm transition-colors ${viewMode === 'visualizer' ? 'bg-orange-500 text-white' : 'bg-stone-700 text-stone-400 hover:text-stone-300'}`}
                    title="Layout Visualizer"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
            
            {/* Regenerate Bar */}
            {activeTab && (
              <div className="bg-stone-900 px-3 py-2 border-b-2 border-stone-600">
                <div className="flex items-center gap-2">
                  {/* Title */}
                  <span className="text-[10px] text-orange-400 uppercase tracking-wide font-bold flex-shrink-0">Edit Output:</span>
                  
                  {/* Revision Prompt Input */}
                  <input
                    type="text"
                    value={revisionPrompt}
                    onChange={(e) => setRevisionPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isRegenerating && hasFileContent) {
                        regeneratePage();
                      }
                    }}
                    disabled={isRegenerating}
                    placeholder="Describe changes (e.g., 'make it more concise' or 'add more detail about pricing')..."
                    className="flex-1 px-2 py-1.5 bg-stone-950 border border-stone-600 rounded-sm text-stone-300 text-xs placeholder-stone-500 focus:outline-none focus:border-orange-500 disabled:opacity-50"
                  />
                  
                  {/* Layout Dropdown */}
                  <div className="relative flex-shrink-0">
                    <select
                      value={regenerateLayout}
                      onChange={(e) => setRegenerateLayout(e.target.value)}
                      disabled={isRegenerating}
                      className="px-2 py-1.5 bg-stone-950 border border-stone-600 rounded-sm text-stone-300 text-xs focus:outline-none focus:border-orange-500 appearance-none pr-6 cursor-pointer disabled:opacity-50"
                      style={{ minWidth: '140px' }}
                    >
                      <option value="">Keep layout</option>
                      {SLIDE_LAYOUTS.map((layout) => (
                        <option key={layout.id} value={layout.id}>
                          {layout.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-stone-500 pointer-events-none" />
                  </div>
                  
                  {/* Regenerate Button */}
                  <button
                    onClick={regeneratePage}
                    disabled={isRegenerating || !hasFileContent}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:bg-stone-600 disabled:cursor-not-allowed rounded-sm font-bold text-white text-xs uppercase tracking-wide transition-colors flex-shrink-0"
                  >
                    {isRegenerating ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Regenerating...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-3 h-3" />
                        Regenerate Page
                      </>
                    )}
                  </button>
                  
                  {/* Undo Button */}
                  <button
                    onClick={undoRegeneration}
                    disabled={!(previousContent[activeTab.id]?.length > 0)}
                    className={`p-1.5 rounded-sm transition-colors flex-shrink-0 ${
                      previousContent[activeTab.id]?.length > 0
                        ? 'bg-stone-700 hover:bg-stone-600 text-orange-400'
                        : 'bg-stone-800 text-stone-600 cursor-not-allowed'
                    }`}
                    title={previousContent[activeTab.id]?.length > 0 ? `Undo regeneration (${previousContent[activeTab.id].length})` : 'No previous version'}
                  >
                    <Undo2 className="w-4 h-4" />
                  </button>

                  {/* Redo Button */}
                  <button
                    onClick={redoRegeneration}
                    disabled={!(redoContent[activeTab.id]?.length > 0)}
                    className={`p-1.5 rounded-sm transition-colors flex-shrink-0 ${
                      redoContent[activeTab.id]?.length > 0
                        ? 'bg-stone-700 hover:bg-stone-600 text-orange-400'
                        : 'bg-stone-800 text-stone-600 cursor-not-allowed'
                    }`}
                    title={redoContent[activeTab.id]?.length > 0 ? `Redo regeneration (${redoContent[activeTab.id].length})` : 'No redo available'}
                  >
                    <Redo2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Formatting Toolbar */}
            {activeTab && (
              <div className="bg-stone-800 px-3 py-1 border-b border-stone-700 border-l-2 border-r-2 border-l-stone-600 border-r-stone-600 flex items-center gap-1">
                {/* Undo / Redo */}
                <button
                  onClick={handleTextUndo}
                  disabled={undoRedoCounts.undo === 0}
                  className={`p-1 rounded transition-colors ${undoRedoCounts.undo === 0 ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:bg-orange-500/20 active:bg-orange-500/30'}`}
                  title="Undo (text)"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleTextRedo}
                  disabled={undoRedoCounts.redo === 0}
                  className={`p-1 rounded transition-colors ${undoRedoCounts.redo === 0 ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:bg-orange-500/20 active:bg-orange-500/30'}`}
                  title="Redo (text)"
                >
                  <Redo2 className="w-3.5 h-3.5" />
                </button>

                {/* Bold, Bullet, Numbered — only in markdown text view */}
                {viewMode === 'text' && (
                  <>
                    <div className="w-px h-4 bg-stone-600 mx-1" />

                    {/* Bold */}
                    <button
                      onClick={handleToggleBold}
                      className="p-1 rounded transition-colors text-orange-400 hover:bg-orange-500/20 active:bg-orange-500/30"
                      title="Bold"
                    >
                      <Bold className="w-3.5 h-3.5" />
                    </button>

                    {/* Bullet List */}
                    <button
                      onClick={handleToggleBullet}
                      className="p-1 rounded transition-colors text-orange-400 hover:bg-orange-500/20 active:bg-orange-500/30"
                      title="Toggle Bullet List"
                    >
                      <List className="w-3.5 h-3.5" />
                    </button>

                    {/* Numbered List */}
                    <button
                      onClick={handleToggleNumbered}
                      className="p-1 rounded transition-colors text-orange-400 hover:bg-orange-500/20 active:bg-orange-500/30"
                      title="Toggle Numbered List"
                    >
                      <ListOrdered className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Descriptor - shown in text edit mode between edit bar and content */}
            {activeTab && viewMode === 'text' && (
              <div className="bg-stone-800 border-l-2 border-r-2 border-stone-600 px-4 py-1.5">
                <p className="text-[10px] text-stone-500 italic">Edits here are reflected in the visual preview. Right-click for AI rewrite options.</p>
              </div>
            )}
            
            <div ref={textareaContainerRef} className={`bg-stone-950 border-l-2 border-r-2 border-b-2 border-stone-600 relative ${openTabs.length === 0 ? 'border-t-2' : ''}`}>
              {activeTab ? (
                viewMode === 'text' ? (
                  <>
                    <textarea
                      ref={textareaRef}
                      value={activeTab.content}
                      onChange={handleTextareaChange}
                      onContextMenu={handleTextareaContextMenu}
                      onKeyDown={handleTextareaKeyDown}
                      className="w-full min-h-[780px] p-4 font-mono text-sm whitespace-pre-wrap text-orange-400 bg-stone-950 leading-relaxed border-none outline-none resize-y"
                      style={{ minHeight: '780px' }}
                    />
                  </>
                ) : (
                  <div style={{ overflow: 'hidden' }}>
                    <LayoutVisualizer
                      content={activeTab.content}
                      overrideColors={deckThemeColors}
                      onRefreshColors={refreshDeckColors}
                      onCycleTheme={cycleTheme}
                      themeName={allThemes[Math.min(themeIndex, allThemes.length - 1)]?.name || 'Theme'}
                      themeIndex={Math.min(themeIndex, allThemes.length - 1)}
                      themeCount={allThemes.length}
                      isGeneratingTheme={isGeneratingTheme}
                      onContentChange={(newContent) => { pushTextUndo(activeTab?.content || ''); updateTabContent(newContent); }}
                      onTextContextMenu={handleVisualizerContextMenu}
                      placementAssets={placementAssets}
                      zoomLevel={zoomLevel}
                    />
                    <p className="text-[10px] text-stone-500 italic px-4 py-1.5">Preview is read-only. Select text and right-click to rewrite with AI, or switch to markdown view to edit directly.</p>
                  </div>
                )
              ) : (
                <div className="p-8 text-center text-stone-500 flex flex-col items-center justify-center bg-stone-950 min-h-[780px]">
                  <div className="w-14 h-14 mb-3 bg-stone-900 rounded-full flex items-center justify-center border-2 border-dashed border-stone-700">
                    <FileText className="w-7 h-7 text-stone-600" />
                  </div>
                  <p className="font-medium text-sm text-stone-500">No output yet</p>
                  <p className="text-xs mt-1 text-stone-600">Generated page outlines will appear here</p>
                </div>
              )}
              {/* Rewrite Preview — floats above both text and visualizer views */}
              {rewritePreview.visible && (() => {
                const container = textareaContainerRef.current;
                const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0, width: 420, height: 400 };
                const relX = Math.max(8, Math.min(contextMenu.x - rect.left, rect.width - 428));
                const relY = Math.max(8, Math.min(contextMenu.y - rect.top + 10, rect.height - 320));
                return (
                  <div
                    className="absolute z-[80] bg-stone-800 border-2 border-orange-500/40 rounded-sm shadow-2xl w-[420px] max-h-[310px] flex flex-col"
                    style={{ left: relX, top: relY }}
                  >
                    {/* Original text being replaced */}
                    <div className="px-3 pt-2 pb-1 flex-shrink-0 border-b border-stone-700">
                      <span className="text-[9px] text-stone-500 uppercase tracking-wide font-bold">Replacing</span>
                      <div className="mt-1 max-h-[60px] overflow-y-auto">
                        <p className="text-[11px] text-stone-400 font-mono whitespace-pre-wrap leading-relaxed">{contextMenu.selectedText}</p>
                      </div>
                    </div>

                    {/* Generated rewrite */}
                    <div className="px-3 pt-2 pb-2 flex-1 min-h-0 overflow-y-auto">
                      <span className="text-[9px] text-orange-400 uppercase tracking-wide font-bold">Rewritten</span>
                      <div className="mt-1">
                        {rewritePreview.isLoading ? (
                          <div className="flex items-center gap-2 py-4 justify-center">
                            <Loader2 className="w-4 h-4 text-orange-400 animate-spin" />
                            <span className="text-xs text-stone-400">Generating {REWRITE_LABELS[rewritePreview.mode] || ''}...</span>
                          </div>
                        ) : (
                          <p className="text-[11px] text-orange-400 font-mono whitespace-pre-wrap leading-relaxed">{rewritePreview.text}</p>
                        )}
                      </div>
                    </div>

                    {/* Compact action bar */}
                    <div className="px-3 py-1.5 border-t border-stone-700 flex items-center justify-end gap-1.5 flex-shrink-0">
                      <button onClick={handleRewriteCancel} className="p-1.5 hover:bg-stone-700 rounded-sm transition-colors" title="Cancel">
                        <X className="w-3.5 h-3.5 text-stone-500 hover:text-stone-300" />
                      </button>
                      <button onClick={handleRewriteRedo} disabled={rewritePreview.isLoading} className="p-1.5 hover:bg-stone-700 disabled:opacity-50 rounded-sm transition-colors" title="Regenerate">
                        <RefreshCw className={`w-3.5 h-3.5 ${rewritePreview.isLoading ? 'animate-spin text-orange-400' : 'text-stone-500 hover:text-orange-400'}`} />
                      </button>
                      <button
                        onClick={handleRewriteReplace}
                        disabled={rewritePreview.isLoading || !rewritePreview.text || rewritePreview.text.startsWith('Error:')}
                        className="px-3 py-1 bg-orange-500 hover:bg-orange-600 disabled:bg-stone-600 disabled:text-stone-400 rounded-sm text-white font-bold text-[11px] transition-colors"
                      >
                        Replace
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </section>
        </main>
      </div>
      
      {/* History Modal */}
      <HistoryModal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        history={history}
        onImport={handleHistoryImport}
        uploadedFileName={uploadedFiles.length > 0 ? uploadedFiles[0].file.name : null}
        onExportWithResolver={handleExportWithResolver}
        onExportVis={handleExportVis}
        onExportVisWithResolver={handleExportVisWithResolver}
        onImportThemes={handleImportThemes}
        enableImgPromptExport={enableImgPromptExport}
        setEnableImgPromptExport={setEnableImgPromptExport}
        imgPromptModel={imgPromptModel}
        setImgPromptModel={setImgPromptModel}
        onGenerateImgPrompts={generateImagePrompts}
        isGeneratingImgPrompts={isGeneratingImgPrompts}
        imgPromptError={imgPromptError}
        onExportVisualAssets={exportVisualAssets}
        hasPlacedAssets={assetPlacementActive}
        exportDirHandle={exportDirHandle}
        exportFolderPath={exportFolderPath}
        onPickExportFolder={pickExportFolder}
        onClearExportFolder={clearExportFolder}
      />
      
      {/* Duplicate Resolver Modal */}
      <DuplicateResolverModal
        isOpen={showDuplicateResolver}
        duplicates={duplicatesToResolve}
        currentIndex={currentDuplicateIndex}
        onSelect={handleDuplicateSelect}
        onCancel={handleDuplicateCancel}
        onExportAll={handleExportAll}
      />
      
      {/* Settings Slide-Out Panel */}
      {showSettingsMenu && (
        <div className="fixed inset-0 z-50">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/50 transition-opacity"
            onClick={() => setShowSettingsMenu(false)}
          />
          {/* Slide-out Panel */}
          <div
            className="absolute top-0 right-0 h-full bg-stone-800 border-l-2 border-stone-600 shadow-2xl flex flex-col animate-slide-in-right"
            style={{
              width: '40%',
              minWidth: '400px',
              paddingTop: window.electronAPI ? '32px' : '0px',
              animation: 'slideInRight 0.3s ease-out'
            }}
          >
            {/* Panel Header */}
            <div className="bg-stone-700 px-4 py-3 flex items-center justify-between border-b-2 border-stone-600 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-orange-400" />
                <span className="font-bold text-orange-400 uppercase tracking-wide">Settings</span>
              </div>
              <button 
                onClick={() => setShowSettingsMenu(false)}
                className="p-1 hover:bg-stone-600 rounded transition-colors"
              >
                <X className="w-5 h-5 text-stone-400" />
              </button>
            </div>
            
            {/* Tabs */}
            <div className="flex border-b-2 border-stone-600 flex-shrink-0">
              <button
                onClick={() => setSettingsTab('prompts')}
                className={`flex-1 py-2 px-4 text-sm font-medium transition-colors ${
                  settingsTab === 'prompts' 
                    ? 'bg-stone-900 text-orange-400 border-b-2 border-orange-500 -mb-[2px]' 
                    : 'bg-stone-700 text-stone-400 hover:text-stone-300'
                }`}
              >
                System Prompts
              </button>
              <button
                onClick={() => setSettingsTab('format')}
                className={`flex-1 py-2 px-4 text-sm font-medium transition-colors ${
                  settingsTab === 'format' 
                    ? 'bg-stone-900 text-orange-400 border-b-2 border-orange-500 -mb-[2px]' 
                    : 'bg-stone-700 text-stone-400 hover:text-stone-300'
                }`}
              >
                Output Format
              </button>
            </div>

            {/* Lock Switch Bar */}
            {(
            <div className="bg-stone-900 px-4 py-2 border-b-2 border-stone-600 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                {settingsTab === 'prompts' ? (
                  promptsTabLocked ? (
                    <Lock className="w-4 h-4 text-stone-500" />
                  ) : (
                    <Unlock className="w-4 h-4 text-orange-400" />
                  )
                ) : (
                  formatTabLocked ? (
                    <Lock className="w-4 h-4 text-stone-500" />
                  ) : (
                    <Unlock className="w-4 h-4 text-orange-400" />
                  )
                )}
                <span className={`text-xs font-bold uppercase tracking-wide ${
                  (settingsTab === 'prompts' ? promptsTabLocked : formatTabLocked)
                    ? 'text-stone-500'
                    : 'text-orange-400'
                }`}>
                  {(settingsTab === 'prompts' ? promptsTabLocked : formatTabLocked) ? 'Locked' : 'Unlocked'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] uppercase tracking-wide ${
                  (settingsTab === 'prompts' ? promptsTabLocked : formatTabLocked)
                    ? 'text-stone-500'
                    : 'text-stone-400'
                }`}>
                  {(settingsTab === 'prompts' ? promptsTabLocked : formatTabLocked) ? 'Read Only' : 'Editable'}
                </span>
                <button
                  onClick={() => {
                    if (settingsTab === 'prompts') {
                      setPromptsTabLocked(!promptsTabLocked);
                    } else {
                      setFormatTabLocked(!formatTabLocked);
                    }
                  }}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    (settingsTab === 'prompts' ? !promptsTabLocked : !formatTabLocked)
                      ? 'bg-orange-500'
                      : 'bg-stone-600'
                  }`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 bg-stone-500 rounded-full transition-transform ${
                      (settingsTab === 'prompts' ? !promptsTabLocked : !formatTabLocked)
                        ? 'left-6'
                        : 'left-1'
                    }`}
                  />
                </button>
              </div>
            </div>
            )}
            
            {/* Tab Content */}
            <div className={`flex-1 overflow-y-auto settings-scrollbar ${
              (settingsTab === 'prompts' ? promptsTabLocked : formatTabLocked) ? 'opacity-50' : ''
            }`}>
              {settingsTab === 'prompts' ? (
                <>
                  {/* Page Generation Prompts Section Title */}
                  <div className="border-b border-stone-700 px-3 py-2">
                    <span className="text-xs font-bold text-stone-500 uppercase tracking-wide">Page Generation Prompts</span>
                  </div>
                  
                  {/* Single Page System Prompt */}
                  <div className="border-b border-stone-700 overflow-hidden">
                    <button onClick={() => setSettingsCollapsed(p => ({...p, sp_sys: !p.sp_sys}))} className="flex items-center justify-between w-full px-3 py-2 bg-stone-800 hover:bg-stone-750 transition-colors">
                      <div className="text-left">
                        <span className={`text-xs font-bold uppercase tracking-wide ${promptsTabLocked ? 'text-stone-500' : 'text-orange-400'}`}>Single Page - API System Message</span>
                        <p className="text-[10px] text-stone-500">Core instruction sent as system message for single page generation</p>
                      </div>
                      <ChevronRight className={`w-4 h-4 text-stone-500 transition-transform flex-shrink-0 ${settingsCollapsed.sp_sys ? '' : 'rotate-90'}`} />
                    </button>
                    {!settingsCollapsed.sp_sys && (
                      <div className="px-3 pb-3 pt-2">
                        <textarea value={singlePageSystemPrompt} onChange={(e) => setSinglePageSystemPrompt(e.target.value)} disabled={promptsTabLocked} className={`w-full h-32 px-3 py-2 bg-stone-950 border-2 border-stone-600 rounded-sm text-orange-400 text-xs font-mono focus:outline-none focus:border-orange-500 resize-none settings-scrollbar ${promptsTabLocked ? 'cursor-not-allowed' : ''}`} />
                        <button onClick={() => setSinglePageSystemPrompt(DEFAULT_SINGLE_PAGE_SYSTEM)} disabled={promptsTabLocked} className={`mt-1 text-[10px] ${promptsTabLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}>Reset to default</button>
                      </div>
                    )}
                  </div>
                  
                  {/* Single Page Instructions */}
                  <div className="border-b border-stone-700 overflow-hidden">
                    <button onClick={() => setSettingsCollapsed(p => ({...p, sp_rules: !p.sp_rules}))} className="flex items-center justify-between w-full px-3 py-2 bg-stone-800 hover:bg-stone-750 transition-colors">
                      <div className="text-left">
                        <span className={`text-xs font-bold uppercase tracking-wide ${promptsTabLocked ? 'text-stone-500' : 'text-orange-400'}`}>Single Page - Generation Rules</span>
                        <p className="text-[10px] text-stone-500">Formatting rules and constraints for single page output</p>
                      </div>
                      <ChevronRight className={`w-4 h-4 text-stone-500 transition-transform flex-shrink-0 ${settingsCollapsed.sp_rules ? '' : 'rotate-90'}`} />
                    </button>
                    {!settingsCollapsed.sp_rules && (
                      <div className="px-3 pb-3 pt-2">
                        <textarea value={singlePageInstructions} onChange={(e) => setSinglePageInstructions(e.target.value)} disabled={promptsTabLocked} className={`w-full h-48 px-3 py-2 bg-stone-950 border-2 border-stone-600 rounded-sm text-orange-400 text-xs font-mono focus:outline-none focus:border-orange-500 resize-none settings-scrollbar ${promptsTabLocked ? 'cursor-not-allowed' : ''}`} />
                        <button onClick={() => setSinglePageInstructions(DEFAULT_SINGLE_PAGE_INSTRUCTIONS)} disabled={promptsTabLocked} className={`mt-1 text-[10px] ${promptsTabLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}>Reset to default</button>
                      </div>
                    )}
                  </div>
                  
                  {/* Full Deck System Prompt */}
                  <div className="border-b border-stone-700 overflow-hidden">
                    <button onClick={() => setSettingsCollapsed(p => ({...p, fd_sys: !p.fd_sys}))} className="flex items-center justify-between w-full px-3 py-2 bg-stone-800 hover:bg-stone-750 transition-colors">
                      <div className="text-left">
                        <span className={`text-xs font-bold uppercase tracking-wide ${promptsTabLocked ? 'text-stone-500' : 'text-orange-400'}`}>Full Deck - API System Message</span>
                        <p className="text-[10px] text-stone-500">Core instruction sent as system message for full deck generation</p>
                      </div>
                      <ChevronRight className={`w-4 h-4 text-stone-500 transition-transform flex-shrink-0 ${settingsCollapsed.fd_sys ? '' : 'rotate-90'}`} />
                    </button>
                    {!settingsCollapsed.fd_sys && (
                      <div className="px-3 pb-3 pt-2">
                        <textarea value={fullDeckSystemPrompt} onChange={(e) => setFullDeckSystemPrompt(e.target.value)} disabled={promptsTabLocked} className={`w-full h-32 px-3 py-2 bg-stone-950 border-2 border-stone-600 rounded-sm text-orange-400 text-xs font-mono focus:outline-none focus:border-orange-500 resize-none settings-scrollbar ${promptsTabLocked ? 'cursor-not-allowed' : ''}`} />
                        <button onClick={() => setFullDeckSystemPrompt(DEFAULT_FULL_DECK_SYSTEM)} disabled={promptsTabLocked} className={`mt-1 text-[10px] ${promptsTabLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}>Reset to default</button>
                      </div>
                    )}
                  </div>
                  
                  {/* Full Deck Instructions */}
                  <div className="border-b border-stone-700 overflow-hidden">
                    <button onClick={() => setSettingsCollapsed(p => ({...p, fd_rules: !p.fd_rules}))} className="flex items-center justify-between w-full px-3 py-2 bg-stone-800 hover:bg-stone-750 transition-colors">
                      <div className="text-left">
                        <span className={`text-xs font-bold uppercase tracking-wide ${promptsTabLocked ? 'text-stone-500' : 'text-orange-400'}`}>Full Deck - Generation Rules</span>
                        <p className="text-[10px] text-stone-500">Formatting rules and constraints for full deck output</p>
                      </div>
                      <ChevronRight className={`w-4 h-4 text-stone-500 transition-transform flex-shrink-0 ${settingsCollapsed.fd_rules ? '' : 'rotate-90'}`} />
                    </button>
                    {!settingsCollapsed.fd_rules && (
                      <div className="px-3 pb-3 pt-2">
                        <textarea value={fullDeckInstructions} onChange={(e) => setFullDeckInstructions(e.target.value)} disabled={promptsTabLocked} className={`w-full h-48 px-3 py-2 bg-stone-950 border-2 border-stone-600 rounded-sm text-orange-400 text-xs font-mono focus:outline-none focus:border-orange-500 resize-none settings-scrollbar ${promptsTabLocked ? 'cursor-not-allowed' : ''}`} />
                        <button onClick={() => setFullDeckInstructions(DEFAULT_FULL_DECK_INSTRUCTIONS)} disabled={promptsTabLocked} className={`mt-1 text-[10px] ${promptsTabLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}>Reset to default</button>
                      </div>
                    )}
                  </div>
                  
                  {/* Visual Assets System Prompt Section Title */}
                  <div className="border-b border-stone-700 px-3 py-2">
                    <span className="text-xs font-bold text-stone-500 uppercase tracking-wide">Visual Assets System Prompt</span>
                  </div>

                  {/* Theme Color Generation Prompt */}
                  <div className="border-b border-stone-700 overflow-hidden">
                    <button onClick={() => setSettingsCollapsed(p => ({...p, theme_prompt: !p.theme_prompt}))} className="flex items-center justify-between w-full px-3 py-2 bg-stone-800 hover:bg-stone-750 transition-colors">
                      <div className="text-left">
                        <span className={`text-xs font-bold uppercase tracking-wide ${promptsTabLocked ? 'text-stone-500' : 'text-orange-400'}`}>Theme Color Generation</span>
                        <p className="text-[10px] text-stone-500">System prompt sent to Haiku for AI theme color generation</p>
                      </div>
                      <ChevronRight className={`w-4 h-4 text-stone-500 transition-transform flex-shrink-0 ${settingsCollapsed.theme_prompt ? '' : 'rotate-90'}`} />
                    </button>
                    {!settingsCollapsed.theme_prompt && (
                      <div className="px-3 pb-3 pt-2">
                        <textarea value={themeColorPrompt} onChange={(e) => setThemeColorPrompt(e.target.value)} disabled={promptsTabLocked} className={`w-full h-48 px-3 py-2 bg-stone-950 border-2 border-stone-600 rounded-sm text-orange-400 text-xs font-mono focus:outline-none focus:border-orange-500 resize-none settings-scrollbar ${promptsTabLocked ? 'cursor-not-allowed' : ''}`} />
                        <button onClick={() => setThemeColorPrompt(DEFAULT_THEME_COLOR_PROMPT)} disabled={promptsTabLocked} className={`mt-1 text-[10px] ${promptsTabLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}>Reset to default</button>
                      </div>
                    )}
                  </div>

                  {/* Shared Image Prompt Rules (All Models) */}
                  <div className="border-b border-stone-700 overflow-hidden">
                    <button onClick={() => setSettingsCollapsed(p => ({...p, img_shared: !p.img_shared}))} className="flex items-center justify-between w-full px-3 py-2 bg-stone-800 hover:bg-stone-750 transition-colors">
                      <div className="text-left">
                        <span className={`text-xs font-bold uppercase tracking-wide ${promptsTabLocked ? 'text-stone-500' : 'text-orange-400'}`}>Shared Rules (All Models)</span>
                        <p className="text-[10px] text-stone-500">Common formatting and structure rules applied to all image generation models</p>
                      </div>
                      <ChevronRight className={`w-4 h-4 text-stone-500 transition-transform flex-shrink-0 ${settingsCollapsed.img_shared ? '' : 'rotate-90'}`} />
                    </button>
                    {!settingsCollapsed.img_shared && (
                      <div className="px-3 pb-3 pt-2">
                        <textarea value={imgPromptSharedSystem} onChange={(e) => setImgPromptSharedSystem(e.target.value)} disabled={promptsTabLocked} className={`w-full h-48 px-3 py-2 bg-stone-950 border-2 border-stone-600 rounded-sm text-orange-400 text-xs font-mono focus:outline-none focus:border-orange-500 resize-none settings-scrollbar ${promptsTabLocked ? 'cursor-not-allowed' : ''}`} />
                        <button onClick={() => setImgPromptSharedSystem(DEFAULT_IMG_PROMPT_SHARED_SYSTEM)} disabled={promptsTabLocked} className={`mt-1 text-[10px] ${promptsTabLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}>Reset to default</button>
                      </div>
                    )}
                  </div>

                  {/* Midjourney System Prompt */}
                  <div className="border-b border-stone-700 overflow-hidden">
                    <button onClick={() => setSettingsCollapsed(p => ({...p, img_midjourney: !p.img_midjourney}))} className="flex items-center justify-between w-full px-3 py-2 bg-stone-800 hover:bg-stone-750 transition-colors">
                      <div className="text-left">
                        <span className={`text-xs font-bold uppercase tracking-wide ${promptsTabLocked ? 'text-stone-500' : 'text-orange-400'}`}>Midjourney Prompt</span>
                        <p className="text-[10px] text-stone-500">Model-specific rules for Midjourney v6</p>
                      </div>
                      <ChevronRight className={`w-4 h-4 text-stone-500 transition-transform flex-shrink-0 ${settingsCollapsed.img_midjourney ? '' : 'rotate-90'}`} />
                    </button>
                    {!settingsCollapsed.img_midjourney && (
                      <div className="px-3 pb-3 pt-2">
                        <textarea value={imgPromptMidjourneySystem} onChange={(e) => setImgPromptMidjourneySystem(e.target.value)} disabled={promptsTabLocked} className={`w-full h-32 px-3 py-2 bg-stone-950 border-2 border-stone-600 rounded-sm text-orange-400 text-xs font-mono focus:outline-none focus:border-orange-500 resize-none settings-scrollbar ${promptsTabLocked ? 'cursor-not-allowed' : ''}`} />
                        <button onClick={() => setImgPromptMidjourneySystem(DEFAULT_IMG_PROMPT_MIDJOURNEY)} disabled={promptsTabLocked} className={`mt-1 text-[10px] ${promptsTabLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}>Reset to default</button>
                      </div>
                    )}
                  </div>

                  {/* Flux System Prompt */}
                  <div className="border-b border-stone-700 overflow-hidden">
                    <button onClick={() => setSettingsCollapsed(p => ({...p, img_flux: !p.img_flux}))} className="flex items-center justify-between w-full px-3 py-2 bg-stone-800 hover:bg-stone-750 transition-colors">
                      <div className="text-left">
                        <span className={`text-xs font-bold uppercase tracking-wide ${promptsTabLocked ? 'text-stone-500' : 'text-orange-400'}`}>Flux Prompt</span>
                        <p className="text-[10px] text-stone-500">Model-specific rules for Flux</p>
                      </div>
                      <ChevronRight className={`w-4 h-4 text-stone-500 transition-transform flex-shrink-0 ${settingsCollapsed.img_flux ? '' : 'rotate-90'}`} />
                    </button>
                    {!settingsCollapsed.img_flux && (
                      <div className="px-3 pb-3 pt-2">
                        <textarea value={imgPromptFluxSystem} onChange={(e) => setImgPromptFluxSystem(e.target.value)} disabled={promptsTabLocked} className={`w-full h-32 px-3 py-2 bg-stone-950 border-2 border-stone-600 rounded-sm text-orange-400 text-xs font-mono focus:outline-none focus:border-orange-500 resize-none settings-scrollbar ${promptsTabLocked ? 'cursor-not-allowed' : ''}`} />
                        <button onClick={() => setImgPromptFluxSystem(DEFAULT_IMG_PROMPT_FLUX)} disabled={promptsTabLocked} className={`mt-1 text-[10px] ${promptsTabLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}>Reset to default</button>
                      </div>
                    )}
                  </div>

                  {/* Nano Banana System Prompt */}
                  <div className="border-b border-stone-700 overflow-hidden">
                    <button onClick={() => setSettingsCollapsed(p => ({...p, img_nanobanana: !p.img_nanobanana}))} className="flex items-center justify-between w-full px-3 py-2 bg-stone-800 hover:bg-stone-750 transition-colors">
                      <div className="text-left">
                        <span className={`text-xs font-bold uppercase tracking-wide ${promptsTabLocked ? 'text-stone-500' : 'text-orange-400'}`}>Nano Banana Prompt</span>
                        <p className="text-[10px] text-stone-500">Model-specific rules for Nano Banana</p>
                      </div>
                      <ChevronRight className={`w-4 h-4 text-stone-500 transition-transform flex-shrink-0 ${settingsCollapsed.img_nanobanana ? '' : 'rotate-90'}`} />
                    </button>
                    {!settingsCollapsed.img_nanobanana && (
                      <div className="px-3 pb-3 pt-2">
                        <textarea value={imgPromptNanoBananaSystem} onChange={(e) => setImgPromptNanoBananaSystem(e.target.value)} disabled={promptsTabLocked} className={`w-full h-32 px-3 py-2 bg-stone-950 border-2 border-stone-600 rounded-sm text-orange-400 text-xs font-mono focus:outline-none focus:border-orange-500 resize-none settings-scrollbar ${promptsTabLocked ? 'cursor-not-allowed' : ''}`} />
                        <button onClick={() => setImgPromptNanoBananaSystem(DEFAULT_IMG_PROMPT_NANOBANANA)} disabled={promptsTabLocked} className={`mt-1 text-[10px] ${promptsTabLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}>Reset to default</button>
                      </div>
                    )}
                  </div>

                  {/* Chat GPT / DALL-E System Prompt */}
                  <div className="border-b border-stone-700 overflow-hidden">
                    <button onClick={() => setSettingsCollapsed(p => ({...p, img_chatgpt: !p.img_chatgpt}))} className="flex items-center justify-between w-full px-3 py-2 bg-stone-800 hover:bg-stone-750 transition-colors">
                      <div className="text-left">
                        <span className={`text-xs font-bold uppercase tracking-wide ${promptsTabLocked ? 'text-stone-500' : 'text-orange-400'}`}>Chat GPT / DALL-E Prompt</span>
                        <p className="text-[10px] text-stone-500">Model-specific rules for ChatGPT / DALL-E 3</p>
                      </div>
                      <ChevronRight className={`w-4 h-4 text-stone-500 transition-transform flex-shrink-0 ${settingsCollapsed.img_chatgpt ? '' : 'rotate-90'}`} />
                    </button>
                    {!settingsCollapsed.img_chatgpt && (
                      <div className="px-3 pb-3 pt-2">
                        <textarea value={imgPromptChatGPTSystem} onChange={(e) => setImgPromptChatGPTSystem(e.target.value)} disabled={promptsTabLocked} className={`w-full h-32 px-3 py-2 bg-stone-950 border-2 border-stone-600 rounded-sm text-orange-400 text-xs font-mono focus:outline-none focus:border-orange-500 resize-none settings-scrollbar ${promptsTabLocked ? 'cursor-not-allowed' : ''}`} />
                        <button onClick={() => setImgPromptChatGPTSystem(DEFAULT_IMG_PROMPT_CHATGPT)} disabled={promptsTabLocked} className={`mt-1 text-[10px] ${promptsTabLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}>Reset to default</button>
                      </div>
                    )}
                  </div>

                  {/* Image Prompt - API System Message */}
                  <div className="border-b border-stone-700 overflow-hidden">
                    <button onClick={() => setSettingsCollapsed(p => ({...p, img_api_sys: !p.img_api_sys}))} className="flex items-center justify-between w-full px-3 py-2 bg-stone-800 hover:bg-stone-750 transition-colors">
                      <div className="text-left">
                        <span className={`text-xs font-bold uppercase tracking-wide ${promptsTabLocked ? 'text-stone-500' : 'text-orange-400'}`}>Image Prompt - API System Message</span>
                        <p className="text-[10px] text-stone-500">Core instruction sent as the API system message for image prompt generation</p>
                      </div>
                      <ChevronRight className={`w-4 h-4 text-stone-500 transition-transform flex-shrink-0 ${settingsCollapsed.img_api_sys ? '' : 'rotate-90'}`} />
                    </button>
                    {!settingsCollapsed.img_api_sys && (
                      <div className="px-3 pb-3 pt-2">
                        <textarea value={imgPromptApiSystem} onChange={(e) => setImgPromptApiSystem(e.target.value)} disabled={promptsTabLocked} className={`w-full h-48 px-3 py-2 bg-stone-950 border-2 border-stone-600 rounded-sm text-orange-400 text-xs font-mono focus:outline-none focus:border-orange-500 resize-none settings-scrollbar ${promptsTabLocked ? 'cursor-not-allowed' : ''}`} />
                        <button onClick={() => setImgPromptApiSystem(DEFAULT_IMG_PROMPT_API_SYSTEM)} disabled={promptsTabLocked} className={`mt-1 text-[10px] ${promptsTabLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}>Reset to default</button>
                      </div>
                    )}
                  </div>

                  {/* AI Rewrite Prompts Section Title */}
                  <div className="border-b border-stone-700 px-3 py-2">
                    <span className="text-xs font-bold text-stone-500 uppercase tracking-wide">AI Rewrite Prompts</span>
                  </div>
                  
                  {Object.entries(REWRITE_LABELS).map(([mode, label]) => {
                    const collapseKey = `rw_${mode}`;
                    return (
                      <div key={mode} className="border-b border-stone-700 overflow-hidden">
                        <button onClick={() => setSettingsCollapsed(p => ({...p, [collapseKey]: !p[collapseKey]}))} className="flex items-center justify-between w-full px-3 py-2 bg-stone-800 hover:bg-stone-750 transition-colors">
                          <div className="text-left">
                            <span className={`text-xs font-bold uppercase tracking-wide ${promptsTabLocked ? 'text-stone-500' : 'text-orange-400'}`}>{label}</span>
                            <p className="text-[10px] text-stone-500">Rewrite prompt for "{label}" mode</p>
                          </div>
                          <ChevronRight className={`w-4 h-4 text-stone-500 transition-transform flex-shrink-0 ${settingsCollapsed[collapseKey] ? '' : 'rotate-90'}`} />
                        </button>
                        {!settingsCollapsed[collapseKey] && (
                          <div className="px-3 pb-3 pt-2">
                            <textarea
                              value={rewritePrompts[mode]}
                              onChange={(e) => setRewritePrompts(prev => ({ ...prev, [mode]: e.target.value }))}
                              disabled={promptsTabLocked}
                              className={`w-full h-32 px-3 py-2 bg-stone-950 border-2 border-stone-600 rounded-sm text-orange-400 text-xs font-mono focus:outline-none focus:border-orange-500 resize-y settings-scrollbar ${promptsTabLocked ? 'cursor-not-allowed' : ''}`}
                            />
                            <button
                              onClick={() => setRewritePrompts(prev => ({ ...prev, [mode]: DEFAULT_REWRITE_PROMPTS[mode] }))}
                              disabled={promptsTabLocked}
                              className={`mt-1 text-[10px] ${promptsTabLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}
                            >
                              Reset to default
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              ) : (
                <>
                  {/* Single Page Output Format */}
                  <div className="border-b border-stone-700 overflow-hidden">
                    <button onClick={() => setSettingsCollapsed(p => ({...p, sp_fmt: !p.sp_fmt}))} className="flex items-center justify-between w-full px-3 py-2 bg-stone-800 hover:bg-stone-750 transition-colors">
                      <div className="text-left">
                        <span className={`text-xs font-bold uppercase tracking-wide ${formatTabLocked ? 'text-stone-500' : 'text-orange-400'}`}>Single Page Export Schema</span>
                        <p className="text-[10px] text-stone-500">Markdown structure for individual slide exports</p>
                      </div>
                      <ChevronRight className={`w-4 h-4 text-stone-500 transition-transform flex-shrink-0 ${settingsCollapsed.sp_fmt ? '' : 'rotate-90'}`} />
                    </button>
                    {!settingsCollapsed.sp_fmt && (
                      <div className="px-3 pb-3 pt-2">
                        <textarea value={singlePageOutputFormat} onChange={(e) => setSinglePageOutputFormat(e.target.value)} disabled={formatTabLocked} className={`w-full h-80 px-3 py-2 bg-stone-950 border-2 border-stone-600 rounded-sm text-orange-400 text-xs font-mono focus:outline-none focus:border-orange-500 resize-none settings-scrollbar ${formatTabLocked ? 'cursor-not-allowed' : ''}`} />
                        <button onClick={() => setSinglePageOutputFormat(DEFAULT_SINGLE_PAGE_OUTPUT_FORMAT)} disabled={formatTabLocked} className={`mt-1 text-[10px] ${formatTabLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}>Reset to default</button>
                      </div>
                    )}
                  </div>
                  
                  {/* Full Deck Output Format */}
                  <div className="border-b border-stone-700 overflow-hidden">
                    <button onClick={() => setSettingsCollapsed(p => ({...p, fd_fmt: !p.fd_fmt}))} className="flex items-center justify-between w-full px-3 py-2 bg-stone-800 hover:bg-stone-750 transition-colors">
                      <div className="text-left">
                        <span className={`text-xs font-bold uppercase tracking-wide ${formatTabLocked ? 'text-stone-500' : 'text-orange-400'}`}>Full Deck Export Schema</span>
                        <p className="text-[10px] text-stone-500">Markdown structure for complete deck exports</p>
                      </div>
                      <ChevronRight className={`w-4 h-4 text-stone-500 transition-transform flex-shrink-0 ${settingsCollapsed.fd_fmt ? '' : 'rotate-90'}`} />
                    </button>
                    {!settingsCollapsed.fd_fmt && (
                      <div className="px-3 pb-3 pt-2">
                        <textarea value={fullDeckOutputFormat} onChange={(e) => setFullDeckOutputFormat(e.target.value)} disabled={formatTabLocked} className={`w-full h-96 px-3 py-2 bg-stone-950 border-2 border-stone-600 rounded-sm text-orange-400 text-xs font-mono focus:outline-none focus:border-orange-500 resize-none settings-scrollbar ${formatTabLocked ? 'cursor-not-allowed' : ''}`} />
                        <button onClick={() => setFullDeckOutputFormat(DEFAULT_FULL_DECK_OUTPUT_FORMAT)} disabled={formatTabLocked} className={`mt-1 text-[10px] ${formatTabLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}>Reset to default</button>
                      </div>
                    )}
                  </div>
                  
                  {/* Visual Deck Export Schema */}
                  <div className="border-b border-stone-700 overflow-hidden">
                    <button onClick={() => setSettingsCollapsed(p => ({...p, vis_fmt: !p.vis_fmt}))} className="flex items-center justify-between w-full px-3 py-2 bg-stone-800 hover:bg-stone-750 transition-colors">
                      <div className="text-left">
                        <span className={`text-xs font-bold uppercase tracking-wide ${formatTabLocked ? 'text-stone-500' : 'text-orange-400'}`}>Visual Deck Export Schema</span>
                        <p className="text-[10px] text-stone-500">Extended export format with theme colors and deck summary. This schema is read-only.</p>
                      </div>
                      <ChevronRight className={`w-4 h-4 text-stone-500 transition-transform flex-shrink-0 ${settingsCollapsed.vis_fmt ? '' : 'rotate-90'}`} />
                    </button>
                    {!settingsCollapsed.vis_fmt && (
                      <div className="px-3 pb-3 pt-2">
                        <textarea readOnly value={`DECK SUMMARY\n═══════════════════════════════════════\n▸ DECK TITLE: [Title from Page 1]\n▸ PAGE COUNT: [Total pages]\n▸ SELECTED THEME: [Name] — [#hex1, #hex2, #hex3, #hex4]\n▸ VISUAL DESCRIPTION: [AI-generated mood/texture description]\n═══════════════════════════════════════\n\n[Standard DECKOUTLINE page content]\nSLIDE #1 — [Layout]\n▸ TITLE: ...\n▸ SUBTITLE: ...\n▸ COPY/TEXT CONTENT: ...\n▸ REQUIRED ASSETS: ...\n▸ LAYOUT STRUCTURE: ...\n▸ VISUAL STYLING: ...\n▸ COMPONENT GEOMETRY: { "canvas": {...}, "frames": [...] }\n═══════════════════════════════════════\n[...additional slides...]\n═══════════════════════════════════════\n\nALTERNATE THEME COLORS\n═══════════════════════════════════════\n• [Theme Name]: #hex1, #hex2, #hex3, #hex4\n• [Theme Name]: #hex1, #hex2, #hex3, #hex4\n═══════════════════════════════════════`} className="w-full h-80 px-3 py-2 bg-stone-950 border-2 border-stone-600 rounded-sm text-stone-400 text-xs font-mono focus:outline-none resize-none settings-scrollbar cursor-not-allowed" />
                      </div>
                    )}
                  </div>

                  {/* Image Prompt Export Schema */}
                  <div className="border-b border-stone-700 overflow-hidden">
                    <button onClick={() => setSettingsCollapsed(p => ({...p, img_fmt: !p.img_fmt}))} className="flex items-center justify-between w-full px-3 py-2 bg-stone-800 hover:bg-stone-750 transition-colors">
                      <div className="text-left">
                        <span className={`text-xs font-bold uppercase tracking-wide ${formatTabLocked ? 'text-stone-500' : 'text-orange-400'}`}>Image Prompt Export Schema</span>
                        <p className="text-[10px] text-stone-500">Markdown structure for generated image prompts file</p>
                      </div>
                      <ChevronRight className={`w-4 h-4 text-stone-500 transition-transform flex-shrink-0 ${settingsCollapsed.img_fmt ? '' : 'rotate-90'}`} />
                    </button>
                    {!settingsCollapsed.img_fmt && (
                      <div className="px-3 pb-3 pt-2">
                        <textarea value={imgPromptOutputFormat} onChange={(e) => setImgPromptOutputFormat(e.target.value)} disabled={formatTabLocked} className={`w-full h-80 px-3 py-2 bg-stone-950 border-2 border-stone-600 rounded-sm text-orange-400 text-xs font-mono focus:outline-none focus:border-orange-500 resize-none settings-scrollbar ${formatTabLocked ? 'cursor-not-allowed' : ''}`} />
                        <button onClick={() => setImgPromptOutputFormat(DEFAULT_IMG_PROMPT_OUTPUT_FORMAT)} disabled={formatTabLocked} className={`mt-1 text-[10px] ${formatTabLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}>Reset to default</button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            
            {/* Panel Footer */}
            <div className="px-4 py-3 border-t-2 border-stone-600 flex-shrink-0 flex items-center justify-between">
              <p className="text-[10px] text-stone-500 flex-1">
                Changes are applied immediately. Use "Reset to default" to restore original settings.
              </p>
              <button
                onClick={() => setShowHelpModal(true)}
                className="ml-3 p-1.5 bg-stone-700 hover:bg-stone-600 rounded-sm transition-colors"
                title="Help & Documentation"
              >
                <HelpCircle className="w-4 h-4 text-orange-400" />
              </button>
            </div>
          </div>
          
          {/* CSS Animation and Scrollbar Styles */}
          <style>{`
            @keyframes slideInRight {
              from {
                transform: translateX(100%);
              }
              to {
                transform: translateX(0);
              }
            }
          `}</style>
        </div>
      )}
      
      {/* Help Modal - Higher z-index to appear above settings panel */}
      {showHelpModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setShowHelpModal(false)}
          />
          {/* Modal */}
          <div className="relative bg-stone-800 border-2 border-stone-600 rounded-sm shadow-2xl flex flex-col" style={{ width: '850px', height: '82vh' }}>
            {/* Modal Header */}
            <div className="bg-stone-700 px-4 py-3 flex items-center justify-between border-b-2 border-stone-600 flex-shrink-0">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-orange-400" />
                <span className="font-bold text-orange-400 uppercase tracking-wide">Help & Documentation</span>
              </div>
              <button
                onClick={() => setShowHelpModal(false)}
                className="p-1 hover:bg-stone-600 rounded transition-colors"
              >
                <X className="w-5 h-5 text-stone-400" />
              </button>
            </div>

            {/* Modal Body — Sidebar + Content */}
            <div className="flex-1 flex overflow-hidden">
              {/* Sidebar — Table of Contents */}
              <nav className="w-52 flex-shrink-0 bg-stone-900 border-r border-stone-700 overflow-y-auto settings-scrollbar py-2 flex flex-col">
                <div className="flex-1">
                {DOG_HELP_SIDEBAR_ITEMS.map(item => (
                  <button
                    key={item.id}
                    onClick={() => setHelpPage(item.id)}
                    className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${
                      helpPage === item.id
                        ? 'bg-stone-800 text-orange-400 font-bold border-l-2 border-orange-500'
                        : 'text-stone-400 hover:bg-stone-800 hover:text-stone-300 border-l-2 border-transparent'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
                </div>
                <div className="px-3 py-2 border-t border-stone-800">
                  <span className="text-xs text-stone-500 font-mono">{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v?'}</span>
                </div>
              </nav>

              {/* Content Area */}
              <div className="flex-1 overflow-y-auto p-5 settings-scrollbar">

              <DogHelpContent helpPage={helpPage} />
            </div>

          </div>
        </div>
        </div>
      )}

      {/* Right-Click Context Menu */}
      {contextMenu.visible && (
        <div
          className="fixed z-[70] bg-stone-800 border-2 border-stone-600 rounded-sm shadow-xl py-1 min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <style>{`
            .ctx-btn { border-left: 3px solid transparent; transition: all 0.1s ease; cursor: pointer; }
            .ctx-btn:hover:not(:disabled) { border-left-color: #f97316; background: rgba(249,115,22,0.12); }
            .ctx-btn:disabled { color: #57534e; cursor: default; }
            .ctx-btn:disabled:hover { border-left-color: transparent; background: transparent; }
          `}</style>
          {/* Section 1: Edit — text view only */}
          {contextMenu.source !== 'visualizer' && (
            <>
              <button onClick={() => handleClipboardAction('undo')} className="ctx-btn w-full px-3 py-1.5 text-left text-xs text-orange-400 flex items-center gap-2">
                <Undo2 className="w-3 h-3 flex-shrink-0" /> Undo <span className="ml-auto text-stone-600 text-[10px]">{modKey}Z</span>
              </button>
              <button onClick={() => handleClipboardAction('redo')} className="ctx-btn w-full px-3 py-1.5 text-left text-xs text-orange-400 flex items-center gap-2">
                <Redo2 className="w-3 h-3 flex-shrink-0" /> Redo <span className="ml-auto text-stone-600 text-[10px]">{shiftModKey}Z</span>
              </button>

              {/* Divider */}
              <div className="border-t border-stone-600 my-1" />

              {/* Section 2: Clipboard */}
              <button onClick={() => handleClipboardAction('cut')} className="ctx-btn w-full px-3 py-1.5 text-left text-xs text-orange-400 flex items-center gap-2">
                <Scissors className="w-3 h-3 flex-shrink-0" /> Cut <span className="ml-auto text-stone-600 text-[10px]">{modKey}X</span>
              </button>
              <button onClick={() => handleClipboardAction('copy')} className="ctx-btn w-full px-3 py-1.5 text-left text-xs text-orange-400 flex items-center gap-2">
                <Copy className="w-3 h-3 flex-shrink-0" /> Copy <span className="ml-auto text-stone-600 text-[10px]">{modKey}C</span>
              </button>
              <button onClick={() => handleClipboardAction('paste')} className="ctx-btn w-full px-3 py-1.5 text-left text-xs text-orange-400 flex items-center gap-2">
                <ClipboardList className="w-3 h-3 flex-shrink-0" /> Paste <span className="ml-auto text-stone-600 text-[10px]">{modKey}V</span>
              </button>

              {/* Divider */}
              <div className="border-t border-stone-600 my-1" />
            </>
          )}

          {/* AI Rewrite — shown in both views */}
          <div className="px-3 py-1">
            <span className="text-[9px] text-stone-500 uppercase tracking-wide font-bold">AI Rewrite</span>
          </div>
          {Object.entries(REWRITE_LABELS).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => handleRewriteRequest(mode)}
              className="ctx-btn w-full px-3 py-1.5 text-left text-xs text-orange-400 flex items-center gap-2"
            >
              <Sparkles className="w-3 h-3 flex-shrink-0" />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Footer bar is now managed by App.jsx container */}

      {/* New Project Modal */}
      {showNewProjectModal && (
        <div
          onClick={resetNewProjectModal}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-stone-800 border-2 border-stone-600 rounded-sm shadow-xl"
            style={{ width: '520px', maxHeight: '85vh', padding: '24px', overflowY: 'auto' }}
          >
            <h3 className="text-sm font-bold uppercase tracking-widest text-orange-400 mb-4">Create New Project</h3>
            <div className="space-y-4">
              {/* Title */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1 block">Project Title</label>
                <input
                  type="text"
                  value={newProjectTitle}
                  onChange={(e) => setNewProjectTitle(e.target.value)}
                  placeholder="Enter project title..."
                  autoFocus
                  className="w-full px-3 py-2 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '2px solid #44403c' }}
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1 block">Description</label>
                <textarea
                  value={newProjectDescription}
                  onChange={(e) => setNewProjectDescription(e.target.value)}
                  placeholder="Brief description of the project..."
                  rows={3}
                  className="w-full px-3 py-2 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                  style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '2px solid #44403c' }}
                />
              </div>

              {/* Dates */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1 block">Start Date</label>
                  <input
                    type="date"
                    value={newProjectStartDate}
                    onChange={(e) => setNewProjectStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '2px solid #44403c', colorScheme: 'dark' }}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1 block">End Date</label>
                  <input
                    type="date"
                    value={newProjectEndDate}
                    onChange={(e) => setNewProjectEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '2px solid #44403c', colorScheme: 'dark' }}
                  />
                </div>
              </div>

              {/* Documents Upload — cloud projects have no attachment home
                  yet (locked #17 / S14 storage work), so the pickers degrade
                  to an explanation rather than losing files silently. */}
              {cloudProjects ? (
                <p className="text-[10px] text-stone-500 border border-stone-700 rounded-sm px-2 py-2 bg-stone-900/50">
                  File attachments on cloud projects arrive with the storage
                  work. Create the project here, then upload files in the
                  generator panel to include them in generation.
                </p>
              ) : (<>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1 block">Documents</label>
                <div
                  onClick={() => document.getElementById('new-proj-docs-input')?.click()}
                  className="border-2 border-dashed border-stone-600 rounded-sm px-3 py-3 text-center cursor-pointer hover:border-orange-500 transition-colors"
                  style={{ backgroundColor: '#1c1917' }}
                >
                  <p className="text-[10px] text-stone-500">Click to upload documents (.pdf, .doc, .txt, .md, .csv)</p>
                  <input
                    id="new-proj-docs-input"
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.txt,.md,.csv,.xlsx"
                    onChange={(e) => { handleNewProjectFileUpload('documents', e.target.files); e.target.value = ''; }}
                    style={{ display: 'none' }}
                  />
                </div>
                {newProjectDocuments.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {newProjectDocuments.map(f => (
                      <div key={f.id} className="flex items-center justify-between px-2 py-1 bg-stone-900/50 rounded-sm border border-stone-700">
                        <span className="text-[10px] text-stone-400 truncate flex-1 mr-2">{f.name}</span>
                        <button
                          onClick={() => setNewProjectDocuments(prev => prev.filter(d => d.id !== f.id))}
                          className="text-[10px] text-stone-600 hover:text-red-500 transition-colors flex-shrink-0"
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Visual Assets Upload */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1 block">Visual Assets</label>
                <div
                  onClick={() => document.getElementById('new-proj-assets-input')?.click()}
                  className="border-2 border-dashed border-stone-600 rounded-sm px-3 py-3 text-center cursor-pointer hover:border-orange-500 transition-colors"
                  style={{ backgroundColor: '#1c1917' }}
                >
                  <p className="text-[10px] text-stone-500">Click to upload images or videos</p>
                  <input
                    id="new-proj-assets-input"
                    type="file"
                    multiple
                    accept="image/*,video/*"
                    onChange={(e) => { handleNewProjectFileUpload('assets', e.target.files); e.target.value = ''; }}
                    style={{ display: 'none' }}
                  />
                </div>
                {newProjectAssets.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {newProjectAssets.map(f => (
                      <div key={f.id} className="flex items-center justify-between px-2 py-1 bg-stone-900/50 rounded-sm border border-stone-700">
                        {f.type?.startsWith('image/') && (
                          <img src={f.content} alt="" className="w-6 h-6 object-cover rounded-sm mr-2 flex-shrink-0" />
                        )}
                        <span className="text-[10px] text-stone-400 truncate flex-1 mr-2">{f.name}</span>
                        <button
                          onClick={() => setNewProjectAssets(prev => prev.filter(a => a.id !== f.id))}
                          className="text-[10px] text-stone-600 hover:text-red-500 transition-colors flex-shrink-0"
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              </>)}
            </div>

            {/* Buttons */}
            <div className="flex gap-3 mt-5">
              <button
                onClick={resetNewProjectModal}
                className="flex-1 px-4 py-2 text-xs font-bold uppercase tracking-wide rounded-sm transition-colors"
                style={{ backgroundColor: '#44403c', color: '#a8a29e' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateProjectFromModal}
                disabled={!newProjectTitle.trim()}
                className="flex-1 px-4 py-2 text-xs font-bold uppercase tracking-wide rounded-sm transition-colors disabled:opacity-40"
                style={{ backgroundColor: '#ea580c', color: '#fff' }}
              >
                Create Project
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
