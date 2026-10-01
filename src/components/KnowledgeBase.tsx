import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Plus, 
  Tag, 
  FileText, 
  MoreVertical, 
  Edit3, 
  Trash2, 
  History,
  BrainCircuit,
  MessageSquareQuote,
  Link as LinkIcon,
  FileUp,
  Loader2
} from 'lucide-react';
import { KnowledgeBaseItem } from '../types';
import { apiFetch } from '../lib/api';

export default function KnowledgeBase({ darkMode, t }: { darkMode: boolean, t: any }) {
  const [items, setItems] = useState<KnowledgeBaseItem[]>([]);
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ title: '', content: '', tags: '' });

  // Upload / Scraping state
  const [activeTab, setActiveTab] = useState<'manual' | 'link' | 'file'>('manual');
  const [urlInput, setUrlInput] = useState('');
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  // Detail view and custom dialog states
  const [viewingItem, setViewingItem] = useState<KnowledgeBaseItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Ticket-based learning states
  const [showLearningPanel, setShowLearningPanel] = useState(false);
  const [learningPeriod, setLearningPeriod] = useState(30);
  const [learningLimit, setLearningLimit] = useState(5);
  const [isLearning, setIsLearning] = useState(false);
  const [learningResult, setLearningResult] = useState<{ success: boolean; count?: number; error?: string } | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'articles' | 'tickets'>('all');

  const handleStartLearning = async () => {
    setIsLearning(true);
    setLearningResult(null);
    try {
      const res = await apiFetch('/api/admin/tickets/learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodDays: learningPeriod, limit: learningLimit })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to trigger learning');
      }
      const data = await res.json();
      setLearningResult({ success: true, count: data.count });
      fetchItems();
    } catch (err: any) {
      setLearningResult({ success: false, error: err.message || 'Ошибка во время обучения' });
    } finally {
      setIsLearning(false);
    }
  };

  const fetchItems = () => {
    apiFetch('/api/knowledge-base')
      .then(res => res.json())
      .then(setItems);
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handleOpenModal = (item?: KnowledgeBaseItem) => {
    setActiveTab('manual');
    setUrlInput('');
    setScrapeError('');
    if (item) {
      setEditingId(item.id);
      setFormData({
        title: item.title,
        content: item.content,
        tags: item.tags.join(', ')
      });
    } else {
      setEditingId(null);
      setFormData({ title: '', content: '', tags: '' });
    }
    setIsModalOpen(true);
  };

  const handleScrape = async () => {
    if (!urlInput) return;
    setIsScraping(true);
    setScrapeError('');
    try {
      const res = await apiFetch('/api/knowledge-base/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to scrape URL');
      }
      await res.json();
      setIsModalOpen(false);
      setUrlInput('');
      fetchItems();
    } catch (err: any) {
      setScrapeError(err.message || 'Ошибка импорта ссылки');
    } finally {
      setIsScraping(false);
    }
  };

  const handleFileRead = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setFormData({
        title: file.name,
        content: text,
        tags: `file, ${file.name.split('.').pop() || 'imported'}`
      });
      setActiveTab('manual');
    };
    reader.onerror = () => {
      alert('Не удалось прочитать файл');
    };
    reader.readAsText(file);
  };

  const handleSave = async () => {
    const payload = {
      title: formData.title,
      content: formData.content,
      tags: formData.tags.split(',').map(tag => tag.trim()).filter(Boolean)
    };

    if (editingId) {
      await apiFetch(`/api/knowledge-base/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      await apiFetch('/api/knowledge-base', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }
    setIsModalOpen(false);
    fetchItems();
  };

  const handleDelete = (id: string) => {
    setDeletingId(id);
  };

  const confirmDelete = async () => {
    if (deletingId) {
      await apiFetch(`/api/knowledge-base/${deletingId}`, { method: 'DELETE' });
      setDeletingId(null);
      fetchItems();
    }
  };

  const filteredItems = items.filter(i => {
    const matchesSearch = i.title.toLowerCase().includes(search.toLowerCase()) || 
                          i.content.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    
    if (filterType === 'articles') {
      return !i.tags.includes('learned-ticket');
    }
    if (filterType === 'tickets') {
      return i.tags.includes('learned-ticket');
    }
    return true;
  });

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className={`text-4xl font-black tracking-tight italic ${darkMode ? 'bg-gradient-to-r from-white to-slate-500' : 'bg-gradient-to-r from-slate-900 to-slate-500'} bg-clip-text text-transparent`}>{t.context_engine}</h2>
          <p className="text-slate-500 text-sm mt-2 font-medium italic">{t.context_desc}</p>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setShowLearningPanel(!showLearningPanel)} 
            className={`px-6 py-3 rounded-2xl flex items-center gap-2 text-[10px] font-black border transition-all uppercase tracking-[0.2em] ${showLearningPanel ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-500/20' : (darkMode ? 'border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10' : 'border-slate-200 bg-white shadow-lg shadow-slate-200/40 text-slate-500 hover:text-indigo-600')}`}
          >
             <BrainCircuit className="w-4 h-4" />
             ОБУЧЕНИЕ НА ТИКЕТАХ
          </button>
          <button className={`px-6 py-3 rounded-2xl flex items-center gap-2 text-[10px] font-black border transition-all uppercase tracking-[0.2em] ${darkMode ? 'border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10' : 'border-slate-200 bg-white shadow-lg shadow-slate-200/40 text-slate-500 hover:text-indigo-600'}`}>
             <BrainCircuit className="w-4 h-4" />
             {t.reindex_kb}
          </button>
          <button onClick={() => handleOpenModal()} className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-black text-[10px] flex items-center gap-2 transition-all shadow-[0_10px_25px_rgba(79,70,229,0.3)] uppercase tracking-[0.2em]">
            <Plus className="w-5 h-5" />
            {t.add_entity}
          </button>
        </div>
      </div>

      {showLearningPanel && (
        <div className={`p-8 rounded-[2rem] border transition-all relative overflow-hidden ${darkMode ? 'border-indigo-500/20 bg-indigo-500/5 shadow-[0_0_50px_rgba(99,102,241,0.05)]' : 'border-indigo-100 bg-indigo-50/30 shadow-xl shadow-indigo-500/5'}`}>
          <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
            <BrainCircuit className="w-40 h-40 text-indigo-500" />
          </div>
          
          <div className="relative z-10 max-w-2xl space-y-6">
            <div>
              <h3 className={`text-xl font-black italic tracking-tight ${darkMode ? 'text-white' : 'text-slate-900'}`}>
                {t.ticket_learning_title}
              </h3>
              <p className="text-slate-500 text-xs mt-1.5 font-bold leading-relaxed">
                {t.ticket_learning_desc}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Period Select */}
              <div className="space-y-2">
                <label className={`block text-[10px] font-black uppercase tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  {t.analyze_period}
                </label>
                <div className="flex gap-2">
                  {[7, 30, 90].map((days) => (
                    <button
                      key={days}
                      onClick={() => setLearningPeriod(days)}
                      className={`flex-1 py-2.5 rounded-xl text-[10px] font-black transition-all ${
                        learningPeriod === days
                          ? 'bg-indigo-600 text-white shadow-md'
                          : (darkMode ? 'bg-white/5 border border-white/5 text-slate-400 hover:bg-white/10' : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300')
                      }`}
                    >
                      {days === 7 ? t.period_7_days : days === 30 ? t.period_30_days : t.period_90_days}
                    </button>
                  ))}
                </div>
              </div>

              {/* Limit Input */}
              <div className="space-y-2">
                <label className={`block text-[10px] font-black uppercase tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  Лимит тикетов для анализа (защита лимитов)
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="1"
                    max="15"
                    value={learningLimit}
                    onChange={(e) => setLearningLimit(parseInt(e.target.value))}
                    className="flex-1 accent-indigo-600 h-1.5 rounded-lg appearance-none cursor-pointer bg-slate-200 dark:bg-white/10"
                  />
                  <span className={`text-xs font-black min-w-[20px] text-center ${darkMode ? 'text-white' : 'text-slate-900'}`}>
                    {learningLimit}
                  </span>
                </div>
              </div>
            </div>

            {/* Action / Feedback */}
            <div className="flex items-center gap-4 pt-2">
              <button
                disabled={isLearning}
                onClick={handleStartLearning}
                className={`px-8 py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white rounded-2xl font-black text-[10px] flex items-center gap-2.5 transition-all shadow-lg uppercase tracking-[0.2em] ${isLearning ? 'animate-pulse' : ''}`}
              >
                {isLearning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t.learning_progress}
                  </>
                ) : (
                  <>
                    <BrainCircuit className="w-4 h-4" />
                    {t.start_learning}
                  </>
                )}
              </button>

              {isLearning && (
                <span className="text-[10px] font-black text-indigo-500 animate-pulse uppercase tracking-widest">
                  Бережно анализируем тикеты по одному, чтобы сберечь ваши лимиты токенов...
                </span>
              )}
            </div>

            {/* Results Alert */}
            {learningResult && (
              <div className={`p-5 rounded-2xl border text-xs font-bold leading-relaxed ${
                learningResult.success
                  ? (darkMode ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-emerald-50 border-emerald-100 text-emerald-700')
                  : (darkMode ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-rose-50 border-rose-100 text-rose-700')
              }`}>
                {learningResult.success ? (
                  <p>
                    🎉 {t.learning_success} <span className="font-black underline">{learningResult.count}</span>. 
                    Агент успешно перенял опыт решения реальных кейсов из Omnidesk и теперь будет использовать эти данные при генерации рекомендаций.
                  </p>
                ) : (
                  <p>
                    ❌ {t.learning_error} {learningResult.error}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Search & Tabs */}
      <div className={`p-3 rounded-3xl border ${darkMode ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white/80 shadow-2xl shadow-slate-200/20'} backdrop-blur-md flex items-center gap-6`}>
        <div className={`flex-1 flex items-center gap-4 px-5 py-3 rounded-2xl border transition-all focus-within:border-indigo-500/40 ${darkMode ? 'bg-black/40 border-white/5' : 'bg-slate-50 border-slate-100'}`}>
          <Search className="w-5 h-5 text-slate-500" />
          <input 
            type="text" 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.search_placeholder} 
            className={`bg-transparent border-none outline-none text-xs w-full font-bold ${darkMode ? 'text-slate-200 placeholder:text-slate-600' : 'text-slate-900 placeholder:text-slate-400'}`}
          />
        </div>
        <div className={`hidden md:flex items-center gap-1.5 p-1.5 rounded-2xl border ${darkMode ? 'bg-black/20 border-white/5' : 'bg-slate-100 border-slate-200'}`}>
           <button 
             onClick={() => setFilterType('all')}
             className={`px-6 py-2 rounded-xl text-[10px] font-black tracking-[0.1em] transition-all ${filterType === 'all' ? (darkMode ? 'bg-white/10 text-white' : 'bg-white text-indigo-600 shadow-sm') : 'text-slate-500 hover:text-indigo-600'}`}
           >
             ALL
           </button>
           <button 
             onClick={() => setFilterType('articles')}
             className={`px-6 py-2 rounded-xl text-[10px] font-black tracking-[0.1em] transition-all ${filterType === 'articles' ? (darkMode ? 'bg-white/10 text-white' : 'bg-white text-indigo-600 shadow-sm') : 'text-slate-500 hover:text-indigo-600'}`}
           >
             ARTICLES
           </button>
           <button 
             onClick={() => setFilterType('tickets')}
             className={`px-6 py-2 rounded-xl text-[10px] font-black tracking-[0.1em] transition-all ${filterType === 'tickets' ? (darkMode ? 'bg-white/10 text-white' : 'bg-white text-indigo-600 shadow-sm') : 'text-slate-500 hover:text-indigo-600'}`}
           >
             TICKETS
           </button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
        {filteredItems.map(item => (
          <div 
            key={item.id} 
            onClick={() => setViewingItem(item)}
            className={`p-8 rounded-[2rem] border transition-all group relative hover:scale-[1.02] active:scale-95 cursor-pointer ${darkMode ? 'border-white/10 bg-white/5 hover:border-indigo-500/30 hover:bg-white/10' : 'border-slate-200 bg-white shadow-xl shadow-slate-200/50 hover:border-indigo-500/40 hover:shadow-2xl'}`}
          >
            <button 
              onClick={(e) => { e.stopPropagation(); }}
              className={`absolute top-8 right-8 opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-xl ${darkMode ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-slate-50 text-slate-400'}`}
            >
              <MoreVertical className="w-5 h-5" />
            </button>
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-8 border transition-transform group-hover:scale-110 group-hover:rotate-3 ${darkMode ? 'bg-indigo-500/10 border-indigo-500/20 shadow-[0_0_20px_rgba(99,102,241,0.1)]' : 'bg-indigo-50 border-indigo-100 shadow-lg shadow-indigo-500/5'}`}>
               <FileText className={`w-7 h-7 ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`} />
            </div>
            <h3 className={`font-black text-xl mb-4 italic tracking-tight line-clamp-1 ${darkMode ? 'text-white' : 'text-slate-900'}`}>{item.title}</h3>
            <p className={`text-xs mb-8 line-clamp-3 leading-relaxed font-bold tracking-tight ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              {item.content}
            </p>
            <div className="flex items-center flex-wrap gap-2.5">
              {(item.tags || []).map(tag => (
                <span key={tag} className={`text-[9px] font-black px-4 py-1.5 rounded-xl border uppercase tracking-[0.2em] shadow-sm ${darkMode ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20' : 'bg-indigo-50 text-indigo-600 border-indigo-100'}`}>
                  {tag}
                </span>
              ))}
            </div>
            <div className={`mt-10 pt-8 border-t flex items-center justify-between text-[10px] font-black uppercase tracking-[0.2em] ${darkMode ? 'border-white/5 text-slate-500' : 'border-slate-100 text-slate-400'}`}>
               <div className="flex items-center gap-2">
                 <History className="w-4 h-4 text-indigo-500/60" />
                 <span>Synced 2h ago</span>
               </div>
               <div className="flex gap-6">
                 <button 
                   onClick={(e) => { e.stopPropagation(); handleOpenModal(item); }} 
                   className="hover:text-indigo-600 transition-colors pointer-events-auto"
                 >
                   EDIT
                 </button>
                 <button 
                   onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }} 
                   className="hover:text-red-500 transition-colors pointer-events-auto"
                 >
                   DELETE
                 </button>
               </div>
            </div>
          </div>
        ))}

        {/* Training Placeholder */}
        <div onClick={() => handleOpenModal()} className={`p-10 rounded-[2rem] border-2 border-dashed transition-all group flex flex-col items-center justify-center text-center cursor-pointer min-h-[350px] backdrop-blur-sm ${darkMode ? 'border-white/10 bg-white/5 hover:border-indigo-500/40' : 'border-slate-200 bg-slate-50 hover:border-indigo-500/40 hover:bg-white'}`}>
            <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-8 border-2 group-hover:scale-110 transition-all ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200 shadow-xl shadow-slate-200/50'}`}>
              <Plus className={`w-10 h-10 ${darkMode ? 'text-indigo-500/40 group-hover:text-indigo-400' : 'text-indigo-600/40 group-hover:text-indigo-600'}`} />
            </div>
            <h4 className={`font-black mb-2 uppercase tracking-[0.3em] text-xs ${darkMode ? 'text-white' : 'text-slate-900'}`}>{t.ingest_data}</h4>
            <p className="text-[10px] text-slate-500 max-w-[200px] font-black leading-relaxed uppercase tracking-widest">{t.ingest_desc}</p>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className={`w-full max-w-lg p-6 rounded-3xl border ${darkMode ? 'bg-zinc-900 border-white/10' : 'bg-white border-slate-200'} shadow-2xl`}>
            <h3 className={`text-xl font-bold mb-4 ${darkMode ? 'text-white' : 'text-slate-900'}`}>
              {editingId ? 'Edit Entity' : 'Add Entity'}
            </h3>

            {/* Modal Tabs (only when creating, not editing) */}
            {!editingId && (
              <div className={`flex border-b mb-6 ${darkMode ? 'border-white/10' : 'border-slate-100'}`}>
                <button
                  onClick={() => setActiveTab('manual')}
                  className={`flex-1 pb-3 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all ${
                    activeTab === 'manual'
                      ? 'border-indigo-500 text-indigo-500'
                      : 'border-transparent text-slate-400 hover:text-slate-500'
                  }`}
                >
                  Ручной ввод
                </button>
                <button
                  onClick={() => setActiveTab('link')}
                  className={`flex-1 pb-3 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all ${
                    activeTab === 'link'
                      ? 'border-indigo-500 text-indigo-500'
                      : 'border-transparent text-slate-400 hover:text-slate-500'
                  }`}
                >
                  Импорт ссылки
                </button>
                <button
                  onClick={() => setActiveTab('file')}
                  className={`flex-1 pb-3 text-[10px] font-black uppercase tracking-wider border-b-2 transition-all ${
                    activeTab === 'file'
                      ? 'border-indigo-500 text-indigo-500'
                      : 'border-transparent text-slate-400 hover:text-slate-500'
                  }`}
                >
                  Загрузить файл
                </button>
              </div>
            )}
            
            <div className="space-y-4">
              {activeTab === 'manual' || editingId ? (
                <>
                  <div>
                    <label className={`block text-xs font-bold mb-2 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Title</label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      className={`w-full p-3 rounded-xl border text-sm focus:border-indigo-500/50 outline-none ${darkMode ? 'bg-black/40 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
                    />
                  </div>
                  
                  <div>
                    <label className={`block text-xs font-bold mb-2 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Content</label>
                    <textarea
                      value={formData.content}
                      onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                      className={`w-full h-32 p-3 rounded-xl border text-sm resize-none focus:border-indigo-500/50 outline-none ${darkMode ? 'bg-black/40 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
                    />
                  </div>

                  <div>
                    <label className={`block text-xs font-bold mb-2 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Tags (comma separated)</label>
                    <input
                      type="text"
                      value={formData.tags}
                      onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                      className={`w-full p-3 rounded-xl border text-sm focus:border-indigo-500/50 outline-none ${darkMode ? 'bg-black/40 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
                    />
                  </div>
                </>
              ) : activeTab === 'link' ? (
                <div className="space-y-4">
                  <div className={`p-4 rounded-2xl border ${darkMode ? 'bg-black/20 border-white/5' : 'bg-slate-50 border-slate-100'}`}>
                    <p className="text-xs text-slate-500 mb-3 font-medium">
                      Укажите веб-ссылку на документацию или статью (например, <code>https://docs.example.com/...</code>). Наш парсер загрузит страницу, очистит её от HTML-тегов и автоматически добавит в базу знаний.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        placeholder="https://example.com/docs"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        className={`flex-1 p-3 rounded-xl border text-sm outline-none ${darkMode ? 'bg-black/40 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'}`}
                      />
                      <button
                        onClick={handleScrape}
                        disabled={isScraping || !urlInput}
                        className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-[10px] tracking-wider uppercase rounded-xl disabled:opacity-50 transition-colors flex items-center gap-2"
                      >
                        {isScraping ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Импорт...
                          </>
                        ) : (
                          'Импорт'
                        )}
                      </button>
                    </div>
                    {scrapeError && (
                      <p className="text-xs text-red-500 mt-2 font-semibold">{scrapeError}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragOver(true);
                    }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragOver(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) handleFileRead(file);
                    }}
                    className={`p-8 rounded-2xl border-2 border-dashed text-center transition-all flex flex-col items-center justify-center min-h-[180px] cursor-pointer ${
                      isDragOver 
                        ? 'border-indigo-500 bg-indigo-500/10' 
                        : darkMode 
                          ? 'border-white/10 bg-black/20 hover:border-indigo-500/30' 
                          : 'border-slate-200 bg-slate-50 hover:border-indigo-500/40'
                    }`}
                    onClick={() => document.getElementById('kb-file-input')?.click()}
                  >
                    <input
                      id="kb-file-input"
                      type="file"
                      accept=".txt,.md,.json,.html,.xml,.csv,.js,.ts"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileRead(file);
                      }}
                    />
                    <FileUp className="w-10 h-10 text-indigo-500 mb-3" />
                    <p className={`text-xs font-bold ${darkMode ? 'text-white' : 'text-slate-700'}`}>
                      Перетащите файл сюда или кликните для выбора
                    </p>
                    <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest font-black">
                      Поддерживаются .txt, .md, .json, .html, .csv до 5MB
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setIsModalOpen(false)}
                className={`px-6 py-2 rounded-xl text-xs font-bold transition-colors ${darkMode ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}
              >
                Cancel
              </button>
              {(activeTab === 'manual' || editingId) && (
                <button
                  onClick={handleSave}
                  className="px-6 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors"
                >
                  Save
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VIEW MATERIAL DETAIL MODAL */}
      {viewingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={`w-full max-w-2xl p-6 rounded-3xl border flex flex-col max-h-[90vh] ${darkMode ? 'bg-zinc-900 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'} shadow-2xl`}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <span className={`text-[9px] font-black px-3 py-1 rounded-md uppercase tracking-wider ${darkMode ? 'bg-indigo-500/10 text-indigo-300' : 'bg-indigo-50 text-indigo-600'}`}>
                  Просмотр материала
                </span>
                <h3 className="text-xl font-black italic tracking-tight mt-2">{viewingItem.title}</h3>
              </div>
              <button
                onClick={() => setViewingItem(null)}
                className={`p-1.5 rounded-lg transition-colors ${darkMode ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}
              >
                ✕
              </button>
            </div>

            <div className={`flex-1 overflow-y-auto pr-2 my-4 p-4 rounded-2xl border ${darkMode ? 'bg-black/20 border-white/5' : 'bg-slate-50 border-slate-100'}`}>
              <p className="text-sm font-sans whitespace-pre-wrap leading-relaxed">
                {viewingItem.content}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 mb-6">
              {(viewingItem.tags || []).map(tag => (
                <span key={tag} className={`text-[9px] font-black px-4 py-1.5 rounded-xl border uppercase tracking-[0.2em] shadow-sm ${darkMode ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20' : 'bg-indigo-50 text-indigo-600 border-indigo-100'}`}>
                  {tag}
                </span>
              ))}
            </div>

            <div className="flex justify-between items-center border-t pt-4 border-slate-200/50 dark:border-white/5">
              <div className="text-xs text-slate-400 font-medium">
                ID: <code className="font-mono text-[10px]">{viewingItem.id}</code>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    const itemToEdit = viewingItem;
                    setViewingItem(null);
                    handleOpenModal(itemToEdit);
                  }}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors shadow-lg shadow-indigo-600/20"
                >
                  Редактировать
                </button>
                <button
                  onClick={() => {
                    const idToDelete = viewingItem.id;
                    setViewingItem(null);
                    setDeletingId(idToDelete);
                  }}
                  className="px-5 py-2.5 rounded-xl border border-red-500/30 text-red-500 hover:bg-red-500/10 text-xs font-bold transition-colors"
                >
                  Удалить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM DELETE CONFIRMATION DIALOG */}
      {deletingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className={`w-full max-w-md p-6 rounded-3xl border ${darkMode ? 'bg-zinc-900 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'} shadow-2xl`}>
            <div className="flex items-center gap-3 mb-4 text-red-500">
              <Trash2 className="w-6 h-6" />
              <h3 className="text-lg font-bold">Удалить запись из базы знаний?</h3>
            </div>
            <p className={`text-sm mb-6 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              Вы действительно хотите навсегда удалить эту запись? Данное действие необратимо.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeletingId(null)}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-colors ${darkMode ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-slate-100 text-slate-500'}`}
              >
                Отмена
              </button>
              <button
                onClick={confirmDelete}
                className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-colors shadow-lg shadow-red-600/20"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
