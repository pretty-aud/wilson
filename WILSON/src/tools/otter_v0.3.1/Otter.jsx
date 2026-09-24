import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import Editor from '@monaco-editor/react';
/* Monaco takes its size as a NUMBER, and `TYPE.body` IS a number: `tokens.js`
   builds TYPE with `Number(THEME['text-body'].replace('px',''))`, so this is
   the scale reaching a third-party API that cannot take a CSS string. T1
   first allowlisted the hard-coded 14 on the grounds that "a token string
   would break the editor" — true of a string, and beside the point, because
   there was a numeric token the whole time. A reviewer found it. */
import { TYPE } from '../../ui/tokens.js';
import { Menu, Tabs, Panel, Button, IconButton, EmptyState, Card, SectionTitle, Badge, Banner, Select, Chip, Table, Row, Th, Td, Kbd, Loading, Dialog } from '../../ui';
import {
  X, Settings, ChevronDown, ChevronRight,
  Plus, Trash2, Download, Upload, Search, BookOpen, GraduationCap,
  Keyboard, Loader2, Check, AlertCircle,
  RotateCcw, Eye, FileJson, Clock, Lightbulb,
  Code, HelpCircle, ArrowLeft, ArrowRight, Star, CheckCircle2,
  Lock, Unlock, Library, Braces, FolderOpen, Share2,
  Link, ExternalLink, ShieldCheck, GitPullRequestArrow
} from 'lucide-react';
import {
  FULL_COURSE_OUTLINE_PROMPT, SUBJECT_GENERATION_PROMPT, SINGLE_SUBJECT_PROMPT,
  MULTIPLE_CHOICE_PROMPT, CODE_IDENTIFICATION_PROMPT, CODE_WRITING_PROMPT, COMPANION_PROMPT,
  NODES_GENERATION_PROMPT
} from './prompts.js';
// Session 10: content routes go through the adapter seam instead of straight
// to the in-app Express server — cloud when signed in, local otherwise, and
// the only thing that works at all in the Session 11 web build.
import { otterFetch, otterCloudActive } from './adapters';
import { callAI, isRetryableAIError } from '../../cloud/aiProxy';
import { hasLocalServer, loadOtterSettings, saveOtterSettings } from '../../lib/localData';
import { pushSettingsToCloud } from '../../lib/userState';
import { modelFor } from '../../lib/activeModel';
import Validator from './Validator';
import { OTTER_HELP_SIDEBAR_ITEMS, OtterHelpContent } from '../../data/otterHelpContent';
import { useAgent } from '../../agent';
// ── Session 11: sharing, tiers, trash and change requests ──
// Everything below attaches to the EXISTING two-sidebar shell — chips above the
// existing lists, a menu on the existing rows, dialogs off that menu. The one
// authorised shell change is the Sidebar 1 collapse (SidebarCollapse.jsx).
import { usePermissions } from '../../permissions';
import {
  useSidebarCollapse, SidebarCollapseButton, SidebarReopenRail,
} from './components/SidebarCollapse.jsx';
import CourseFilterChips from './components/CourseFilterChips.jsx';
import CourseRowMenu from './components/CourseRowMenu.jsx';
import ShareCourseDialog from './components/ShareCourseDialog.jsx';
import ChangeRequestDialog from './components/ChangeRequestDialog.jsx';
// Session 13 follow-up (Audrey, 2026-07-30): change requests live IN the tool —
// the review queue for admins (+ standard-course owners), a read-only queue
// for managers (0026), and every proposer's own requests + feedback.
import RequestsView from './components/RequestsView.jsx';
import TrashPanel, { TrashSidebarList } from './components/TrashPanel.jsx';
import './otter.css';
import {
  VisibilityBadge, OwnerBadge, MetadataOnlyBadge, ReadOnlyBadge,
} from './components/CourseBadges.jsx';
import {
  courseMatchesFilter, canWriteCourse, canReadCourse, findStandardByName,
  VISIBILITY_META, filtersFor,
} from './components/otterSharing.js';

// ═══════════════════════════════════════════════════════════════════
//  THE LESSON'S CODE BLOCK (A3). react-markdown wraps every fence in its own
//  <pre>, even when the `code` renderer returns the highlighter (PreTag="div"
//  names only the highlighter's inner wrapper), so `.lesson-content pre` in
//  index.css draws the ONE code well for tagged and untagged fences alike.
//  oneDark's block style is inline and would draw a second well inside it —
//  a cool hsl(220) ground, its own padding, margin and radius, Fira Code —
//  so this object takes all of that away and keeps only the app's mono. The
//  syntax colours on the tokens inside are data and stay the theme's, but
//  for the comments (LESSON_CODE_THEME, below).
//  (A3 review round 1 measured the first version: two nested wells.)
//  The box is as wide as its code, so a scrolled line ends 16px inside the
//  well as an untagged fence's does (it ended on the edge — round 2).
// ═══════════════════════════════════════════════════════════════════
const LESSON_CODE_BLOCK = {
  background: 'transparent',
  color: 'inherit',
  border: 0,
  borderRadius: 0,
  padding: 0,
  margin: 0,
  overflow: 'visible',
  width: 'max-content',
  minWidth: '100%',
  textShadow: 'none',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-dense)',
  lineHeight: 'var(--text-dense--line-height)',
};
// oneDark draws comments in hsl(220 10% 40%): 3.27:1 on the well at 13px,
// the one text on the lesson page under AA (A3 review round 2). The third
// ink is the app's own quiet text and measures 5.70:1 there. Its colours are
// inline styles, so they are changed in the theme object, not in CSS.
const LESSON_CODE_THEME = {
  ...oneDark,
  comment: { ...oneDark.comment, color: 'var(--color-ink-3)' },
  prolog: { ...oneDark.prolog, color: 'var(--color-ink-3)' },
  cdata: { ...oneDark.cdata, color: 'var(--color-ink-3)' },
};
const LESSON_CODE_TEXT = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-dense)',
  lineHeight: 'var(--text-dense--line-height)',
  whiteSpace: 'pre',
};

// ═══════════════════════════════════════════════════════════════════
//  NODE TYPE BADGE (defined outside component to avoid re-creation)
//
//  🚨 Q9 (plan §2, in force): these fifteen colours are ASSUMED to mirror the
//  host application's own socket colours (Blender's, Unreal's), which makes
//  them load-bearing DATA rather than decoration — "kept and documented as
//  an exempt ramp". They are the one set of cool hues on O.T.T.E.R.'s
//  surface and the only hexes it writes; the visual language's warm-only
//  rule does not reach them. If Audrey rules the other way (Q9's
//  alternative: eight from one hue rotation plus "other"), this map is the
//  one place that changes. The badge itself is the kit's (A3): the Label
//  step, one hairline and one fill — the socket colour reaches it through
//  --node-color, as a bin's colour reaches the kit Chip.
// ═══════════════════════════════════════════════════════════════════
const NODE_TYPE_COLORS = {
  'Float': '#60a5fa', 'Integer': '#818cf8', 'Vector': '#c084fc',
  'Color': '#facc15', 'Shader': '#4ade80', 'Geometry': '#2dd4bf',
  'String': '#fb923c', 'Boolean': '#f87171', 'Image': '#f472b6',
  'Object': '#fbbf24', 'Collection': '#a3e635', 'Material': '#34d399',
  'Mesh': '#22d3ee', 'Curve': '#fb7185', 'Any': '#a8a29e'
};

function NodeTypeBadge({ type }) {
  const color = NODE_TYPE_COLORS[type] || NODE_TYPE_COLORS.Any;
  return (
    <Badge className="otter-node-type" style={{ '--node-color': color }}>
      <span className="otter-badge-label">{type || 'Any'}</span>
    </Badge>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN OTTER COMPONENT (tool inside WILSON)
// ═══════════════════════════════════════════════════════════════════
export default function Otter({ onNavigate, currentPage, openSettingsTrigger = 0, onContextChange }) {
  // ── Navigation state ──
  const [currentView, setCurrentView] = useState('library');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('prompts');
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [helpPage, setHelpPage] = useState('otter-overview');

  // Open settings when triggered from WILSON nav strip
  const prevSettingsTrigger = useRef(openSettingsTrigger);
  useEffect(() => {
    if (openSettingsTrigger !== prevSettingsTrigger.current) {
      prevSettingsTrigger.current = openSettingsTrigger;
      setSettingsOpen(true);
    }
  }, [openSettingsTrigger]);

  // ── Data state ──
  const [settings, setSettings] = useState(null);
  // S30: the reason a settings write was refused, shown beside the control.
  const [settingsError, setSettingsError] = useState(null);

  // ── Software/Language hierarchy ──
  const [softwareList, setSoftwareList] = useState([]);
  const [activeSoftwareSlug, setActiveSoftwareSlug] = useState(null);
  const [activeSoftware, setActiveSoftware] = useState(null);
  const [subjectList, setSubjectList] = useState([]);
  const [activeSubjectSlug, setActiveSubjectSlug] = useState(null);
  const [activeSubject, setActiveSubject] = useState(null);
  const [expandedSoftware, setExpandedSoftware] = useState(null);
  const [softwareHotkeys, setSoftwareHotkeys] = useState(null);
  const [activeProgress, setActiveProgress] = useState(null);

  // ── Sidebar lesson navigation ──
  const [expandedSubjectSections, setExpandedSubjectSections] = useState({});
  const [selectedLessonId, setSelectedLessonId] = useState(null);

  // ── Quiz state ──
  const [quizScope, setQuizScope] = useState('software');
  const [quizTab, setQuizTab] = useState('mc');
  const [quizTypes, setQuizTypes] = useState(new Set(['mc']));
  const [quizQuestions, setQuizQuestions] = useState(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [quizScore, setQuizScore] = useState(0);
  const [quizComplete, setQuizComplete] = useState(false);
  // Session 30: the result of trying to RECORD the attempt, shown on the
  // results screen. O.T.T.E.R.'s house defect is the swallowed error, and a
  // score that silently fails to save is the exact complaint this replaces.
  const [quizSaveState, setQuizSaveState] = useState(null); // null | 'saving' | 'saved' | {error}

  // ── Quiz selection state ──
  const [quizSelections, setQuizSelections] = useState({});
  const [quizStarted, setQuizStarted] = useState(false);
  const [showQuizLeaveConfirm, setShowQuizLeaveConfirm] = useState(null);
  const [quizSelectionData, setQuizSelectionData] = useState({});
  const [quizExpanded, setQuizExpanded] = useState({});

  // ── Code writing state ──
  const [challenges, setChallenges] = useState(null);
  const [currentChallenge, setCurrentChallenge] = useState(0);
  const [userCode, setUserCode] = useState('');
  const [hintsShown, setHintsShown] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  const [showSolutionConfirm, setShowSolutionConfirm] = useState(false);

  // ── Hotkey / Functions state ──
  const [hotkeySearch, setHotkeySearch] = useState('');
  const [softwareFunctions, setSoftwareFunctions] = useState(null);
  const [functionSearch, setFunctionSearch] = useState('');

  // ── Nodes state ──
  const [softwareNodes, setSoftwareNodes] = useState(null);
  const [nodeSearch, setNodeSearch] = useState('');
  const [activeNodeSystem, setActiveNodeSystem] = useState(null); // tracks which node system tab is active

  // ── Sidebar refs for scroll-to-category ──
  const hotkeyScrollRef = useRef(null);
  const nodeScrollRef = useRef(null);
  const functionScrollRef = useRef(null);

  // ── Import state ──
  const [showImportModal, setShowImportModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const [showDeleteSubjectConfirm, setShowDeleteSubjectConfirm] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(null);
  const [importDragOver, setImportDragOver] = useState(false);
  const importFileRef = useRef(null);

  // ── Undo/Redo for subject deletions ──
  const [deletedSubjectsStack, setDeletedSubjectsStack] = useState([]);
  const [redoSubjectsStack, setRedoSubjectsStack] = useState([]);

  // ── Edit menu ── (the kit Menu since A3: it owns outside-click and Escape)
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const [editMenuPos, setEditMenuPos] = useState({ x: 0, y: 0 });
  const editPressWhileOpenRef = useRef(false);

  // ── Software name autocomplete ──
  const [showSoftwareDropdown, setShowSoftwareDropdown] = useState(false);
  const softwareInputRef = useRef(null);

  // ── Library sort ──
  const [sortBy, setSortBy] = useState('date');

  // ── Settings prompt editing ──
  const [editingPrompts, setEditingPrompts] = useState({});
  const [promptSections, setPromptSections] = useState({});

  // ── Settings panel lock states ──
  const [promptsTabLocked, setPromptsTabLocked] = useState(true);
  const [toolsTabLocked, setToolsTabLocked] = useState(true);

  // ── Search modal ──
  const [showSearchModal, setShowSearchModal] = useState(false);
  // A kit Menu floats over every dialog (its layer is 80) and Search is not a
  // kit Dialog yet, so Space with the Edit menu open would leave the menu over
  // the search dialog. Before A3 the dropdown sat under the search backdrop and
  // closed on the first click there; closing it as Search opens keeps that
  // outcome. (A3 review round 1.)
  useEffect(() => { if (showSearchModal) setEditMenuOpen(false); }, [showSearchModal]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedSearchResult, setSelectedSearchResult] = useState(null);
  const searchInputRef = useRef(null);

  // ── Prompt input state ──
  const [promptText, setPromptText] = useState('');
  const [skillLevel, setSkillLevel] = useState('beginner');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(null);
  const [genElapsed, setGenElapsed] = useState(0);
  const [genPhase, setGenPhase] = useState('');
  const genTimerRef = useRef(null);
  const generatingRef = useRef(false);
  const [promptMode, setPromptMode] = useState('course');
  const [softwareNameInput, setSoftwareNameInput] = useState('');
  const [referenceUrls, setReferenceUrls] = useState([]);
  const [referenceUrlInput, setReferenceUrlInput] = useState('');
  const [fetchingUrl, setFetchingUrl] = useState(false);

  // ── Generation queue (per-subject tracking) ──
  const [generatingSubjects, setGeneratingSubjects] = useState(new Map());
  const generatingSubjectsRef = useRef(new Map());
  const [genQueueCancelledRef] = useState(() => ({ current: new Set() }));
  const genAbortControllers = useRef(new Map());
  const [subjectErrors, setSubjectErrors] = useState({});

  // ═══════════════════════════════════════════════════════════════
  //  SESSION 11 — sharing, tiers, trash, change requests
  // ═══════════════════════════════════════════════════════════════

  // The one authorised change to the existing shell. Sidebar 2 — Lessons is
  // deliberately NOT collapsible: if it ever should be, it must reuse this same
  // hook so O.T.T.E.R. never grows two collapse mechanisms.
  // The shortcut is gated on O.T.T.E.R. actually being the visible page: this
  // component stays mounted while the user is in RABBIT, Settings or the Admin
  // Terminal (App.jsx renders every page and toggles `display`), so an
  // unconditional window listener would toggle — and persist — a sidebar the
  // user cannot even see.
  const sidebar1 = useSidebarCollapse('otter.sidebar1.collapsed', {
    shortcutEnabled: currentPage === 'otter',
  });

  const perms = usePermissions();
  const appRole = perms.role;

  // Cloud vs local. Read from the ADAPTER, not from usePermissions alone: the
  // Settings mode override can pin local while a session exists, and the
  // sharing controls must appear exactly when the backend behind them works.
  const [cloudMode, setCloudMode] = useState(false);
  useEffect(() => {
    let alive = true;
    otterCloudActive().then(v => { if (alive) setCloudMode(v); }).catch(() => {});
    return () => { alive = false; };
  }, [perms.ready, perms.workspaceId]);

  // ── Library filter chips (courses; subjects inherit — see CourseFilterChips) ──
  const [courseFilter, setCourseFilter] = useState('all');

  // Leaving cloud mode hides the chip strip, so any filter still selected would
  // become a room with no door — most visibly 'trash', which would then render
  // an empty "Recently deleted" pane forever with no way back to the library.
  useEffect(() => {
    if (!cloudMode) setCourseFilter('all');
  }, [cloudMode]);

  // Same trap, one state over: leaving cloud mode unmounts the Requests nav
  // button, so the view must not stay on a pane with no door — and every op
  // in it is cloudOnly (501 locally) anyway.
  useEffect(() => {
    if (!cloudMode && currentView === 'requests') setCurrentView('library');
  }, [cloudMode, currentView]);

  // Same trap one level down: the admin-only chip disappears when an admin is
  // demoted mid-session.
  useEffect(() => {
    if (courseFilter === 'unopenable' && appRole !== 'admin') setCourseFilter('all');
  }, [courseFilter, appRole]);

  // ── Trash ("Recently deleted" is a filter state, not a view) ──
  const [trashRows, setTrashRows] = useState([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashBusyId, setTrashBusyId] = useState(null);
  const [trashError, setTrashError] = useState(null);

  // ── Dialogs off the course row menu ──
  const [shareDialogCourse, setShareDialogCourse] = useState(null);
  const [crDialogCourse, setCrDialogCourse] = useState(null);
  // Bumped when the change-request dialog closes so a mounted RequestsView
  // reloads — the dialog is the proposer's actuator (resubmit / withdraw /
  // accept), and the list behind it must not keep advertising finished work.
  const [requestsRefreshTick, setRequestsRefreshTick] = useState(0);
  const [sharingNotice, setSharingNotice] = useState(null);
  // Separate from genError: that one renders only on the prompt screen, and
  // fork/share can both be triggered from the Library and the sidebar.
  const [sharingError, setSharingError] = useState(null);

  // ── Tier picker in the existing create-course flow ──
  const [newCourseVisibility, setNewCourseVisibility] = useState('personal');
  const [forkBusy, setForkBusy] = useState(false);

  // ═══════════════════════════════════════════════════════════════
  //  AGENT INTEGRATION — register tool interface with agent system
  // ═══════════════════════════════════════════════════════════════
  const agent = useAgent();

  // Report context changes to parent (App.jsx) and agent
  useEffect(() => {
    const ctx = { activeSoftwareSlug, activeSubjectSlug, selectedLessonId };
    onContextChange?.(ctx);
  }, [activeSoftwareSlug, activeSubjectSlug, selectedLessonId, onContextChange]);

  // Register agent tool interface
  useEffect(() => {
    if (!agent) return;

    const toolInterface = {
      toolName: 'otter',
      get currentContext() {
        return { activeSoftwareSlug, activeSubjectSlug, selectedLessonId };
      },
      async getAvailableSubjects() {
        if (!activeSoftwareSlug) return [];
        try {
          const res = await otterFetch(`/api/software/${activeSoftwareSlug}/subjects`);
          return await res.json();
        } catch { return []; }
      },
      getContent(lessonId) {
        if (!activeSubject?.sections) return null;
        for (const section of activeSubject.sections) {
          const lesson = section.lessons?.find(l => l.id === lessonId);
          if (lesson) {
            return `# ${lesson.title}\n\n${lesson.content}\n\n## Key Takeaways\n${(lesson.key_takeaways || []).map(t => `- ${t}`).join('\n')}\n\n## Practice\n${lesson.practice_prompt || ''}`;
          }
        }
        return null;
      },
      async applyChange(target, changes) {
        // Load the full subject
        const res = await otterFetch(`/api/software/${activeSoftwareSlug}/subjects/${target.subject_slug}`);
        if (!res.ok) throw new Error('Failed to load subject');
        const subject = await res.json();

        // Apply each change
        for (const change of changes) {
          for (const section of subject.sections || []) {
            const lesson = section.lessons?.find(l => l.id === target.lesson_id);
            if (lesson && change.field === 'content') {
              lesson.content = lesson.content.replace(change.original, change.proposed);
            } else if (lesson && change.field === 'key_takeaways') {
              lesson.key_takeaways = lesson.key_takeaways.map(t =>
                t === change.original ? change.proposed : t
              );
            } else if (lesson && change.field === 'practice_prompt') {
              if (lesson.practice_prompt === change.original) {
                lesson.practice_prompt = change.proposed;
              }
            }
          }
        }

        subject.updated_at = new Date().toISOString();

        // Save back
        const saveRes = await otterFetch(`/api/software/${activeSoftwareSlug}/subjects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subject),
        });
        if (!saveRes.ok) throw new Error('Failed to save subject');

        // Refresh local state
        setActiveSubject(subject);
        invalidateCache(activeSoftwareSlug);
      },
      async getCorrections() {
        if (!activeSoftwareSlug) return [];
        try {
          const res = await otterFetch(`/api/software/${activeSoftwareSlug}/corrections`);
          const data = await res.json();
          return data.corrections || [];
        } catch { return []; }
      },
      async saveCorrection(correction) {
        if (!activeSoftwareSlug) return;
        await otterFetch(`/api/software/${activeSoftwareSlug}/corrections`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ corrections: [correction] }),
        });
      },
      async getSubjectData(subjectSlug) {
        try {
          const res = await otterFetch(`/api/software/${activeSoftwareSlug}/subjects/${subjectSlug}`);
          if (!res.ok) return null;
          return await res.json();
        } catch { return null; }
      },
      // Agent generation: create a single subject using the full AI pipeline
      async generateSingleSubjectFromAgent(topic, overrideSlug) {
        return agentGenSingleRef.current(topic, overrideSlug || activeSoftwareSlug);
      },
      // Agent generation: create a full course with subject stubs
      async generateCourseFromAgent(softwareName, description) {
        return agentGenCourseRef.current(softwareName, description);
      },
      // Agent generation: fill a stub subject with real content
      async generateSubjectContentFromAgent(subjectSlug) {
        return generateSubjectContent(subjectSlug, { skipNavigation: true });
      },
      // Get active software metadata (name, type)
      async getActiveSoftwareMeta() {
        if (!activeSoftwareSlug) return null;
        const cached = softwareCacheRef.current[activeSoftwareSlug];
        if (cached?.meta) return cached.meta;
        try { return await otterFetch(`/api/software/${activeSoftwareSlug}`).then(r => r.json()); }
        catch { return null; }
      },
    };

    agent.registerTool('otter', toolInterface);
    return () => agent.unregisterTool('otter');
  }, [agent, activeSoftwareSlug, activeSubjectSlug, selectedLessonId, activeSubject]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tell the agent system this tool is in the foreground whenever
  // the OTTER page is visible. Mirrors the pattern used by RABBIT —
  // the all-pages-rendered layout means we can't rely on mount/unmount,
  // we have to gate on currentPage. Without this, activeTool stays
  // pinned to whatever tool was visited last (e.g. 'rabbit'), which
  // causes the PET agent to respond as the wrong tool and refuse
  // OTTER-only actions like course generation.
  useEffect(() => {
    if (!agent) return;
    if (currentPage === 'otter') {
      agent.setActiveTool?.('otter');
    }
  }, [agent, currentPage]);

  // ═══════════════════════════════════════════════════════════════
  //  DATA LOADERS — in-memory cache for instant UI
  // ═══════════════════════════════════════════════════════════════
  const softwareCacheRef = useRef({});
  const subjectCacheRef = useRef({});

  const invalidateCache = useCallback((slug) => {
    if (slug) {
      delete softwareCacheRef.current[slug];
      Object.keys(subjectCacheRef.current).forEach(key => {
        if (key.startsWith(slug + '/')) delete subjectCacheRef.current[key];
      });
    } else {
      softwareCacheRef.current = {};
      subjectCacheRef.current = {};
    }
  }, []);

  const loadSoftwareList = useCallback(async () => {
    try {
      const res = await otterFetch('/api/software');
      const data = await res.json();
      // A denied or failed request answers with an error OBJECT, not a list,
      // and every consumer below calls .find / .filter / .map on this state:
      // an un-guarded set threw `softwareList.find is not a function` and
      // unmounted the whole app (measured in dev tester mode, where every
      // RLS-gated call is a 401). SettingsPage already guards the same
      // response this way.
      setSoftwareList(Array.isArray(data) ? data : []);
      for (const sw of data) {
        if (!softwareCacheRef.current[sw.slug]) {
          Promise.all([
            otterFetch(`/api/software/${sw.slug}`).then(r => r.json()),
            otterFetch(`/api/software/${sw.slug}/subjects`).then(r => r.json()),
            otterFetch(`/api/software/${sw.slug}/progress`).then(r => r.json()),
            otterFetch(`/api/software/${sw.slug}/hotkeys`).then(r => r.json()),
            otterFetch(`/api/software/${sw.slug}/functions`).then(r => r.json()).catch(() => ({ categories: [] })),
            otterFetch(`/api/software/${sw.slug}/nodes`).then(r => r.json()).catch(() => ({ categories: [] })),
            otterFetch(`/api/software/${sw.slug}/references`).then(r => r.json()).catch(() => ({ urls: [] })),
          ]).then(([meta, subjects, progress, hotkeys, functions, nodes, refs]) => {
            softwareCacheRef.current[sw.slug] = { meta, subjects, progress, hotkeys, functions, nodes, references: refs.urls || [] };
            for (const sub of subjects) {
              const cacheKey = `${sw.slug}/${sub.slug}`;
              if (!subjectCacheRef.current[cacheKey]) {
                otterFetch(`/api/software/${sw.slug}/subjects/${sub.slug}`)
                  .then(r => r.json())
                  .then(fullSub => { subjectCacheRef.current[cacheKey] = fullSub; })
                  .catch(() => {});
              }
            }
          }).catch(() => {});
        }
      }
    } catch { /* ignore */ }
  }, []);

  const selectSoftware = useCallback((slug, forceReload = false) => {
    setActiveSoftwareSlug(slug);
    setExpandedSoftware(slug);
    const cached = softwareCacheRef.current[slug];
    if (cached && !forceReload) {
      setActiveSoftware(cached.meta);
      setSubjectList(cached.subjects);
      setActiveProgress(cached.progress);
      setSoftwareHotkeys(cached.hotkeys);
      setSoftwareFunctions(cached.functions || null);
      setSoftwareNodes(cached.nodes || null);
      setReferenceUrls(cached.references || []);
      return;
    }
    Promise.all([
      otterFetch(`/api/software/${slug}`).then(r => r.json()),
      otterFetch(`/api/software/${slug}/subjects`).then(r => r.json()),
      otterFetch(`/api/software/${slug}/progress`).then(r => r.json()),
      otterFetch(`/api/software/${slug}/hotkeys`).then(r => r.json()),
      otterFetch(`/api/software/${slug}/functions`).then(r => r.json()).catch(() => ({ categories: [] })),
      otterFetch(`/api/software/${slug}/nodes`).then(r => r.json()).catch(() => ({ categories: [] })),
      otterFetch(`/api/software/${slug}/references`).then(r => r.json()).catch(() => ({ urls: [] })),
    ]).then(([meta, subjects, progress, hotkeys, functions, nodes, refs]) => {
      softwareCacheRef.current[slug] = { meta, subjects, progress, hotkeys, functions, nodes, references: refs.urls || [] };
      setActiveSoftware(meta);
      setSubjectList(subjects);
      setActiveProgress(progress);
      setSoftwareHotkeys(hotkeys);
      setSoftwareFunctions(functions);
      setSoftwareNodes(nodes);
      setReferenceUrls(refs.urls || []);
      for (const sub of subjects) {
        const cacheKey = `${slug}/${sub.slug}`;
        if (!subjectCacheRef.current[cacheKey]) {
          otterFetch(`/api/software/${slug}/subjects/${sub.slug}`)
            .then(r => r.json())
            .then(fullSub => { subjectCacheRef.current[cacheKey] = fullSub; })
            .catch(() => {});
        }
      }
    }).catch(e => console.error('Failed to load software:', e));
  }, []);

  // Session 13: the Admin Terminal's "Open their course" jumps here. The
  // listener is deliberately NOT gated on currentPage — O.T.T.E.R. stays
  // mounted on every page (the all-pages shell), and this event only ever
  // fires from an explicit click in the Requests queue, so handling it while
  // hidden is exactly the point (App.jsx navigates the shell in parallel).
  // The course may be freshly readable (the 0025 review window), so the list
  // refreshes before selecting.
  useEffect(() => {
    const onOpenCourse = async (e) => {
      const slug = e?.detail?.slug
      if (!slug) return
      // The dispatcher already probed readability, but re-check here anyway:
      // if the review window closed in between, selectSoftware would cache the
      // 404's error JSON as course meta and hand the render a poisoned object.
      try {
        const probe = await otterFetch(`/api/software/${slug}`)
        if (!probe.ok) return
      } catch { return }
      await loadSoftwareList()
      selectSoftware(slug, true)
      setCurrentView('library')
    }
    window.addEventListener('wilson:open-otter-course', onOpenCourse)
    return () => window.removeEventListener('wilson:open-otter-course', onOpenCourse)
  }, [loadSoftwareList, selectSoftware])

  const selectSubject = useCallback((softwareSlug, subjectSlug) => {
    setActiveSubjectSlug(subjectSlug);
    const cacheKey = `${softwareSlug}/${subjectSlug}`;
    const cached = subjectCacheRef.current[cacheKey];
    if (cached) {
      setActiveSubject(cached);
      if (cached.sections?.length && !cached.is_stub) {
        const firstSec = cached.sections[0];
        setExpandedSubjectSections({ [firstSec.id]: true });
        if (firstSec.lessons?.length) setSelectedLessonId(firstSec.lessons[0].id);
      }
      return;
    }
    otterFetch(`/api/software/${softwareSlug}/subjects/${subjectSlug}`)
      .then(r => r.json())
      .then(data => {
        subjectCacheRef.current[cacheKey] = data;
        setActiveSubject(data);
        if (data.sections?.length && !data.is_stub) {
          const firstSec = data.sections[0];
          setExpandedSubjectSections({ [firstSec.id]: true });
          if (firstSec.lessons?.length) setSelectedLessonId(firstSec.lessons[0].id);
        }
      })
      .catch(e => console.error('Failed to load subject:', e));
  }, []);

  const saveProgress = useCallback(async (progress) => {
    if (!activeSoftwareSlug || !progress) return;
    await otterFetch(`/api/software/${activeSoftwareSlug}/progress`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(progress)
    });
  }, [activeSoftwareSlug]);

  // ═══════════════════════════════════════════════════════════════
  //  SESSION 11 — derived capability state + sharing handlers
  // ═══════════════════════════════════════════════════════════════

  // The list row carries the capability flags (they come from
  // otter_course_index via course.list); the per-course `meta` from course.get
  // does not have can_write at all. Always ask the list.
  const activeCourseRow = useMemo(
    () => softwareList.find(sw => sw.slug === activeSoftwareSlug) || null,
    [softwareList, activeSoftwareSlug],
  );

  // Gates every generate/edit affordance. Defaults OPEN so signing out of the
  // cloud does not disable a single-user local install (the Express server
  // sends no can_write at all).
  const activeCanWrite = canWriteCourse(activeCourseRow);
  const activeCanRead  = canReadCourse(activeCourseRow);

  const visibleCourses = useMemo(
    () => softwareList.filter(sw => courseMatchesFilter(sw, courseFilter)),
    [softwareList, courseFilter],
  );

  const filterCounts = useMemo(() => {
    const counts = {};
    for (const chip of filtersFor(appRole)) {
      counts[chip.key] = chip.key === 'trash'
        ? trashRows.length
        : softwareList.filter(sw => courseMatchesFilter(sw, chip.key)).length;
    }
    return counts;
  }, [softwareList, appRole, trashRows.length]);

  const loadTrash = useCallback(async () => {
    if (!cloudMode) { setTrashRows([]); return; }
    setTrashLoading(true);
    try {
      const res = await otterFetch('/api/otter/trash');
      const data = await res.json();
      // Every O.T.T.E.R. call site historically ignored res.ok; this one must
      // not — an unchecked failure here reads as "your trash is empty", which
      // is the most alarming possible lie for this particular screen.
      if (!res.ok) throw new Error(data?.error || 'Could not load deleted items');
      setTrashRows(Array.isArray(data) ? data : []);
      setTrashError(null);
    } catch (e) {
      setTrashRows([]);
      setTrashError(e.message);
    } finally {
      setTrashLoading(false);
    }
  }, [cloudMode]);

  // Fetch only when the chip is actually selected — the trash is a rarely-used
  // surface and this keeps it off the launch path entirely.
  useEffect(() => {
    if (courseFilter === 'trash') loadTrash();
  }, [courseFilter, loadTrash]);

  const restoreTrashRow = useCallback(async (row) => {
    if (trashBusyId) return;
    setTrashBusyId(row.id);
    setTrashError(null);
    try {
      const res = await otterFetch('/api/otter/trash/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: row.kind, id: row.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not restore this');
      if (!data.restored) throw new Error('This was already restored, or it has been deleted for good.');

      invalidateCache(row.kind === 'subject' ? row.course_id : row.id);
      await Promise.all([loadTrash(), loadSoftwareList()]);
      // Peak-End: land the user back ON the thing they just rescued rather
      // than on a list that is now one item shorter.
      if (row.kind === 'course') {
        selectSoftware(row.id, true);
        setCourseFilter('all');
        setCurrentView('library');
      } else if (row.course_id === activeSoftwareSlug) {
        selectSoftware(row.course_id, true);
      }
    } catch (e) {
      setTrashError(e.message);
    } finally {
      setTrashBusyId(null);
    }
  }, [trashBusyId, loadTrash, loadSoftwareList, invalidateCache, selectSoftware, activeSoftwareSlug]);

  // A course row came back from the server after a write. Merge what it
  // actually says — NEVER what we sent — then re-read the list so the
  // capability flags (which only otter_course_index computes) stay correct.
  const handleCourseChanged = useCallback((row) => {
    if (!row?.slug) return;
    setSoftwareList(prev => prev.map(sw => (sw.slug === row.slug ? { ...sw, ...row } : sw)));
    setShareDialogCourse(prev => (prev && prev.slug === row.slug ? { ...prev, ...row } : prev));
    // The change-request dialog holds its own SNAPSHOT taken from softwareList
    // when the menu item fired. It branches on course.visibility to decide
    // whether to offer "also share my copy", so leaving it stale means a course
    // the user just shared still shows the share-it checkbox — and ticking it
    // would issue a redundant PATCH.
    setCrDialogCourse(prev => (prev && prev.slug === row.slug ? { ...prev, ...row } : prev));
    if (softwareCacheRef.current[row.slug]) {
      softwareCacheRef.current[row.slug].meta = { ...softwareCacheRef.current[row.slug].meta, ...row };
    }
    if (activeSoftwareSlug === row.slug) setActiveSoftware(m => ({ ...m, ...row }));
    loadSoftwareList();
  }, [activeSoftwareSlug, loadSoftwareList]);

  // "Use the company standard instead of generating one." Always yields a
  // PERSONAL copy owned by the caller, so the official version stays pristine
  // and an admin edit never changes a course underneath someone mid-study.
  const forkCourse = useCallback(async (course, newName) => {
    if (forkBusy) return null;
    setForkBusy(true);
    setSharingNotice(null);
    setSharingError(null);
    try {
      const res = await otterFetch(`/api/otter/courses/${course.slug}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName ?? null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not copy this course');
      await loadSoftwareList();
      selectSoftware(data.slug, true);
      setCourseFilter('all');
      setCurrentView('library');
      setSharingNotice(`Copied "${data.name}" into your own courses. Edit it however you like.`);
      return data;
    } catch (e) {
      // Surfaced on BOTH the prompt screen (where the fork offer lives) and the
      // Library (where the row menu lives) — a fork can be started from either.
      setSharingError(e.message);
      setGenError(e.message);
      return null;
    } finally {
      setForkBusy(false);
    }
  }, [forkBusy, loadSoftwareList, selectSoftware]);

  // ═══════════════════════════════════════════════════════════════
  //  LOAD SETTINGS & DATA ON MOUNT
  // ═══════════════════════════════════════════════════════════════
  // Session 12 (gap #21): loadSoftwareList() must not depend on the settings
  // fetch. In a browser there is no in-app Express server, so the old
  // fetch('/api/otter-settings') chain rejected, the catch swallowed it, and
  // the library never loaded at all. localData routes settings to Express in
  // Electron (unchanged order: settings → legacy migration → list) and to
  // localStorage on the web; the list load now runs in every case.
  useEffect(() => {
    (async () => {
      try {
        const s = await loadOtterSettings();
        setSettings(s);
        setEditingPrompts({
          courseOutline: s.prompts?.courseOutline || FULL_COURSE_OUTLINE_PROMPT,
          subjectContent: s.prompts?.subjectContent || SUBJECT_GENERATION_PROMPT,
          singleSubject: s.prompts?.singleSubject || SINGLE_SUBJECT_PROMPT,
          mc: s.prompts?.mc || MULTIPLE_CHOICE_PROMPT,
          codeId: s.prompts?.codeId || CODE_IDENTIFICATION_PROMPT,
          codeWrite: s.prompts?.codeWrite || CODE_WRITING_PROMPT,
          companion: s.prompts?.companion || COMPANION_PROMPT,
        });
        // Check migration — the one-shot legacy disk migration only exists
        // where the local server does.
        if (hasLocalServer()) {
          try {
            const migRes = await fetch('/api/migration-needed');
            const migData = await migRes.json();
            if (migData.needed) {
              await fetch('/api/migrate', { method: 'POST' });
            }
          } catch { /* ignore */ }
        }
      } catch { /* ignore — prompts fall back to their defaults */ }
      loadSoftwareList();
    })();
  }, []);

  // ═══════════════════════════════════════════════════════════════
  //  SAVE SETTINGS
  // ═══════════════════════════════════════════════════════════════
  // S30: saveOtterSettings now REJECTS on a refused write (it used to swallow
  // the status). Two of the three call sites here are `onChange`/`onClick`
  // handlers that drop the promise, so without this catch a failed save would
  // become an unhandled rejection instead of a message — trading one silence
  // for a louder silence.
  //
  // State is applied only on success, deliberately: showing the new value over
  // a write that did not land is the "green tick" defect this session spent
  // the day removing.
  const saveSettings = useCallback(async (updates) => {
    const newSettings = { ...settings, ...updates };
    try {
      await saveOtterSettings(newSettings);
      // S31: this is the ONLY writer of `prompts`, which follow the PERSON
      // between computers. The push is deliberately AFTER the local write and
      // inside the same try, so a refused cloud write surfaces in the same
      // banner rather than being a second silent failure mode.
      // pushSettingsToCloud() no-ops when signed out.
      await pushSettingsToCloud();
      setSettings(newSettings);
      setSettingsError(null);
    } catch (err) {
      setSettingsError(err?.message || 'That setting could not be saved.');
    }
  }, [settings]);

  const savePrompts = useCallback(async () => {
    await saveSettings({ prompts: editingPrompts });
  }, [editingPrompts, saveSettings]);

  // ═══════════════════════════════════════════════════════════════
  //  ANTHROPIC CALL HELPER — via the ai-proxy Edge Function
  //  (Session 12, locked #21: same body shape, the key lives server-side,
  //  and the proxy streams so long generations survive the Edge deadline.
  //  callAI reassembles the stream into the classic message object.)
  // ═══════════════════════════════════════════════════════════════
  // Session 30: bounds the pause_turn continuation below.
  const MAX_CONTINUATIONS = 3;

  async function callAnthropicAPI({ model, maxTokens, systemPrompt, messages, signal, tools, betas, depth = 0 }) {
    const body = { model, max_tokens: maxTokens, system: systemPrompt, messages, tool: 'otter' };
    if (tools && tools.length > 0) body.tools = tools;
    if (betas) body.betas = betas;

    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [3000, 6000, 12000];

    let data;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal?.aborted) throw new Error('Cancelled');

      try {
        data = await callAI(body, { signal });
        break;
      } catch (err) {
        // Retry on overloaded/rate-limited errors, same schedule as before.
        if (isRetryableAIError(err) && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAYS[attempt] || 12000;
          console.warn(`API ${err.status || '?'}, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
    }

    // 🚨 Session 30: RESUME A PAUSED SERVER-SIDE TOOL RUN.
    //
    // `pause_turn` is what Anthropic returns when a server-side tool run — here
    // web_search — hits its iteration limit mid-answer. The turn then ENDS on a
    // server_tool_use block, so the last TEXT block is a preamble ("Let me look
    // up Blender's interface...") rather than the JSON. Nothing downstream
    // checked for it, so generateSubjectContent parsed the preamble and threw
    // "Failed to parse subject JSON. Try again."
    //
    // The Validator already does exactly this and has since S19 (`dab9046`),
    // which is when web search made it necessary — Validator.jsx:52-59. This
    // wrapper never got it, and generateSubjectContent is the O.T.T.E.R. call
    // that uses web_search (max_uses 3) while the course OUTLINE does not.
    // That asymmetry is why the outline generates and the subject does not.
    //
    // Resumed by re-sending with the assistant turn appended and NO trailing
    // user turn: the API recognises the trailing server_tool_use and continues.
    // That is the documented shape, and it is NOT the text prefill that S19
    // measured returning 400.
    if (data?.stop_reason === 'pause_turn' && depth < MAX_CONTINUATIONS) {
      return callAnthropicAPI({
        model, maxTokens, systemPrompt,
        messages: [...messages, { role: 'assistant', content: data.content }],
        signal, tools, betas,
        depth: depth + 1,
      });
    }

    return data;
  }

  /**
   * What actually came back, for an error a user can act on.
   *
   * Every JSON parse failure in this file used to say only "Try again", which
   * is the same sentence for a paused tool run, a refusal, an empty response
   * and genuinely malformed JSON. S30 hit two DIFFERENT causes behind two
   * identical messages in one evening; naming the shape turns the next
   * recurrence into a measurement instead of another round trip.
   */
  function describeResponse(data) {
    const blocks = (data?.content || []).map(b => b?.type || '?').join(', ') || 'none';
    const chars = extractTextAndCitations(data).text.length;
    return `[${data?.stop_reason ?? 'no stop_reason'}; blocks: ${blocks}; ${chars} chars of text]`;
  }

  // Extract text + citation sources from API response (handles web_search content blocks)
  function extractTextAndCitations(data) {
    const blocks = data.content || [];
    const textParts = [];
    const allCitations = [];

    for (const block of blocks) {
      if (block.type === 'text') {
        // Strip <cite> tags from the text (Anthropic's inline citation markers)
        const cleaned = (block.text || '').replace(/<\/?cite[^>]*>/g, '');
        if (cleaned.trim()) textParts.push(cleaned);
        // Extract citations from text block if present
        if (block.citations) {
          for (const cite of block.citations) {
            allCitations.push({ url: cite.url || '', title: cite.title || '' });
          }
        }
      }
      // Extract sources from web_search_tool_result blocks
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const result of block.content) {
          if (result.type === 'web_search_result' && result.url) {
            allCitations.push({ url: result.url, title: result.title || result.url });
          }
        }
      }
    }

    // Use last text part (the final JSON response) — but fall back to concatenated if only one
    const text = textParts.length > 0 ? textParts[textParts.length - 1] : '';

    // Deduplicate by URL
    const seen = new Set();
    const sources = [];
    for (const c of allCitations) {
      if (c.url && !seen.has(c.url)) { seen.add(c.url); sources.push(c); }
    }
    return { text, sources };
  }

  // ═══════════════════════════════════════════════════════════════
  //  REFERENCE URL HANDLER
  // ═══════════════════════════════════════════════════════════════
  // Save reference URLs to backend whenever they change
  const saveReferenceUrls = useCallback((urls) => {
    if (!activeSoftwareSlug) return;
    otterFetch(`/api/software/${activeSoftwareSlug}/references`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls })
    }).catch(() => {});
    if (softwareCacheRef.current[activeSoftwareSlug]) {
      softwareCacheRef.current[activeSoftwareSlug].references = urls;
    }
  }, [activeSoftwareSlug]);

  const addReferenceUrl = useCallback(async () => {
    const url = referenceUrlInput.trim();
    if (!url) return;
    try { new URL(url.startsWith('http') ? url : `https://${url}`); } catch { return; }
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    if (referenceUrls.some(r => r.url === fullUrl)) return;
    setFetchingUrl(true);
    try {
      // Session 12: the URL scraper lives in the local Express server — a
      // browser can neither reach it nor fetch cross-origin itself. Save the
      // reference with an honest error badge instead of a confusing failure.
      if (!hasLocalServer()) {
        throw new Error('Reference text can only be fetched in the desktop app — the URL is saved without its content.');
      }
      const res = await fetch('/api/fetch-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: fullUrl })
      });
      const data = await res.json();
      let newRef;
      if (data.error) {
        newRef = { url: fullUrl, title: fullUrl, text: '', error: data.error };
      } else {
        newRef = { url: fullUrl, title: data.title, text: data.text };
      }
      const updated = [...referenceUrls, newRef];
      setReferenceUrls(updated);
      saveReferenceUrls(updated);
      setReferenceUrlInput('');
    } catch (e) {
      const newRef = { url: fullUrl, title: fullUrl, text: '', error: e.message };
      const updated = [...referenceUrls, newRef];
      setReferenceUrls(updated);
      saveReferenceUrls(updated);
      setReferenceUrlInput('');
    } finally {
      setFetchingUrl(false);
    }
  }, [referenceUrlInput, referenceUrls, saveReferenceUrls]);

  // ═══════════════════════════════════════════════════════════════
  //  COURSE GENERATION (Full Course Outline)
  // ═══════════════════════════════════════════════════════════════
  const generateCourse = useCallback(async () => {
    if (!softwareNameInput.trim()) return;
    setGenerating(true);
    setGenError(null);
    setGenElapsed(0);
    setGenPhase('Sending request to AI...');

    const nameLower = softwareNameInput.trim().toLowerCase();
    const existingMatch = softwareList.find(sw => sw.name.toLowerCase() === nameLower);

    const startTime = Date.now();
    genTimerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setGenElapsed(elapsed);
      if (elapsed < 2) setGenPhase('Sending request...');
      else if (elapsed < 8) setGenPhase('Designing curriculum outline...');
      else if (elapsed < 15) setGenPhase('Creating subject stubs...');
      else setGenPhase('Finalizing...');
    }, 1000);

    try {
      const systemPrompt = editingPrompts.courseOutline || FULL_COURSE_OUTLINE_PROMPT;
      let userMessage = `Software/Language: ${softwareNameInput.trim()}\nSkill level: ${skillLevel}\n`;
      if (promptText.trim()) userMessage += `\nAdditional context: ${promptText}`;

      let existingSubjectTitles = [];
      if (existingMatch) {
        try {
          const existingSubs = await otterFetch(`/api/software/${existingMatch.slug}/subjects`).then(r => r.json());
          existingSubjectTitles = existingSubs.map(s => s.title);
          userMessage += `\n\nIMPORTANT: This software already has the following subjects — do NOT generate duplicates or basics:\n${existingSubjectTitles.map(t => `- ${t}`).join('\n')}`;
          userMessage += `\nDo NOT include "General Basics" since it already exists. Only generate NEW subjects.`;
        } catch { /* proceed without existing subject info */ }
      }

      // Inject user-provided reference URLs for outline context
      const validRefs = referenceUrls.filter(r => r.text && !r.error);
      if (validRefs.length > 0) {
        userMessage += `\n\nThe user provided these reference materials. Design subjects that align with this content:\n`;
        for (const ref of validRefs) {
          userMessage += `- ${ref.title} (${ref.url}): ${ref.text.slice(0, 500)}\n`;
        }
      }

      const data = await callAnthropicAPI({
        model: modelFor('otter.course'),
        maxTokens: 12000,
        systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
      if (data.stop_reason === 'max_tokens') {
        throw new Error('Response was too long and got cut off. Try a simpler topic.');
      }

      setGenPhase('Parsing response...');
      // 🚨 S30: was `data.content?.[0]?.text`. These models THINK even when
      // nothing asks them to (S19 measured `thinking` omitted -> thinking=1),
      // ai-proxy pipes the stream through untouched, and the reassembler puts
      // every block at its own index — so content[0] is a THINKING block and
      // .text is undefined. rawText became '', nothing matched, and every
      // course generation died on "Failed to parse course outline JSON."
      // Reproduced in anthropicStream.test.js.
      const { text: rawText } = extractTextAndCitations(data);
      let text = rawText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      let parsed;
      try { parsed = JSON.parse(text); }
      catch {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try { parsed = JSON.parse(jsonMatch[0]); }
          catch { throw new Error(`Failed to parse course outline JSON. Try again. ${describeResponse(data)}`); }
        } else {
          throw new Error(`Failed to parse course outline JSON. Try again. ${describeResponse(data)}`);
        }
      }

      let slug;
      if (existingMatch) {
        slug = existingMatch.slug;
        setGenPhase('Adding to existing course...');
      } else {
        setGenPhase('Creating software folder...');
        const metaRes = await otterFetch('/api/software', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: parsed.software_name || softwareNameInput.trim(),
            type: parsed.type || 'software',
            skill_level: skillLevel,
            // Session 11 tier picker. The DATABASE decides whether the caller
            // may have this tier; we send the choice and read back the answer.
            visibility: newCourseVisibility,
          })
        });
        const meta = await metaRes.json();
        // Creating a course can now genuinely fail (a refused tier is an error,
        // not a downgrade). Unchecked, `meta.slug` would be undefined and every
        // subject below would POST to /api/software/undefined/subjects — the
        // exact silent-success failure the adapter work exists to prevent.
        if (!metaRes.ok || !meta?.slug) {
          throw new Error(meta?.error || 'Could not create the course.');
        }
        slug = meta.slug;
      }

      setGenPhase('Saving subject stubs...');
      const subjects = parsed.subjects || [];

      let existingSlugs = new Set();
      let existingMaxOrder = 0;
      if (existingMatch) {
        try {
          const existingSubs = await otterFetch(`/api/software/${slug}/subjects`).then(r => r.json());
          existingSubs.forEach(s => {
            existingSlugs.add(s.slug);
            if (s.subject_order != null && s.subject_order > existingMaxOrder) existingMaxOrder = s.subject_order;
          });
          const existingTitlesLower = new Set(existingSubs.map(s => s.title.toLowerCase()));
          for (const sub of subjects) {
            if (existingTitlesLower.has(sub.title.toLowerCase())) {
              const subSlug = sub.title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
              existingSlugs.add(subSlug);
            }
          }
        } catch { /* proceed */ }
      }

      let orderCounter = existingMaxOrder;
      for (const sub of subjects) {
        const subSlug = sub.title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (existingSlugs.has(subSlug)) continue;
        if (existingMatch && sub.title.toLowerCase().includes('general basics')) continue;

        orderCounter++;
        await otterFetch(`/api/software/${slug}/subjects`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: subSlug,
            title: sub.title,
            description: sub.description || '',
            skill_level: sub.skill_level || skillLevel,
            estimated_hours: sub.estimated_hours || 1,
            is_stub: true,
            sections: [],
            section_outlines: sub.section_outlines || [],
            prerequisites: [],
            subject_order: sub.subject_order || orderCounter,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
        });
      }

      setPromptText('');
      setSoftwareNameInput('');
      setReferenceUrls([]);
      invalidateCache(slug);
      await loadSoftwareList();
      selectSoftware(slug, true);
      setCurrentView('library');
    } catch (e) {
      setGenError(e.message);
    } finally {
      clearInterval(genTimerRef.current);
      genTimerRef.current = null;
      setGenerating(false);
      setGenPhase('');
    }
  }, [softwareNameInput, promptText, skillLevel, editingPrompts, loadSoftwareList, selectSoftware, softwareList, referenceUrls, newCourseVisibility]);

  // ═══════════════════════════════════════════════════════════════
  //  SUBJECT CONTENT GENERATION (for stubs)
  // ═══════════════════════════════════════════════════════════════
  const updateGenSubject = useCallback((slug, updates) => {
    setGeneratingSubjects(prev => {
      const next = new Map(prev);
      const existing = next.get(slug) || {};
      next.set(slug, { ...existing, ...updates });
      generatingSubjectsRef.current = next;
      return next;
    });
  }, []);

  const removeGenSubject = useCallback((slug) => {
    setGeneratingSubjects(prev => {
      const next = new Map(prev);
      const entry = next.get(slug);
      if (entry?.timerId) clearInterval(entry.timerId);
      next.delete(slug);
      generatingSubjectsRef.current = next;
      return next;
    });
  }, []);

  const cancelGeneration = useCallback((slug) => {
    genQueueCancelledRef.current.add(slug);
    const controller = genAbortControllers.current.get(slug);
    if (controller) {
      controller.abort();
      genAbortControllers.current.delete(slug);
    }
    removeGenSubject(slug);
    genQueueCancelledRef.current.delete(slug);
    if (generatingSubjectsRef.current.size === 0) {
      generatingRef.current = false;
      setGenerating(false);
    }
  }, [removeGenSubject, genQueueCancelledRef]);

  const generateSubjectContent = useCallback(async (subjectSlug, { skipNavigation = false } = {}) => {
    if (!activeSoftwareSlug) return;
    if (generatingSubjectsRef.current.has(subjectSlug)) return;

    let subTitle = subjectSlug;
    try {
      const stubPre = await otterFetch(`/api/software/${activeSoftwareSlug}/subjects/${subjectSlug}`).then(r => r.json());
      subTitle = stubPre.title || subjectSlug;
    } catch { /* use slug */ }

    const startTime = Date.now();
    const timerId = setInterval(() => {
      setGeneratingSubjects(prev => {
        const next = new Map(prev);
        const entry = next.get(subjectSlug);
        if (entry && !entry.cancelled) {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          let phase = 'Sending request...';
          if (elapsed >= 45) phase = 'Still working...';
          else if (elapsed >= 25) phase = 'Generating exercises...';
          else if (elapsed >= 15) phase = 'Writing lesson content...';
          else if (elapsed >= 8) phase = 'Reviewing sources...';
          else if (elapsed >= 2) phase = 'Searching the web...';
          next.set(subjectSlug, { ...entry, elapsed, phase });
        }
        generatingSubjectsRef.current = next;
        return next;
      });
    }, 1000);

    const abortController = new AbortController();
    genAbortControllers.current.set(subjectSlug, abortController);
    const signal = abortController.signal;

    updateGenSubject(subjectSlug, { title: subTitle, phase: 'Loading subject data...', elapsed: 0, startTime, timerId, cancelled: false });

    try {
      if (signal.aborted) throw new Error('Cancelled');

      const stubData = await otterFetch(`/api/software/${activeSoftwareSlug}/subjects/${subjectSlug}`, { signal }).then(r => r.json());

      if (signal.aborted) throw new Error('Cancelled');

      const systemPrompt = editingPrompts.subjectContent || SUBJECT_GENERATION_PROMPT;
      const swType = activeSoftware?.type || 'software';
      let userMessage = `Software/Language: ${activeSoftware?.name || activeSoftwareSlug}\n`;
      userMessage += `Type: ${swType}\n`;
      userMessage += `Subject: ${stubData.title}\n`;
      userMessage += `Description: ${stubData.description || ''}\n`;
      userMessage += `Skill level: ${stubData.skill_level || 'beginner'}\n`;
      if (swType === 'coding_language') {
        userMessage += `\nIMPORTANT: This is a coding language. Include "functions" (not "hotkeys") in your response — list built-in functions, methods, and constructs covered in this subject with full parameter details, return types, and examples.\n`;
      }
      if (swType === 'software' || swType === 'node_software') {
        // Detect if this subject is specifically about nodes based on title/description
        const subjectText = `${stubData.title || ''} ${stubData.description || ''} ${(stubData.section_outlines || []).map(s => s.title + ' ' + s.description).join(' ')}`.toLowerCase();
        const isNodeSubject = /\bnode[s]?\b|node.?based|shader.?graph|material.?editor|compositor|geometry.?node/i.test(subjectText);

        if (isNodeSubject) {
          userMessage += `\nCRITICAL: This subject is about node-based workflows. You MUST include a "nodes" array alongside "hotkeys" in your response. Document all relevant nodes with their complete inputs, outputs, and types (Float, Integer, Vector, Color, Shader, Geometry, String, Boolean, Image, Object, Collection, Material, Mesh, Curve, Any). This is mandatory for this subject.\n`;
        } else {
          userMessage += `\nIf this subject involves node-based workflows (shader nodes, geometry nodes, compositing nodes, etc.), include a "nodes" array alongside "hotkeys" documenting relevant nodes with all inputs, outputs, and types (Float, Integer, Vector, Color, Shader, Geometry, String, Boolean, Image, Object, Collection, Material, Mesh, Curve, Any). Omit "nodes" if the subject does not involve nodes.\n`;
        }
      }
      if (stubData.section_outlines?.length) {
        userMessage += `\nSection outlines to follow:\n${stubData.section_outlines.map(s => `- ${s.title}: ${s.description} (${s.lesson_count} lessons)`).join('\n')}`;
      }

      // Dedup context: pass existing hotkeys/functions/nodes so AI doesn't duplicate
      try {
        if (swType === 'coding_language') {
          const fnData = softwareFunctions || await otterFetch(`/api/software/${activeSoftwareSlug}/functions`).then(r => r.json());
          const allNames = (fnData?.categories || []).flatMap(c => (c.functions || []).map(f => f.name)).slice(0, 100);
          if (allNames.length > 0) userMessage += `\n\nEXISTING FUNCTIONS (DO NOT DUPLICATE):\n${allNames.map(n => `- ${n}`).join('\n')}\nOnly include functions NOT in this list.\n`;
        } else {
          const hkData = softwareHotkeys || await otterFetch(`/api/software/${activeSoftwareSlug}/hotkeys`).then(r => r.json());
          const allActions = (hkData?.categories || []).flatMap(c => (c.shortcuts || []).map(s => s.action)).slice(0, 100);
          if (allActions.length > 0) userMessage += `\n\nEXISTING HOTKEYS (DO NOT DUPLICATE):\n${allActions.map(a => `- ${a}`).join('\n')}\nOnly include hotkeys NOT in this list.\n`;
        }
        if (swType === 'node_software' || swType === 'software') {
          const ndData = softwareNodes || await otterFetch(`/api/software/${activeSoftwareSlug}/nodes`).then(r => r.json());
          const allNodeNames = (ndData?.systems || []).flatMap(s => (s.categories || []).flatMap(c => (c.nodes || []).map(n => n.name))).slice(0, 100);
          if (allNodeNames.length > 0) userMessage += `\n\nEXISTING NODES (DO NOT DUPLICATE):\n${allNodeNames.map(n => `- ${n}`).join('\n')}\nOnly include nodes NOT in this list.\n`;
        }
      } catch { /* proceed without dedup context */ }

      // Inject user-provided reference URLs
      const validRefs = referenceUrls.filter(r => r.text && !r.error);
      if (validRefs.length > 0) {
        userMessage += `\n\n--- REFERENCE MATERIAL (from user-provided URLs) ---\n`;
        for (const ref of validRefs) {
          userMessage += `\nSource: ${ref.title} (${ref.url})\n${ref.text.slice(0, 3000)}\n`;
        }
        userMessage += `\nUse the above reference material as primary sources. Cite them where relevant.\n`;
      }

      updateGenSubject(subjectSlug, { phase: 'Sending request...' });

      const hasUserRefs = validRefs.length > 0;
      const data = await callAnthropicAPI({
        model: modelFor('otter.subjectContent'),
        maxTokens: 12000,
        systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        signal,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: hasUserRefs ? 1 : 3 }],
        betas: 'web-search-2025-03-05',
      });

      if (signal.aborted) throw new Error('Cancelled');

      if (data.stop_reason === 'max_tokens') {
        throw new Error('Response was too long. Try generating again.');
      }

      updateGenSubject(subjectSlug, { phase: 'Parsing response...' });
      const { text: rawText, sources: webSources } = extractTextAndCitations(data);
      let text = rawText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      let parsed;
      try { parsed = JSON.parse(text); }
      catch {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try { parsed = JSON.parse(jsonMatch[0]); }
          catch { throw new Error(`Failed to parse subject JSON. Try again. ${describeResponse(data)}`); }
        } else {
          throw new Error(`Failed to parse subject JSON. Try again. ${describeResponse(data)}`);
        }
      }

      // Normalize sections
      if (!parsed.sections) parsed.sections = [];
      parsed.sections = parsed.sections.map((s, si) => ({
        id: s.id || `section_${si + 1}`,
        title: s.title || `Section ${si + 1}`,
        description: s.description || '',
        estimated_minutes: s.estimated_minutes || 30,
        lessons: (s.lessons || []).map((l, li) => ({
          id: l.id || `lesson_${si + 1}_${li + 1}`,
          title: l.title || `Lesson ${li + 1}`,
          content: (l.content || '').replace(/<\/?cite[^>]*>/g, ''),
          key_takeaways: Array.isArray(l.key_takeaways) ? l.key_takeaways : (l.key_takeaways ? [l.key_takeaways] : []),
          practice_prompt: l.practice_prompt || '',
        }))
      }));

      if (signal.aborted) throw new Error('Cancelled');

      updateGenSubject(subjectSlug, { phase: 'Saving subject...' });
      // Merge web search sources + user-provided reference URLs, deduplicate
      const userRefSources = validRefs.map(r => ({ title: r.title, url: r.url }));
      const allSources = [...(webSources || []), ...userRefSources];
      const seenUrls = new Set();
      const dedupedSources = allSources.filter(s => { if (!s.url || seenUrls.has(s.url)) return false; seenUrls.add(s.url); return true; });

      const updatedSubject = {
        ...stubData,
        ...parsed,
        slug: subjectSlug,
        software_slug: activeSoftwareSlug,
        is_stub: false,
        sources: dedupedSources,
        updated_at: new Date().toISOString(),
      };
      await otterFetch(`/api/software/${activeSoftwareSlug}/subjects`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSubject)
      });

      // Immediately update subjectList so sidebar reflects this subject is no longer a stub
      setSubjectList(prev => prev.map(s =>
        s.slug === subjectSlug ? { ...s, is_stub: false, title: updatedSubject.title || s.title } : s
      ));

      // Merge hotkeys if present (software type)
      if (parsed.hotkeys?.length > 0) {
        let categories = parsed.hotkeys;
        const first = categories[0];
        if (first && !first.shortcuts) {
          const grouped = {};
          categories.forEach(h => {
            const cat = h.context || h.category || 'General';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push({ action: h.action || h.description || '', windows: h.windows || h.key || '', mac: h.mac || h.key || '', notes: h.notes || '' });
          });
          categories = Object.entries(grouped).map(([category, shortcuts]) => ({ category, shortcuts }));
        }
        const hkRes = await otterFetch(`/api/software/${activeSoftwareSlug}/hotkeys/merge`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categories })
        });
        const updatedHk = await hkRes.json();
        setSoftwareHotkeys(updatedHk);
        if (softwareCacheRef.current[activeSoftwareSlug]) softwareCacheRef.current[activeSoftwareSlug].hotkeys = updatedHk;
      }

      // Merge functions if present (coding language type)
      if (parsed.functions?.length > 0) {
        let categories = parsed.functions;
        categories = categories.map(cat => ({
          category: cat.category || 'General',
          functions: (cat.functions || []).map(f => ({
            name: f.name || '', syntax: f.syntax || f.name || '',
            parameters: f.parameters || '', returns: f.returns || f.returnType || '',
            description: f.description || '', example: f.example || ''
          }))
        })).filter(cat => cat.functions.length > 0);
        if (categories.length > 0) {
          await otterFetch(`/api/software/${activeSoftwareSlug}/functions/merge`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categories })
          });
        }
      }

      // Merge nodes if present
      if (parsed.nodes?.length > 0) {
        const nodesRes = await otterFetch(`/api/software/${activeSoftwareSlug}/nodes/merge`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categories: parsed.nodes })
        });
        const updatedNodes = await nodesRes.json();
        setSoftwareNodes(updatedNodes);
        if (softwareCacheRef.current[activeSoftwareSlug]) softwareCacheRef.current[activeSoftwareSlug].nodes = updatedNodes;
      }

      invalidateCache(activeSoftwareSlug);
      if (!skipNavigation) {
        selectSoftware(activeSoftwareSlug, true);
        selectSubject(activeSoftwareSlug, subjectSlug);
        setCurrentView('study');
      }
    } catch (e) {
      const isCancelled = e.name === 'AbortError' || e.message === 'Cancelled' || signal.aborted;
      if (!isCancelled) {
        console.error(`Generation failed for ${subjectSlug}:`, e.message);
        setGenError(e.message);
        setSubjectErrors(prev => ({ ...prev, [subjectSlug]: e.message }));
      }
    } finally {
      genAbortControllers.current.delete(subjectSlug);
      genQueueCancelledRef.current.delete(subjectSlug);

      // Synchronously update the ref BEFORE checking size — removeGenSubject uses
      // a React batched state updater, so the ref wouldn't be updated yet if we
      // relied on it. Do the ref update ourselves, then trigger the React state update.
      const nextMap = new Map(generatingSubjectsRef.current);
      const entry = nextMap.get(subjectSlug);
      if (entry?.timerId) clearInterval(entry.timerId);
      nextMap.delete(subjectSlug);
      generatingSubjectsRef.current = nextMap;
      setGeneratingSubjects(nextMap);

      // Refresh when all queue items are done
      if (nextMap.size === 0) {
        invalidateCache(activeSoftwareSlug);
        selectSoftware(activeSoftwareSlug, true);
      }
    }
  }, [activeSoftwareSlug, activeSoftware, editingPrompts, selectSoftware, selectSubject, updateGenSubject, removeGenSubject, genQueueCancelledRef, invalidateCache, referenceUrls, softwareHotkeys, softwareFunctions, softwareNodes]);

  // ═══════════════════════════════════════════════════════════════
  //  ADD SINGLE SUBJECT
  // ═══════════════════════════════════════════════════════════════
  const generateSingleSubject = useCallback(async () => {
    if (!promptText.trim() || !activeSoftwareSlug || generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    setGenError(null);
    setGenElapsed(0);
    setGenPhase('Sending request...');

    const startTime = Date.now();
    genTimerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setGenElapsed(elapsed);
      if (elapsed < 2) setGenPhase('Sending request...');
      else if (elapsed < 6) setGenPhase('Searching the web...');
      else if (elapsed < 10) setGenPhase('Reviewing sources...');
      else if (elapsed < 20) setGenPhase('Writing focused lesson...');
      else setGenPhase('Finalizing...');
    }, 1000);

    try {
      const systemPrompt = editingPrompts.singleSubject || SINGLE_SUBJECT_PROMPT;
      const swType = activeSoftware?.type || 'software';
      let userMessage = `Software/Language: ${activeSoftware?.name || activeSoftwareSlug}\n`;
      userMessage += `Type: ${swType}\n`;
      userMessage += `Skill level: ${skillLevel}\n`;
      if (swType === 'coding_language') {
        userMessage += `\nIMPORTANT: This is a coding language. Include "functions" (not "hotkeys") — list built-in functions, methods, and constructs with parameter details, return types, and examples.\n`;
      }
      if (swType === 'software' || swType === 'node_software') {
        const topicText = promptText.toLowerCase();
        const isNodeTopic = /\bnode[s]?\b|node.?based|shader.?graph|material.?editor|compositor|geometry.?node/i.test(topicText);
        if (isNodeTopic) {
          userMessage += `\nCRITICAL: This topic is about node-based workflows. You MUST include a "nodes" array alongside "hotkeys" in your response. Document all relevant nodes with their complete inputs, outputs, and types (Float, Integer, Vector, Color, Shader, Geometry, String, Boolean, Image, Object, Collection, Material, Mesh, Curve, Any). This is mandatory for this topic.\n`;
        } else {
          userMessage += `\nIf this topic involves node-based workflows (shader nodes, geometry nodes, compositing nodes, etc.), include a "nodes" array alongside "hotkeys" documenting relevant nodes with all inputs, outputs, and types (Float, Integer, Vector, Color, Shader, Geometry, String, Boolean, Image, Object, Collection, Material, Mesh, Curve, Any). Omit "nodes" if the topic does not involve nodes.\n`;
        }
      }
      userMessage += `\nSingle topic lesson: ${promptText}`;

      // Dedup context
      try {
        if (swType === 'coding_language') {
          const fnData = softwareFunctions || await otterFetch(`/api/software/${activeSoftwareSlug}/functions`).then(r => r.json());
          const allNames = (fnData?.categories || []).flatMap(c => (c.functions || []).map(f => f.name)).slice(0, 100);
          if (allNames.length > 0) userMessage += `\n\nEXISTING FUNCTIONS (DO NOT DUPLICATE):\n${allNames.map(n => `- ${n}`).join('\n')}\nOnly include functions NOT in this list.\n`;
        } else {
          const hkData = softwareHotkeys || await otterFetch(`/api/software/${activeSoftwareSlug}/hotkeys`).then(r => r.json());
          const allActions = (hkData?.categories || []).flatMap(c => (c.shortcuts || []).map(s => s.action)).slice(0, 100);
          if (allActions.length > 0) userMessage += `\n\nEXISTING HOTKEYS (DO NOT DUPLICATE):\n${allActions.map(a => `- ${a}`).join('\n')}\nOnly include hotkeys NOT in this list.\n`;
        }
        if (swType === 'node_software' || swType === 'software') {
          const ndData = softwareNodes || await otterFetch(`/api/software/${activeSoftwareSlug}/nodes`).then(r => r.json());
          const allNodeNames = (ndData?.systems || []).flatMap(s => (s.categories || []).flatMap(c => (c.nodes || []).map(n => n.name))).slice(0, 100);
          if (allNodeNames.length > 0) userMessage += `\n\nEXISTING NODES (DO NOT DUPLICATE):\n${allNodeNames.map(n => `- ${n}`).join('\n')}\nOnly include nodes NOT in this list.\n`;
        }
      } catch { /* proceed without dedup context */ }

      // Inject user-provided reference URLs
      const validRefs = referenceUrls.filter(r => r.text && !r.error);
      if (validRefs.length > 0) {
        userMessage += `\n\n--- REFERENCE MATERIAL (from user-provided URLs) ---\n`;
        for (const ref of validRefs) {
          userMessage += `\nSource: ${ref.title} (${ref.url})\n${ref.text.slice(0, 3000)}\n`;
        }
        userMessage += `\nUse the above reference material as primary sources. Cite them where relevant.\n`;
      }

      const hasUserRefs = validRefs.length > 0;
      const data = await callAnthropicAPI({
        model: modelFor('otter.singleSubject'),
        maxTokens: 12000,
        systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: hasUserRefs ? 1 : 3 }],
        betas: 'web-search-2025-03-05',
      });
      if (data.stop_reason === 'max_tokens') {
        throw new Error('Response was too long. Try a more specific topic.');
      }

      setGenPhase('Parsing response...');
      const { text: rawText, sources: webSources } = extractTextAndCitations(data);
      let text = rawText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      let parsed;
      try { parsed = JSON.parse(text); }
      catch {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try { parsed = JSON.parse(jsonMatch[0]); }
          catch { throw new Error(`Failed to parse subject JSON. Try again. ${describeResponse(data)}`); }
        } else {
          throw new Error(`Failed to parse subject JSON. Try again. ${describeResponse(data)}`);
        }
      }

      // Normalize sections
      if (!parsed.sections) parsed.sections = [];
      parsed.sections = parsed.sections.map((s, si) => ({
        id: s.id || `section_${si + 1}`,
        title: s.title || `Section ${si + 1}`,
        description: s.description || '',
        estimated_minutes: s.estimated_minutes || 30,
        lessons: (s.lessons || []).map((l, li) => ({
          id: l.id || `lesson_${si + 1}_${li + 1}`,
          title: l.title || `Lesson ${li + 1}`,
          content: (l.content || '').replace(/<\/?cite[^>]*>/g, ''),
          key_takeaways: Array.isArray(l.key_takeaways) ? l.key_takeaways : [],
          practice_prompt: l.practice_prompt || '',
        }))
      }));

      setGenPhase('Saving subject...');
      // Merge web + user ref sources, deduplicate
      const userRefSources2 = validRefs.map(r => ({ title: r.title, url: r.url }));
      const allSources2 = [...(webSources || []), ...userRefSources2];
      const seenUrls2 = new Set();
      const dedupedSources2 = allSources2.filter(s => { if (!s.url || seenUrls2.has(s.url)) return false; seenUrls2.add(s.url); return true; });

      const subSlug = (parsed.title || promptText).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const subject = {
        slug: subSlug,
        title: parsed.title || promptText,
        software_slug: activeSoftwareSlug,
        description: parsed.description || '',
        skill_level: parsed.skill_level || skillLevel,
        estimated_hours: parsed.estimated_hours || 1,
        is_stub: false,
        sections: parsed.sections,
        prerequisites: parsed.prerequisites || [],
        sources: dedupedSources2,
        original_prompt: promptText,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await otterFetch(`/api/software/${activeSoftwareSlug}/subjects`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subject)
      });

      // Merge hotkeys if present (software type)
      if (parsed.hotkeys?.length > 0) {
        let categories = parsed.hotkeys;
        const first = categories[0];
        if (first && !first.shortcuts) {
          const grouped = {};
          categories.forEach(h => {
            const cat = h.context || h.category || 'General';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push({ action: h.action || h.description || '', windows: h.windows || h.key || '', mac: h.mac || h.key || '', notes: h.notes || '' });
          });
          categories = Object.entries(grouped).map(([category, shortcuts]) => ({ category, shortcuts }));
        }
        const hkRes2 = await otterFetch(`/api/software/${activeSoftwareSlug}/hotkeys/merge`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categories })
        });
        const updatedHk2 = await hkRes2.json();
        setSoftwareHotkeys(updatedHk2);
        if (softwareCacheRef.current[activeSoftwareSlug]) softwareCacheRef.current[activeSoftwareSlug].hotkeys = updatedHk2;
      }

      // Merge functions if present (coding language type)
      if (parsed.functions?.length > 0) {
        let categories = parsed.functions.map(cat => ({
          category: cat.category || 'General',
          functions: (cat.functions || []).map(f => ({
            name: f.name || '', syntax: f.syntax || f.name || '',
            parameters: f.parameters || '', returns: f.returns || f.returnType || '',
            description: f.description || '', example: f.example || ''
          }))
        })).filter(cat => cat.functions.length > 0);
        if (categories.length > 0) {
          await otterFetch(`/api/software/${activeSoftwareSlug}/functions/merge`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categories })
          });
        }
      }

      // Merge nodes if present
      if (parsed.nodes?.length > 0) {
        const nodesRes = await otterFetch(`/api/software/${activeSoftwareSlug}/nodes/merge`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categories: parsed.nodes })
        });
        const updatedNodes = await nodesRes.json();
        setSoftwareNodes(updatedNodes);
        if (softwareCacheRef.current[activeSoftwareSlug]) softwareCacheRef.current[activeSoftwareSlug].nodes = updatedNodes;
      }

      setPromptText('');
      setReferenceUrls([]);
      invalidateCache(activeSoftwareSlug);
      selectSoftware(activeSoftwareSlug, true);
      selectSubject(activeSoftwareSlug, subSlug);
      setCurrentView('study');
    } catch (e) {
      setGenError(e.message);
    } finally {
      clearInterval(genTimerRef.current);
      genTimerRef.current = null;
      generatingRef.current = false;
      setGenerating(false);
      setGenPhase('');
    }
  }, [promptText, skillLevel, activeSoftwareSlug, activeSoftware, editingPrompts, selectSoftware, selectSubject, referenceUrls, softwareHotkeys, softwareFunctions, softwareNodes]);

  // ═══════════════════════════════════════════════════════════════
  //  AGENT GENERATION WRAPPERS — parameterized versions for agent
  // ═══════════════════════════════════════════════════════════════

  // Agent: generate a single subject (mirrors generateSingleSubject but takes params)
  const agentGenerateSingleSubject = useCallback(async (topic, softwareSlug) => {
    const swSlug = softwareSlug || activeSoftwareSlug;
    if (!topic?.trim() || !swSlug) throw new Error('Topic and software course are required');

    // Use a temporary slug for queue tracking until we know the real one
    const tempSlug = `_agent_${Date.now()}`;

    const startTime = Date.now();
    const timerId = setInterval(() => {
      setGeneratingSubjects(prev => {
        const next = new Map(prev);
        const entry = next.get(tempSlug);
        if (entry && !entry.cancelled) {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          let phase = 'Sending request...';
          if (elapsed >= 25) phase = 'Finalizing...';
          else if (elapsed >= 15) phase = 'Writing focused lesson...';
          else if (elapsed >= 8) phase = 'Reviewing sources...';
          else if (elapsed >= 2) phase = 'Searching the web...';
          next.set(tempSlug, { ...entry, elapsed, phase });
        }
        generatingSubjectsRef.current = next;
        return next;
      });
    }, 1000);

    updateGenSubject(tempSlug, { title: topic, phase: 'Sending request...', elapsed: 0, startTime, timerId, cancelled: false });

    try {
      // Fetch software metadata fresh
      let swMeta;
      try {
        swMeta = await otterFetch(`/api/software/${swSlug}`).then(r => r.json());
      } catch { swMeta = { name: swSlug, type: 'software' }; }
      const swType = swMeta.type || 'software';

      const systemPrompt = editingPrompts.singleSubject || SINGLE_SUBJECT_PROMPT;
      let userMessage = `Software/Language: ${swMeta.name || swSlug}\n`;
      userMessage += `Type: ${swType}\n`;
      userMessage += `Skill level: ${skillLevel}\n`;
      if (swType === 'coding_language') {
        userMessage += `\nIMPORTANT: This is a coding language. Include "functions" (not "hotkeys") — list built-in functions, methods, and constructs with parameter details, return types, and examples.\n`;
      }
      if (swType === 'software' || swType === 'node_software') {
        const topicText = topic.toLowerCase();
        const isNodeTopic = /\bnode[s]?\b|node.?based|shader.?graph|material.?editor|compositor|geometry.?node/i.test(topicText);
        if (isNodeTopic) {
          userMessage += `\nCRITICAL: This topic is about node-based workflows. You MUST include a "nodes" array alongside "hotkeys" in your response. Document all relevant nodes with their complete inputs, outputs, and types (Float, Integer, Vector, Color, Shader, Geometry, String, Boolean, Image, Object, Collection, Material, Mesh, Curve, Any). This is mandatory for this topic.\n`;
        } else {
          userMessage += `\nIf this topic involves node-based workflows (shader nodes, geometry nodes, compositing nodes, etc.), include a "nodes" array alongside "hotkeys" documenting relevant nodes with all inputs, outputs, and types. Omit "nodes" if the topic does not involve nodes.\n`;
        }
      }
      userMessage += `\nSingle topic lesson: ${topic}`;

      // Dedup context
      try {
        if (swType === 'coding_language') {
          const fnData = softwareFunctions || await otterFetch(`/api/software/${swSlug}/functions`).then(r => r.json());
          const allNames = (fnData?.categories || []).flatMap(c => (c.functions || []).map(f => f.name)).slice(0, 100);
          if (allNames.length > 0) userMessage += `\n\nEXISTING FUNCTIONS (DO NOT DUPLICATE):\n${allNames.map(n => `- ${n}`).join('\n')}\nOnly include functions NOT in this list.\n`;
        } else {
          const hkData = softwareHotkeys || await otterFetch(`/api/software/${swSlug}/hotkeys`).then(r => r.json());
          const allActions = (hkData?.categories || []).flatMap(c => (c.shortcuts || []).map(s => s.action)).slice(0, 100);
          if (allActions.length > 0) userMessage += `\n\nEXISTING HOTKEYS (DO NOT DUPLICATE):\n${allActions.map(a => `- ${a}`).join('\n')}\nOnly include hotkeys NOT in this list.\n`;
        }
        if (swType === 'node_software' || swType === 'software') {
          const ndData = softwareNodes || await otterFetch(`/api/software/${swSlug}/nodes`).then(r => r.json());
          const allNodeNames = (ndData?.systems || []).flatMap(s => (s.categories || []).flatMap(c => (c.nodes || []).map(n => n.name))).slice(0, 100);
          if (allNodeNames.length > 0) userMessage += `\n\nEXISTING NODES (DO NOT DUPLICATE):\n${allNodeNames.map(n => `- ${n}`).join('\n')}\nOnly include nodes NOT in this list.\n`;
        }
      } catch { /* proceed without dedup context */ }

      // Inject user-provided reference URLs
      const validRefs = referenceUrls.filter(r => r.text && !r.error);
      if (validRefs.length > 0) {
        userMessage += `\n\n--- REFERENCE MATERIAL (from user-provided URLs) ---\n`;
        for (const ref of validRefs) {
          userMessage += `\nSource: ${ref.title} (${ref.url})\n${ref.text.slice(0, 3000)}\n`;
        }
        userMessage += `\nUse the above reference material as primary sources. Cite them where relevant.\n`;
      }

      const hasUserRefs = validRefs.length > 0;
      const data = await callAnthropicAPI({
        model: modelFor('otter.agentSubject'),
        maxTokens: 12000,
        systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: hasUserRefs ? 1 : 3 }],
        betas: 'web-search-2025-03-05',
      });
      if (data.stop_reason === 'max_tokens') {
        throw new Error('Response was too long. Try a more specific topic.');
      }

      updateGenSubject(tempSlug, { phase: 'Parsing response...' });
      const { text: rawText, sources: webSources } = extractTextAndCitations(data);
      let text = rawText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      let parsed;
      try { parsed = JSON.parse(text); }
      catch {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try { parsed = JSON.parse(jsonMatch[0]); }
          catch { throw new Error(`Failed to parse subject JSON. Try again. ${describeResponse(data)}`); }
        } else {
          throw new Error(`Failed to parse subject JSON. Try again. ${describeResponse(data)}`);
        }
      }

      // Normalize sections
      if (!parsed.sections) parsed.sections = [];
      parsed.sections = parsed.sections.map((s, si) => ({
        id: s.id || `section_${si + 1}`,
        title: s.title || `Section ${si + 1}`,
        description: s.description || '',
        estimated_minutes: s.estimated_minutes || 30,
        lessons: (s.lessons || []).map((l, li) => ({
          id: l.id || `lesson_${si + 1}_${li + 1}`,
          title: l.title || `Lesson ${li + 1}`,
          content: (l.content || '').replace(/<\/?cite[^>]*>/g, ''),
          key_takeaways: Array.isArray(l.key_takeaways) ? l.key_takeaways : [],
          practice_prompt: l.practice_prompt || '',
        }))
      }));

      updateGenSubject(tempSlug, { phase: 'Saving subject...' });
      const userRefSources = validRefs.map(r => ({ title: r.title, url: r.url }));
      const allSources = [...(webSources || []), ...userRefSources];
      const seenUrls = new Set();
      const dedupedSources = allSources.filter(s => { if (!s.url || seenUrls.has(s.url)) return false; seenUrls.add(s.url); return true; });

      const subSlug = (parsed.title || topic).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const subject = {
        slug: subSlug,
        title: parsed.title || topic,
        software_slug: swSlug,
        description: parsed.description || '',
        skill_level: parsed.skill_level || skillLevel,
        estimated_hours: parsed.estimated_hours || 1,
        is_stub: false,
        sections: parsed.sections,
        prerequisites: parsed.prerequisites || [],
        sources: dedupedSources,
        original_prompt: topic,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await otterFetch(`/api/software/${swSlug}/subjects`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subject)
      });

      // Merge hotkeys if present
      if (parsed.hotkeys?.length > 0) {
        let categories = parsed.hotkeys;
        const first = categories[0];
        if (first && !first.shortcuts) {
          const grouped = {};
          categories.forEach(h => {
            const cat = h.context || h.category || 'General';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push({ action: h.action || h.description || '', windows: h.windows || h.key || '', mac: h.mac || h.key || '', notes: h.notes || '' });
          });
          categories = Object.entries(grouped).map(([category, shortcuts]) => ({ category, shortcuts }));
        }
        const hkRes = await otterFetch(`/api/software/${swSlug}/hotkeys/merge`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categories })
        });
        const updatedHk = await hkRes.json();
        setSoftwareHotkeys(updatedHk);
        if (softwareCacheRef.current[swSlug]) softwareCacheRef.current[swSlug].hotkeys = updatedHk;
      }

      // Merge functions if present
      if (parsed.functions?.length > 0) {
        let categories = parsed.functions.map(cat => ({
          category: cat.category || 'General',
          functions: (cat.functions || []).map(f => ({
            name: f.name || '', syntax: f.syntax || f.name || '',
            parameters: f.parameters || '', returns: f.returns || f.returnType || '',
            description: f.description || '', example: f.example || ''
          }))
        })).filter(cat => cat.functions.length > 0);
        if (categories.length > 0) {
          await otterFetch(`/api/software/${swSlug}/functions/merge`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categories })
          });
        }
      }

      // Merge nodes if present
      if (parsed.nodes?.length > 0) {
        const nodesRes = await otterFetch(`/api/software/${swSlug}/nodes/merge`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categories: parsed.nodes })
        });
        const updatedNodes = await nodesRes.json();
        setSoftwareNodes(updatedNodes);
        if (softwareCacheRef.current[swSlug]) softwareCacheRef.current[swSlug].nodes = updatedNodes;
      }

      invalidateCache(swSlug);
      selectSoftware(swSlug, true);
      selectSubject(swSlug, subSlug);
      setCurrentView('study');
    } catch (e) {
      setSubjectErrors(prev => ({ ...prev, [tempSlug]: e.message }));
    } finally {
      removeGenSubject(tempSlug);
    }
  }, [activeSoftwareSlug, skillLevel, editingPrompts, selectSoftware, selectSubject, referenceUrls, softwareHotkeys, softwareFunctions, softwareNodes, invalidateCache, updateGenSubject, removeGenSubject]);

  // Agent: generate a full course (mirrors generateCourse but takes params)
  const agentGenerateCourse = useCallback(async (softwareName, description) => {
    if (!softwareName?.trim()) throw new Error('Software/language name is required');

    const tempSlug = `_agent_course_${Date.now()}`;

    const nameLower = softwareName.trim().toLowerCase();
    const existingMatch = softwareList.find(sw => sw.name.toLowerCase() === nameLower);

    const startTime = Date.now();
    const timerId = setInterval(() => {
      setGeneratingSubjects(prev => {
        const next = new Map(prev);
        const entry = next.get(tempSlug);
        if (entry && !entry.cancelled) {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          let phase = 'Sending request...';
          if (elapsed >= 15) phase = 'Finalizing...';
          else if (elapsed >= 8) phase = 'Creating subject stubs...';
          else if (elapsed >= 2) phase = 'Designing curriculum outline...';
          next.set(tempSlug, { ...entry, elapsed, phase });
        }
        generatingSubjectsRef.current = next;
        return next;
      });
    }, 1000);

    updateGenSubject(tempSlug, { title: `Course: ${softwareName.trim()}`, phase: 'Sending request...', elapsed: 0, startTime, timerId, cancelled: false });

    try {
      const systemPrompt = editingPrompts.courseOutline || FULL_COURSE_OUTLINE_PROMPT;
      let userMessage = `Software/Language: ${softwareName.trim()}\nSkill level: ${skillLevel}\n`;
      if (description?.trim()) userMessage += `\nAdditional context: ${description}`;

      let existingSubjectTitles = [];
      if (existingMatch) {
        try {
          const existingSubs = await otterFetch(`/api/software/${existingMatch.slug}/subjects`).then(r => r.json());
          existingSubjectTitles = existingSubs.map(s => s.title);
          userMessage += `\n\nIMPORTANT: This software already has the following subjects — do NOT generate duplicates or basics:\n${existingSubjectTitles.map(t => `- ${t}`).join('\n')}`;
          userMessage += `\nDo NOT include "General Basics" since it already exists. Only generate NEW subjects.`;
        } catch { /* proceed */ }
      }

      // Inject reference URLs
      const validRefs = referenceUrls.filter(r => r.text && !r.error);
      if (validRefs.length > 0) {
        userMessage += `\n\nThe user provided these reference materials. Design subjects that align with this content:\n`;
        for (const ref of validRefs) {
          userMessage += `- ${ref.title} (${ref.url}): ${ref.text.slice(0, 500)}\n`;
        }
      }

      const data = await callAnthropicAPI({
        model: modelFor('otter.agentCourse'),
        maxTokens: 12000,
        systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
      if (data.stop_reason === 'max_tokens') {
        throw new Error('Response was too long. Try again.');
      }

      updateGenSubject(tempSlug, { phase: 'Parsing response...' });
      // Same defect as generateCourse — see the note there.
      const { text: rawText } = extractTextAndCitations(data);
      let text = rawText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      let parsed;
      try { parsed = JSON.parse(text); }
      catch {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try { parsed = JSON.parse(jsonMatch[0]); }
          catch { throw new Error(`Failed to parse course outline JSON. Try again. ${describeResponse(data)}`); }
        } else {
          throw new Error(`Failed to parse course outline JSON. Try again. ${describeResponse(data)}`);
        }
      }

      let slug;
      if (existingMatch) {
        slug = existingMatch.slug;
        updateGenSubject(tempSlug, { phase: 'Adding to existing course...' });
      } else {
        updateGenSubject(tempSlug, { phase: 'Creating software folder...' });
        const metaRes = await otterFetch('/api/software', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: parsed.software_name || softwareName.trim(),
            type: parsed.type || 'software',
            skill_level: skillLevel,
            // The agent has no tier picker to read; courses it creates are born
            // personal, which is also what otter_courses_insert defaults to.
            visibility: 'personal',
          })
        });
        const meta = await metaRes.json();
        if (!metaRes.ok || !meta?.slug) {
          throw new Error(meta?.error || 'Could not create the course.');
        }
        slug = meta.slug;
      }

      updateGenSubject(tempSlug, { phase: 'Saving subject stubs...' });
      const subjects = parsed.subjects || [];

      let existingSlugs = new Set();
      let existingMaxOrder = 0;
      if (existingMatch) {
        try {
          const existingSubs = await otterFetch(`/api/software/${slug}/subjects`).then(r => r.json());
          existingSubs.forEach(s => {
            existingSlugs.add(s.slug);
            if (s.subject_order != null && s.subject_order > existingMaxOrder) existingMaxOrder = s.subject_order;
          });
          const existingTitlesLower = new Set(existingSubs.map(s => s.title.toLowerCase()));
          for (const sub of subjects) {
            if (existingTitlesLower.has(sub.title.toLowerCase())) {
              const subSlug = sub.title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
              existingSlugs.add(subSlug);
            }
          }
        } catch { /* proceed */ }
      }

      let orderCounter = existingMaxOrder;
      for (const sub of subjects) {
        const subSlug = sub.title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (existingSlugs.has(subSlug)) continue;
        if (existingMatch && sub.title.toLowerCase().includes('general basics')) continue;

        orderCounter++;
        await otterFetch(`/api/software/${slug}/subjects`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: subSlug,
            title: sub.title,
            description: sub.description || '',
            skill_level: sub.skill_level || skillLevel,
            estimated_hours: sub.estimated_hours || 1,
            is_stub: true,
            sections: [],
            section_outlines: sub.section_outlines || [],
            prerequisites: [],
            subject_order: sub.subject_order || orderCounter,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
        });
      }

      invalidateCache(slug);
      await loadSoftwareList();
      selectSoftware(slug, true);
      setCurrentView('library');
      return slug;
    } catch (e) {
      setSubjectErrors(prev => ({ ...prev, [tempSlug]: e.message }));
    } finally {
      removeGenSubject(tempSlug);
    }
  }, [skillLevel, editingPrompts, loadSoftwareList, selectSoftware, softwareList, referenceUrls, invalidateCache, updateGenSubject, removeGenSubject]);

  // Refs for agent generation functions so tool interface always gets latest
  const agentGenSingleRef = useRef(null);
  agentGenSingleRef.current = agentGenerateSingleSubject;
  const agentGenCourseRef = useRef(null);
  agentGenCourseRef.current = agentGenerateCourse;

  // ═══════════════════════════════════════════════════════════════
  //  QUIZ GENERATION
  // ═══════════════════════════════════════════════════════════════
  const getQuizContent = useCallback(async () => {
    const selectedSlugs = Object.keys(quizSelections);
    if (selectedSlugs.length === 0) return null;

    let allContent = '';
    let softwareNames = [];
    let types = new Set();
    let levels = new Set();

    for (const swSlug of selectedSlugs) {
      const selectedSubjects = quizSelections[swSlug];
      if (!selectedSubjects || (selectedSubjects instanceof Set && selectedSubjects.size === 0)) continue;

      const swData = quizSelectionData[swSlug];
      if (!swData) continue;
      softwareNames.push(swData.meta?.name || swSlug);
      types.add(swData.meta?.type || 'software');
      levels.add(swData.meta?.skill_level || 'beginner');

      const subjects = swData.subjects || [];
      for (const sub of subjects) {
        if (sub.is_stub) continue;
        if (selectedSubjects !== 'all' && !selectedSubjects.has(sub.slug)) continue;

        const cacheKey = `${swSlug}/${sub.slug}`;
        let full = subjectCacheRef.current[cacheKey];
        if (!full) {
          try {
            full = await otterFetch(`/api/software/${swSlug}/subjects/${sub.slug}`).then(r => r.json());
            subjectCacheRef.current[cacheKey] = full;
          } catch { continue; }
        }
        if (full.sections) {
          allContent += `### ${swData.meta?.name}: ${full.title}\n`;
          allContent += full.sections.map(s =>
            s.lessons.map(l => `## ${l.title}\n${l.content}`).join('\n\n')
          ).join('\n\n') + '\n\n';
        }
      }
    }

    if (!allContent.trim()) return null;

    return {
      content: allContent,
      software: softwareNames.join(', '),
      type: types.has('coding_language') ? 'coding_language' : 'software',
      skillLevel: [...levels][0] || 'beginner',
    };
  }, [quizSelections, quizSelectionData]);

  const generateQuiz = useCallback(async (types) => {
    setQuizLoading(true);
    setQuizError(null);
    setQuizQuestions(null);
    setChallenges(null);
    setCurrentQuestion(0);
    setSelectedAnswer(null);
    setShowExplanation(false);
    setQuizScore(0);
    setQuizComplete(false);
    setQuizSaveState(null);
    setCurrentChallenge(0);
    setHintsShown(0);
    setShowSolution(false);

    try {
      const quizData = await getQuizContent();
      if (!quizData || !quizData.content.trim()) {
        throw new Error('No lesson content available. Generate content for at least one subject first.');
      }

      const context = `Subject: ${quizData.software} (${quizData.type})\nSkill Level: ${quizData.skillLevel}\n\nLesson Content:\n${quizData.content}`;
      const typesArr = Array.from(types);

      let allQuestions = [];
      let allChallenges = [];

      for (const type of typesArr) {
        let prompt;
        if (type === 'mc') prompt = editingPrompts.mc || MULTIPLE_CHOICE_PROMPT;
        else if (type === 'codeId') prompt = editingPrompts.codeId || CODE_IDENTIFICATION_PROMPT;
        else prompt = editingPrompts.codeWrite || CODE_WRITING_PROMPT;

        const data = await callAnthropicAPI({
          model: modelFor('otter.quiz'),
          maxTokens: 8192,
          systemPrompt: prompt,
          messages: [{ role: 'user', content: context }],
        });

        // Same defect as generateCourse — a thinking block sits at content[0].
        const rawText = extractTextAndCitations(data).text;
        let text = rawText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
        let parsed;
        try { parsed = JSON.parse(text); }
        catch {
          const m = text.match(/\{[\s\S]*\}/);
          if (m) { try { parsed = JSON.parse(m[0]); } catch { throw new Error(`Failed to parse ${type} quiz JSON.`); } }
          else throw new Error(`Failed to parse ${type} quiz JSON.`);
        }

        if (type === 'codeWrite') {
          allChallenges = [...allChallenges, ...(parsed.challenges || [])];
        } else {
          allQuestions = [...allQuestions, ...(parsed.questions || [])];
        }
      }

      if (allQuestions.length > 0) setQuizQuestions(allQuestions);
      if (allChallenges.length > 0) {
        setChallenges(allChallenges);
        if (allChallenges[0]?.starter_code) setUserCode(allChallenges[0].starter_code);
      }
      const firstType = typesArr.find(t => t === 'mc' || t === 'codeId') ? (typesArr.includes('mc') ? 'mc' : 'codeId') : 'codeWrite';
      setQuizTab(firstType);
      setQuizStarted(true);
    } catch (e) {
      setQuizError(e.message);
    } finally {
      setQuizLoading(false);
    }
  }, [editingPrompts, getQuizContent]);

  // ═══════════════════════════════════════════════════════════════
  //  QUIZ ANSWER HANDLING
  // ═══════════════════════════════════════════════════════════════
  const handleAnswer = useCallback((idx) => {
    if (showExplanation) return;
    setSelectedAnswer(idx);
    setShowExplanation(true);
    const q = quizQuestions[currentQuestion];
    if (idx === q.correct_answer) {
      setQuizScore(s => s + 1);
    }
  }, [showExplanation, quizQuestions, currentQuestion]);

  // ═══════════════════════════════════════════════════════════════
  //  RECORDING AN ATTEMPT — the caller that never existed
  // ═══════════════════════════════════════════════════════════════
  //
  // 🚨 Every hop of this path has been built since Session 10 — the column,
  // both adapter ops, the route mapping, and a unit test that PASSES — and
  // nothing has ever called the writer, on either backend. That is why quiz
  // scores "were not saved": not a broken save, an absent one. See 0045.
  //
  // The attempt records which courses it drew on, because a quiz is built from
  // whatever the user ticked (quizSelections) and may span several. Filing it
  // under `activeSoftware` would attribute a Blender+Unity score to whichever
  // course happened to be open, which is the wiring the old per-course route
  // invited.
  const recordQuizAttempt = useCallback(async (score, total) => {
    const courses = Object.keys(quizSelections)
      .filter(slug => {
        const sel = quizSelections[slug];
        return sel === 'all' || (sel instanceof Set && sel.size > 0);
      })
      .map(slug => ({ id: slug, name: quizSelectionData[slug]?.meta?.name || slug }));

    setQuizSaveState('saving');
    try {
      const res = await otterFetch('/api/otter/quiz-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score, total, courses,
          question_types: Array.from(quizTypes),
        }),
      });
      // otterFetch resolves for every status, so this check is the whole
      // difference between recording a result and appearing to.
      if (!res.ok) {
        const detail = await res.json().then(b => b?.error).catch(() => null);
        setQuizSaveState({ error: detail || `Your score could not be saved (HTTP ${res.status}).` });
        return;
      }
      setQuizSaveState('saved');
    } catch (err) {
      setQuizSaveState({ error: err?.message || 'Your score could not be saved.' });
    }
  }, [quizSelections, quizSelectionData, quizTypes]);

  const nextQuestion = useCallback(() => {
    if (currentQuestion + 1 >= quizQuestions.length) {
      setQuizComplete(true);
      // The single moment a quiz finishes, and the only write point.
      //
      // ⚠️ `quizScore` MUST stay in this callback's dependency list. The old
      // deps were [currentQuestion, quizQuestions]; with the score added by
      // handleAnswer, a stale closure here would under-report the last
      // question — silently, and only when the last answer was right. It is
      // correct as written because the Next/See Results button renders only
      // once showExplanation is true, so a render always separates the answer
      // from this call and the value is settled by the time it runs.
      recordQuizAttempt(quizScore, quizQuestions.length);
    } else {
      setCurrentQuestion(c => c + 1);
      setSelectedAnswer(null);
      setShowExplanation(false);
    }
  }, [currentQuestion, quizQuestions, quizScore, recordQuizAttempt]);

  // ═══════════════════════════════════════════════════════════════
  //  QUIZ NAVIGATION GUARD
  // ═══════════════════════════════════════════════════════════════
  const navigateTo = useCallback((targetView, extraActions) => {
    if (quizStarted && currentView === 'quiz' && targetView !== 'quiz') {
      setShowQuizLeaveConfirm({ targetView, extraActions });
    } else {
      if (extraActions) extraActions();
      setCurrentView(targetView);
    }
  }, [quizStarted, currentView]);

  // Picking a chip filters the LIBRARY, so it must also SHOW the library.
  // Without this the chip changed the sidebar list while the main pane stayed
  // on whatever view the user was in — and since every banner for these flows
  // (trash restore, fork, share) renders inside renderLibrary(), which sits in
  // a `hidden` wrapper unless currentView === 'library', a failed restore
  // produced no feedback anywhere at all.
  //
  // Defined HERE, after navigateTo, deliberately: hoisting it up with the other
  // Session 11 handlers would put navigateTo in its dependency array before the
  // const is initialised, which is a temporal-dead-zone ReferenceError at first
  // render, not a lint nit.
  //
  // navigateTo rather than setCurrentView so the in-progress-quiz guard still
  // gets its say — and the filter only changes if the user agrees to leave.
  const selectCourseFilter = useCallback((key) => {
    navigateTo('library', () => {
      setCourseFilter(key);
      setTrashError(null);
      setSharingError(null);
      setSharingNotice(null);
    });
  }, [navigateTo]);

  const confirmLeaveQuiz = useCallback(() => {
    if (showQuizLeaveConfirm) {
      if (showQuizLeaveConfirm.extraActions) showQuizLeaveConfirm.extraActions();
      setCurrentView(showQuizLeaveConfirm.targetView);
      setShowQuizLeaveConfirm(null);
    }
  }, [showQuizLeaveConfirm]);

  // Load quiz selection data from all software
  const loadQuizSelectionData = useCallback(async () => {
    const data = {};
    for (const sw of softwareList) {
      const cached = softwareCacheRef.current[sw.slug];
      if (cached) {
        data[sw.slug] = { meta: cached.meta, subjects: cached.subjects };
      }
    }
    if (Object.keys(data).length > 0) {
      setQuizSelectionData({ ...data });
    }
    await Promise.all(softwareList.map(async (sw) => {
      try {
        const [meta, subjects] = await Promise.all([
          otterFetch(`/api/software/${sw.slug}`).then(r => r.json()),
          otterFetch(`/api/software/${sw.slug}/subjects`).then(r => r.json()),
        ]);
        data[sw.slug] = { meta, subjects };
        if (softwareCacheRef.current[sw.slug]) {
          softwareCacheRef.current[sw.slug].meta = meta;
          softwareCacheRef.current[sw.slug].subjects = subjects;
        }
      } catch { /* skip */ }
    }));
    setQuizSelectionData({ ...data });
  }, [softwareList]);

  // Auto-load quiz data whenever quiz view is opened
  useEffect(() => {
    if (currentView === 'quiz' && softwareList.length > 0 && Object.keys(quizSelectionData).length === 0) {
      loadQuizSelectionData();
    }
  }, [currentView, softwareList, quizSelectionData, loadQuizSelectionData]);

  // ── Global keyboard shortcuts ──
  useEffect(() => {
    // Session 17 (§6 #50): O.T.T.E.R. stays mounted under display:none on
    // every other page, so an ungated window listener fired everywhere —
    // pressing Space in D.O.G. or R.A.B.B.I.T. opened the search modal
    // inside the hidden tree. Same gate as the sidebar-collapse shortcut.
    if (currentPage !== 'otter') return undefined;
    const handleKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      const editable = document.activeElement?.isContentEditable;
      const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable;
      // Space → open search
      if (e.key === ' ' && !showSearchModal && !isEditing) {
        e.preventDefault();
        setShowSearchModal(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSearchModal, currentPage]);

  // ═══════════════════════════════════════════════════════════════
  //  IMPORT / EXPORT
  // ═══════════════════════════════════════════════════════════════
  const exportAll = useCallback(async () => {
    const res = await otterFetch('/api/export-all');
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `OTTER_all_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImportFile = useCallback(async (file) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (data.version === '2.0' && data.software) {
        for (const sw of data.software) {
          if (!sw.meta) continue;
          await otterFetch('/api/software', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: sw.meta.name, type: sw.meta.type, skill_level: sw.meta.skill_level })
          });
          const slug = sw.meta.slug;
          for (const sub of (sw.subjects || [])) {
            await otterFetch(`/api/software/${slug}/subjects`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(sub)
            });
          }
          if (sw.hotkeys?.categories?.length) {
            await otterFetch(`/api/software/${slug}/hotkeys/merge`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ categories: sw.hotkeys.categories })
            });
          }
          if (sw.functions?.categories?.length) {
            await otterFetch(`/api/software/${slug}/functions/merge`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ categories: sw.functions.categories })
            });
          }
          // Handle both new systems format and old categories format for nodes import
          if (sw.nodes?.systems?.length) {
            const flatCats = sw.nodes.systems.flatMap(sys =>
              (sys.categories || []).map(cat => ({ ...cat, system: sys.system }))
            );
            if (flatCats.length > 0) {
              await otterFetch(`/api/software/${slug}/nodes/merge`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categories: flatCats })
              });
            }
          } else if (sw.nodes?.categories?.length) {
            await otterFetch(`/api/software/${slug}/nodes/merge`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ categories: sw.nodes.categories })
            });
          }
          if (sw.progress) {
            await otterFetch(`/api/software/${slug}/progress`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(sw.progress)
            });
          }
          // Renumber subjects to ensure consistent ordering after import
          await otterFetch(`/api/software/${slug}/subjects/renumber`, { method: 'POST' });
        }
        invalidateCache();
        loadSoftwareList();
        setShowImportModal(false);
        return;
      }

      if (data.lesson) {
        const softwareName = data.lesson.software_or_language || 'Imported';
        const slug = softwareName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        await otterFetch('/api/software', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: softwareName, type: data.lesson.type || 'software', skill_level: data.lesson.skill_level || 'beginner' })
        });
        const subSlug = (data.lesson.title || 'imported').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        await otterFetch(`/api/software/${slug}/subjects`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: subSlug,
            title: data.lesson.title,
            software_slug: slug,
            description: data.lesson.description || '',
            skill_level: data.lesson.skill_level || 'beginner',
            estimated_hours: data.lesson.estimated_hours || 1,
            is_stub: false,
            sections: data.lesson.sections || [],
            prerequisites: data.lesson.prerequisites || [],
            created_at: data.lesson.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
        });
        invalidateCache();
        loadSoftwareList();
        setShowImportModal(false);
        return;
      }

      throw new Error('Unrecognized file format');
    } catch (e) {
      alert('Import failed: ' + e.message);
    }
  }, [loadSoftwareList]);

  const handleDuplicateResolve = useCallback(async (action) => {
    setShowDuplicateModal(null);
    setShowImportModal(false);
  }, []);

  // ═══════════════════════════════════════════════════════════════
  //  DELETE SOFTWARE
  // ═══════════════════════════════════════════════════════════════
  const deleteSoftware = useCallback(async (slug) => {
    await otterFetch(`/api/software/${slug}`, { method: 'DELETE' });
    // Session 11: in cloud mode this is otter_soft_delete_row — a 30-day trash,
    // not a destruction. Keep the "Recently deleted" list honest immediately so
    // the course the user just removed is visibly recoverable.
    if (cloudMode) loadTrash();
    if (activeSoftwareSlug === slug) {
      setActiveSoftwareSlug(null);
      setActiveSoftware(null);
      setSubjectList([]);
      setActiveSubjectSlug(null);
      setActiveSubject(null);
      setSoftwareHotkeys(null);
      setSoftwareFunctions(null);
      setActiveProgress(null);
      setReferenceUrls([]);
      setCurrentView('library');
    }
    invalidateCache(slug);
    loadSoftwareList();
    setShowDeleteConfirm(null);
  }, [activeSoftwareSlug, loadSoftwareList, invalidateCache, cloudMode, loadTrash]);

  // ═══════════════════════════════════════════════════════════════
  //  DELETE SUBJECT (with undo support)
  // ═══════════════════════════════════════════════════════════════
  const deleteSubject = useCallback(async (softwareSlug, subjectSlug) => {
    try {
      const subData = await otterFetch(`/api/software/${softwareSlug}/subjects/${subjectSlug}`).then(r => r.json());
      setDeletedSubjectsStack(prev => [...prev, { softwareSlug, subjectData: subData }]);
      setRedoSubjectsStack([]);
    } catch { /* proceed with delete even if backup fails */ }

    await otterFetch(`/api/software/${softwareSlug}/subjects/${subjectSlug}`, { method: 'DELETE' });
    if (activeSubjectSlug === subjectSlug) {
      setActiveSubjectSlug(null);
      setActiveSubject(null);
      setSelectedLessonId(null);
      setExpandedSubjectSections({});
      setCurrentView('library');
    }
    invalidateCache(softwareSlug);
    selectSoftware(softwareSlug, true);
    setShowDeleteSubjectConfirm(null);
  }, [activeSubjectSlug, invalidateCache, selectSoftware]);

  const deletedSubjectsRef = useRef(deletedSubjectsStack);
  deletedSubjectsRef.current = deletedSubjectsStack;
  const redoSubjectsRef = useRef(redoSubjectsStack);
  redoSubjectsRef.current = redoSubjectsStack;

  const undoDeleteSubject = useCallback(async () => {
    const stack = deletedSubjectsRef.current;
    if (stack.length === 0) return;
    const last = stack[stack.length - 1];
    setDeletedSubjectsStack(prev => prev.slice(0, -1));
    setRedoSubjectsStack(prev => [...prev, last]);

    await otterFetch(`/api/software/${last.softwareSlug}/subjects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(last.subjectData)
    });
    // Renumber subjects to maintain clean ordering after restore
    await otterFetch(`/api/software/${last.softwareSlug}/subjects/renumber`, { method: 'POST' });
    invalidateCache(last.softwareSlug);
    selectSoftware(last.softwareSlug, true);
    loadSoftwareList();
  }, [invalidateCache, selectSoftware, loadSoftwareList]);

  const redoDeleteSubject = useCallback(async () => {
    const stack = redoSubjectsRef.current;
    if (stack.length === 0) return;
    const last = stack[stack.length - 1];
    setRedoSubjectsStack(prev => prev.slice(0, -1));
    setDeletedSubjectsStack(prev => [...prev, last]);

    // DELETE endpoint already calls renumberSubjects on the backend
    await otterFetch(`/api/software/${last.softwareSlug}/subjects/${last.subjectData.slug}`, { method: 'DELETE' });
    invalidateCache(last.softwareSlug);
    selectSoftware(last.softwareSlug, true);
    loadSoftwareList();
  }, [invalidateCache, selectSoftware, loadSoftwareList]);

  // ═══════════════════════════════════════════════════════════════
  //  MARK LESSON COMPLETE
  // ═══════════════════════════════════════════════════════════════
  const toggleLessonComplete = useCallback(async (lessonId) => {
    if (!activeProgress || !activeSubjectSlug) return;
    const subProgress = activeProgress.subjects?.[activeSubjectSlug] || { completed_lessons: [], last_accessed: new Date().toISOString() };
    const completed = subProgress.completed_lessons.includes(lessonId)
      ? subProgress.completed_lessons.filter(id => id !== lessonId)
      : [...subProgress.completed_lessons, lessonId];
    const updated = {
      ...activeProgress,
      subjects: {
        ...activeProgress.subjects,
        [activeSubjectSlug]: { completed_lessons: completed, last_accessed: new Date().toISOString() }
      }
    };
    setActiveProgress(updated);
    if (activeSoftwareSlug && softwareCacheRef.current[activeSoftwareSlug]) {
      softwareCacheRef.current[activeSoftwareSlug].progress = updated;
    }
    saveProgress(updated);
  }, [activeProgress, activeSubjectSlug, activeSoftwareSlug, saveProgress]);

  // ═══════════════════════════════════════════════════════════════
  //  GET SELECTED LESSON
  // ═══════════════════════════════════════════════════════════════
  const getSelectedLesson = useCallback(() => {
    if (!activeSubject || !selectedLessonId) return null;
    for (const s of (activeSubject.sections || [])) {
      for (const l of (s.lessons || [])) {
        if (l.id === selectedLessonId) return l;
      }
    }
    return null;
  }, [activeSubject, selectedLessonId]);

  const getAllLessons = useCallback(() => {
    if (!activeSubject) return [];
    return (activeSubject.sections || []).flatMap(s => s.lessons || []);
  }, [activeSubject]);

  const navigateLesson = useCallback((direction) => {
    const all = getAllLessons();
    const idx = all.findIndex(l => l.id === selectedLessonId);
    const next = idx + direction;
    if (next >= 0 && next < all.length) {
      setSelectedLessonId(all[next].id);
      for (const s of activeSubject.sections) {
        if (s.lessons.some(l => l.id === all[next].id)) {
          setExpandedSubjectSections(prev => ({ ...prev, [s.id]: true }));
        }
      }
    }
  }, [selectedLessonId, getAllLessons, activeSubject]);

  const completedLessonsCache = useMemo(() => {
    if (!activeProgress || !activeSubjectSlug) return [];
    return activeProgress.subjects?.[activeSubjectSlug]?.completed_lessons || [];
  }, [activeProgress, activeSubjectSlug]);

  const getCompletedLessons = useCallback(() => completedLessonsCache, [completedLessonsCache]);

  const getCurrentProgressPercent = useCallback(() => {
    if (!activeSubject || activeSubject.is_stub) return 0;
    const total = activeSubject.sections?.reduce((sum, s) => sum + (s.lessons?.length || 0), 0) || 0;
    if (total === 0) return 0;
    const completed = getCompletedLessons().length;
    return Math.round((completed / total) * 100);
  }, [activeSubject, getCompletedLessons]);

  // ═══════════════════════════════════════════════════════════════
  //  SEARCH — full-text search across all lesson content
  // ═══════════════════════════════════════════════════════════════
  const performSearch = useCallback(async (query) => {
    if (!query || query.trim().length < 2) {
      setSearchResults([]);
      setSelectedSearchResult(null);
      return;
    }
    const q = query.trim().toLowerCase();
    const results = [];

    for (const sw of softwareList) {
      const cached = softwareCacheRef.current[sw.slug];
      if (!cached) continue;

      for (const sub of cached.subjects) {
        if (sub.is_stub) continue;
        const cacheKey = `${sw.slug}/${sub.slug}`;
        let fullSub = subjectCacheRef.current[cacheKey];

        if (!fullSub) {
          try {
            fullSub = await otterFetch(`/api/software/${sw.slug}/subjects/${sub.slug}`).then(r => r.json());
            subjectCacheRef.current[cacheKey] = fullSub;
          } catch { continue; }
        }

        if (!fullSub?.sections) continue;

        for (const section of fullSub.sections) {
          for (const lesson of (section.lessons || [])) {
            const content = lesson.content || '';
            const title = lesson.title || '';
            const fullText = `${title}\n${content}`;
            const lowerText = fullText.toLowerCase();

            let matchCount = 0;
            let idx = 0;
            while ((idx = lowerText.indexOf(q, idx)) !== -1) {
              matchCount++;
              idx += q.length;
            }

            if (matchCount > 0) {
              results.push({
                softwareName: sw.name,
                softwareSlug: sw.slug,
                subjectTitle: sub.title,
                subjectSlug: sub.slug,
                sectionTitle: section.title,
                lessonTitle: lesson.title,
                lessonId: lesson.id,
                matches: matchCount,
                content: fullText,
              });
            }
          }
        }
      }

      // Hotkeys search
      const hotkeyCategories = (cached.hotkeys?.categories || []).filter(cat => cat && Array.isArray(cat.shortcuts));
      if (hotkeyCategories.length > 0) {
        const allText = hotkeyCategories.map(cat =>
          `${cat.category}\n` + cat.shortcuts.map(s => `${s.action || ''} ${s.windows || ''} ${s.mac || ''} ${s.notes || ''}`).join('\n')
        ).join('\n');
        const lowerAll = allText.toLowerCase();
        let matchCount = 0, idx2 = 0;
        while ((idx2 = lowerAll.indexOf(q, idx2)) !== -1) { matchCount++; idx2 += q.length; }
        if (matchCount > 0) {
          results.push({
            softwareName: sw.name,
            softwareSlug: sw.slug,
            subjectTitle: 'Hotkeys',
            subjectSlug: null,
            sectionTitle: 'Reference',
            lessonTitle: `${sw.name} — Keyboard Shortcuts`,
            lessonId: null,
            resultType: 'hotkeys',
            matches: matchCount,
            content: allText,
            hotkeyCategories,
          });
        }
      }

      // Functions search
      const funcCategories = (cached.functions?.categories || []).filter(cat => cat && Array.isArray(cat.functions));
      if (funcCategories.length > 0) {
        const allText = funcCategories.map(cat =>
          `${cat.category}\n` + cat.functions.map(f => `${f.name || ''} ${f.description || ''} ${f.syntax || ''} ${f.returns || ''}`).join('\n')
        ).join('\n');
        const lowerAll = allText.toLowerCase();
        let matchCount = 0, idx2 = 0;
        while ((idx2 = lowerAll.indexOf(q, idx2)) !== -1) { matchCount++; idx2 += q.length; }
        if (matchCount > 0) {
          const matchedFuncCategories = funcCategories.map(cat => ({
            ...cat,
            functions: cat.functions.filter(f => {
              const fText = [f.name, f.description, f.syntax, f.returns, f.parameters, f.example].filter(Boolean).join(' ').toLowerCase();
              return fText.includes(q);
            })
          })).filter(cat => cat.functions.length > 0);
          results.push({
            softwareName: sw.name,
            softwareSlug: sw.slug,
            subjectTitle: 'Functions',
            subjectSlug: null,
            sectionTitle: 'Reference',
            lessonTitle: `${sw.name} — Functions Reference`,
            lessonId: null,
            resultType: 'functions',
            matches: matchCount,
            content: allText,
            matchedCategories: matchedFuncCategories,
          });
        }
      }

      // Nodes search
      const nodeSystems = (cached.nodes?.systems || []).filter(sys => sys && Array.isArray(sys.categories));
      if (nodeSystems.length > 0) {
        const matchedNodeCategories = [];
        let nodeMatchCount = 0;
        for (const sys of nodeSystems) {
          for (const cat of sys.categories) {
            const matchingNodes = (cat.nodes || []).filter(n => {
              const nText = [
                n.name, n.description, n.notes,
                ...(Array.isArray(n.inputs) ? n.inputs.map(inp => `${inp.name || ''} ${inp.description || ''}`) : []),
                ...(Array.isArray(n.outputs) ? n.outputs.map(out => `${out.name || ''} ${out.description || ''}`) : []),
              ].filter(Boolean).join(' ').toLowerCase();
              return nText.includes(q);
            });
            if (matchingNodes.length > 0) {
              let catMatches = 0;
              for (const n of matchingNodes) {
                const text = [n.name, n.description, n.notes,
                  ...(Array.isArray(n.inputs) ? n.inputs.map(i => `${i.name || ''} ${i.description || ''}`) : []),
                  ...(Array.isArray(n.outputs) ? n.outputs.map(o => `${o.name || ''} ${o.description || ''}`) : []),
                ].filter(Boolean).join(' ').toLowerCase();
                let ni = 0;
                while ((ni = text.indexOf(q, ni)) !== -1) { catMatches++; ni += q.length; }
              }
              nodeMatchCount += catMatches;
              matchedNodeCategories.push({ system: sys.system, category: cat.category, nodes: matchingNodes });
            }
          }
        }
        if (nodeMatchCount > 0) {
          results.push({
            softwareName: sw.name,
            softwareSlug: sw.slug,
            subjectTitle: 'Nodes',
            subjectSlug: null,
            sectionTitle: 'Reference',
            lessonTitle: `${sw.name} — Node Reference`,
            lessonId: null,
            resultType: 'nodes',
            matches: nodeMatchCount,
            content: matchedNodeCategories.map(mc => mc.nodes.map(n => `${n.name} ${n.description}`).join('\n')).join('\n'),
            matchedCategories: matchedNodeCategories,
          });
        }
      }
    }

    results.sort((a, b) => b.matches - a.matches);
    setSearchResults(results);
    setSelectedSearchResult(results.length > 0 ? 0 : null);
  }, [softwareList]);

  // ═══════════════════════════════════════════════════════════════
  //  UTILITY: Format time for generation progress
  // ═══════════════════════════════════════════════════════════════
  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // Navigate to a search result (lesson, hotkeys, or functions page)
  const navigateToSearchResult = useCallback((r) => {
    selectSoftware(r.softwareSlug);
    if (r.resultType === 'hotkeys' || r.resultType === 'functions') {
      setCurrentView('hotkeys');
    } else if (r.resultType === 'nodes') {
      setCurrentView('nodes');
    } else {
      selectSubject(r.softwareSlug, r.subjectSlug);
      setSelectedLessonId(r.lessonId);
      setCurrentView('study');
    }
    setShowSearchModal(false);
    setSearchQuery('');
    setSearchResults([]);
  }, [selectSoftware, selectSubject]);

  // ═══════════════════════════════════════════════════════════════
  //  THE NAV BAR'S VIEWS (A3: the kit's Tabs)
  // ═══════════════════════════════════════════════════════════════
  // Which tab is selected — each condition is the one its button used to
  // carry. Library only with no course open; Hotkeys and Functions share the
  // hotkeys view and split on the course's type. Anything else (a course, a
  // lesson, the prompt, Sources) selects no tab, as before.
  const navView =
    currentView === 'library' && !activeSoftwareSlug ? 'library'
      : currentView === 'quiz' ? 'quiz'
        : currentView === 'hotkeys' ? (activeSoftware?.type === 'coding_language' ? 'functions' : 'hotkeys')
          : currentView === 'nodes' ? 'nodes'
            : currentView === 'requests' ? 'requests'
              : currentView === 'validator' ? 'validator'
                : null;

  // Each tab does exactly what its button's onClick did.
  function selectNavView(id) {
    if (id === 'library') {
      navigateTo('library', () => {
        setActiveSoftwareSlug(null);
        setActiveSoftware(null);
        setActiveSubjectSlug(null);
        setActiveSubject(null);
      });
    } else if (id === 'quiz') {
      loadQuizSelectionData(); navigateTo('quiz');
    } else if (id === 'hotkeys') {
      if (activeSoftware && activeSoftware.type !== 'coding_language') {
        navigateTo('hotkeys');
      } else {
        const first = softwareList.find(sw => sw.type !== 'coding_language');
        if (first) selectSoftware(first.slug);
        navigateTo('hotkeys');
      }
    } else if (id === 'nodes') {
      const nodeCapable = softwareList.filter(sw => sw.type !== 'coding_language');
      if (nodeCapable.length > 0) {
        if (!activeSoftware || activeSoftware.type === 'coding_language') {
          selectSoftware(nodeCapable[0].slug);
        }
      }
      navigateTo('nodes');
    } else if (id === 'functions') {
      if (activeSoftware && activeSoftware.type === 'coding_language') {
        navigateTo('hotkeys');
      } else {
        const first = softwareList.find(sw => sw.type === 'coding_language');
        if (first) selectSoftware(first.slug);
        navigateTo('hotkeys');
      }
    } else if (id === 'requests') {
      navigateTo('requests');
    } else if (id === 'validator') {
      navigateTo('validator');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  RENDER — MAIN LAYOUT
  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="otter-root">
      {/* ── NAV BAR ──
          A3: the six views are the kit's Tabs (review O1, O2): one tab
          treatment, one active state (the 2px signal underline), on the same
          strip R.A.B.B.I.T.'s ViewTabs draws. Edit (a menu) and Search (a
          dialog) are not views, so they are not tabs; they wear the tab's
          class so the strip reads as one language, and keep the underline
          while their menu or dialog is open, as they always did. */}
      <nav className="otter-nav" aria-label="O.T.T.E.R.">
        <button
          type="button"
          className="ui-tab otter-nav-button"
          aria-expanded={editMenuOpen}
          data-active={editMenuOpen ? 'true' : undefined}
          onPointerDown={() => { editPressWhileOpenRef.current = editMenuOpen; }}
          onKeyDown={() => { editPressWhileOpenRef.current = false; }}
          onClick={(e) => {
            // The kit Menu closes on any mousedown outside itself, and the
            // trigger is outside it: a press that closed the menu must not
            // reopen it on the click that follows.
            if (editPressWhileOpenRef.current) { editPressWhileOpenRef.current = false; return; }
            const r = e.currentTarget.getBoundingClientRect();
            setEditMenuPos({ x: r.left, y: r.bottom });
            setEditMenuOpen(prev => !prev);
          }}
        >
          Edit <ChevronDown className="otter-nav-icon" aria-hidden="true" />
        </button>
        {editMenuOpen && (
          <Menu
            x={editMenuPos.x}
            y={editMenuPos.y}
            onClose={() => setEditMenuOpen(false)}
            items={[
              {
                label: 'Undo delete', Icon: RotateCcw, onClick: undoDeleteSubject,
                disabled: deletedSubjectsStack.length === 0,
                hint: deletedSubjectsStack.length > 0 ? `(${deletedSubjectsStack.length})` : undefined,
              },
              {
                label: 'Redo delete', Icon: ArrowRight, onClick: redoDeleteSubject,
                disabled: redoSubjectsStack.length === 0,
                hint: redoSubjectsStack.length > 0 ? `(${redoSubjectsStack.length})` : undefined,
              },
              { divider: true },
              { label: 'Import subjects', Icon: Upload, onClick: () => setShowImportModal(true) },
              { label: 'Export all', Icon: Download, onClick: exportAll },
            ]}
          />
        )}
        <span className="ui-tabs-sep" aria-hidden="true" />
        <button
          type="button"
          className="ui-tab otter-nav-button"
          data-active={showSearchModal ? 'true' : undefined}
          onClick={() => setShowSearchModal(true)}
        >
          <Search className="otter-nav-icon" aria-hidden="true" /> Search
        </button>
        <Tabs
          items={[
            { id: 'library', label: <><Library className="otter-nav-icon" aria-hidden="true" />Library</> },
            { id: 'quiz', label: <><GraduationCap className="otter-nav-icon" aria-hidden="true" />Quiz</> },
            { id: 'hotkeys', label: <><Keyboard className="otter-nav-icon" aria-hidden="true" />Hotkeys</> },
            { id: 'nodes', label: <><Share2 className="otter-nav-icon" aria-hidden="true" />Nodes</> },
            { id: 'functions', label: <><Braces className="otter-nav-icon" aria-hidden="true" />Functions</> },
            // Requests — Session 13 follow-up (Audrey, 2026-07-30). Cloud-only:
            // change requests are meaningless without a workspace (the ops are
            // cloudOnly and would 501 locally). Admins read it as their
            // company-library controls; everyone else as their own requests.
            ...(cloudMode ? [{
              id: 'requests',
              label: <><GitPullRequestArrow className="otter-nav-icon" aria-hidden="true" />{appRole === 'admin' ? 'Admin' : 'Requests'}</>,
              title: appRole === 'admin'
                ? 'Company library — review and apply suggested changes'
                : 'Change requests and feedback',
            }] : []),
            // Validate — right-aligned (otter.css), and always the last tab.
            { id: 'validator', label: <><ShieldCheck className="otter-nav-icon" aria-hidden="true" />Validate</>, title: 'Lesson Validator' },
          ]}
          value={navView}
          onChange={selectNavView}
          panelId="otter-view-panel"
          label="O.T.T.E.R. views"
          className="otter-nav-tabs"
        />
      </nav>

      {/* ── BODY — sidebars + content ── */}
      <div className="flex flex-1 overflow-hidden">
        {renderSoftwareSidebar()}
        {renderLessonSidebar()}
        <main className="flex-1 overflow-hidden relative">
          {/* The region the nav's tabs switch (kit Tabs: `panelId`). A div, so
              <main> keeps its landmark role. */}
          <div id="otter-view-panel" role="tabpanel" className="h-full">
          <div className={currentView === 'library' ? 'h-full' : 'hidden'}>{renderLibrary()}</div>
          <div className={currentView === 'prompt' ? 'h-full' : 'hidden'}>{renderPromptInput()}</div>
          <div className={currentView === 'study' ? 'h-full' : 'hidden'}>{renderStudyView()}</div>
          <div className={currentView === 'quiz' ? 'h-full' : 'hidden'}>{renderQuizCenter()}</div>
          <div className={currentView === 'hotkeys' ? 'h-full' : 'hidden'}>{renderHotkeys()}</div>
          <div className={currentView === 'nodes' ? 'h-full' : 'hidden'}>{renderNodes()}</div>
          <div className={currentView === 'sources' ? 'h-full' : 'hidden'}>{renderSourcesView()}</div>
          {/* Conditionally MOUNTED, not hidden: the queue should be fresh on
              every visit, and mounting it always would fire cr.list for every
              user at launch (the AdminTerminalBody lazy-fetch rule). */}
          {currentView === 'requests' && (
            <div className="h-full">
              <RequestsView
                role={appRole}
                userId={perms.userId}
                softwareList={softwareList}
                refreshTick={requestsRefreshTick}
                onOpenCourse={async (slug) => {
                  // Refresh FIRST: the course may be freshly readable through
                  // the 0025 review window and absent from the list loaded at
                  // mount — without this the jump lands on a library that
                  // doesn't show it (same rule as the wilson:open-otter-course
                  // handler above).
                  await loadSoftwareList();
                  navigateTo('library');
                  selectSoftware(slug, true);
                }}
                onOpenDialog={(sourceSlug) => {
                  const course = softwareList.find(sw => sw.slug === sourceSlug);
                  if (!course) return false;
                  selectSoftware(sourceSlug);
                  setCrDialogCourse(course);
                  return true;
                }}
                // Approving a nomination changes the visibility of TWO courses
                // — the promoted one and the standard it stands down — so every
                // badge, filter chip and capability flag derived from the index
                // is stale until this runs. invalidateCache too: the per-course
                // meta in softwareCacheRef carries the old tier.
                onCoursesChanged={() => { invalidateCache(); loadSoftwareList(); }}
              />
            </div>
          )}
          <div className={currentView === 'validator' ? 'h-full' : 'hidden'}>
            <Validator
              softwareList={softwareList}
              activeSoftwareSlug={activeSoftwareSlug}
              softwareCacheRef={softwareCacheRef}
              subjectCacheRef={subjectCacheRef}
            />
          </div>
          </div>
          {/* ── GENERATION QUEUE INDICATOR ──
              A3 (review O15): inside <main>, 24px from its bottom-left corner,
              so it tracks the sidebars. It was fixed at left 440px — the
              content edge only while both sidebars were open at their old
              widths — and hovered 48px up over a bar 8px tall. */}
          {generatingSubjects.size > 0 && (
            <div className="otter-queue">
              <div className="otter-queue-head">
                <Loader2 className="animate-spin" aria-hidden="true" /> Generating ({generatingSubjects.size})
              </div>
              <div className="otter-queue-list">
                {Array.from(generatingSubjects.entries()).map(([slug, entry]) => (
                  <div key={slug} className="otter-queue-row">
                    <div className="otter-queue-text">
                      <p className="otter-queue-title">{entry.title}</p>
                      <p className="otter-queue-meta">
                        {entry.cancelled ? (
                          <span className="otter-queue-cancelling">Cancelling...</span>
                        ) : (
                          <>
                            <span>{entry.phase}</span>
                            <span aria-hidden="true">&bull;</span>
                            <span className="otter-queue-time">{Math.floor((entry.elapsed || 0) / 60)}:{String((entry.elapsed || 0) % 60).padStart(2, '0')}</span>
                          </>
                        )}
                      </p>
                    </div>
                    {!entry.cancelled && (
                      <IconButton size="sm" icon={X} danger title="Cancel generation" onClick={() => cancelGeneration(slug)} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ── SETTINGS PANEL ── */}
      {settingsOpen && renderSettingsPanel()}

      {/* ── HELP ──
          A4: the kit's Dialog (review O27), D.O.G.'s Help rule for rule
          (A2): the reading width (720; it was 850), its fixed 82vh, the
          200px contents column, the open page as F2's selected row. Opened
          over the settings slide-out, its Escape is its own (A2-KR-3). */}
      {showHelpModal && (
        <Dialog
          title="Help & documentation"
          onClose={() => setShowHelpModal(false)}
          dismissOnBackdrop
          width="reading"
          className="otter-help"
        >
          <nav className="otter-help-side wilson-dark-scroll" aria-label="Help contents">
            <div className="otter-help-list">
              {OTTER_HELP_SIDEBAR_ITEMS.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setHelpPage(item.id)}
                  className="otter-help-nav"
                  data-active={helpPage === item.id}
                  aria-current={helpPage === item.id ? 'page' : undefined}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="otter-help-version">{typeof __OTTER_VERSION__ !== 'undefined' ? __OTTER_VERSION__ : 'v?'}</div>
          </nav>
          <div className="otter-help-content wilson-dark-scroll">
            <OtterHelpContent helpPage={helpPage} theme="dark" />
          </div>
        </Dialog>
      )}

      {/* ── MODALS ── */}
      {showImportModal && renderImportModal()}
      {showDeleteConfirm && renderDeleteConfirm()}
      {showDeleteSubjectConfirm && renderDeleteSubjectConfirm()}
      {showClearConfirm && renderClearConfirm()}
      {showDuplicateModal && renderDuplicateModal()}

      {/* ── SESSION 11 DIALOGS ──
          Both open from the course row's actions menu, in the style of
          RABBIT's EditHistoryDrawer. Conditionally RENDERED, not hidden:
          ShareCourseDialog mounts useWorkspaceMembers, which fires a
          workspace_directory RPC — that must not run for every user on
          every launch (the AdminTerminalBody lesson). */}
      {shareDialogCourse && (
        <ShareCourseDialog
          course={shareDialogCourse}
          role={appRole}
          userId={perms.userId}
          // Bump the Requests tick too: this dialog can submit or withdraw a
          // NOMINATION, and the sidebar that opens it renders outside the view
          // switch — so it can be used while RequestsView is mounted behind it.
          // Without this the queue keeps showing the pre-submit state.
          onClose={() => { setShareDialogCourse(null); setRequestsRefreshTick(t => t + 1); }}
          onCourseChanged={handleCourseChanged}
        />
      )}
      {crDialogCourse && (
        <ChangeRequestDialog
          course={crDialogCourse}
          standardName={
            softwareList.find(sw => sw.slug === crDialogCourse.source_course_id)?.name ?? null
          }
          onClose={() => {
            setCrDialogCourse(null);
            setRequestsRefreshTick(t => t + 1);
          }}
        />
      )}

      {/* ── SEARCH MODAL ── */}
      {showSearchModal && renderSearchModal()}

      {/* ── QUIZ LEAVE CONFIRM ── */}
      {showQuizLeaveConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
          <div className="bg-stone-800 border border-stone-600 rounded-control p-6 max-w-sm w-full mx-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,0.3)]">
            <h3 className="text-orange-400 font-semibold text-h1 mb-2">Leave Quiz?</h3>
            <p className="text-stone-400 text-body mb-6">You have a quiz in progress. Your quiz will be preserved so you can come back to it.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowQuizLeaveConfirm(null)} className="flex-1 bg-stone-700 text-stone-300 border border-stone-600 py-2 rounded-control hover:bg-stone-600 transition-colors text-body font-semibold">Stay</button>
              <button onClick={confirmLeaveQuiz} className="flex-1 bg-orange-600 text-white border border-orange-700 py-2 rounded-control hover:bg-orange-700 transition-colors text-body font-semibold">Leave Quiz</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════
  //  RENDER FUNCTIONS — defined after return (hoisted by function declaration)
  // ═══════════════════════════════════════════════════════════════════

  // ── SEARCH MODAL ──
  function renderSearchModal() {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowSearchModal(false)}>
        <div
          className="bg-stone-800 border border-stone-600 rounded-control shadow-[8px_8px_0px_0px_rgba(0,0,0,0.3)] w-[900px] max-w-[95vw] h-[600px] max-h-[85vh] flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          <div className="px-4 py-3 border-b border-stone-600 shrink-0">
            <div className="flex items-center gap-3">
              <Search className="w-5 h-5 text-orange-400 shrink-0" />
              <input
                ref={searchInputRef}
                autoFocus
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); performSearch(e.target.value); }}
                onKeyDown={e => {
                  if (e.key === 'Escape') setShowSearchModal(false);
                  if (e.key === 'ArrowDown' && searchResults.length > 0) {
                    e.preventDefault();
                    setSelectedSearchResult(prev => prev !== null ? Math.min(prev + 1, searchResults.length - 1) : 0);
                  }
                  if (e.key === 'ArrowUp' && searchResults.length > 0) {
                    e.preventDefault();
                    setSelectedSearchResult(prev => prev !== null ? Math.max(prev - 1, 0) : 0);
                  }
                  if (e.key === 'Enter' && selectedSearchResult !== null) {
                    const r = searchResults[selectedSearchResult];
                    if (r) navigateToSearchResult(r);
                  }
                }}
                placeholder="Search lessons, hotkeys, functions, nodes..."
                className="flex-1 bg-transparent text-white text-body placeholder-stone-500"
              />
              <span className="text-stone-500 text-caption shrink-0">
                {searchResults.length > 0 ? `${searchResults.length} page${searchResults.length !== 1 ? 's' : ''}` : searchQuery.length >= 2 ? 'No results' : ''}
              </span>
              <button onClick={() => setShowSearchModal(false)} className="p-1 hover:bg-stone-700 rounded-control">
                <X className="w-4 h-4 text-stone-400" />
              </button>
            </div>
          </div>
          <div className="flex-1 flex overflow-hidden">
            <div className="w-[280px] shrink-0 border-r border-stone-600 overflow-y-auto bg-stone-900">
              {searchQuery.length < 2 && <div className="px-4 py-8 text-center text-stone-600 text-body">Type at least 2 characters to search</div>}
              {searchQuery.length >= 2 && searchResults.length === 0 && <div className="px-4 py-8 text-center text-stone-600 text-body">No matches found</div>}
              {searchResults.map((r, i) => (
                <button
                  key={`${r.softwareSlug}-${r.subjectSlug || r.resultType}-${r.lessonId || r.resultType}`}
                  onClick={() => setSelectedSearchResult(i)}
                  className={`w-full text-left px-3 py-2.5 border-b border-stone-700 transition-colors ${selectedSearchResult === i ? 'bg-stone-700' : 'hover:bg-stone-800'}`}
                >
                  <div className="flex items-center gap-1.5">
                    <p className="text-white text-dense font-semibold truncate flex-1">{r.lessonTitle}</p>
                    {r.resultType && <span className="text-label px-1.5 py-0.5 rounded-control font-semibold uppercase shrink-0 bg-stone-600 text-stone-300">{r.resultType === 'hotkeys' ? 'Keys' : r.resultType === 'functions' ? 'Func' : 'Node'}</span>}
                  </div>
                  <p className="text-stone-500 text-dense truncate">{r.softwareName}{r.resultType ? '' : ` / ${r.subjectTitle}`}</p>
                  <p className="text-orange-400 text-dense mt-0.5">{r.matches} match{r.matches !== 1 ? 'es' : ''}</p>
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-stone-900">
              {selectedSearchResult !== null && searchResults[selectedSearchResult] ? (() => {
                const r = searchResults[selectedSearchResult];
                const q = searchQuery.trim();
                const lowerQ = q.toLowerCase();

                const header = (
                  <div className="mb-4 pb-3 border-b border-stone-700">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-orange-400 font-semibold text-h3">{r.lessonTitle}</h3>
                        <p className="text-stone-500 text-dense">{r.softwareName} &gt; {r.subjectTitle} &gt; {r.sectionTitle}</p>
                      </div>
                      <button onClick={() => navigateToSearchResult(r)} className="bg-orange-600 text-white px-3 py-1.5 rounded-control text-dense font-semibold border border-orange-700 hover:bg-orange-700 transition-colors shrink-0">
                        {r.resultType === 'hotkeys' ? 'Go to Hotkeys' : r.resultType === 'functions' ? 'Go to Functions' : r.resultType === 'nodes' ? 'Go to Nodes' : 'Go to Lesson'}
                      </button>
                    </div>
                    <p className="text-orange-400 text-dense mt-1">{r.matches} occurrence{r.matches !== 1 ? 's' : ''} found</p>
                  </div>
                );

                {/* ── Hotkeys: table with all shortcuts, matches highlighted ── */}
                if (r.resultType === 'hotkeys' && r.hotkeyCategories) {
                  return (
                    <div>
                      {header}
                      {r.hotkeyCategories.map((cat, ci) => {
                        const hasMatch = cat.shortcuts.some(s => [s.action, s.windows, s.mac, s.notes].filter(Boolean).join(' ').toLowerCase().includes(lowerQ));
                        if (!hasMatch) return null;
                        return (
                          <div key={ci} className="mb-4">
                            <h4 className="text-orange-400 font-semibold text-h3 mb-2">{cat.category}</h4>
                            <div className="bg-stone-800 border border-stone-600 rounded-control overflow-hidden">
                              <table className="w-full">
                                <thead>
                                  <tr style={{ background: '#44403c' }}>
                                    <th className="text-left text-label font-semibold uppercase p-2 border-b border-stone-600" style={{ color: '#d6d3d1' }}>Action</th>
                                    <th className="text-left text-label font-semibold uppercase p-2 border-b border-stone-600" style={{ color: '#d6d3d1' }}>Windows</th>
                                    <th className="text-left text-label font-semibold uppercase p-2 border-b border-stone-600" style={{ color: '#d6d3d1' }}>Mac</th>
                                    <th className="text-left text-label font-semibold uppercase p-2 border-b border-stone-600" style={{ color: '#d6d3d1' }}>Notes</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {cat.shortcuts.map((s, si) => {
                                    const isMatch = [s.action, s.windows, s.mac, s.notes].filter(Boolean).join(' ').toLowerCase().includes(lowerQ);
                                    return (
                                      <tr key={si} className={`border-b border-stone-700 last:border-0 transition-colors ${isMatch ? 'bg-orange-500/10' : 'opacity-40'}`}>
                                        <td className="p-2 text-dense" style={{ color: '#d6d3d1' }}>{s.action}</td>
                                        <td className="p-2"><kbd className="px-1.5 py-0.5 rounded-control text-dense border font-mono" style={{ background: '#1c1917', color: '#fb923c', borderColor: '#57534e' }}>{s.windows}</kbd></td>
                                        <td className="p-2"><kbd className="px-1.5 py-0.5 rounded-control text-dense border font-mono" style={{ background: '#1c1917', color: '#fb923c', borderColor: '#57534e' }}>{s.mac}</kbd></td>
                                        <td className="p-2 text-dense" style={{ color: '#78716c' }}>{s.notes || '\u2014'}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                }

                {/* ── Functions: only matching functions in card format ── */}
                if (r.resultType === 'functions' && r.matchedCategories) {
                  return (
                    <div>
                      {header}
                      {r.matchedCategories.map((cat, ci) => (
                        <div key={ci} className="mb-4">
                          <h4 className="text-orange-400 font-semibold text-h3 mb-2">{cat.category}</h4>
                          <div className="space-y-2">
                            {cat.functions.map((f, fi) => (
                              <div key={fi} className="bg-stone-800 border border-stone-600 rounded-control p-3">
                                <code className="font-mono font-semibold text-dense" style={{ color: '#fb923c' }}>{f.name}</code>
                                {f.syntax && <pre className="border rounded-control px-2 py-1.5 mb-2 mt-1.5 font-mono text-dense overflow-x-auto whitespace-pre-wrap" style={{ background: '#0c0a09', color: '#d6d3d1', borderColor: '#44403c' }}>{f.syntax}</pre>}
                                {f.parameters && <div className="mb-1.5"><span className="text-label font-semibold uppercase block mb-0.5" style={{ color: '#78716c' }}>Parameters:</span><span className="text-dense whitespace-pre-wrap" style={{ color: '#d6d3d1' }}>{f.parameters}</span></div>}
                                {f.returns && <div className="mb-1.5"><span className="text-label font-semibold uppercase" style={{ color: '#78716c' }}>Returns: </span><span className="text-dense whitespace-pre-wrap" style={{ color: '#d6d3d1' }}>{f.returns}</span></div>}
                                {f.description && <p className="text-dense mb-1.5 whitespace-pre-wrap" style={{ color: '#a8a29e' }}>{f.description}</p>}
                                {f.example && <pre className="border rounded-control px-2 py-1.5 font-mono text-dense overflow-x-auto whitespace-pre-wrap" style={{ background: '#0c0a09', color: '#4ade80', borderColor: '#44403c' }}>{f.example}</pre>}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                }

                {/* ── Nodes: only matching nodes in card format ── */}
                if (r.resultType === 'nodes' && r.matchedCategories) {
                  return (
                    <div>
                      {header}
                      {r.matchedCategories.map((mc, ci) => (
                        <div key={ci} className="mb-4">
                          <h4 className="text-orange-400 font-semibold text-h3 mb-1">{mc.category}</h4>
                          <p className="text-stone-600 text-dense mb-2">{mc.system}</p>
                          <div className="space-y-2">
                            {mc.nodes.map((node, ni) => (
                              <div key={ni} className="bg-stone-800 border border-stone-600 rounded-control p-3">
                                <div className="font-semibold text-dense mb-1.5" style={{ color: '#fb923c' }}>{node.name}</div>
                                <p className="text-dense mb-2 whitespace-pre-wrap" style={{ color: '#a8a29e' }}>{node.description}</p>
                                {Array.isArray(node.inputs) && node.inputs.length > 0 && (
                                  <div className="mb-2">
                                    <span className="text-label font-semibold uppercase block mb-1" style={{ color: '#78716c' }}>Inputs</span>
                                    <div className="space-y-0.5">
                                      {node.inputs.filter(Boolean).map((inp, k) => (
                                        <div key={k} className="flex items-start gap-1.5 text-caption">
                                          <span className="shrink-0 w-24 truncate" style={{ color: '#d6d3d1' }}>{inp.name || ''}</span>
                                          <NodeTypeBadge type={inp.type} />
                                          <span style={{ color: '#a8a29e' }}>{inp.description || ''}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {Array.isArray(node.outputs) && node.outputs.length > 0 && (
                                  <div className="mb-2">
                                    <span className="text-label font-semibold uppercase block mb-1" style={{ color: '#78716c' }}>Outputs</span>
                                    <div className="space-y-0.5">
                                      {node.outputs.filter(Boolean).map((out, k) => (
                                        <div key={k} className="flex items-start gap-1.5 text-caption">
                                          <span className="shrink-0 w-24 truncate" style={{ color: '#d6d3d1' }}>{out.name || ''}</span>
                                          <NodeTypeBadge type={out.type} />
                                          <span style={{ color: '#a8a29e' }}>{out.description || ''}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {node.notes && (
                                  <div className="border-t border-stone-700 pt-1.5 mt-1.5">
                                    <span className="text-caption italic" style={{ color: '#78716c' }}>{node.notes}</span>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                }

                {/* ── Default: lesson results with highlighted text ── */}
                const content = r.content;
                const parts = [];
                const lowerContent = content.toLowerCase();
                let lastIdx = 0;
                let pos = 0;
                while ((pos = lowerContent.indexOf(lowerQ, lastIdx)) !== -1) {
                  if (pos > lastIdx) parts.push({ text: content.slice(lastIdx, pos), highlight: false });
                  parts.push({ text: content.slice(pos, pos + q.length), highlight: true });
                  lastIdx = pos + q.length;
                }
                if (lastIdx < content.length) parts.push({ text: content.slice(lastIdx), highlight: false });
                return (
                  <div>
                    {header}
                    <pre className="text-stone-300 text-dense leading-relaxed whitespace-pre-wrap font-sans">
                      {parts.map((part, i) =>
                        part.highlight
                          ? <mark key={i} className="bg-orange-500/30 text-orange-300 rounded-control px-0.5">{part.text}</mark>
                          : <span key={i}>{part.text}</span>
                      )}
                    </pre>
                  </div>
                );
              })() : (
                <div className="flex items-center justify-center h-full text-stone-600 text-body">
                  {searchResults.length > 0 ? 'Select a result to preview' : 'Search results will appear here'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  SIDEBAR 1 — Software & Subjects
  // ═══════════════════════════════════════════════════════════════
  function renderSoftwareSidebar() {
    // Collapsed: a persistent full-height rail. Never hover-only, and the
    // chevron sits where the collapse button was, so the control does not move.
    if (sidebar1.collapsed) {
      return <SidebarReopenRail onExpand={sidebar1.expand} label="Show courses" />;
    }

    return (
      <Panel
        width="sm"
        className="otter-courses"
        title="Courses"
        actions={<SidebarCollapseButton onCollapse={sidebar1.toggle} label="Hide courses" />}
      >
        <div className="otter-courses-new">
          <Button
            variant="primary"
            size="sm"
            Icon={Plus}
            onClick={() => { setPromptMode('course'); setGenError(null); setCurrentView('prompt'); }}
          >
            New
          </Button>
        </div>
        {/* Tier filters. Cloud only: signed out there is one user, one tier and
            no trash, so a chip strip would be pure noise in local mode. */}
        {cloudMode && (
          <CourseFilterChips
            value={courseFilter}
            onChange={selectCourseFilter}
            role={appRole}
            counts={filterCounts}
          />
        )}
        <div className="otter-course-list">
          {courseFilter === 'trash' ? (
            <TrashSidebarList
              rows={trashRows}
              loading={trashLoading}
              busyId={trashBusyId}
              error={trashError}
              onDismissError={() => setTrashError(null)}
              onRestore={restoreTrashRow}
            />
          ) : softwareList.length === 0 ? (
            <EmptyState icon={Plus} title="No courses yet" body='Click "New" above to create your first course' compact />
          ) : visibleCourses.length === 0 ? (
            // A filter that silently shows an empty column reads as data loss.
            <EmptyState title="Nothing here yet" compact>
              <Button variant="ghost" size="sm" onClick={() => setCourseFilter('all')}>Show all courses</Button>
            </EmptyState>
          ) : (
            [...visibleCourses].sort((a, b) => {
              const aIsLang = a.type === 'coding_language' ? 1 : 0;
              const bIsLang = b.type === 'coding_language' ? 1 : 0;
              return aIsLang - bIsLang;
            }).map(sw => {
              const isExpanded = expandedSoftware === sw.slug;
              const isActive = activeSoftwareSlug === sw.slug;
              // A metadata-only row (an admin looking at a colleague's personal
              // course) has nothing to open — selecting it would fire reads that
              // RLS refuses. It stays visible and inert.
              const openable = canReadCourse(sw);
              const rowCanWrite = canWriteCourse(sw);
              return (
                <div key={sw.slug}>
                  {/* Was a single full-width <button>; it is now a row so the
                      actions menu can sit beside the label. */}
                  <div
                    className="otter-course-row"
                    data-active={isActive ? 'true' : undefined}
                    data-openable={openable ? undefined : 'false'}
                  >
                    <button
                      onClick={() => {
                        if (!openable) return;
                        if (isExpanded) {
                          setExpandedSoftware(null);
                        } else {
                          setExpandedSoftware(sw.slug);
                          if (activeSoftwareSlug !== sw.slug) selectSoftware(sw.slug);
                        }
                        if (activeSoftwareSlug !== sw.slug || !isExpanded) {
                          selectSoftware(sw.slug);
                          setCurrentView('library');
                        }
                      }}
                      disabled={!openable}
                      title={openable ? sw.name : `${sw.name} — private to ${sw.owner_label || 'its owner'}`}
                      className="otter-course-open"
                    >
                      {!openable
                        ? <span className="otter-course-chevron" aria-hidden="true" />
                        : isExpanded
                          ? <ChevronDown className="otter-course-chevron" aria-hidden="true" />
                          : <ChevronRight className="otter-course-chevron" aria-hidden="true" />
                      }
                      {/* The course's own name, as its author wrote it (review
                          O9): Dense, sentence case, never uppercased. */}
                      <span className="otter-course-name">{sw.name}</span>
                      {cloudMode && <VisibilityBadge course={sw} compact />}
                    </button>
                    {/* PHASE 5: was `opacity-0 group-hover/course:opacity-100`.
                        This menu is the ONLY way to reach a course's sharing
                        tier, so concealing it until hover concealed the whole
                        company-library model — the literal reason Audrey could
                        not find how to submit a course. Always visible now. */}
                    {cloudMode && (
                      <span className="otter-course-menu">
                        <CourseRowMenu
                          course={sw}
                          role={appRole}
                          compact
                          onShare={setShareDialogCourse}
                          onSuggestChange={setCrDialogCourse}
                          onFork={(c) => forkCourse(c)}
                          onTrash={(c) => setShowDeleteConfirm(c.slug)}
                        />
                      </span>
                    )}
                  </div>
                  {isExpanded && (
                    <div className="otter-subjects">
                      {subjectList.map(sub => {
                        const isSubActive = activeSubjectSlug === sub.slug;
                        const isStub = sub.is_stub;
                        return (
                          <div
                            key={sub.slug}
                            className="otter-subject-row"
                            data-active={isSubActive ? 'true' : undefined}
                            data-stub={isStub ? 'true' : undefined}
                          >
                            <button
                              onClick={() => {
                                selectSubject(sw.slug, sub.slug);
                                if (!isStub) setCurrentView('study');
                                else setCurrentView('library');
                              }}
                              className="otter-subject-open"
                            >
                              <span className="otter-subject-label">
                                {sub.subject_order != null && <span className="otter-subject-order">{String(sub.subject_order).padStart(2, '0')} ·</span>}
                                {sub.title}
                                {isStub && <span className="otter-subject-outline">[outline]</span>}
                              </span>
                            </button>
                            {/* Session 11 item 7: the adapter now returns a
                                clean 403 instead of a fabricated success, but
                                the control should not be here at all. */}
                            {rowCanWrite && (
                              <IconButton
                                size="sm"
                                icon={Trash2}
                                danger
                                title="Delete subject"
                                className="otter-subject-delete"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowDeleteSubjectConfirm({ softwareSlug: sw.slug, subjectSlug: sub.slug, title: sub.title });
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                      {rowCanWrite ? (
                        <button
                          onClick={() => { setPromptMode('subject'); setGenError(null); setCurrentView('prompt'); }}
                          className="otter-add-subject"
                        >
                          <Plus className="otter-add-subject-icon" aria-hidden="true" /> Add subject
                        </button>
                      ) : (
                        // Answers the question the missing buttons raise.
                        <p className="otter-subjects-note">
                          Read only — study it, or make your own copy.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Panel>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  SIDEBAR 2 — Lessons
  // ═══════════════════════════════════════════════════════════════
  function scrollToCategory(refObj, catId) {
    const el = refObj?.current?.querySelector(`[data-cat-id="${catId}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderLessonSidebar() {
    // ── Hotkeys category sidebar (no sidebar for Functions/coding languages) ──
    if (currentView === 'hotkeys' && activeSoftwareSlug) {
      const isCodingLang = activeSoftware?.type === 'coding_language';
      if (isCodingLang) {
        // Functions — no sidebar
        return null;
      } else {
        // Hotkey categories
        const hotkeys = (softwareHotkeys?.categories || []).filter(cat => cat && Array.isArray(cat.shortcuts));
        if (hotkeys.length === 0) return null;
        return (
          <Panel
            width="md"
            className="otter-groups"
            title="Shortcut groups"
            actions={<span className="otter-panel-count">{hotkeys.length} categories</span>}
          >
            <div className="otter-group-list">
              {hotkeys.map((cat, i) => (
                <button key={i} onClick={() => scrollToCategory(hotkeyScrollRef, `hk-cat-${i}`)} className="otter-group-row">
                  <Keyboard className="otter-group-icon" aria-hidden="true" />
                  <span className="otter-group-name">{cat.category}</span>
                  <span className="otter-group-count">{cat.shortcuts.length}</span>
                </button>
              ))}
            </div>
          </Panel>
        );
      }
    }

    // ── Nodes category sidebar ──
    if (currentView === 'nodes' && activeSoftwareSlug) {
      const systems = softwareNodes?.systems || [];
      const activeSys = systems.find(s => s.system === activeNodeSystem) || systems[0];
      const categories = activeSys?.categories || [];
      if (systems.length === 0) return null;
      return (
        <Panel
          width="md"
          className="otter-groups"
          title="Node groups"
          actions={<span className="otter-panel-count">{activeSys?.system || 'No system'}</span>}
        >
          <div className="otter-group-list">
            {categories.filter(cat => cat && Array.isArray(cat.nodes) && cat.nodes.length > 0).map((cat, i) => (
              <button key={i} onClick={() => scrollToCategory(nodeScrollRef, `node-cat-${i}`)} className="otter-group-row">
                <Share2 className="otter-group-icon" aria-hidden="true" />
                <span className="otter-group-name">{cat.category}</span>
                <span className="otter-group-count">{cat.nodes.length}</span>
              </button>
            ))}
          </div>
        </Panel>
      );
    }

    // ── Study lesson sidebar (original) ──
    if (!activeSubject || activeSubject.is_stub) return null;
    const completedList = getCompletedLessons();
    const progress = getCurrentProgressPercent();
    return (
      <Panel width="md" className="otter-lessons">
        {/* The subject is data, so it is not the Panel's Label-step title:
            it keeps its own casing at the H3 step above its progress. */}
        <div className="otter-lessons-head">
          <h3 className="otter-lessons-title">{activeSubject.title}</h3>
          <div
            className="otter-progress"
            role="progressbar"
            aria-label="Lessons completed"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div className="otter-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p className="otter-lessons-meta">{progress}% complete</p>
        </div>
        <div className="otter-lesson-list">
          {(activeSubject.sections || []).map(section => (
            <div key={section.id}>
              <button
                onClick={() => setExpandedSubjectSections(prev => ({ ...prev, [section.id]: !prev[section.id] }))}
                className="otter-section-row"
                aria-expanded={!!expandedSubjectSections[section.id]}
              >
                {expandedSubjectSections[section.id]
                  ? <ChevronDown className="otter-section-chevron" aria-hidden="true" />
                  : <ChevronRight className="otter-section-chevron" aria-hidden="true" />
                }
                <span className="otter-section-name">{section.title}</span>
              </button>
              {expandedSubjectSections[section.id] && (section.lessons || []).map(lesson => {
                const isActive = selectedLessonId === lesson.id;
                const isComplete = completedList.includes(lesson.id);
                return (
                  <button
                    key={lesson.id}
                    onClick={() => { setSelectedLessonId(lesson.id); setCurrentView('study'); }}
                    className="otter-lesson-row"
                    data-active={isActive ? 'true' : undefined}
                  >
                    {/* Completion is a SHAPE (a filled check or an empty
                        ring), so it survives greyscale — kept. */}
                    {isComplete
                      ? <CheckCircle2 className="otter-lesson-mark" aria-hidden="true" />
                      : <span className="otter-lesson-ring" aria-hidden="true" />
                    }
                    <span className="otter-lesson-name">{lesson.title}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {/* ── Sources button ── */}
        {activeSubject.sources?.length > 0 && (
          <button onClick={() => setCurrentView('sources')} className="otter-sources-link">
            <BookOpen className="otter-group-icon" aria-hidden="true" />
            <span>Sources ({activeSubject.sources.length})</span>
          </button>
        )}
      </Panel>
    );
  }

  // Outcome of a sharing/fork action, shown wherever those actions can be
  // started. Nothing in this session may fail silently — that is the whole
  // lesson the Session 10 adapter work was built around.
  function renderSharingBanner() {
    if (!sharingNotice && !sharingError) return null;
    // A3: the kit's Banner — one strip, a tone, the dismiss as its action.
    if (sharingError) {
      return (
        <Banner
          tone="danger"
          Icon={AlertCircle}
          className="otter-banner"
          action={<Button variant="ghost" size="sm" onClick={() => setSharingError(null)}>Dismiss</Button>}
        >
          {sharingError}
        </Banner>
      );
    }
    return (
      <Banner
        tone="success"
        Icon={Check}
        className="otter-banner"
        action={<Button variant="ghost" size="sm" onClick={() => setSharingNotice(null)}>Dismiss</Button>}
      >
        {sharingNotice}
      </Banner>
    );
  }
  // ═══════════════════════════════════════════════════════════════
  //  LIBRARY VIEW
  // ═══════════════════════════════════════════════════════════════
  function renderLibrary() {
    // "Recently deleted" is a FILTER STATE on this same pane, not a new view.
    if (courseFilter === 'trash') {
      return (
        <TrashPanel
          rows={trashRows}
          loading={trashLoading}
          busyId={trashBusyId}
          error={trashError}
          onRestore={restoreTrashRow}
          onDismissError={() => setTrashError(null)}
        />
      );
    }

    if (activeSoftwareSlug && activeSoftware) {
      return (
        <div className="otter-view">
          <div className="otter-view-page" data-width="data">
            {renderSharingBanner()}
            {/* One view-title treatment across O.T.T.E.R. (review O3): the
                kit's SectionTitle, H2 in the one ink, actions on the right. */}
            <SectionTitle
              rule={false}
              className="otter-view-title"
              description={
                <span className="otter-view-meta">
                  <span className="otter-count">{subjectList.length} subjects</span>
                  {activeCanWrite ? ' — Click to study, hover to manage or remove' : ' — Click to study'}
                  {cloudMode && <OwnerBadge course={activeCourseRow} />}
                </span>
              }
              actions={
                <>
                  {/* activeCourseRow is looked up in softwareList while this pane
                      branches on activeSoftware, and the two can briefly disagree
                      (a course removed from the index by another device, an
                      in-flight reload). Rendering the menu against null would give
                      every action an undefined course. */}
                  {cloudMode && activeCourseRow && (
                    <CourseRowMenu
                      course={activeCourseRow}
                      role={appRole}
                      onShare={setShareDialogCourse}
                      onSuggestChange={setCrDialogCourse}
                      onFork={(c) => forkCourse(c)}
                      onTrash={(c) => setShowDeleteConfirm(c.slug)}
                    />
                  )}
                  {activeCanWrite && subjectList.some(s => s.is_stub) && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const stubs = subjectList.filter(s => s.is_stub && !generatingSubjects.has(s.slug));
                        for (const stub of stubs) {
                          if (genQueueCancelledRef.current.has(stub.slug)) continue;
                          generateSubjectContent(stub.slug, { skipNavigation: true });
                        }
                      }}
                      disabled={subjectList.filter(s => s.is_stub).every(s => generatingSubjects.has(s.slug))}
                    >
                      {generatingSubjects.size > 0 ? <Loader2 className="animate-spin" aria-hidden="true" /> : <GraduationCap aria-hidden="true" />}
                      Generate all outlines
                    </Button>
                  )}
                  {activeCanWrite && (
                    <Button variant="secondary" Icon={Upload} onClick={() => setShowImportModal(true)}>
                      Import
                    </Button>
                  )}
                  {activeCanWrite ? (
                    <Button
                      variant="primary"
                      Icon={Plus}
                      onClick={() => { setPromptMode('subject'); setGenError(null); setCurrentView('prompt'); }}
                    >
                      Add subject
                    </Button>
                  ) : activeCanRead && cloudMode && (
                    // The useful action on a course you cannot edit: take your own
                    // copy. Turns a dead end into the flow the model intends.
                    <Button variant="primary" onClick={() => forkCourse(activeCourseRow)} disabled={forkBusy}>
                      {forkBusy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FolderOpen aria-hidden="true" />}
                      Make my own copy
                    </Button>
                  )}
                </>
              }
              as="div"
            >
              {/* The heading is the name alone (its badges were inside it,
                  so it read "DaVinci Resolve 19Standard"); SectionTitle's
                  own element is a div here and carries the H2 look. */}
              <h2 className="otter-title-text">{activeSoftware.name}</h2>
              {cloudMode && <VisibilityBadge course={activeCourseRow} />}
              {cloudMode && <ReadOnlyBadge course={activeCourseRow} />}
              {cloudMode && <MetadataOnlyBadge course={activeCourseRow} />}
            </SectionTitle>
            {subjectList.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="No subjects yet"
                body={`Add a subject to start learning about ${activeSoftware.name}.`}
              />
            ) : (
              <div className="otter-card-grid">
                {subjectList.map(sub => (
                  <div
                    key={sub.slug}
                    className="otter-subject-card"
                    data-stub={sub.is_stub ? 'true' : undefined}
                    onClick={() => {
                      if (!sub.is_stub) { selectSubject(activeSoftwareSlug, sub.slug); setCurrentView('study'); }
                    }}
                  >
                    {/* Header bar with number and badges */}
                    <div className="otter-subject-card-head">
                      {sub.subject_order != null && (
                        <span className="otter-subject-card-order">{String(sub.subject_order).padStart(2, '0')}</span>
                      )}
                      <Badge>{sub.skill_level}</Badge>
                      {sub.is_stub && <Badge className="otter-outline-badge">Outline</Badge>}
                      {activeCanWrite && (
                        <IconButton
                          size="sm"
                          icon={Trash2}
                          danger
                          title="Delete subject"
                          className="otter-subject-card-delete"
                          onClick={(e) => { e.stopPropagation(); setShowDeleteSubjectConfirm({ softwareSlug: activeSoftwareSlug, subjectSlug: sub.slug, title: sub.title }); }}
                        />
                      )}
                    </div>
                    {/* Body */}
                    <div className="otter-subject-card-body">
                      <h3 className="otter-subject-card-title">{sub.title}</h3>
                      <p className="otter-subject-card-desc" title={sub.description}>{sub.description}</p>
                      <div className="otter-spacer" />
                      {sub.is_stub && !activeCanWrite ? (
                        // An outline you cannot fill in. Saying so beats a
                        // Generate button that the database will refuse.
                        <p className="otter-subject-card-note">
                          Outline only — the owner hasn&apos;t written this yet.
                        </p>
                      ) : sub.is_stub ? (
                        <div className="otter-subject-card-generate">
                          {subjectErrors[sub.slug] && !generatingSubjects.has(sub.slug) && (
                            <p className="otter-subject-card-error" title={subjectErrors[sub.slug]}>
                              ⚠ {subjectErrors[sub.slug]}
                            </p>
                          )}
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSubjectErrors(prev => { const next = { ...prev }; delete next[sub.slug]; return next; });
                              generateSubjectContent(sub.slug);
                            }}
                            disabled={generatingSubjects.has(sub.slug)}
                          >
                            {generatingSubjects.has(sub.slug) ? <Loader2 className="animate-spin" aria-hidden="true" /> : <GraduationCap aria-hidden="true" />}
                            {generatingSubjects.has(sub.slug) ? 'Generating...' : subjectErrors[sub.slug] ? 'Retry' : 'Generate content'}
                          </Button>
                        </div>
                      ) : (
                        <div className="otter-subject-card-foot">
                          {sub.lessons_count != null && <span>{sub.lessons_count} lessons</span>}
                          {sub.created_at && <span>{new Date(sub.created_at).toLocaleDateString()}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    // No software selected: show all software cards, scoped by the active chip.
    const sorted = [...visibleCourses].sort((a, b) => {
      if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '');
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
    return (
      <div className="otter-view">
        <div className="otter-view-page" data-width="data">
          {renderSharingBanner()}
          <SectionTitle
            rule={false}
            className="otter-view-title"
            actions={
              <>
                <Select
                  value={sortBy}
                  onChange={(v) => setSortBy(v)}
                  options={[{ value: 'date', label: 'Sort by date' }, { value: 'name', label: 'Sort by name' }]}
                  aria-label="Sort courses"
                />
                <Button variant="secondary" Icon={Upload} onClick={() => setShowImportModal(true)}>
                  Import
                </Button>
                <Button
                  variant="primary"
                  Icon={Plus}
                  onClick={() => { setPromptMode('course'); setGenError(null); setCurrentView('prompt'); }}
                >
                  New course
                </Button>
              </>
            }
          >
            Course library
          </SectionTitle>
          {sorted.length === 0 && softwareList.length > 0 ? (
            // Courses exist, this filter just matched none of them. Saying
            // "No courses yet" here would read as data loss.
            <EmptyState
              icon={BookOpen}
              title="Nothing under this filter"
              body={<>You have {softwareList.length} course{softwareList.length === 1 ? '' : 's'}, but none match &ldquo;{filtersFor(appRole).find(f => f.key === courseFilter)?.label ?? courseFilter}&rdquo;.</>}
            >
              <Button variant="secondary" onClick={() => setCourseFilter('all')}>Show all courses</Button>
            </EmptyState>
          ) : sorted.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="No courses yet"
              body="Create your first learning path by telling O.T.T.E.R. what software or language you want to learn."
            >
              <Button
                variant="primary"
                Icon={Plus}
                onClick={() => { setPromptMode('course'); setGenError(null); setCurrentView('prompt'); }}
              >
                Create your first course
              </Button>
            </EmptyState>
          ) : (() => {
            const languages = sorted.filter(sw => sw.type === 'coding_language');
            const software = sorted.filter(sw => sw.type !== 'coding_language');
            const renderCard = (sw) => {
              const openable = canReadCourse(sw);
              return (
                <div
                  key={sw.slug}
                  className="otter-course-card"
                  data-openable={openable ? undefined : 'false'}
                  onClick={() => { if (openable) { selectSoftware(sw.slug); setCurrentView('library'); } }}
                >
                  {/* PHASE 5: hover concealment removed here too — see the
                      sidebar site above. A card is the surface a user scans
                      when hunting for an action, so this is the one that most
                      needed to be visible at rest. */}
                  {cloudMode && (
                    <div className="otter-course-card-menu">
                      <CourseRowMenu
                        course={sw}
                        role={appRole}
                        onShare={setShareDialogCourse}
                        onSuggestChange={setCrDialogCourse}
                        onFork={(c) => forkCourse(c)}
                        onTrash={(c) => setShowDeleteConfirm(c.slug)}
                      />
                    </div>
                  )}
                  {/* The title clears the trigger: otter.css,
                      .otter-course-card-title, has the arithmetic. */}
                  <h3 className="otter-course-card-title">{sw.name}</h3>
                  {cloudMode && (
                    <div className="otter-course-card-badges">
                      <VisibilityBadge course={sw} />
                      <MetadataOnlyBadge course={sw} />
                      <ReadOnlyBadge course={sw} />
                      <OwnerBadge course={sw} />
                    </div>
                  )}
                  <div className="otter-course-card-meta"><span className="otter-count">{sw.subject_count} subjects</span></div>
                  {sw.created_at && <p className="otter-course-card-date">{new Date(sw.created_at).toLocaleDateString()}</p>}
                </div>
              );
            };
            return (
              <div className="otter-shelves">
                {software.length > 0 && (
                  <section className="otter-shelf">
                    <h3 className="otter-shelf-title">
                      <Keyboard className="otter-shelf-icon" aria-hidden="true" />
                      Software <span className="otter-count">({software.length})</span>
                    </h3>
                    <div className="otter-card-grid">{software.map(renderCard)}</div>
                  </section>
                )}
                {languages.length > 0 && (
                  <section className="otter-shelf">
                    <h3 className="otter-shelf-title">
                      <Braces className="otter-shelf-icon" aria-hidden="true" />
                      Languages <span className="otter-count">({languages.length})</span>
                    </h3>
                    <div className="otter-card-grid">{languages.map(renderCard)}</div>
                  </section>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  PROMPT INPUT VIEW
  // ═══════════════════════════════════════════════════════════════
  function renderPromptInput() {
    const isCourseMode = promptMode === 'course';
    const softwareNameLower = softwareNameInput.trim().toLowerCase();
    const filteredSoftware = softwareNameLower ? softwareList.filter(sw => sw.name.toLowerCase().includes(softwareNameLower)) : softwareList;
    const exactMatch = softwareList.find(sw => sw.name.toLowerCase() === softwareNameLower);
    const isExistingSoftware = !!exactMatch;
    // Matched by lowercased NAME — the same key Otter.jsx has always used to
    // recognise an existing course, so the offer lines up with what the user
    // believes they are naming.
    const standardMatch = findStandardByName(softwareList, softwareNameInput);

    return (
      <div className="otter-view">
        <div className="otter-view-page" data-width="reading">
          <SectionTitle
            rule={false}
            className="otter-view-title"
            description={isCourseMode
              ? (isExistingSoftware
                ? `${exactMatch.name} already exists. New subjects will be added to the existing course (basics will be skipped).`
                : 'Enter the software or language name. O.T.T.E.R. will generate a course outline with 5-10 subject stubs.')
              : 'Describe the topic you want to add. O.T.T.E.R. will generate a focused single-subject lesson.'}
          >
            {isCourseMode ? (isExistingSoftware ? `Add subjects to ${exactMatch.name}` : 'New software course') : `Add subject to ${activeSoftware?.name || 'Software'}`}
          </SectionTitle>
          {/* The form's controls wear the kit's CSS contract (ui-input, the
              Field label) on their own elements rather than becoming the kit's
              Input: that component brings Escape-reverts-the-edit, a new
              behaviour on this form (C1). The labels stay unassociated, as
              they were — htmlFor would make each one a new click target. */}
          <div className="otter-form-card">
            {/* Mode selector */}
            <label className="ui-field-label otter-form-label">Mode</label>
            <div className="otter-radio-row">
              <button onClick={() => setPromptMode('course')} disabled={generating}
                className="otter-radio-card"
                data-selected={isCourseMode ? 'true' : undefined}>
                <div className="otter-radio-title">{isCourseMode ? '\u25CF ' : '\u25CB '}New course</div>
                <div className="otter-radio-desc">Generate 5-10 subject outlines for a software/language.</div>
              </button>
              <button onClick={() => setPromptMode('subject')} disabled={generating}
                className="otter-radio-card"
                data-selected={!isCourseMode ? 'true' : undefined}>
                <div className="otter-radio-title">{!isCourseMode ? '\u25CF ' : '\u25CB '}Add subject</div>
                <div className="otter-radio-desc">Focused single-topic lesson added to existing course.</div>
              </button>
            </div>

            {/* Software name input with autocomplete (course mode) */}
            {isCourseMode && (
              <div className="otter-form-field otter-autocomplete">
                <label className="ui-field-label otter-form-label">Software / Language name</label>
                <input
                  ref={softwareInputRef} type="text" value={softwareNameInput}
                  onChange={e => { setSoftwareNameInput(e.target.value); setShowSoftwareDropdown(true); }}
                  onFocus={() => setShowSoftwareDropdown(true)}
                  onBlur={() => setTimeout(() => setShowSoftwareDropdown(false), 200)}
                  placeholder="e.g., Python, Blender, Photoshop..."
                  disabled={generating}
                  className="ui-input"
                  data-surface="dark"
                />
                {showSoftwareDropdown && softwareNameInput.trim() && filteredSoftware.length > 0 && (
                  <div className="otter-autocomplete-list">
                    {filteredSoftware.map(sw => (
                      <button key={sw.slug}
                        onMouseDown={(e) => { e.preventDefault(); setSoftwareNameInput(sw.name); setShowSoftwareDropdown(false); }}
                        className="otter-sw-option"
                        data-match={sw.name.toLowerCase() === softwareNameLower ? 'true' : undefined}>
                        <span>{sw.name}</span>
                        <span className="otter-sw-option-count">{sw.subject_count} subjects</span>
                      </button>
                    ))}
                  </div>
                )}
                {isExistingSoftware && <p className="otter-form-hint">Existing course — new subjects will be added, basics skipped.</p>}

                {/* ── The fork offer ──────────────────────────────────────────
                    Inline in the flow the user is already in, the moment the
                    name they typed matches a company standard — not an
                    interstitial, and not a modal that interrupts typing.
                    Generating a course costs real API spend and produces a
                    second, divergent version of something the company has
                    already settled; this is the cheaper and better answer.
                    (Von Restorff: the ONE highlighted block on this screen.) */}
                {cloudMode && standardMatch && !standardMatch.is_own && (
                  <Banner tone="info" Icon={ShieldCheck} className="otter-fork-offer">
                    <p className="otter-fork-title">Your company already has a course for this</p>
                    <p className="otter-fork-body">
                      &ldquo;{standardMatch.name}&rdquo; is the company standard
                      ({standardMatch.subject_count} subjects). Start from that instead of
                      generating a new one — you get your own copy to edit, and you can send
                      your improvements back.
                    </p>
                    <div className="otter-fork-actions">
                      <Button variant="primary" size="sm" onClick={() => forkCourse(standardMatch)} disabled={forkBusy || generating}>
                        {forkBusy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FolderOpen aria-hidden="true" />}
                        Use the company standard
                      </Button>
                      <span className="otter-form-hint">or carry on below to generate your own</span>
                    </div>
                  </Banner>
                )}
              </div>
            )}

            {/* ── Tier picker ────────────────────────────────────────────────
                One more FIELD in the existing create flow, not a new step or a
                wizard. Cloud only — signed out there is exactly one person who
                can see anything, so the question is meaningless.
                Hick's Law: two options for everyone; company standard is set
                afterwards from the course's own menu, by an admin, rather than
                being a third choice everyone has to reason past here. */}
            {isCourseMode && cloudMode && !isExistingSoftware && (
              <div className="otter-form-field">
                <label className="ui-field-label otter-form-label">
                  Who is this for?
                </label>
                <div className="otter-radio-row">
                  {['personal', 'shared'].map(tier => {
                    const meta = VISIBILITY_META[tier];
                    const active = newCourseVisibility === tier;
                    return (
                      <button
                        key={tier}
                        onClick={() => setNewCourseVisibility(tier)}
                        disabled={generating}
                        className="otter-radio-card"
                        data-selected={active ? 'true' : undefined}
                      >
                        <div className="otter-radio-title">{active ? '● ' : '○ '}{meta.label}</div>
                        <div className="otter-radio-desc">{meta.blurb}</div>
                      </button>
                    );
                  })}
                </div>
                <p className="otter-form-hint">
                  You can change this later from the course&apos;s menu.
                </p>
              </div>
            )}

            {/* Subject mode: software dropdown selector */}
            {!isCourseMode && (
              <div className="otter-form-field">
                <label className="ui-field-label otter-form-label">Software / Language</label>
                {softwareList.length === 0 ? (
                  <p className="otter-form-hint">No courses yet. Create a course first.</p>
                ) : (
                  <select value={activeSoftwareSlug || ''} onChange={e => { if (e.target.value) selectSoftware(e.target.value); }} disabled={generating}
                    className="ui-input" data-surface="dark">
                    <option value="" disabled>Select a software/language...</option>
                    {softwareList.map(sw => <option key={sw.slug} value={sw.slug}>{sw.name}</option>)}
                  </select>
                )}
              </div>
            )}

            {/* Prompt textarea */}
            <div className="otter-form-field">
              <label className="ui-field-label otter-form-label">
                {isCourseMode ? 'Description (optional)' : 'What specific topic?'}
              </label>
              <textarea value={promptText} onChange={e => setPromptText(e.target.value)}
                placeholder={isCourseMode ? "e.g., Focus on game development workflow..." : "e.g., List comprehensions in Python..."}
                className="ui-input otter-prompt-textarea"
                data-surface="dark"
                disabled={generating} />
            </div>

            {/* Reference URLs */}
            <div className="otter-form-field">
              <label className="ui-field-label otter-form-label">Reference URLs (optional)</label>
              <p className="otter-form-hint otter-form-hint-above">Add URLs for O.T.T.E.R. to reference when creating lessons. Reduces web search time.</p>
              <div className="otter-ref-add">
                <input type="text" value={referenceUrlInput}
                  onChange={e => setReferenceUrlInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addReferenceUrl(); } }}
                  placeholder="https://docs.example.com/guide"
                  disabled={generating || fetchingUrl}
                  className="ui-input"
                  data-surface="dark" />
                <Button variant="secondary" onClick={addReferenceUrl} disabled={generating || fetchingUrl || !referenceUrlInput.trim()}>
                  {fetchingUrl ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />} Add
                </Button>
              </div>
              {referenceUrls.length > 0 && (
                <ul className="otter-refs">
                  {referenceUrls.map((ref, i) => (
                    <li key={i} className="otter-ref">
                      <Link className="otter-ref-icon" aria-hidden="true" />
                      <span className="otter-ref-title" data-error={ref.error ? 'true' : undefined}>{ref.title || ref.url}</span>
                      {ref.error && <span className="otter-ref-failed">Failed</span>}
                      {!ref.error && <Check className="otter-ref-ok" aria-hidden="true" />}
                      <IconButton
                        size="sm"
                        icon={X}
                        title="Remove this reference"
                        onClick={() => {
                          const updated = referenceUrls.filter((_, j) => j !== i);
                          setReferenceUrls(updated);
                          saveReferenceUrls(updated);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Skill level */}
            <div className="otter-form-field">
              <label className="ui-field-label otter-form-label">Skill level</label>
              <div className="otter-levels" role="group" aria-label="Skill level">
                {['beginner', 'intermediate', 'advanced'].map(level => (
                  <Chip key={level} active={skillLevel === level} onClick={() => setSkillLevel(level)} disabled={generating}>
                    {level}
                  </Chip>
                ))}
              </div>
            </div>

            {genError && (
              <Banner tone="danger" Icon={AlertCircle} className="otter-gen-error">{genError}</Banner>
            )}

            {/* Q22 (Audrey, 2026-09-11): the fabricated percentage is removed —
                the bar stays, the number goes. The fill used to climb a
                hard-coded ladder of elapsed seconds (5, 15, 30 … 92 percent)
                that no generation reports; it now says only "working", and
                the phase and the timer, the two honest signals, stay. */}
            {generating && (
              <div className="otter-gen">
                <div className="otter-gen-head">
                  <span className="otter-gen-phase"><Loader2 className="animate-spin" aria-hidden="true" /> {genPhase}</span>
                  <span className="otter-gen-time">{formatTime(genElapsed)}</span>
                </div>
                <div className="otter-gen-bar" aria-hidden="true"><div className="otter-gen-sweep" /></div>
              </div>
            )}

            {!generating && (
              <Button
                variant="primary"
                className="otter-generate"
                onClick={isCourseMode ? generateCourse : generateSingleSubject}
                disabled={isCourseMode ? !softwareNameInput.trim() : (!promptText.trim() || !activeSoftwareSlug)}
              >
                <GraduationCap aria-hidden="true" />
                {isCourseMode ? (isExistingSoftware ? 'Add subjects to existing course' : 'Generate course outline') : 'Generate subject'}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  SOURCES / WORKS CITED VIEW
  // ═══════════════════════════════════════════════════════════════
  function renderSourcesView() {
    if (!activeSubject || !activeSubject.sources?.length) {
      return (
        <EmptyState icon={BookOpen} title="No sources available for this subject.">
          <Button variant="ghost" Icon={ArrowLeft} onClick={() => setCurrentView('study')}>Back to lessons</Button>
        </EmptyState>
      );
    }
    return (
      <div className="otter-view">
        <div className="otter-view-page" data-width="reading">
          <SectionTitle
            rule={false}
            className="otter-view-title"
            description={<span className="otter-count">{activeSubject.title} — {activeSubject.sources.length} source{activeSubject.sources.length !== 1 ? 's' : ''}</span>}
            actions={<Button variant="ghost" Icon={ArrowLeft} onClick={() => setCurrentView('study')}>Back to lessons</Button>}
          >
            Works cited
          </SectionTitle>
          <ul className="otter-sources">
            {activeSubject.sources.map((src, i) => (
              <li key={i}>
                <a href={src.url} target="_blank" rel="noopener noreferrer" className="otter-source">
                  <ExternalLink className="otter-source-icon" aria-hidden="true" />
                  <div className="otter-source-text">
                    <h3 className="otter-source-title">{src.title || 'Untitled source'}</h3>
                    <span className="otter-source-url">{src.url}</span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  // ═══════════════════════════════════════════════════════════════
  //  STUDY VIEW
  // ═══════════════════════════════════════════════════════════════
  function renderStudyView() {
    if (!activeSubject) {
      return <EmptyState icon={BookOpen} title="Select a subject from the sidebar to begin studying." />;
    }
    if (activeSubject.is_stub) {
      return (
        <div className="otter-view">
          <div className="otter-view-page" data-width="reading">
            <nav className="otter-crumbs" aria-label="Where this subject sits">
              <span>{activeSoftware?.name}</span>
              <ChevronRight className="otter-crumb-sep" aria-hidden="true" />
              <span className="otter-crumb-current">{activeSubject.title}</span>
              <span>[outline]</span>
            </nav>
            <SectionTitle rule={false} className="otter-view-title" description={activeSubject.description}>
              {activeSubject.title}
            </SectionTitle>
            <Card title="Section outlines" className="otter-outline-card">
              {activeSubject.section_outlines?.length > 0 ? (
                <ul className="otter-outlines">
                  {activeSubject.section_outlines.map((outline, i) => (
                    <li key={i} className="otter-outline">
                      <h4 className="otter-outline-title">{outline.title}</h4>
                      <p className="otter-outline-desc">{outline.description}</p>
                      <span className="otter-outline-meta">{outline.lesson_count} lessons planned</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="otter-outline-desc">No section outlines available.</p>}
            </Card>
            <Button
              variant="primary"
              className="otter-generate-full"
              onClick={() => generateSubjectContent(activeSubject.slug)}
              disabled={generatingSubjects.has(activeSubject.slug)}
            >
              {generatingSubjects.has(activeSubject.slug) ? <Loader2 className="animate-spin" aria-hidden="true" /> : <GraduationCap aria-hidden="true" />}
              {generatingSubjects.has(activeSubject.slug) ? 'Generating...' : 'Generate full content'}
            </Button>
            {generatingSubjects.has(activeSubject.slug) && (() => {
              const genEntry = generatingSubjects.get(activeSubject.slug);
              return (
                // The same progress as the prompt screen's (O16: one idiom,
                // not three). This bar sat at 100 percent, pulsing, which
                // read as finished while the work was still running.
                <div className="otter-gen">
                  <div className="otter-gen-head">
                    <span className="otter-gen-phase"><Loader2 className="animate-spin" aria-hidden="true" /> {genEntry?.phase || 'Working...'}</span>
                    <span className="otter-gen-time">{Math.floor((genEntry?.elapsed || 0) / 60)}:{String((genEntry?.elapsed || 0) % 60).padStart(2, '0')}</span>
                  </div>
                  <div className="otter-gen-bar" aria-hidden="true"><div className="otter-gen-sweep" /></div>
                </div>
              );
            })()}
            {genError && (
              <Banner tone="danger" Icon={AlertCircle} className="otter-gen-error">{genError}</Banner>
            )}
          </div>
        </div>
      );
    }

    const selectedLesson = getSelectedLesson();
    const allLessons = getAllLessons();
    const currentIdx = allLessons.findIndex(l => l.id === selectedLessonId);
    const completedLessons = getCompletedLessons();
    const currentSection = activeSubject?.sections?.find(s => s.lessons?.some(l => l.id === selectedLessonId));

    return (
      <div className="otter-study">
        {selectedLesson ? (
          <div className="otter-study-page">
            <nav className="otter-crumbs" aria-label="Where this lesson sits">
              <span>{activeSoftware?.name}</span>
              <ChevronRight className="otter-crumb-sep" aria-hidden="true" />
              <span>{activeSubject?.title}</span>
              {currentSection && <><ChevronRight className="otter-crumb-sep" aria-hidden="true" /><span>{currentSection.title}</span></>}
              <ChevronRight className="otter-crumb-sep" aria-hidden="true" />
              <span className="otter-crumb-current">{selectedLesson.title}</span>
            </nav>
            {/* The reading surface's own title, at the H1 step: the one 20px
                line on it. The markdown's headings sit one step below (O32),
                so a stray "# heading" in a lesson can no longer read as the
                page starting over. */}
            <h2 className="otter-lesson-title">{selectedLesson.title}</h2>
            <div className="lesson-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                code({ node, inline, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '');
                  // A3: oneDark's inline block style is neutralised here
                  // (LESSON_CODE_BLOCK, above the component) so the <pre>
                  // react-markdown wraps around this draws the one well. The
                  // syntax colours inside are data and stay the theme's.
                  // Inline code carries no style of its own any more:
                  // .lesson-content styles it.
                  return !inline && match ? (
                    <SyntaxHighlighter
                      style={LESSON_CODE_THEME}
                      language={match[1]}
                      PreTag="div"
                      customStyle={LESSON_CODE_BLOCK}
                      codeTagProps={{ className: `language-${match[1]}`, style: LESSON_CODE_TEXT }}
                      {...props}
                    >{String(children).replace(/\n$/, '')}</SyntaxHighlighter>
                  ) : (<code {...props} className={className}>{children}</code>);
                },
                // A table scrolls inside this box when its columns cannot fit
                // the reading container, not the pane (A3 review round 2).
                table({ node, ...props }) {
                  return <div className="lesson-table"><table {...props} /></div>;
                },
              }}>
                {(() => {
                  let content = selectedLesson.content || '';
                  const headingMatch = content.match(/^(#{1,3})\s+(.+?)(\n|$)/);
                  if (headingMatch) {
                    const headingText = headingMatch[2].trim().replace(/\*\*/g, '');
                    const titleNorm = selectedLesson.title.trim().replace(/\*\*/g, '');
                    if (headingText.toLowerCase() === titleNorm.toLowerCase()) content = content.slice(headingMatch[0].length).trimStart();
                  }
                  return content;
                })()}
              </ReactMarkdown>
            </div>
            {/* Key takeaways and the practice exercise are siblings of the
                prose, so they were the one thing still running the pane's
                full width beside a measured paragraph (T1's question 2).
                Both are the kit's Card now, on the same measure. */}
            {selectedLesson.key_takeaways?.length > 0 && (
              <Card
                className="otter-lesson-card"
                title={<><Star className="otter-card-icon" aria-hidden="true" /> Key takeaways</>}
              >
                <ul className="otter-takeaways">
                  {selectedLesson.key_takeaways.map((t, i) => (
                    <li key={i}><Check className="otter-takeaway-mark" aria-hidden="true" /> {t}</li>
                  ))}
                </ul>
              </Card>
            )}
            {selectedLesson.practice_prompt && (
              <Card
                className="otter-lesson-card"
                title={<><Lightbulb className="otter-card-icon" aria-hidden="true" /> Practice exercise</>}
              >
                <p className="otter-practice">{selectedLesson.practice_prompt}</p>
              </Card>
            )}
            <div className="otter-lesson-foot">
              {/* Done or not is said by the label and the check, not by a
                  green fill used nowhere else in the tool (O31). */}
              <Button
                variant="secondary"
                Icon={Check}
                onClick={() => toggleLessonComplete(selectedLesson.id)}
                aria-pressed={completedLessons.includes(selectedLesson.id)}
                className="otter-complete"
                data-complete={completedLessons.includes(selectedLesson.id) ? 'true' : undefined}
              >
                {completedLessons.includes(selectedLesson.id) ? 'Completed' : 'Mark complete'}
              </Button>
              <div className="otter-lesson-steps">
                <Button variant="secondary" Icon={ArrowLeft} disabled={currentIdx <= 0} onClick={() => navigateLesson(-1)}>
                  Previous
                </Button>
                <Button variant="primary" disabled={currentIdx >= allLessons.length - 1} onClick={() => navigateLesson(1)}>
                  Next <ArrowRight aria-hidden="true" />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState title="Select a lesson from the sidebar." />
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  QUIZ CENTER
  // ═══════════════════════════════════════════════════════════════
  function renderQuizCenter() {
    const hasSelections = Object.keys(quizSelections).some(k => {
      const v = quizSelections[k];
      return v === 'all' || (v instanceof Set && v.size > 0);
    });
    const hasCodingSelected = Object.keys(quizSelections).some(k => {
      const v = quizSelections[k];
      if (!v || (v instanceof Set && v.size === 0)) return false;
      return quizSelectionData[k]?.meta?.type === 'coding_language';
    });
    if (!hasCodingSelected && (quizTypes.has('codeId') || quizTypes.has('codeWrite'))) {
      const cleaned = new Set(quizTypes);
      cleaned.delete('codeId');
      cleaned.delete('codeWrite');
      if (cleaned.size === 0) cleaned.add('mc');
      setTimeout(() => setQuizTypes(cleaned), 0);
    }

    const quizActive = quizQuestions || challenges || quizLoading;
    if (quizActive) {
      const hasMcContent = quizQuestions && quizQuestions.length > 0;
      const hasChallengeContent = challenges && challenges.length > 0;
      return (
        <div className="h-full flex flex-col">
          <div className="flex items-center border-b border-stone-600 bg-stone-800 shrink-0">
            {hasMcContent && (
              <button onClick={() => setQuizTab('mc')}
                className={`px-4 py-2 text-body font-semibold transition-colors border-b-2 ${quizTab === 'mc' ? 'text-orange-400 border-orange-500 bg-stone-900' : 'text-stone-400 border-transparent hover:bg-stone-700'}`}>
                Multiple Choice ({quizQuestions.filter((_, i) => !quizQuestions[i]?.code_snippet).length})
              </button>
            )}
            {hasMcContent && quizQuestions.some(q => q.code_snippet) && (
              <button onClick={() => setQuizTab('codeId')}
                className={`px-4 py-2 text-body font-semibold transition-colors border-b-2 ${quizTab === 'codeId' ? 'text-orange-400 border-orange-500 bg-stone-900' : 'text-stone-400 border-transparent hover:bg-stone-700'}`}>
                Code Identification
              </button>
            )}
            {hasChallengeContent && (
              <button onClick={() => setQuizTab('codeWrite')}
                className={`px-4 py-2 text-body font-semibold transition-colors border-b-2 ${quizTab === 'codeWrite' ? 'text-orange-400 border-orange-500 bg-stone-900' : 'text-stone-400 border-transparent hover:bg-stone-700'}`}>
                Code Writing ({challenges.length})
              </button>
            )}
            <div className="ml-auto pr-4">
              <button onClick={() => { setQuizQuestions(null); setChallenges(null); setQuizComplete(false); setQuizScore(0); setCurrentQuestion(0); setQuizStarted(false); setQuizError(null); setQuizSaveState(null); }}
                className="text-stone-400 hover:text-stone-300 text-dense font-semibold flex items-center gap-1">
                <ArrowLeft className="w-3 h-3" /> Back to Selection
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-3xl mx-auto">
              {quizLoading && (
                <div className="flex flex-col items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 text-orange-500 animate-spin mb-4" />
                  <p className="text-stone-400">Generating quiz questions...</p>
                </div>
              )}
              {quizQuestions && !quizComplete && (quizTab === 'mc' || quizTab === 'codeId') && renderQuizQuestion()}
              {quizQuestions && quizComplete && renderQuizResults()}
              {challenges && quizTab === 'codeWrite' && renderCodeWriting()}
            </div>
          </div>
        </div>
      );
    }

    // Quiz selection interface
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-6 py-3 bg-stone-800 border-b border-stone-600 shrink-0">
          <div>
            <h2 className="text-h1 font-semibold text-orange-400">Quiz Center</h2>
            <p className="text-stone-500 text-dense">Select software/languages and subjects to quiz yourself on</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto">
            {softwareList.length === 0 ? (
              <div className="text-center py-20">
                <GraduationCap className="w-16 h-16 text-stone-600 mx-auto mb-4" />
                <h3 className="text-h1 font-semibold text-orange-400 mb-2">No Courses Available</h3>
                <p className="text-stone-500">Create a course first to start quizzing yourself.</p>
              </div>
            ) : (
              <>
                <div className="space-y-4 mb-8">
                  {softwareList.map(sw => {
                    const swData = quizSelectionData[sw.slug];
                    const subjects = (swData?.subjects || []).filter(s => !s.is_stub);
                    const selected = quizSelections[sw.slug];
                    const isAllSelected = selected === 'all';
                    const selectedSubs = selected instanceof Set ? selected : new Set();
                    const isCoding = sw.type === 'coding_language';
                    return (
                      <div key={sw.slug} className="bg-stone-800 border border-stone-600 rounded-control shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)]">
                        <div className={`flex items-center justify-between px-4 py-3 transition-colors ${isAllSelected ? 'bg-orange-600/20 border-b border-stone-600' : 'border-b border-stone-700'}`}>
                          <div className="flex items-center gap-3 cursor-pointer flex-1 min-w-0" onClick={() => {
                            setQuizSelections(prev => {
                              const next = { ...prev };
                              if (next[sw.slug] === 'all') { delete next[sw.slug]; } else { next[sw.slug] = 'all'; }
                              return next;
                            });
                          }}>
                            <div className={`w-5 h-5 rounded-control border flex items-center justify-center transition-colors shrink-0 ${isAllSelected ? 'bg-orange-500 border-orange-600' : selectedSubs.size > 0 ? 'bg-orange-500/50 border-orange-600' : 'border-stone-500 bg-stone-900'}`}>
                              {(isAllSelected || selectedSubs.size > 0) && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <div>
                              <h3 className="text-white font-semibold text-h3">{sw.name}</h3>
                              <div className="flex items-center gap-2 text-caption text-stone-500">
                                <span>{subjects.length} subjects</span>
                                {isCoding && <span className="bg-stone-700 px-1.5 py-0.5 rounded-control text-stone-400">coding</span>}
                              </div>
                            </div>
                          </div>
                          {subjects.length > 0 && (
                            <button onClick={() => setQuizExpanded(prev => ({ ...prev, [sw.slug]: prev[sw.slug] === false ? true : false }))} className="p-1.5 hover:bg-stone-600 rounded-control transition-colors shrink-0">
                              <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform ${quizExpanded[sw.slug] !== false ? 'rotate-180' : ''}`} />
                            </button>
                          )}
                        </div>
                        {subjects.length > 0 && quizExpanded[sw.slug] !== false && (
                          <div className="px-4 py-2 space-y-1">
                            {subjects.map(sub => {
                              const subSelected = isAllSelected || selectedSubs.has(sub.slug);
                              return (
                                <div key={sub.slug} className={`flex items-center gap-3 px-3 py-2 rounded-control cursor-pointer transition-colors ${subSelected ? 'bg-orange-600/10' : 'hover:bg-stone-700'}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setQuizSelections(prev => {
                                      const next = { ...prev };
                                      let subs = next[sw.slug];
                                      if (subs === 'all') { subs = new Set(subjects.map(s => s.slug)); }
                                      else if (!(subs instanceof Set)) { subs = new Set(); }
                                      else { subs = new Set(subs); }
                                      if (subs.has(sub.slug)) { subs.delete(sub.slug); } else { subs.add(sub.slug); }
                                      if (subs.size === subjects.length) { next[sw.slug] = 'all'; }
                                      else if (subs.size === 0) { delete next[sw.slug]; }
                                      else { next[sw.slug] = subs; }
                                      return next;
                                    });
                                  }}>
                                  <div className={`w-4 h-4 rounded-control border flex items-center justify-center shrink-0 transition-colors ${subSelected ? 'bg-orange-500 border-orange-600' : 'border-stone-500 bg-stone-900'}`}>
                                    {subSelected && <Check className="w-2.5 h-2.5 text-white" />}
                                  </div>
                                  <span className={`text-body ${subSelected ? 'text-orange-300' : 'text-stone-400'}`}>{sub.title}</span>
                                  <span className="text-stone-600 text-caption ml-auto">{sub.skill_level}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {subjects.length === 0 && <div className="px-4 py-3 text-stone-600 text-caption italic">No generated subjects yet.</div>}
                      </div>
                    );
                  })}
                </div>
                {hasSelections && (
                  <div className="bg-stone-800 border border-stone-600 rounded-control p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)]">
                    <h3 className="text-white font-semibold text-h3 mb-1">Quiz Type</h3>
                    <p className="text-stone-500 text-dense mb-3">Select one or more question types</p>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {[{ key: 'mc', label: 'Multiple Choice', always: true }, { key: 'codeId', label: 'Code Identification', always: false }, { key: 'codeWrite', label: 'Code Writing', always: false }].map(({ key, label, always }) => {
                        if (!always && !hasCodingSelected) return null;
                        const selected = quizTypes.has(key);
                        return (
                          <button key={key} onClick={() => { setQuizTypes(prev => { const next = new Set(prev); if (next.has(key)) { next.delete(key); } else { next.add(key); } if (next.size === 0) return prev; return next; }); }}
                            className={`px-4 py-2 rounded-control text-body font-semibold border transition-colors flex items-center gap-2 ${selected ? 'bg-orange-600 text-white border-orange-700' : 'bg-stone-700 text-stone-400 border-stone-600 hover:border-stone-500'}`}>
                            <div className={`w-3.5 h-3.5 rounded-control border flex items-center justify-center ${selected ? 'border-white bg-white/20' : 'border-stone-500'}`}>
                              {selected && <Check className="w-2.5 h-2.5 text-white" />}
                            </div>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    {quizError && <div className="mb-4 bg-red-900/30 border border-red-700 rounded-control p-3"><p className="text-red-300 text-body">{quizError}</p></div>}
                    <button onClick={() => generateQuiz(quizTypes)} disabled={quizLoading || quizTypes.size === 0}
                      className="w-full bg-orange-600 text-white py-3 rounded-control border border-orange-700 hover:bg-orange-700 font-semibold shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)] transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                      {quizLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <GraduationCap className="w-5 h-5" />}
                      Generate Quiz ({quizTypes.size} type{quizTypes.size !== 1 ? 's' : ''})
                    </button>
                  </div>
                )}
                {!hasSelections && <div className="text-center py-4"><p className="text-stone-500 text-body">Select at least one software/language or subject above to start a quiz.</p></div>}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderQuizQuestion() {
    const q = quizQuestions[currentQuestion];
    if (!q) return null;
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <span className="text-stone-500 text-body">Question {currentQuestion + 1} of {quizQuestions.length}</span>
          <span className={`text-label font-semibold uppercase px-2 py-0.5 rounded-control ${q.difficulty === 'easy' ? 'bg-green-900 text-green-400' : q.difficulty === 'medium' ? 'bg-yellow-900 text-yellow-400' : 'bg-red-900 text-red-400'}`}>{q.difficulty}</span>
        </div>
        {q.code_snippet && (
          <div className="mb-4">
            <SyntaxHighlighter style={oneDark} language={q.language || 'javascript'} customStyle={{ borderRadius: '2px', border: '2px solid #57534e' }}>{q.code_snippet}</SyntaxHighlighter>
          </div>
        )}
        <h3 className="text-white text-h1 font-semibold mb-4">{q.question}</h3>
        <div className="space-y-2 mb-6">
          {q.options.map((opt, i) => {
            const isSelected = selectedAnswer === i;
            const isCorrect = i === q.correct_answer;
            let cls = 'bg-stone-800 text-stone-300 border-stone-600 hover:border-stone-500';
            if (showExplanation) {
              if (isCorrect) cls = 'bg-green-900/30 text-green-300 border-green-600';
              else if (isSelected && !isCorrect) cls = 'bg-red-900/30 text-red-300 border-red-600';
            } else if (isSelected) { cls = 'bg-orange-600/20 text-orange-300 border-orange-500'; }
            return (
              <button key={i} onClick={() => handleAnswer(i)} disabled={showExplanation} className={`w-full text-left p-3 rounded-control border transition-colors ${cls}`}>
                <span className="font-semibold mr-2">{String.fromCharCode(65 + i)}.</span>{opt}
              </button>
            );
          })}
        </div>
        {showExplanation && <div className="bg-stone-800 border border-stone-600 rounded-control p-4 mb-4"><p className="text-stone-300 text-body">{q.explanation}</p></div>}
        {showExplanation && (
          <button onClick={nextQuestion} className="bg-orange-600 text-white px-4 py-2 rounded-control border border-orange-700 hover:bg-orange-700 font-semibold transition-colors">
            {currentQuestion + 1 >= quizQuestions.length ? 'See Results' : 'Next Question'}
          </button>
        )}
      </div>
    );
  }

  function renderQuizResults() {
    const pct = Math.round((quizScore / quizQuestions.length) * 100);
    return (
      <div className="text-center py-8">
        <div className={`text-h1 font-semibold mb-2 ${pct >= 70 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>{pct}%</div>
        <p className="text-stone-400 mb-2">{quizScore} out of {quizQuestions.length} correct</p>

        {/* Session 30: say whether the result was KEPT. "Try Again" below
            zeroes the score, so before this the only copy of a result was the
            number on this screen and the most obvious next click destroyed
            it. */}
        <div className="mb-6 text-dense h-4">
          {quizSaveState === 'saving' && <span className="text-stone-500">Saving your result…</span>}
          {quizSaveState === 'saved' && <span className="text-stone-500">Saved to your quiz history (kept for 30 days).</span>}
          {quizSaveState?.error && (
            <span className="text-red-400">Not saved — {quizSaveState.error}</span>
          )}
        </div>

        <button onClick={() => { setQuizQuestions(null); setQuizComplete(false); setQuizScore(0); setCurrentQuestion(0); setQuizSaveState(null); }}
          className="bg-orange-600 text-white px-6 py-2 rounded-control border border-orange-700 hover:bg-orange-700 font-semibold transition-colors">
          Try Again
        </button>
      </div>
    );
  }

  function renderCodeWriting() {
    const ch = challenges[currentChallenge];
    if (!ch) return null;
    const codeLang = activeSoftware?.name?.toLowerCase() || 'javascript';
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <span className="text-stone-500 text-body">Challenge {currentChallenge + 1} of {challenges.length}</span>
          <span className={`text-label font-semibold uppercase px-2 py-0.5 rounded-control ${ch.difficulty === 'easy' ? 'bg-green-900 text-green-400' : ch.difficulty === 'medium' ? 'bg-yellow-900 text-yellow-400' : 'bg-red-900 text-red-400'}`}>{ch.difficulty}</span>
        </div>
        <h3 className="text-white text-h1 font-semibold mb-2">{ch.title}</h3>
        <p className="text-stone-400 mb-4 text-body">{ch.description}</p>
        {ch.test_cases?.length > 0 && (
          <div className="mb-4 bg-stone-800 border border-stone-600 rounded-control p-3">
            <h4 className="text-stone-300 text-h3 font-semibold mb-2">Test Cases</h4>
            {ch.test_cases.map((tc, i) => (
              <div key={i} className="text-stone-400 text-dense mb-1">
                <span className="text-stone-500">Input:</span> {tc.input} &rarr; <span className="text-stone-500">Expected:</span> {tc.expected_output}
              </div>
            ))}
          </div>
        )}
        <div className="border border-stone-600 rounded-control overflow-hidden mb-4" style={{ height: '300px' }}>
          <Editor height="300px" defaultLanguage={codeLang} value={userCode} onChange={v => setUserCode(v || '')} theme="vs-dark"
            options={{ minimap: { enabled: false }, fontSize: TYPE.body, scrollBeyondLastLine: false, wordWrap: 'on' }} />
        </div>
        <div className="flex items-center gap-2 mb-4">
          {ch.hints?.length > 0 && hintsShown < ch.hints.length && (
            <button onClick={() => setHintsShown(h => h + 1)} className="flex items-center gap-1 bg-stone-700 text-stone-300 border border-stone-600 px-3 py-1.5 rounded-control hover:bg-stone-600 transition-colors text-body">
              <HelpCircle className="w-4 h-4" /> Show Hint ({hintsShown}/{ch.hints.length})
            </button>
          )}
          {!showSolution && !showSolutionConfirm && (
            <button onClick={() => setShowSolutionConfirm(true)} className="flex items-center gap-1 bg-stone-700 text-stone-300 border border-stone-600 px-3 py-1.5 rounded-control hover:bg-stone-600 transition-colors text-body">
              <Eye className="w-4 h-4" /> Show Solution
            </button>
          )}
        </div>
        {hintsShown > 0 && (
          <div className="space-y-2 mb-4">
            {ch.hints.slice(0, hintsShown).map((hint, i) => (
              <div key={i} className="bg-stone-800 border border-yellow-700 rounded-control p-3 text-body text-stone-300">
                <span className="text-yellow-500 font-semibold">Hint {i + 1}:</span> {hint}
              </div>
            ))}
          </div>
        )}
        {showSolutionConfirm && !showSolution && (
          <div className="bg-stone-800 border border-orange-600 rounded-control p-4 mb-4">
            <p className="text-stone-300 text-body mb-3">Are you sure? Try a bit more first!</p>
            <div className="flex gap-2">
              <button onClick={() => { setShowSolution(true); setShowSolutionConfirm(false); }} className="bg-orange-600 text-white px-3 py-1 rounded-control text-body border border-orange-700">Show it</button>
              <button onClick={() => setShowSolutionConfirm(false)} className="bg-stone-700 text-stone-300 px-3 py-1 rounded-control text-body border border-stone-600">Keep trying</button>
            </div>
          </div>
        )}
        {showSolution && (
          <div className="mb-4">
            <h4 className="text-green-400 text-h3 font-semibold mb-2">Solution</h4>
            <SyntaxHighlighter style={oneDark} language={codeLang} customStyle={{ borderRadius: '2px', border: '2px solid #57534e' }}>{ch.solution}</SyntaxHighlighter>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-stone-700 pt-4">
          <button disabled={currentChallenge <= 0} onClick={() => { setCurrentChallenge(c => c - 1); setUserCode(challenges[currentChallenge - 1]?.starter_code || ''); setHintsShown(0); setShowSolution(false); setShowSolutionConfirm(false); }}
            className="flex items-center gap-1 px-3 py-2 bg-stone-700 text-stone-300 border border-stone-600 rounded-control hover:bg-stone-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-body">
            <ArrowLeft className="w-4 h-4" /> Previous
          </button>
          <button disabled={currentChallenge >= challenges.length - 1} onClick={() => { setCurrentChallenge(c => c + 1); setUserCode(challenges[currentChallenge + 1]?.starter_code || ''); setHintsShown(0); setShowSolution(false); setShowSolutionConfirm(false); }}
            className="flex items-center gap-1 px-3 py-2 bg-orange-600 text-white border border-orange-700 rounded-control hover:bg-orange-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-body">
            Next <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  HOTKEY / FUNCTIONS REFERENCE
  // ═══════════════════════════════════════════════════════════════
  function renderHotkeys() {
    const isCodingLang = activeSoftware?.type === 'coding_language';
    const codingLanguages = softwareList.filter(sw => sw.type === 'coding_language');
    const softwareApps = softwareList.filter(sw => sw.type !== 'coding_language');

    if (!activeSoftwareSlug) {
      return <EmptyState icon={Keyboard} title="Select a software or language from the toolbar to get started." />;
    }

    if (isCodingLang) {
      const allFuncs = (softwareFunctions?.categories || []).filter(cat => cat && Array.isArray(cat.functions));
      const filtered = functionSearch
        ? allFuncs.map(cat => ({ ...cat, functions: cat.functions.filter(f =>
            (f.name || '').toLowerCase().includes(functionSearch.toLowerCase()) ||
            (f.description || '').toLowerCase().includes(functionSearch.toLowerCase()) ||
            (f.syntax || '').toLowerCase().includes(functionSearch.toLowerCase())
          ) })).filter(cat => cat.functions.length > 0)
        : allFuncs;

      return (
        <div className="otter-view" ref={functionScrollRef}>
          <div className="otter-view-page" data-width="data">
            <SectionTitle
              rule={false}
              className="otter-view-title"
              actions={
                <div className="otter-search">
                  <Search className="otter-search-icon" aria-hidden="true" />
                  <input type="text" value={functionSearch} onChange={e => setFunctionSearch(e.target.value)} placeholder="Search functions..."
                    className="ui-input otter-search-input" data-surface="dark" />
                </div>
              }
            >
              Functions reference
            </SectionTitle>
            <div className="otter-ref-picker">
              <Braces className="otter-ref-picker-icon" aria-hidden="true" />
              <Select
                value={activeSoftwareSlug || ''}
                onChange={(v) => { if (v) selectSoftware(v); }}
                options={codingLanguages.map(sw => ({ value: sw.slug, label: sw.name }))}
                aria-label="Language"
              />
              <span className="otter-ref-picker-note">— Built-in functions, methods &amp; constructs</span>
            </div>
            {filtered.length === 0 ? (
              allFuncs.length === 0
                ? <EmptyState icon={Braces} title="No functions documented yet." body="Generate subject content to populate the functions reference." />
                : <EmptyState icon={Braces} title="No functions matching your search." />
            ) : filtered.map((cat, i) => (
              <section key={i} className="otter-ref-section" data-cat-id={`func-cat-${i}`}>
                <h3 className="otter-ref-section-title">{cat.category}</h3>
                <div className="otter-ref-cards">
                  {cat.functions.map((f, j) => (
                    <div key={j} className="otter-fn-card">
                      <code className="otter-fn-name">{f.name}</code>
                      {f.syntax && <pre className="otter-code-well">{f.syntax}</pre>}
                      {f.parameters && <div className="otter-fn-part"><span className="otter-fn-label">Parameters:</span><span className="otter-fn-text">{f.parameters}</span></div>}
                      {f.returns && <div className="otter-fn-part"><span className="otter-fn-label">Returns: </span><span className="otter-fn-text">{f.returns}</span></div>}
                      {f.description && <p className="otter-fn-desc">{f.description}</p>}
                      {f.example && <pre className="otter-code-well">{f.example}</pre>}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      );
    }

    // Software hotkeys
    if (!softwareHotkeys) return <div className="otter-center"><Loading label="Loading hotkeys" /></div>;
    const hotkeys = (softwareHotkeys.categories || []).filter(cat => cat && Array.isArray(cat.shortcuts));
    const filteredHk = hotkeySearch
      ? hotkeys.map(cat => ({ ...cat, shortcuts: cat.shortcuts.filter(s =>
          (s.action || '').toLowerCase().includes(hotkeySearch.toLowerCase()) ||
          (s.windows || '').toLowerCase().includes(hotkeySearch.toLowerCase()) ||
          (s.mac || '').toLowerCase().includes(hotkeySearch.toLowerCase())
        ) })).filter(cat => cat.shortcuts.length > 0)
      : hotkeys;

    return (
      <div className="otter-view" ref={hotkeyScrollRef}>
        <div className="otter-view-page" data-width="data">
          <SectionTitle
            rule={false}
            className="otter-view-title"
            actions={
              <div className="otter-search">
                  <Search className="otter-search-icon" aria-hidden="true" />
                  <input type="text" value={hotkeySearch} onChange={e => setHotkeySearch(e.target.value)} placeholder="Search shortcuts..."
                    className="ui-input otter-search-input" data-surface="dark" />
                </div>
            }
          >
            Keyboard shortcuts
          </SectionTitle>
          <div className="otter-ref-picker">
            <Keyboard className="otter-ref-picker-icon" aria-hidden="true" />
            <Select
              value={activeSoftwareSlug || ''}
              onChange={(v) => { if (v) selectSoftware(v); }}
              options={softwareApps.map(sw => ({ value: sw.slug, label: sw.name }))}
              aria-label="Software"
            />
          </div>
          {filteredHk.length === 0 ? (
            <EmptyState icon={Keyboard} title={hotkeys.length === 0 ? 'No keyboard shortcuts available yet.' : 'No shortcuts matching your search.'} />
          ) : filteredHk.map((cat, i) => (
            <section key={i} className="otter-ref-section" data-cat-id={`hk-cat-${i}`}>
              <h3 className="otter-ref-section-title">{cat.category}</h3>
              {/* The kit's Table: a real <table>, fixed layout, so every
                  header sits on its column (the walk measured "Windows" and
                  "Mac" 9px off theirs); keys are the kit's Kbd. */}
              <Card pad={false} className="otter-hk-card">
                <Table
                  head={
                    <Row>
                      <Th width="36%">Action</Th>
                      <Th width="20%">Windows</Th>
                      <Th width="20%">Mac</Th>
                      <Th>Notes</Th>
                    </Row>
                  }
                >
                  {cat.shortcuts.map((s, j) => (
                    <Row key={j}>
                      <Td>{s.action}</Td>
                      <Td><Kbd>{s.windows}</Kbd></Td>
                      <Td><Kbd>{s.mac}</Kbd></Td>
                      <Td className="otter-hk-notes">{s.notes || '\u2014'}</Td>
                    </Row>
                  ))}
                </Table>
              </Card>
            </section>
          ))}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  NODES REFERENCE VIEW
  // ═══════════════════════════════════════════════════════════════
  function renderNodes() {
    try {
    const nodeCapable = softwareList.filter(sw => sw.type !== 'coding_language');

    if (!activeSoftwareSlug) {
      return <EmptyState icon={Share2} title="Select a software from the dropdown to view its node library." />;
    }

    // Systems-based structure: { systems: [{ system: "Geometry Nodes", categories: [...] }] }
    const systems = Array.isArray(softwareNodes?.systems) ? softwareNodes.systems : [];
    const currentSystem = systems.find(s => s.system === activeNodeSystem) || systems[0] || null;
    const allCategories = (currentSystem?.categories || []).filter(cat => cat && Array.isArray(cat.nodes) && cat.nodes.length > 0);

    const searchTerm = (nodeSearch || '').toLowerCase();
    const filtered = searchTerm
      ? allCategories.map(cat => ({ ...cat, nodes: (cat.nodes || []).filter(n =>
          (n.name || '').toLowerCase().includes(searchTerm) ||
          (n.description || '').toLowerCase().includes(searchTerm) ||
          (Array.isArray(n.inputs) ? n.inputs : []).some(inp => (inp?.name || '').toLowerCase().includes(searchTerm)) ||
          (Array.isArray(n.outputs) ? n.outputs : []).some(out => (out?.name || '').toLowerCase().includes(searchTerm))
        ) })).filter(cat => cat.nodes.length > 0)
      : allCategories;

    return (
      <div className="otter-view" ref={nodeScrollRef}>
        <div className="otter-view-page" data-width="data">
          <SectionTitle
            rule={false}
            className="otter-view-title"
            actions={
              <div className="otter-search">
                <Search className="otter-search-icon" aria-hidden="true" />
                <input type="text" value={nodeSearch} onChange={e => setNodeSearch(e.target.value)} placeholder="Search nodes..."
                  className="ui-input otter-search-input" data-surface="dark" />
              </div>
            }
          >
            Nodes reference
          </SectionTitle>

          {/* Software dropdown */}
          <div className="otter-ref-picker">
            <Share2 className="otter-ref-picker-icon" aria-hidden="true" />
            <Select
              value={activeSoftwareSlug || ''}
              onChange={(v) => { if (v) { selectSoftware(v); setActiveNodeSystem(null); } }}
              options={nodeCapable.map(sw => ({ value: sw.slug, label: sw.name }))}
              aria-label="Software"
            />
          </div>

          {/* Node system tabs (e.g., Geometry Nodes, Shader Nodes) — the kit's
              Tabs, the fifth of review O1's five treatments made one. */}
          {systems.length > 0 && (
            <Tabs
              items={systems.map((sys) => ({
                id: sys.system,
                label: sys.system,
                count: (sys.categories || []).reduce((sum, c) => sum + (c.nodes?.length || 0), 0),
              }))}
              value={currentSystem?.system}
              onChange={(id) => setActiveNodeSystem(id)}
              panelId="otter-node-panel"
              label="Node systems"
              className="otter-system-tabs"
            />
          )}

          {/* Node cards by category */}
          <div id="otter-node-panel" role="tabpanel">
          {systems.length === 0 ? (
            <EmptyState icon={Share2} title="No nodes documented yet." body="Generate subject content to populate the node library." />
          ) : filtered.length === 0 ? (
            <EmptyState icon={Share2} title={searchTerm ? 'No nodes matching your search.' : 'No nodes in this system yet.'} />
          ) : filtered.map((cat, i) => (
            <section key={i} className="otter-ref-section" data-cat-id={`node-cat-${i}`}>
              <h3 className="otter-ref-section-title">{cat.category}</h3>
              <div className="otter-ref-cards">
                {cat.nodes.map((node, j) => (
                  <div key={j} className="otter-fn-card otter-node-card">
                    <div className="otter-node-name">{node.name}</div>
                    <p className="otter-fn-desc">{node.description}</p>

                    {Array.isArray(node.inputs) && node.inputs.length > 0 && (
                      <div className="otter-node-ports">
                        <span className="otter-fn-label">Inputs</span>
                        <ul className="otter-node-port-list">
                          {node.inputs.filter(Boolean).map((p, k) => (
                            <li key={k} className="otter-node-port">
                              <span className="otter-node-port-name">{p.name || ''}</span>
                              <NodeTypeBadge type={p.type} />
                              <span className="otter-node-port-desc">{p.description || ''}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {Array.isArray(node.outputs) && node.outputs.length > 0 && (
                      <div className="otter-node-ports">
                        <span className="otter-fn-label">Outputs</span>
                        <ul className="otter-node-port-list">
                          {node.outputs.filter(Boolean).map((p, k) => (
                            <li key={k} className="otter-node-port">
                              <span className="otter-node-port-name">{p.name || ''}</span>
                              <NodeTypeBadge type={p.type} />
                              <span className="otter-node-port-desc">{p.description || ''}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {node.notes && (
                      <p className="otter-node-notes">{node.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
          </div>
        </div>
      </div>
    );
    } catch (err) {
      console.error('renderNodes error:', err);
      return (
        <EmptyState icon={AlertCircle} title={`Error rendering nodes: ${err?.message || 'Unknown error'}`} />
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  SETTINGS PANEL (D.O.G.-style formatting)
  // ═══════════════════════════════════════════════════════════════
  function renderSettingsPanel() {
    const isLocked = settingsTab === 'prompts' ? promptsTabLocked : toolsTabLocked;
    return (
      <div className="fixed inset-0 z-50">
        <div className="absolute inset-0 bg-black/50 transition-opacity" onClick={() => setSettingsOpen(false)} />
        <div className="absolute top-0 right-0 h-full bg-stone-800 border-l border-stone-600 shadow-2xl flex flex-col"
          style={{ width: '40%', minWidth: '400px', paddingTop: window.electronAPI ? '32px' : '0px', animation: 'slideInRight 0.3s ease-out' }}>
          {/* Header */}
          <div className="bg-stone-700 px-4 py-3 flex items-center justify-between border-b border-stone-600 shrink-0">
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-orange-400" />
              <span className="font-semibold text-orange-400">Settings</span>
            </div>
            <button onClick={() => setSettingsOpen(false)} className="p-1 hover:bg-stone-600 rounded-control transition-colors">
              <X className="w-5 h-5 text-stone-400" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex shrink-0">
            <button onClick={() => setSettingsTab('prompts')}
              className={`flex-1 px-4 py-2 text-body font-semibold transition-colors border-b-2 ${settingsTab === 'prompts' ? 'text-orange-400 border-orange-500 bg-stone-900' : 'text-stone-400 border-transparent bg-stone-700'}`}>
              System Prompts
            </button>
            <button onClick={() => setSettingsTab('tools')}
              className={`flex-1 px-4 py-2 text-body font-semibold transition-colors border-b-2 ${settingsTab === 'tools' ? 'text-orange-400 border-orange-500 bg-stone-900' : 'text-stone-400 border-transparent bg-stone-700'}`}>
              Tool Settings
            </button>
          </div>

          {/* Lock Switch Bar */}
          <div className="bg-stone-900 px-4 py-2 border-b border-stone-600 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              {isLocked ? <Lock className="w-4 h-4 text-stone-500" /> : <Unlock className="w-4 h-4 text-orange-400" />}
              <span className={`text-label font-semibold uppercase ${isLocked ? 'text-stone-500' : 'text-orange-400'}`}>
                {isLocked ? 'Locked' : 'Unlocked'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-label uppercase ${isLocked ? 'text-stone-500' : 'text-stone-400'}`}>
                {isLocked ? 'Read Only' : 'Editable'}
              </span>
              <button onClick={() => { if (settingsTab === 'prompts') setPromptsTabLocked(!promptsTabLocked); else setToolsTabLocked(!toolsTabLocked); }}
                className={`relative w-11 h-6 rounded-full transition-colors ${isLocked ? 'bg-stone-600' : 'bg-orange-500'}`}>
                <span className={`absolute top-1 w-4 h-4 bg-stone-500 rounded-full transition-transform ${isLocked ? 'left-1' : 'left-6'}`} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {settingsTab === 'prompts' && renderPromptsTab()}
            {settingsTab === 'tools' && renderToolsTab()}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-stone-600 flex-shrink-0 flex items-center justify-between">
            <p className="text-dense text-stone-500 flex-1">Changes are applied immediately. Use &quot;Reset to default&quot; to restore original settings.</p>
            <button
              onClick={() => setShowHelpModal(true)}
              className="ml-3 p-1.5 bg-stone-700 hover:bg-stone-600 rounded-control transition-colors"
              title="Help & Documentation"
            >
              <HelpCircle className="w-4 h-4 text-orange-400" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderPromptsTab() {
    const sections = [
      { key: 'courseOutline', title: 'Course Outline', desc: 'Generates 5-10 subject stubs for new software (Sonnet)', defaultVal: FULL_COURSE_OUTLINE_PROMPT },
      { key: 'subjectContent', title: 'Subject Content', desc: 'Full lesson content for a subject (Sonnet)', defaultVal: SUBJECT_GENERATION_PROMPT },
      { key: 'singleSubject', title: 'Single Subject', desc: 'Focused single-topic addition (Sonnet)', defaultVal: SINGLE_SUBJECT_PROMPT },
      { key: 'mc', title: 'Multiple Choice Quiz', desc: 'Generates MC quizzes (Haiku)', defaultVal: MULTIPLE_CHOICE_PROMPT },
      { key: 'codeId', title: 'Code Identification Quiz', desc: 'Generates code ID questions (Haiku)', defaultVal: CODE_IDENTIFICATION_PROMPT },
      { key: 'codeWrite', title: 'Code Writing Challenges', desc: 'Generates coding challenges (Haiku)', defaultVal: CODE_WRITING_PROMPT },
      { key: 'companion', title: 'Companion Chat', desc: 'Prompt for otter companion (Haiku)', defaultVal: COMPANION_PROMPT },
    ];
    return (
      <div className={promptsTabLocked ? 'opacity-60' : ''}>
        {sections.map(s => (
          <div key={s.key} className="border-b border-stone-700 overflow-hidden">
            <button onClick={() => setPromptSections(prev => ({ ...prev, [s.key]: !prev[s.key] }))}
              className="flex items-center justify-between w-full px-3 py-2 bg-stone-800 hover:bg-stone-750 transition-colors">
              <div className="text-left">
                <span className={`text-label font-semibold uppercase ${promptsTabLocked ? 'text-stone-500' : 'text-orange-400'}`}>{s.title}</span>
                <p className="text-dense text-stone-500">{s.desc}</p>
              </div>
              <ChevronRight className={`w-4 h-4 text-stone-500 transition-transform flex-shrink-0 ${promptSections[s.key] ? 'rotate-90' : ''}`} />
            </button>
            {promptSections[s.key] && (
              <div className="px-3 pb-3 pt-2">
                <textarea value={editingPrompts[s.key] || ''} onChange={e => setEditingPrompts(prev => ({ ...prev, [s.key]: e.target.value }))}
                  disabled={promptsTabLocked}
                  className={`w-full h-32 px-3 py-2 bg-stone-950 border border-stone-600 rounded-control text-orange-400 text-dense focus:border-orange-500 resize-none wilson-dark-scroll ${promptsTabLocked ? 'cursor-not-allowed' : ''}`} />
                <button onClick={() => setEditingPrompts(prev => ({ ...prev, [s.key]: s.defaultVal }))} disabled={promptsTabLocked}
                  className={`mt-1 text-dense ${promptsTabLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}>Reset to default</button>
                <button onClick={savePrompts} disabled={promptsTabLocked}
                  className={`mt-1 ml-3 text-dense ${promptsTabLocked ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'}`}>Save</button>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  function renderToolsTab() {
    return (
      <div className={toolsTabLocked ? 'opacity-60' : ''}>
        {/* Storage Location */}
        <div className="bg-stone-900 border border-stone-600 rounded-control p-4 mb-4">
          <label className={`block text-h3 font-semibold mb-2 ${toolsTabLocked ? 'text-stone-500' : 'text-orange-400'}`}>Storage Location</label>
          {/* S30: a refused settings write used to leave the field showing the
              new value with nothing saved. Now it says so. */}
          {settingsError && (
            <div className="flex items-start gap-2 mb-2 px-2 py-1.5 rounded-control border border-red-800/50 bg-red-950/30">
              <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-px" />
              <span className="text-dense text-red-300 leading-relaxed">
                <span className="font-semibold">Not saved.</span> {settingsError}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input value={settings?.storageLocation || './data/software/'} onChange={e => saveSettings({ storageLocation: e.target.value })}
              disabled={toolsTabLocked}
              className="flex-1 bg-stone-950 text-stone-400 border border-stone-600 rounded-control px-3 py-2 text-dense focus:border-orange-500 transition-colors disabled:cursor-not-allowed" />
            {/* Session 12: this button used to POST /api/browse-folder, a
                route that never existed on ANY host — it was dead everywhere
                (same class as S11's unreachable renderDeleteConfirm). The
                preload rabbit bridge already ships a directory picker, so use
                it where it exists and drop the button where it can't work. */}
            {window.electronAPI?.rabbit?.pickDirectory && (
              <button disabled={toolsTabLocked} onClick={async () => {
                try {
                  const dir = await window.electronAPI.rabbit.pickDirectory();
                  if (dir) saveSettings({ storageLocation: dir });
                } catch (e) { console.error('Browse folder failed:', e); }
              }} className="bg-stone-700 text-stone-300 border border-stone-600 px-3 py-2 rounded-control hover:bg-stone-600 transition-colors disabled:cursor-not-allowed disabled:opacity-50 shrink-0 flex items-center gap-1.5" title="Browse for folder">
                <FolderOpen className="w-4 h-4" /><span className="text-dense font-semibold">Browse</span>
              </button>
            )}
          </div>
          <p className="text-stone-600 text-dense mt-1">Default: ./data/software/ -- All courses and subjects are stored here.</p>
        </div>

        {/* Data management */}
        <div className="bg-stone-900 border border-stone-600 rounded-control p-4 mb-4">
          <label className={`block text-h3 font-semibold mb-3 ${toolsTabLocked ? 'text-stone-500' : 'text-orange-400'}`}>Data Management</label>
          <div className="space-y-2">
            <button onClick={exportAll} disabled={toolsTabLocked}
              className="w-full flex items-center gap-2 bg-stone-700 text-stone-300 border border-stone-600 px-3 py-2 rounded-control hover:bg-stone-600 transition-colors text-body disabled:cursor-not-allowed disabled:opacity-50">
              <Download className="w-4 h-4" /> Export All Data
            </button>
            <button onClick={() => setShowImportModal(true)} disabled={toolsTabLocked}
              className="w-full flex items-center gap-2 bg-stone-700 text-stone-300 border border-stone-600 px-3 py-2 rounded-control hover:bg-stone-600 transition-colors text-body disabled:cursor-not-allowed disabled:opacity-50">
              <Upload className="w-4 h-4" /> Import Data
            </button>
            <button onClick={() => setShowClearConfirm(true)} disabled={toolsTabLocked}
              className="w-full flex items-center gap-2 bg-red-900/30 text-red-400 border border-red-800 px-3 py-2 rounded-control hover:bg-red-900/50 transition-colors text-body disabled:cursor-not-allowed disabled:opacity-50">
              <Trash2 className="w-4 h-4" /> Clear All Data
            </button>
          </div>
        </div>
      </div>
    );
  }



  // ═══════════════════════════════════════════════════════════════
  //  MODALS
  // ═══════════════════════════════════════════════════════════════
  function renderImportModal() {
    // A4: the kit's Dialog (review O27). It was a 480px box of its own with
    // a hard offset shadow and a full-width Cancel under the drop zone; the
    // Cancel is the footer's now, and "Choose file" is a kit Button that
    // opens the same hidden file input (a <label> around it before, which
    // the keyboard could not reach — A2 made D.O.G.'s pickers Buttons too).
    return (
      <Dialog
        title="Import data"
        width="form"
        dismissOnBackdrop
        onClose={() => setShowImportModal(false)}
        footer={<Button onClick={() => setShowImportModal(false)}>Cancel</Button>}
      >
        <div className="otter-dropzone" data-over={importDragOver}
          onDragOver={e => { e.preventDefault(); setImportDragOver(true); }}
          onDragLeave={() => setImportDragOver(false)}
          onDrop={e => { e.preventDefault(); setImportDragOver(false); if (e.dataTransfer.files[0]) handleImportFile(e.dataTransfer.files[0]); }}>
          <FileJson className="otter-dropzone-icon" aria-hidden="true" />
          <p className="otter-dropzone-text">Drag and drop a .json file here</p>
          <Button icon={Upload} onClick={() => importFileRef.current?.click()}>Choose file</Button>
          <input ref={importFileRef} type="file" accept=".json" className="hidden" tabIndex={-1} aria-hidden="true"
            onChange={e => { if (e.target.files[0]) handleImportFile(e.target.files[0]); }} />
        </div>
      </Dialog>
    );
  }

  // Session 11: this dialog existed but was UNREACHABLE — nothing ever set
  // showDeleteConfirm truthy, so there was no way to remove a course at all.
  // The course row menu now opens it. Its copy also had to change: in cloud
  // mode the DELETE routes to otter_soft_delete_row, which is a 30-day trash,
  // so "permanently ... cannot be undone" was simply false and would have
  // scared people off a reversible action.
  function renderDeleteConfirm() {
    const course = softwareList.find(sw => sw.slug === showDeleteConfirm);
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setShowDeleteConfirm(null)}>
        <div className="bg-stone-800 border border-stone-600 rounded-control p-6 w-[400px] shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)]" onClick={e => e.stopPropagation()}>
          <h3 className="text-white font-semibold text-h1 mb-2">
            {cloudMode ? 'Move to trash' : 'Delete course'}
          </h3>
          <p className="text-stone-400 text-body mb-6">
            {cloudMode ? (
              <>
                <span className="text-stone-300 font-semibold">{course?.name ?? 'This course'}</span> and
                its subjects will move to Recently deleted. You can restore it for 30 days, after
                which it is deleted for good.
                {course?.visibility === 'company_standard' &&
                  ' It will also stop being offered as the company standard.'}
              </>
            ) : (
              'This will permanently delete this course and all its subjects, progress, and hotkeys. This cannot be undone.'
            )}
          </p>
          <div className="flex gap-2">
            <button onClick={() => setShowDeleteConfirm(null)} className="flex-1 bg-stone-700 text-stone-300 border border-stone-600 py-2 rounded-control hover:bg-stone-600 transition-colors text-body">Cancel</button>
            <button onClick={() => deleteSoftware(showDeleteConfirm)} className="flex-1 bg-red-700 text-white border border-red-800 py-2 rounded-control hover:bg-red-800 transition-colors text-body font-semibold">
              {cloudMode ? 'Move to trash' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderDeleteSubjectConfirm() {
    const { softwareSlug, subjectSlug, title } = showDeleteSubjectConfirm;
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setShowDeleteSubjectConfirm(null)}>
        <div className="bg-stone-800 border border-stone-600 rounded-control p-6 w-[400px] shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)]" onClick={e => e.stopPropagation()}>
          <h3 className="text-white font-semibold text-h1 mb-2">Delete Subject</h3>
          <p className="text-stone-400 text-body mb-2">Are you sure you want to delete:</p>
          <p className="text-orange-400 font-semibold text-h3 mb-4 truncate">&quot;{title}&quot;</p>
          <p className="text-stone-500 text-dense mb-6">This will permanently remove this subject and its lessons. This cannot be undone.</p>
          <div className="flex gap-2">
            <button onClick={() => setShowDeleteSubjectConfirm(null)} className="flex-1 bg-stone-700 text-stone-300 border border-stone-600 py-2 rounded-control hover:bg-stone-600 transition-colors text-body">Cancel</button>
            <button onClick={() => deleteSubject(softwareSlug, subjectSlug)} className="flex-1 bg-red-700 text-white border border-red-800 py-2 rounded-control hover:bg-red-800 transition-colors text-body font-semibold">Delete Subject</button>
          </div>
        </div>
      </div>
    );
  }

  function renderClearConfirm() {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
        <div className="bg-stone-800 border border-stone-600 rounded-control p-6 w-[400px] shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)]">
          <h3 className="text-white font-semibold text-h1 mb-2">Clear All Data</h3>
          <p className="text-stone-400 text-body mb-6">This will delete ALL courses, subjects, and progress. Are you sure?</p>
          <div className="flex gap-2">
            <button onClick={() => setShowClearConfirm(false)} className="flex-1 bg-stone-700 text-stone-300 border border-stone-600 py-2 rounded-control hover:bg-stone-600 transition-colors text-body">Cancel</button>
            <button onClick={async () => {
              for (const sw of softwareList) { await otterFetch(`/api/software/${sw.slug}`, { method: 'DELETE' }); }
              setActiveSoftwareSlug(null); setActiveSoftware(null); setSubjectList([]); setActiveSubjectSlug(null); setActiveSubject(null);
              setSoftwareHotkeys(null); setSoftwareFunctions(null); setActiveProgress(null); setReferenceUrls([]);
              invalidateCache(); loadSoftwareList(); setShowClearConfirm(false); setCurrentView('library');
            }} className="flex-1 bg-red-700 text-white border border-red-800 py-2 rounded-control hover:bg-red-800 transition-colors text-body font-semibold">Clear Everything</button>
          </div>
        </div>
      </div>
    );
  }

  function renderDuplicateModal() {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
        <div className="bg-stone-800 border border-stone-600 rounded-control p-6 w-[440px] shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)]">
          <h3 className="text-white font-semibold text-h1 mb-2">Duplicate Found</h3>
          <p className="text-stone-400 text-body mb-6">A course with this name already exists.</p>
          <div className="space-y-2">
            <button onClick={() => handleDuplicateResolve('replace')} className="w-full bg-orange-600 text-white border border-orange-700 py-2 rounded-control hover:bg-orange-700 transition-colors text-body font-semibold">Replace Existing</button>
            <button onClick={() => handleDuplicateResolve('keep')} className="w-full bg-stone-700 text-stone-300 border border-stone-600 py-2 rounded-control hover:bg-stone-600 transition-colors text-body">Keep Both</button>
            <button onClick={() => handleDuplicateResolve('cancel')} className="w-full bg-stone-700 text-stone-400 border border-stone-600 py-2 rounded-control hover:bg-stone-600 transition-colors text-body">Cancel</button>
          </div>
        </div>
      </div>
    );
  }
}