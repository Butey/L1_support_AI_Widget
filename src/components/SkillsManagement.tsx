import React, { useState, useMemo, useRef } from 'react';
import { 
  Wrench, 
  Plus, 
  Upload, 
  Trash2, 
  Edit3, 
  Copy, 
  Check, 
  Search, 
  X, 
  Eye, 
  Terminal, 
  ToggleLeft, 
  ToggleRight, 
  Sparkles, 
  Layers, 
  Zap, 
  PowerOff, 
  Cpu, 
  FileText, 
  RefreshCw, 
  Github, 
  FolderGit2, 
  XCircle, 
  Save, 
  CheckCircle2, 
  Info,
  ChevronDown,
  ChevronUp,
  Download
} from 'lucide-react';
import { Skill } from '../types';

export interface SkillsManagementProps {
  darkMode: boolean;
  skills: Skill[];
  onUpdateSkills: (skills: Skill[]) => void | Promise<void>;
  t: any;
  repoSkillsModal: any;
  setRepoSkillsModal: (modal: any) => void;
  selectedRepoSkills: Set<string>;
  setSelectedRepoSkills: (s: Set<string>) => void;
  executeBatchImport: () => Promise<void>;
  importing: string | null;
  handleImport: (key: string) => Promise<void>;
  skillImportUrl: string;
  skillRepoUrl: string;
  onSkillImportUrlChange: (url: string) => void;
  onSkillRepoUrlChange: (url: string) => void;
}

export default function SkillsManagement({
  darkMode,
  skills,
  onUpdateSkills,
  t,
  repoSkillsModal,
  setRepoSkillsModal,
  selectedRepoSkills,
  setSelectedRepoSkills,
  executeBatchImport,
  importing,
  handleImport,
  skillImportUrl,
  skillRepoUrl,
  onSkillImportUrlChange,
  onSkillRepoUrlChange
}: SkillsManagementProps) {
  // State for search and filter tabs
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'inactive'>('all');
  
  // Modals state
  const [showPromptInspector, setShowPromptInspector] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [showUrlImportSection, setShowUrlImportSection] = useState(false);

  // File input ref for upload
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Metrics computation
  const totalSkillsCount = skills.length;
  const activeSkills = useMemo(() => skills.filter(s => s && s.enabled), [skills]);
  const activeSkillsCount = activeSkills.length;
  const inactiveSkillsCount = totalSkillsCount - activeSkillsCount;

  // Active prompt calculation (same format as injected by server.ts)
  const activePromptText = useMemo(() => {
    if (activeSkills.length === 0) return '';
    return '=== ACTIVE AGENT SKILLS / CAPABILITIES ===\n\n' +
      activeSkills.map(s => `### Skill: ${s.name || 'Unnamed'}\n${s.content || ''}`).join('\n\n') +
      '\n\n=== END ACTIVE SKILLS ===';
  }, [activeSkills]);

  const activePromptTokens = useMemo(() => {
    if (!activePromptText) return 0;
    return Math.round(activePromptText.length / 4);
  }, [activePromptText]);

  // Filtered skills list
  const filteredSkills = useMemo(() => {
    return skills.filter(skill => {
      // Tab filter
      if (activeTab === 'active' && !skill.enabled) return false;
      if (activeTab === 'inactive' && skill.enabled) return false;

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const nameMatch = (skill.name || '').toLowerCase().includes(q);
        const contentMatch = (skill.content || '').toLowerCase().includes(q);
        const sourceMatch = (skill.source || '').toLowerCase().includes(q);
        return nameMatch || contentMatch || sourceMatch;
      }

      return true;
    });
  }, [skills, activeTab, searchQuery]);

  // Skill toggling
  const handleToggleSkill = (id: string) => {
    const updated = skills.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s);
    onUpdateSkills(updated);
  };

  // Bulk enable / disable
  const handleBulkToggle = (enable: boolean) => {
    // If filtering, we can affect filtered items or all items
    const updated = skills.map(s => {
      if (filteredSkills.some(f => f.id === s.id)) {
        return { ...s, enabled: enable };
      }
      return s;
    });
    onUpdateSkills(updated);
  };

  // Skill deletion
  const handleDeleteSkill = (skill: Skill) => {
    const confirmMsg = (t.skills_action_delete_confirm || 'Delete skill "{name}"?').replace('{name}', skill.name);
    if (window.confirm(confirmMsg)) {
      const updated = skills.filter(s => s.id !== skill.id);
      onUpdateSkills(updated);
    }
  };

  // Copy skill content to clipboard
  const handleCopySkill = (skill: Skill) => {
    navigator.clipboard.writeText(skill.content || '');
    setCopiedId(skill.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Copy full prompt text
  const handleCopyPrompt = () => {
    if (!activePromptText) return;
    navigator.clipboard.writeText(activePromptText);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  };

  // File upload handler - does NOT truncate content!
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newSkillsToAdd: Skill[] = [];
    let filesProcessed = 0;

    const fileList: File[] = Array.from(files);
    fileList.forEach((file: File) => {
      const reader = new FileReader();
      reader.onload = (event: ProgressEvent<FileReader>) => {
        const text = (event.target?.result as string) || '';
        
        // Check if file is JSON containing skills
        let parsedAsSkillJson = false;
        if (file.name.endsWith('.json')) {
          try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
              parsed.forEach((item: any) => {
                if (item && typeof item === 'object' && (item.name || item.content)) {
                  newSkillsToAdd.push({
                    id: item.id || Math.random().toString(36).substring(2, 9),
                    name: item.name || file.name.replace(/\.json$/, ''),
                    content: item.content || '',
                    enabled: item.enabled ?? true,
                    source: item.source || 'local_upload',
                    imported_at: item.imported_at || new Date().toISOString()
                  });
                  parsedAsSkillJson = true;
                }
              });
            } else if (parsed && typeof parsed === 'object' && (parsed.name || parsed.content)) {
              newSkillsToAdd.push({
                id: parsed.id || Math.random().toString(36).substring(2, 9),
                name: parsed.name || file.name.replace(/\.json$/, ''),
                content: parsed.content || '',
                enabled: parsed.enabled ?? true,
                source: parsed.source || 'local_upload',
                imported_at: parsed.imported_at || new Date().toISOString()
              });
              parsedAsSkillJson = true;
            }
          } catch (err) {
            // Not valid skills json, fallback to normal file content
          }
        }

        if (!parsedAsSkillJson) {
          // Extract heading as name if starts with '# '
          let derivedName = file.name.replace(/\.(md|json|txt)$/i, '');
          const firstHeadingMatch = text.match(/^#\s+([^\n\r]+)/);
          if (firstHeadingMatch && firstHeadingMatch[1]?.trim()) {
            derivedName = firstHeadingMatch[1].trim();
          }

          newSkillsToAdd.push({
            id: Math.random().toString(36).substring(2, 9),
            name: derivedName,
            content: text, // FULL content without truncation!
            enabled: true,
            source: 'local_upload',
            imported_at: new Date().toISOString()
          });
        }

        filesProcessed++;
        if (filesProcessed === fileList.length) {
          onUpdateSkills([...skills, ...newSkillsToAdd]);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.readAsText(file);
    });
  };

  // Open skill editor for new skill
  const handleOpenCreateModal = () => {
    setEditingSkill({
      id: Math.random().toString(36).substring(2, 9),
      name: '',
      content: '# Описание и инструкции навыка\n\n- Опишите поведение модели\n- Форматирование ответов\n- Ограничения и сценарии',
      enabled: true,
      source: 'manual',
      imported_at: new Date().toISOString()
    });
    setIsCreatingNew(true);
  };

  // Open skill editor for existing skill
  const handleOpenEditModal = (skill: Skill) => {
    setEditingSkill({ ...skill });
    setIsCreatingNew(false);
  };

  // Save skill from modal
  const handleSaveSkill = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSkill || !editingSkill.name.trim()) return;

    if (isCreatingNew) {
      onUpdateSkills([...skills, editingSkill]);
    } else {
      const updated = skills.map(s => s.id === editingSkill.id ? editingSkill : s);
      onUpdateSkills(updated);
    }
    setEditingSkill(null);
  };

  // Helper for source badge styling & label
  const renderSourceBadge = (source: string) => {
    const s = (source || '').toLowerCase();
    if (s.includes('github') || s.includes('repo')) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/20">
          <Github className="w-3 h-3" />
          {t.skills_source_github || 'GitHub'}
        </span>
      );
    }
    if (s.includes('upload') || s.includes('local')) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/20">
          <FileText className="w-3 h-3" />
          {t.skills_source_upload || 'Файл'}
        </span>
      );
    }
    if (s.includes('builtin') || s.includes('system')) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <Sparkles className="w-3 h-3" />
          {t.skills_source_builtin || 'Встроенный'}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-slate-500/10 text-slate-400 border border-slate-500/20">
        <Wrench className="w-3 h-3" />
        {t.skills_source_manual || 'Вручную'}
      </span>
    );
  };

  return (
    <div className="md:col-span-2 lg:col-span-3 space-y-8">
      {/* Hidden file input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        accept=".md,.json,.txt" 
        multiple
        className="hidden" 
      />

      {/* A. Top Metrics Cards (grid of 4) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Metric 1: Всего скиллов */}
        <div className={`p-6 rounded-3xl border transition-all relative overflow-hidden ${darkMode ? 'bg-zinc-900/80 border-white/10 shadow-xl' : 'bg-white border-slate-200/80 shadow-lg shadow-slate-100'}`}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">
              {t.skills_metric_total || 'Всего скиллов'}
            </span>
            <div className={`p-3 rounded-2xl ${darkMode ? 'bg-indigo-500/10 text-indigo-400' : 'bg-indigo-50 text-indigo-600'}`}>
              <Layers className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className={`text-3xl font-black tracking-tight ${darkMode ? 'text-white' : 'text-slate-900'}`}>
              {totalSkillsCount}
            </span>
          </div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-2">
            {skills.length === 1 ? 'Зарегистрирован 1 навык' : `Зарегистрировано ${totalSkillsCount} навыков`}
          </p>
        </div>

        {/* Metric 2: Активно в промпте (with pulsing dot) */}
        <div className={`p-6 rounded-3xl border transition-all relative overflow-hidden ${darkMode ? 'bg-zinc-900/80 border-emerald-500/20 shadow-xl' : 'bg-white border-emerald-200/80 shadow-lg shadow-emerald-500/5'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span className="text-[11px] font-black uppercase tracking-widest text-emerald-500">
                {t.skills_metric_active || 'Активно в промпте'}
              </span>
            </div>
            <div className={`p-3 rounded-2xl ${darkMode ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
              <Zap className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className={`text-3xl font-black tracking-tight ${darkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
              {activeSkillsCount}
            </span>
            <span className="text-xs font-bold text-slate-500">
              / {totalSkillsCount}
            </span>
          </div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-2">
            Внедряются в системный контекст
          </p>
        </div>

        {/* Metric 3: Отключено */}
        <div className={`p-6 rounded-3xl border transition-all relative overflow-hidden ${darkMode ? 'bg-zinc-900/80 border-white/10 shadow-xl' : 'bg-white border-slate-200/80 shadow-lg shadow-slate-100'}`}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">
              {t.skills_metric_inactive || 'Отключено'}
            </span>
            <div className={`p-3 rounded-2xl ${darkMode ? 'bg-zinc-800 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>
              <PowerOff className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className={`text-3xl font-black tracking-tight ${darkMode ? 'text-slate-300' : 'text-slate-700'}`}>
              {inactiveSkillsCount}
            </span>
          </div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-2">
            Игнорируются при запросе
          </p>
        </div>

        {/* Metric 4: Объем контекста (~ токенов) */}
        <div className={`p-6 rounded-3xl border transition-all relative overflow-hidden ${darkMode ? 'bg-zinc-900/80 border-indigo-500/20 shadow-xl' : 'bg-white border-indigo-200/80 shadow-lg shadow-indigo-500/5'}`}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-widest text-indigo-400">
              {t.skills_metric_tokens || 'Объем контекста'}
            </span>
            <div className={`p-3 rounded-2xl ${darkMode ? 'bg-indigo-500/10 text-indigo-400' : 'bg-indigo-50 text-indigo-600'}`}>
              <Cpu className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className={`text-3xl font-black tracking-tight ${darkMode ? 'text-indigo-300' : 'text-indigo-600'}`}>
              ~{activePromptTokens.toLocaleString()}
            </span>
            <span className="text-xs font-bold text-slate-500">
              {t.skills_tokens_approx || 'токенов'}
            </span>
          </div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-2">
            {activePromptText ? `${activePromptText.length.toLocaleString()} символов` : 'Контекст пуст'}
          </p>
        </div>
      </div>

      {/* B. "Как работают скиллы" Banner */}
      <div className={`p-6 sm:p-8 rounded-[2rem] border transition-all relative overflow-hidden ${
        darkMode 
          ? 'bg-gradient-to-r from-indigo-950/40 via-purple-950/20 to-zinc-900 border-indigo-500/20 shadow-xl' 
          : 'bg-gradient-to-r from-indigo-50/80 via-purple-50/50 to-white border-indigo-100 shadow-md shadow-indigo-500/5'
      }`}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
          <div className={`p-4 rounded-2xl shrink-0 ${darkMode ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 shadow-[0_0_20px_rgba(99,102,241,0.2)]' : 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'}`}>
            <Sparkles className="w-6 h-6" />
          </div>
          <div className="flex-1 space-y-1">
            <h4 className={`text-base font-black tracking-tight ${darkMode ? 'text-white' : 'text-slate-900'}`}>
              {t.skills_banner_title || 'Как работают скиллы в OmniAI'}
            </h4>
            <p className={`text-xs leading-relaxed font-medium ${darkMode ? 'text-slate-300' : 'text-slate-600'}`}>
              {t.skills_banner_desc || 'Активные скиллы автоматически внедряются в системный контекст модели в блоке === ACTIVE AGENT SKILLS / CAPABILITIES ===, определяя стиль ответов, правила форматирования и рабочие протоколы. Неактивные скиллы не расходуют токены контекста.'}
            </p>
          </div>
          <button
            onClick={() => setShowPromptInspector(true)}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shrink-0 transition-all border ${
              darkMode 
                ? 'bg-white/10 hover:bg-white/15 text-white border-white/10' 
                : 'bg-white hover:bg-slate-50 text-indigo-600 border-indigo-200 shadow-sm'
            }`}
          >
            <Eye className="w-4 h-4" />
            {t.skills_btn_inspector || 'Инспектор промпта'}
          </button>
        </div>
      </div>

      {/* C. Toolbar: Search, Filter Tabs & Actions */}
      <div className="space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Search input & Tabs */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.skills_search_placeholder || 'Поиск скилла по названию или инструкциям...'}
                className={`w-full pl-11 pr-10 py-3.5 rounded-2xl border text-xs font-bold outline-none transition-all focus:border-indigo-500/50 ${
                  darkMode ? 'bg-black/40 border-white/10 text-slate-200 placeholder:text-slate-600' : 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400'
                }`}
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-slate-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filter Tabs */}
            <div className={`flex items-center p-1 rounded-2xl border ${darkMode ? 'bg-black/40 border-white/10' : 'bg-slate-100 border-slate-200'}`}>
              <button
                onClick={() => setActiveTab('all')}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                  activeTab === 'all'
                    ? (darkMode ? 'bg-zinc-800 text-white shadow-sm' : 'bg-white text-slate-900 shadow-sm')
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {t.skills_tab_all || 'Все'} <span className="opacity-60 text-[10px]">({totalSkillsCount})</span>
              </button>
              <button
                onClick={() => setActiveTab('active')}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                  activeTab === 'active'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'text-slate-500 hover:text-emerald-400'
                }`}
              >
                {t.skills_tab_active || 'Активные'} <span className="opacity-75 text-[10px]">({activeSkillsCount})</span>
              </button>
              <button
                onClick={() => setActiveTab('inactive')}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                  activeTab === 'inactive'
                    ? (darkMode ? 'bg-zinc-800 text-white shadow-sm' : 'bg-white text-slate-900 shadow-sm')
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {t.skills_tab_inactive || 'Неактивные'} <span className="opacity-60 text-[10px]">({inactiveSkillsCount})</span>
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Create Skill */}
            <button
              onClick={handleOpenCreateModal}
              className="px-5 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-black text-xs flex items-center gap-2 transition-all shadow-lg shadow-indigo-600/20 uppercase tracking-widest active:scale-95 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              {t.skills_btn_create || 'Создать скилл'}
            </button>

            {/* Upload .md / .json */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`px-4 py-3.5 rounded-2xl font-black text-xs flex items-center gap-2 transition-all border uppercase tracking-wider active:scale-95 whitespace-nowrap ${
                darkMode 
                  ? 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10' 
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm'
              }`}
              title="Upload .md, .json, or .txt skill definitions"
            >
              <Upload className="w-4 h-4 text-indigo-500" />
              {t.skills_btn_upload || 'Загрузить .md/.json'}
            </button>

            {/* Inspector */}
            <button
              onClick={() => setShowPromptInspector(true)}
              className={`p-3.5 rounded-2xl transition-all border ${
                darkMode 
                  ? 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10' 
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm'
              }`}
              title={t.skills_btn_inspector || 'Инспектор промпта'}
            >
              <Terminal className="w-4 h-4" />
            </button>

            {/* Quick URL/Repo import toggle */}
            <button
              onClick={() => setShowUrlImportSection(!showUrlImportSection)}
              className={`px-3.5 py-3.5 rounded-2xl transition-all border flex items-center gap-1.5 text-xs font-bold ${
                showUrlImportSection
                  ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-400'
                  : (darkMode ? 'bg-white/5 border-white/10 text-slate-400 hover:text-white' : 'bg-white border-slate-200 text-slate-600 shadow-sm')
              }`}
              title="Toggle URL & Git Import"
            >
              <FolderGit2 className="w-4 h-4" />
              {showUrlImportSection ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Bulk Actions Row */}
        {skills.length > 0 && (
          <div className="flex items-center justify-between px-1 text-xs">
            <span className="text-[11px] font-bold text-slate-500">
              Показано: {filteredSkills.length} из {skills.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleBulkToggle(true)}
                className="px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider text-emerald-500 hover:bg-emerald-500/10 transition-colors"
              >
                {t.skills_btn_enable_all || 'Включить все'}
              </button>
              <span className="text-slate-600">•</span>
              <button
                onClick={() => handleBulkToggle(false)}
                className="px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider text-slate-400 hover:bg-slate-500/10 transition-colors"
              >
                {t.skills_btn_disable_all || 'Отключить все'}
              </button>
            </div>
          </div>
        )}

        {/* Optional Collapsible URL / Git Repository Import Bar */}
        {showUrlImportSection && (
          <div className={`p-6 rounded-3xl border transition-all space-y-4 ${darkMode ? 'bg-zinc-900/60 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex items-center gap-2">
              <FolderGit2 className="w-4 h-4 text-indigo-500" />
              <h5 className={`text-xs font-black uppercase tracking-widest ${darkMode ? 'text-white' : 'text-slate-800'}`}>
                {t.skills_import_url_title || 'Импорт из URL или Git-репозитория'}
              </h5>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Single File URL */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={skillImportUrl}
                  onChange={(e) => onSkillImportUrlChange(e.target.value)}
                  placeholder="https://raw.githubusercontent.com/.../skill.md"
                  className={`flex-1 p-3.5 rounded-xl border text-xs font-mono outline-none focus:border-indigo-500/50 ${
                    darkMode ? 'bg-black/40 border-white/10 text-slate-200' : 'bg-white border-slate-200 text-slate-900'
                  }`}
                />
                <button
                  onClick={() => handleImport('skill_import_url')}
                  disabled={!skillImportUrl.trim() || importing === 'skill_import_url'}
                  className="px-4 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black flex items-center gap-2 transition-all disabled:opacity-40 uppercase tracking-wider whitespace-nowrap"
                >
                  {importing === 'skill_import_url' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  Импорт .md
                </button>
              </div>

              {/* Repo URL */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={skillRepoUrl}
                  onChange={(e) => onSkillRepoUrlChange(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  className={`flex-1 p-3.5 rounded-xl border text-xs font-mono outline-none focus:border-indigo-500/50 ${
                    darkMode ? 'bg-black/40 border-white/10 text-slate-200' : 'bg-white border-slate-200 text-slate-900'
                  }`}
                />
                <button
                  onClick={() => handleImport('skill_repo_url')}
                  disabled={!skillRepoUrl.trim() || importing === 'skill_repo_url'}
                  className="px-4 py-3.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-black flex items-center gap-2 transition-all disabled:opacity-40 uppercase tracking-wider whitespace-nowrap"
                >
                  {importing === 'skill_repo_url' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FolderGit2 className="w-3.5 h-3.5" />}
                  Импорт репозитория
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* D. Skills Grid */}
      {filteredSkills.length === 0 ? (
        <div className={`p-16 rounded-[2.5rem] border text-center transition-all flex flex-col items-center justify-center space-y-4 ${
          darkMode ? 'bg-zinc-900/40 border-white/5' : 'bg-slate-50/50 border-slate-100'
        }`}>
          <div className={`p-5 rounded-3xl ${darkMode ? 'bg-white/5 text-slate-500' : 'bg-slate-100 text-slate-400'}`}>
            <Wrench className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h4 className={`text-lg font-black tracking-tight ${darkMode ? 'text-white' : 'text-slate-800'}`}>
              {t.skills_empty_title || 'Скиллы не найдены'}
            </h4>
            <p className="text-xs font-bold text-slate-500 max-w-sm">
              {searchQuery 
                ? 'Нет результатов, соответствующих вашему запросу. Попробуйте очистить фильтры.' 
                : (t.skills_empty_desc || 'Создайте новый скилл или загрузите файл .md/.json для начала работы.')}
            </p>
          </div>
          <div className="flex items-center gap-3 pt-2">
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(''); setActiveTab('all'); }}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold border transition-colors ${
                  darkMode ? 'border-white/10 text-slate-300 hover:bg-white/5' : 'border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                Сбросить поиск
              </button>
            )}
            <button
              onClick={handleOpenCreateModal}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black transition-all shadow-md shadow-indigo-600/20 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {t.skills_btn_create || 'Создать скилл'}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSkills.map((skill) => {
            const tokenEstimate = Math.round((skill.content || '').length / 4);
            const excerpt = (skill.content || '')
              .replace(/^#+\s+/gm, '') // Remove heading markers
              .replace(/\n+/g, ' ')   // Normalize whitespace
              .trim();
            const truncatedExcerpt = excerpt.length > 140 ? excerpt.slice(0, 140) + '...' : excerpt;

            return (
              <div 
                key={skill.id} 
                className={`p-6 rounded-[2rem] border flex flex-col justify-between transition-all group relative ${
                  skill.enabled
                    ? (darkMode 
                        ? 'bg-zinc-900/90 border-white/10 hover:border-emerald-500/30 hover:shadow-2xl hover:shadow-emerald-500/5' 
                        : 'bg-white border-slate-200 hover:border-emerald-300 hover:shadow-xl hover:shadow-emerald-500/10')
                    : (darkMode 
                        ? 'bg-zinc-900/40 border-white/5 opacity-75 hover:opacity-100' 
                        : 'bg-slate-50 border-slate-200/60 opacity-85 hover:opacity-100')
                }`}
              >
                {/* Header: Source badge & Active status pill */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    {renderSourceBadge(skill.source)}

                    {/* Active Status Pill */}
                    {skill.enabled ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.15)]">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        {t.skills_badge_active || 'АКТИВЕН В ЧАТЕ'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-500/10 text-slate-400 border border-slate-500/20">
                        {t.skills_badge_disabled || 'ОТКЛЮЧЕН'}
                      </span>
                    )}
                  </div>

                  {/* Skill Name */}
                  <div className="pt-1">
                    <h4 className={`text-base font-black tracking-tight leading-snug break-words ${darkMode ? 'text-white' : 'text-slate-900'}`}>
                      {skill.name}
                    </h4>
                  </div>

                  {/* Excerpt */}
                  <p className={`text-xs leading-relaxed line-clamp-3 min-h-[3.75rem] ${darkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                    {truncatedExcerpt || <span className="italic opacity-50">Нет содержимого</span>}
                  </p>
                </div>

                {/* Footer Section */}
                <div className="pt-5 mt-4 border-t space-y-4 border-inherit">
                  {/* Meta stats: Tokens & Date */}
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-500">
                    <span className={`px-2.5 py-1 rounded-lg border font-mono ${
                      skill.enabled 
                        ? (darkMode ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-emerald-50 border-emerald-200 text-emerald-700')
                        : (darkMode ? 'bg-white/5 border-white/5 text-slate-500' : 'bg-slate-100 border-slate-200 text-slate-500')
                    }`}>
                      ~{tokenEstimate} токенов
                    </span>
                    <span>
                      {skill.imported_at ? skill.imported_at.split('T')[0] : '—'}
                    </span>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center justify-between gap-2">
                    {/* Toggle switch button */}
                    <button
                      onClick={() => handleToggleSkill(skill.id)}
                      className={`px-3 py-2 rounded-xl flex items-center gap-2 text-xs font-black transition-all border ${
                        skill.enabled
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                          : (darkMode ? 'bg-white/5 border-white/10 text-slate-400 hover:text-white' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200')
                      }`}
                      title={t.skill_toggle || 'Переключить статус'}
                    >
                      {skill.enabled ? <ToggleRight className="w-5 h-5 text-emerald-400" /> : <ToggleLeft className="w-5 h-5 text-slate-400" />}
                      <span className="text-[10px] uppercase tracking-wider">
                        {skill.enabled ? 'ВКЛ' : 'ВЫКЛ'}
                      </span>
                    </button>

                    {/* Right-aligned icon buttons */}
                    <div className="flex items-center gap-1.5">
                      {/* Copy */}
                      <button
                        onClick={() => handleCopySkill(skill)}
                        className={`p-2.5 rounded-xl transition-all border ${
                          copiedId === skill.id
                            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                            : (darkMode ? 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-200')
                        }`}
                        title={copiedId === skill.id ? (t.skills_action_copied || 'Скопировано!') : (t.skills_action_copy || 'Копировать')}
                      >
                        {copiedId === skill.id ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      </button>

                      {/* Edit */}
                      <button
                        onClick={() => handleOpenEditModal(skill)}
                        className={`p-2.5 rounded-xl transition-all border ${
                          darkMode ? 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:bg-white/10' : 'bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                        }`}
                        title={t.skills_action_edit || 'Подробнее / Редактировать'}
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => handleDeleteSkill(skill)}
                        className="p-2.5 rounded-xl transition-all border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white"
                        title={t.skills_action_delete || 'Удалить'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* E1. Modal: Live Prompt Inspector */}
      {showPromptInspector && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
          <div className={`w-full max-w-3xl max-h-[85vh] flex flex-col rounded-[2.5rem] border shadow-2xl overflow-hidden ${
            darkMode ? 'bg-zinc-950 border-white/10' : 'bg-white border-slate-200'
          }`}>
            {/* Modal Header */}
            <div className={`p-6 border-b flex items-center justify-between ${darkMode ? 'border-white/10 bg-zinc-900/50' : 'border-slate-100 bg-slate-50'}`}>
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl ${darkMode ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-100 text-indigo-600'}`}>
                  <Terminal className="w-5 h-5" />
                </div>
                <div>
                  <h3 className={`font-black text-lg tracking-tight ${darkMode ? 'text-white' : 'text-slate-900'}`}>
                    {t.skills_inspector_title || 'Инспектор активного промпта'}
                  </h3>
                  <p className="text-[11px] font-bold text-slate-500">
                    {t.skills_inspector_subtitle || 'Точный блок инструкций, передаваемый в системный промпт LLM'}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowPromptInspector(false)}
                className="p-2 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-white/10 transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Stats Bar */}
            <div className={`px-6 py-3 border-b flex flex-wrap items-center justify-between text-xs font-mono ${
              darkMode ? 'bg-zinc-900/30 border-white/5 text-slate-400' : 'bg-slate-100/70 border-slate-200 text-slate-600'
            }`}>
              <div className="flex items-center gap-4">
                <span>
                  Активных скиллов: <strong className="text-indigo-400">{activeSkillsCount}</strong>
                </span>
                <span>•</span>
                <span>
                  Символов: <strong className="text-indigo-400">{activePromptText.length.toLocaleString()}</strong>
                </span>
                <span>•</span>
                <span>
                  Токенов (прим.): <strong className="text-emerald-400">~{activePromptTokens.toLocaleString()}</strong>
                </span>
              </div>
              <button
                onClick={handleCopyPrompt}
                disabled={!activePromptText}
                className="flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-300 disabled:opacity-40 transition-colors"
              >
                {promptCopied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                {promptCopied ? (t.skills_action_copied || 'Скопировано!') : (t.skills_action_copy || 'Копировать')}
              </button>
            </div>

            {/* Modal Body: Monospace Text */}
            <div className="p-6 overflow-y-auto flex-1 font-mono text-xs leading-relaxed">
              {activePromptText ? (
                <div className={`p-5 rounded-2xl border ${darkMode ? 'bg-black/80 border-white/10 text-emerald-300/90' : 'bg-slate-900 border-slate-800 text-emerald-400'}`}>
                  <pre className="whitespace-pre-wrap font-mono select-text">
                    {activePromptText}
                  </pre>
                </div>
              ) : (
                <div className="p-12 text-center text-slate-500 space-y-2">
                  <Info className="w-8 h-8 mx-auto opacity-50" />
                  <p className="font-bold text-sm">
                    {t.skills_inspector_empty || '(Нет активных скиллов — блок навыков в системный контекст не внедряется)'}
                  </p>
                  <p className="text-xs max-w-sm mx-auto">
                    Включите один или несколько навыков в списке, чтобы они начали передаваться языковой модели.
                  </p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className={`p-6 border-t flex justify-end gap-3 ${darkMode ? 'border-white/10 bg-zinc-900/50' : 'border-slate-100 bg-slate-50'}`}>
              <button
                onClick={() => setShowPromptInspector(false)}
                className={`px-6 py-3 rounded-xl font-bold text-xs transition-colors ${
                  darkMode ? 'text-slate-300 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                Закрыть
              </button>
              {activePromptText && (
                <button
                  onClick={handleCopyPrompt}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-black text-xs transition-all flex items-center gap-2 uppercase tracking-wider"
                >
                  {promptCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {promptCopied ? (t.skills_action_copied || 'Скопировано!') : 'Копировать весь блок'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* E2. Modal: Skill Editor / Viewer */}
      {editingSkill && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
          <form 
            onSubmit={handleSaveSkill}
            className={`w-full max-w-3xl max-h-[90vh] flex flex-col rounded-[2.5rem] border shadow-2xl overflow-hidden ${
              darkMode ? 'bg-zinc-900 border-white/10' : 'bg-white border-slate-200'
            }`}
          >
            {/* Header */}
            <div className={`p-6 border-b flex items-center justify-between ${darkMode ? 'border-white/10' : 'border-slate-100'}`}>
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl ${darkMode ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-100 text-indigo-600'}`}>
                  <Edit3 className="w-5 h-5" />
                </div>
                <h3 className={`font-black text-xl tracking-tight ${darkMode ? 'text-white' : 'text-slate-900'}`}>
                  {isCreatingNew ? (t.skills_editor_title_new || 'Создание нового скилла') : (t.skills_editor_title_edit || 'Редактирование скилла')}
                </h3>
              </div>
              <button 
                type="button"
                onClick={() => setEditingSkill(null)} 
                className="p-2 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-white/10 transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Form Body */}
            <div className="p-6 space-y-6 overflow-y-auto flex-1">
              {/* Skill Name */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] block">
                  {t.skills_editor_name_label || 'Название навыка'} *
                </label>
                <input
                  type="text"
                  required
                  value={editingSkill.name}
                  onChange={(e) => setEditingSkill({ ...editingSkill, name: e.target.value })}
                  placeholder={t.skills_editor_name_placeholder || 'например, Эксперт по ответам Omnidesk'}
                  className={`w-full p-4 rounded-2xl border text-sm font-bold outline-none transition-all focus:border-indigo-500/50 ${
                    darkMode ? 'bg-black/40 border-white/10 text-slate-100' : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                />
              </div>

              {/* Status & Source meta */}
              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingSkill.enabled}
                    onChange={(e) => setEditingSkill({ ...editingSkill, enabled: e.target.checked })}
                    className="w-5 h-5 rounded-lg accent-indigo-600 cursor-pointer"
                  />
                  <span className={`text-xs font-bold ${darkMode ? 'text-slate-200' : 'text-slate-800'}`}>
                    {t.skills_editor_enable_label || 'Активировать в чате сразу после сохранения'}
                  </span>
                </label>

                <div className="flex items-center gap-2 text-xs text-slate-500 font-bold ml-auto">
                  <span>Источник:</span>
                  {renderSourceBadge(editingSkill.source)}
                </div>
              </div>

              {/* Markdown Content */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] block">
                    {t.skills_editor_content_label || 'Инструкции и протоколы (Markdown)'} *
                  </label>
                  <span className="text-[10px] font-mono text-slate-500">
                    {(editingSkill.content || '').length} символов • ~{Math.round((editingSkill.content || '').length / 4)} токенов
                  </span>
                </div>
                <textarea
                  required
                  rows={12}
                  value={editingSkill.content}
                  onChange={(e) => setEditingSkill({ ...editingSkill, content: e.target.value })}
                  placeholder={t.skills_editor_content_placeholder || 'Опишите правила, формат ответа, шаблоны и ограничения для модели...'}
                  className={`w-full p-5 rounded-2xl border text-xs font-mono leading-relaxed resize-y outline-none transition-all focus:border-indigo-500/50 ${
                    darkMode ? 'bg-black/50 border-white/10 text-indigo-100' : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                />
              </div>
            </div>

            {/* Footer */}
            <div className={`p-6 border-t flex justify-end gap-3 ${darkMode ? 'border-white/10 bg-zinc-900/50' : 'border-slate-100 bg-slate-50'}`}>
              <button 
                type="button"
                onClick={() => setEditingSkill(null)}
                className={`px-6 py-3 rounded-xl font-bold text-xs transition-colors ${
                  darkMode ? 'text-slate-300 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                {t.skills_editor_cancel || 'Отмена'}
              </button>
              <button 
                type="submit"
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-black text-xs transition-all flex items-center gap-2 shadow-lg shadow-indigo-600/30 uppercase tracking-widest active:scale-95"
              >
                <Save className="w-4 h-4" />
                {t.skills_editor_save || 'Сохранить скилл'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* E3. Modal: Repo Skills Selection Modal (reused from existing flow) */}
      {repoSkillsModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className={`w-full max-w-2xl max-h-[80vh] flex flex-col rounded-[2.5rem] border shadow-2xl overflow-hidden ${
            darkMode ? 'bg-zinc-900 border-white/10' : 'bg-white border-slate-200'
          }`}>
            <div className={`p-6 border-b flex items-center justify-between ${darkMode ? 'border-white/10' : 'border-slate-100'}`}>
              <div className="flex items-center gap-3">
                <FolderGit2 className="w-5 h-5 text-indigo-500" />
                <h3 className={`font-black text-xl tracking-tight ${darkMode ? 'text-white' : 'text-slate-900'}`}>
                  {t.skills_repo_modal_title || 'Выбор навыков из репозитория'}
                </h3>
              </div>
              <button 
                onClick={() => setRepoSkillsModal(null)} 
                className="p-2 rounded-xl bg-slate-500/10 text-slate-500 hover:bg-slate-500/20 transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            
            {/* Select all / Deselect all bar */}
            <div className={`px-6 py-3 border-b flex items-center justify-between text-xs ${
              darkMode ? 'bg-zinc-900/40 border-white/5 text-slate-400' : 'bg-slate-50 border-slate-100 text-slate-600'
            }`}>
              <span className="font-bold">
                Выбрано: {selectedRepoSkills.size} из {repoSkillsModal.files?.length || 0}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRepoSkills(new Set(repoSkillsModal.files.map((f: any) => f.path)));
                  }}
                  className="font-bold text-indigo-400 hover:underline"
                >
                  {t.skills_repo_select_all || 'Выбрать все'}
                </button>
                <span>•</span>
                <button
                  type="button"
                  onClick={() => setSelectedRepoSkills(new Set())}
                  className="font-bold text-slate-400 hover:underline"
                >
                  {t.skills_repo_deselect_all || 'Снять все'}
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <div className="space-y-2">
                {repoSkillsModal.files && repoSkillsModal.files.map((file: any) => (
                  <label 
                    key={file.path} 
                    className={`flex items-center gap-4 p-4 rounded-2xl cursor-pointer transition-colors border ${
                      selectedRepoSkills.has(file.path)
                        ? (darkMode ? 'border-indigo-500/40 bg-indigo-500/10' : 'border-indigo-300 bg-indigo-50/50')
                        : (darkMode ? 'border-white/5 hover:bg-white/5' : 'border-slate-100 hover:bg-slate-50')
                    }`}
                  >
                    <input 
                      type="checkbox" 
                      className="w-5 h-5 rounded-lg accent-indigo-600 cursor-pointer"
                      checked={selectedRepoSkills.has(file.path)}
                      onChange={(e) => {
                        const newSet = new Set(selectedRepoSkills);
                        if (e.target.checked) newSet.add(file.path);
                        else newSet.delete(file.path);
                        setSelectedRepoSkills(newSet);
                      }}
                    />
                    <div className="flex flex-col">
                      <span className={`font-bold text-sm ${darkMode ? 'text-slate-200' : 'text-slate-800'}`}>
                        {file.path}
                      </span>
                      {file.size && (
                        <span className="text-[10px] text-slate-500">
                          {Math.round(file.size / 1024)} KB
                        </span>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className={`p-6 border-t flex justify-end gap-4 ${darkMode ? 'border-white/10 bg-zinc-900/50' : 'border-slate-100 bg-slate-50'}`}>
              <button 
                onClick={() => setRepoSkillsModal(null)}
                className={`px-6 py-3 rounded-xl font-bold text-xs transition-colors ${
                  darkMode ? 'text-slate-300 hover:bg-white/10' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                {t.skills_editor_cancel || 'Отмена'}
              </button>
              <button 
                onClick={executeBatchImport}
                disabled={selectedRepoSkills.size === 0 || importing === 'skill_repo_url'}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-black text-xs transition-all flex items-center gap-2 disabled:opacity-50 uppercase tracking-widest active:scale-95"
              >
                {importing === 'skill_repo_url' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {t.skills_repo_install_selected || 'Установить выбранные'} ({selectedRepoSkills.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
