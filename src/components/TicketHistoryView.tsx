import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft,
  History, 
  ExternalLink, 
  Search, 
  RefreshCw, 
  Copy, 
  Check, 
  Trash2, 
  X, 
  ShieldCheck, 
  AlertTriangle, 
  Tag, 
  Sparkles, 
  Image as ImageIcon,
  User,
  Bot
} from 'lucide-react';
import { apiFetch, getSafeSessionItem, setSafeSessionItem, getSafeLocalItem, setSafeLocalItem } from '../lib/api';
import { ConversationHistoryMessage } from '../types';

interface TicketHistoryViewProps {
  caseNumber: string;
  darkMode?: boolean;
  onClose?: () => void;
  isStandalone?: boolean;
  widgetSecret?: string;
  staffEmail?: string;
  adminToken?: string;
}

export default function TicketHistoryView({
  caseNumber,
  darkMode = true,
  onClose,
  isStandalone = false,
  widgetSecret,
  staffEmail,
  adminToken
}: TicketHistoryViewProps) {
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ConversationHistoryMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [authKeyInput, setAuthKeyInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Extract caseNumber from prop or URL param fallback
  const resolvedCaseNumber = caseNumber || (() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      return p.get('case_number') || p.get('ticket') || p.get('ticket_id') || p.get('case_id') || p.get('caseId') || '';
    }
    return '';
  })();

  const cleanCase = resolvedCaseNumber
    .replace(/^[№#\s]+/, '')
    .trim();

  const [authResolving, setAuthResolving] = useState(false);

  // Helper to extract active auth credentials across props, query params, opener bridge, session & local storage
  const getAuthCredentials = () => {
    let sec = widgetSecret || '';
    let email = staffEmail || '';
    let tok = adminToken || '';

    // 1. Initial auth object passed directly by opener
    if (typeof window !== 'undefined' && (window as any).__INITIAL_AUTH__) {
      const init = (window as any).__INITIAL_AUTH__;
      if (init.secret && !sec) sec = init.secret;
      if (init.staffEmail && !email) email = init.staffEmail;
      if (init.token && !tok) tok = init.token;
    }

    // 2. Query parameters
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        const urlSec = params.get('secret') || params.get('ws') || params.get('widget_secret');
        const urlEmail = params.get('staff_email') || params.get('email');
        const urlTok = params.get('token') || params.get('admin_token');

        if (urlSec) {
          sec = urlSec;
          setSafeSessionItem('omni_widget_secret', urlSec);
          setSafeLocalItem('omni_widget_secret', urlSec);
        }
        if (urlEmail) {
          email = urlEmail;
          setSafeSessionItem('omni_staff_email', urlEmail);
          setSafeLocalItem('omni_staff_email', urlEmail);
        }
        if (urlTok) {
          tok = urlTok;
          setSafeSessionItem('admin_token', urlTok);
          setSafeLocalItem('admin_token', urlTok);
        }
      } catch (e) {}
    }

    // 3. Current session & local storage
    if (!sec) {
      sec = getSafeSessionItem('omni_widget_secret') || getSafeLocalItem('omni_widget_secret') || '';
    }
    if (!email) {
      email = getSafeSessionItem('omni_staff_email') || getSafeLocalItem('omni_staff_email') || '';
    }
    if (!tok) {
      tok = getSafeSessionItem('admin_token') || getSafeLocalItem('admin_token') || '';
    }

    // 4. Inspect window.opener (the widget interface that opened this standalone window)
    if (typeof window !== 'undefined' && window.opener) {
      try {
        const openerAuth = (window.opener as any).__OMNI_GET_AUTH__?.();
        if (openerAuth) {
          if (openerAuth.secret && !sec) sec = openerAuth.secret;
          if (openerAuth.staffEmail && !email) email = openerAuth.staffEmail;
          if (openerAuth.adminToken && !tok) tok = openerAuth.adminToken;
        }
        if (!sec && (window.opener as any).__OMNI_WIDGET_SECRET) {
          sec = (window.opener as any).__OMNI_WIDGET_SECRET;
        }
        if (!email && (window.opener as any).__OMNI_STAFF_EMAIL) {
          email = (window.opener as any).__OMNI_STAFF_EMAIL;
        }
        if (!sec && window.opener.sessionStorage) {
          const opSec = window.opener.sessionStorage.getItem('omni_widget_secret');
          if (opSec) sec = opSec;
        }
        if (!sec && window.opener.localStorage) {
          const opSec = window.opener.localStorage.getItem('omni_widget_secret');
          if (opSec) sec = opSec;
        }
        if (!email && window.opener.sessionStorage) {
          const opEmail = window.opener.sessionStorage.getItem('omni_staff_email');
          if (opEmail) email = opEmail;
        }
        if (!tok && window.opener.sessionStorage) {
          const opTok = window.opener.sessionStorage.getItem('admin_token');
          if (opTok) tok = opTok;
        }
      } catch (e) {
        // Cross-origin opener will be reached via postMessage & BroadcastChannel
      }
    }

    // 5. Inspect window.parent (if embedded in an iframe or modal)
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      try {
        const parentAuth = (window.parent as any).__OMNI_GET_AUTH__?.();
        if (parentAuth) {
          if (parentAuth.secret && !sec) sec = parentAuth.secret;
          if (parentAuth.staffEmail && !email) email = parentAuth.staffEmail;
          if (parentAuth.adminToken && !tok) tok = parentAuth.adminToken;
        }
        if (!sec && (window.parent as any).__OMNI_WIDGET_SECRET) {
          sec = (window.parent as any).__OMNI_WIDGET_SECRET;
        }
      } catch (e) {}
    }

    // Persist discovered credentials
    if (sec) {
      setSafeSessionItem('omni_widget_secret', sec);
      setSafeLocalItem('omni_widget_secret', sec);
    }
    if (email) {
      setSafeSessionItem('omni_staff_email', email);
      setSafeLocalItem('omni_staff_email', email);
    }
    if (tok) {
      setSafeSessionItem('admin_token', tok);
      setSafeLocalItem('admin_token', tok);
    }

    return { secret: sec, staffEmail: email, token: tok };
  };

  // Auto-config fallback to query server configuration if available
  const tryAutoConfig = async (): Promise<boolean> => {
    try {
      const res = await apiFetch('/api/widget/config');
      if (res.ok) {
        const data = await res.json();
        if (data?.widgetSecret) {
          setSafeSessionItem('omni_widget_secret', data.widgetSecret);
          setSafeLocalItem('omni_widget_secret', data.widgetSecret);
          return true;
        }
      }
    } catch (e) {}
    return false;
  };

  // Send request for auth credentials to widget opener, parent and BroadcastChannel
  const requestAuthFromWidget = () => {
    try {
      if (typeof window !== 'undefined') {
        if (window.opener && typeof window.opener.postMessage === 'function') {
          window.opener.postMessage({ type: 'OMNIDESK_REQUEST_AUTH' }, '*');
        }
        if (window.parent && window.parent !== window && typeof window.parent.postMessage === 'function') {
          window.parent.postMessage({ type: 'OMNIDESK_REQUEST_AUTH' }, '*');
        }
        if ('BroadcastChannel' in window) {
          try {
            const bc = new BroadcastChannel('omniai_auth');
            bc.postMessage({ type: 'OMNIDESK_REQUEST_AUTH' });
            bc.close();
          } catch (e) {}
        }
      }
    } catch (e) {}
  };

  // Handshake listener for OMNIDESK_PROVIDE_AUTH from widget interface
  useEffect(() => {
    const handleAuthMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'OMNIDESK_PROVIDE_AUTH') {
        const incomingSec = event.data.secret;
        const incomingEmail = event.data.staffEmail;
        const incomingTok = event.data.adminToken || event.data.token;
        let updated = false;

        if (incomingSec) {
          setSafeSessionItem('omni_widget_secret', incomingSec);
          setSafeLocalItem('omni_widget_secret', incomingSec);
          updated = true;
        }
        if (incomingEmail) {
          setSafeSessionItem('omni_staff_email', incomingEmail);
          setSafeLocalItem('omni_staff_email', incomingEmail);
          updated = true;
        }
        if (incomingTok) {
          setSafeSessionItem('admin_token', incomingTok);
          setSafeLocalItem('admin_token', incomingTok);
          updated = true;
        }

        if (updated) {
          setError(null);
          fetchHistory();
        }
      }
    };

    window.addEventListener('message', handleAuthMessage);

    let ch: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        ch = new BroadcastChannel('omniai_auth');
        ch.onmessage = (event) => {
          if (event.data && event.data.type === 'OMNIDESK_PROVIDE_AUTH') {
            handleAuthMessage(event as any);
          }
        };
      } catch (e) {}
    }

    // Proactively request auth from widget interface on mount
    requestAuthFromWidget();
    const t1 = setTimeout(requestAuthFromWidget, 300);
    const t2 = setTimeout(requestAuthFromWidget, 1000);

    return () => {
      window.removeEventListener('message', handleAuthMessage);
      clearTimeout(t1);
      clearTimeout(t2);
      if (ch) {
        try { ch.close(); } catch (e) {}
      }
    };
  }, [cleanCase]);

  // Clean sensitive auth credentials from address bar after persisting them to storage
  useEffect(() => {
    if (typeof window !== 'undefined' && isStandalone) {
      try {
        const params = new URLSearchParams(window.location.search);
        let changed = false;
        for (const key of ['ws', 'secret', 'widget_secret', 'token', 'admin_token']) {
          if (params.has(key)) {
            params.delete(key);
            changed = true;
          }
        }
        if (changed) {
          const cleanSearch = params.toString();
          const cleanUrl = window.location.pathname + (cleanSearch ? `?${cleanSearch}` : '') + window.location.hash;
          window.history.replaceState({}, document.title, cleanUrl);
        }
      } catch (e) {}
    }
  }, [isStandalone]);

  const fetchHistory = async () => {
    if (!cleanCase) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { secret, staffEmail: email, token } = getAuthCredentials();
      const headers: Record<string, string> = {};
      if (secret) headers['X-Widget-Secret'] = secret;
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (email) headers['X-Staff-Email'] = email;

      const queryParams = new URLSearchParams();
      if (secret) queryParams.set('ws', secret);
      if (token) queryParams.set('token', token);
      if (email) queryParams.set('staff_email', email);
      const qs = queryParams.toString();
      const historyUrl = `/api/omnidesk/cases/${encodeURIComponent(cleanCase)}/history${qs ? `?${qs}` : ''}`;

      const res = await apiFetch(historyUrl, { headers });
      if (!res.ok) {
        if (res.status === 401) {
          // If 401 occurs, attempt auto-pulling credentials before giving up
          requestAuthFromWidget();
          const autoFetched = await tryAutoConfig();
          if (autoFetched) {
            const retryCreds = getAuthCredentials();
            const retryHeaders: Record<string, string> = {};
            if (retryCreds.secret) retryHeaders['X-Widget-Secret'] = retryCreds.secret;
            if (retryCreds.token) retryHeaders['Authorization'] = `Bearer ${retryCreds.token}`;
            if (retryCreds.staffEmail) retryHeaders['X-Staff-Email'] = retryCreds.staffEmail;

            const retryQs = new URLSearchParams();
            if (retryCreds.secret) retryQs.set('ws', retryCreds.secret);
            if (retryCreds.token) retryQs.set('token', retryCreds.token);
            if (retryCreds.staffEmail) retryQs.set('staff_email', retryCreds.staffEmail);
            const retryRes = await apiFetch(`/api/omnidesk/cases/${encodeURIComponent(cleanCase)}/history?${retryQs.toString()}`, { headers: retryHeaders });
            if (retryRes.ok) {
              const retryData = await retryRes.json();
              setMessages(retryData.messages || []);
              setError(null);
              return;
            }
          }
        }
        throw new Error(`Ошибка загрузки истории (${res.status})`);
      }
      const data = await res.json();
      setMessages(data.messages || []);
      setError(null);
    } catch (err: any) {
      console.error('Failed to load ticket history:', err);
      setError(err.message || 'Не удалось загрузить историю диалога');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [cleanCase]);

  // Support Escape key to exit history view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleCopyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      console.warn('Clipboard copy failed:', e);
    }
  };

  const handleClearHistory = async () => {
    if (!window.confirm(`Вы уверены, что хотите очистить историю диалогов по тикету #${cleanCase}?`)) {
      return;
    }
    setClearing(true);
    try {
      const { secret, staffEmail: email, token } = getAuthCredentials();
      const headers: Record<string, string> = {};
      if (secret) headers['X-Widget-Secret'] = secret;
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (email) headers['X-Staff-Email'] = email;

      const queryParams = new URLSearchParams();
      if (secret) queryParams.set('ws', secret);
      if (token) queryParams.set('token', token);
      if (email) queryParams.set('staff_email', email);
      const qs = queryParams.toString();
      const historyUrl = `/api/omnidesk/cases/${encodeURIComponent(cleanCase)}/history${qs ? `?${qs}` : ''}`;

      const res = await apiFetch(historyUrl, {
        method: 'DELETE',
        headers
      });
      if (res.ok) {
        setMessages([]);
      } else {
        throw new Error('Не удалось очистить историю');
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setClearing(false);
    }
  };

  const handleOpenStandalone = () => {
    const creds = getAuthCredentials();
    const params = new URLSearchParams();
    params.set('mode', 'history');
    params.set('case_number', cleanCase);
    if (creds.secret) params.set('ws', creds.secret);
    if (creds.staffEmail) params.set('staff_email', creds.staffEmail);
    if (creds.token) params.set('token', creds.token);

    const url = `/?${params.toString()}`;
    const win = window.open(url, '_blank', 'width=960,height=760,scrollbars=yes');
    if (win) {
      try {
        (win as any).__INITIAL_AUTH__ = creds;
      } catch (e) {}
      setTimeout(() => {
        try {
          win.postMessage({
            type: 'OMNIDESK_PROVIDE_AUTH',
            ...creds
          }, '*');
        } catch (e) {}
      }, 250);
    }
  };

  const handleAutoPullSecret = async () => {
    setAuthResolving(true);
    setAuthError(null);
    requestAuthFromWidget();
    const configFetched = await tryAutoConfig();
    if (configFetched) {
      await fetchHistory();
      setAuthResolving(false);
      return;
    }
    setTimeout(async () => {
      await fetchHistory();
      setAuthResolving(false);
    }, 600);
  };

  const handleManualUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = authKeyInput.trim();
    if (!key) return;
    setAuthError(null);
    setAuthSubmitting(true);

    try {
      // 1. Try as widget secret
      let res = await apiFetch(`/api/omnidesk/cases/${encodeURIComponent(cleanCase)}/history?ws=${encodeURIComponent(key)}`, {
        headers: { 'X-Widget-Secret': key }
      });
      if (res.ok) {
        setSafeSessionItem('omni_widget_secret', key);
        setSafeLocalItem('omni_widget_secret', key);
        const data = await res.json();
        setMessages(data.messages || []);
        setError(null);
        setAuthKeyInput('');
        return;
      }

      // 2. Try as admin password/token
      res = await apiFetch(`/api/omnidesk/cases/${encodeURIComponent(cleanCase)}/history?token=${encodeURIComponent(key)}`, {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      if (res.ok) {
        setSafeSessionItem('admin_token', key);
        setSafeLocalItem('admin_token', key);
        const data = await res.json();
        setMessages(data.messages || []);
        setError(null);
        setAuthKeyInput('');
        return;
      }

      setAuthError('Неверный ключ доступа (секрет виджета или пароль)');
    } catch (err: any) {
      setAuthError(err.message || 'Ошибка проверки авторизации');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const filteredMessages = messages.filter(m => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const matchesUser = m.userQuery?.toLowerCase().includes(query);
    const matchesReply = m.replyText?.toLowerCase().includes(query);
    const matchesSuggestion = m.suggestions?.some(s => s.text?.toLowerCase().includes(query));
    const matchesEscalation = m.escalation?.noteContent?.toLowerCase().includes(query);
    const matchesReasoning = m.classification?.reasoning?.toLowerCase().includes(query);
    return matchesUser || matchesReply || matchesSuggestion || matchesEscalation || matchesReasoning;
  });

  return (
    <div className={`flex flex-col h-full ${darkMode ? 'bg-[#09090b] text-slate-100' : 'bg-slate-50 text-slate-900'} font-sans`}>
      {/* Top Header */}
      <header className={`px-3 py-2.5 sm:px-6 sm:py-3.5 border-b shrink-0 flex items-center justify-between gap-2 ${darkMode ? 'border-white/10 bg-black/40' : 'border-slate-200 bg-white shadow-sm'}`}>
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {onClose && (
            <button
              onClick={onClose}
              title="Вернуться к чату (Esc)"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border shrink-0 ${
                darkMode 
                  ? 'bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border-indigo-500/30' 
                  : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
              }`}
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Назад</span>
            </button>
          )}
          <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
            <History className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm sm:text-base font-black tracking-tight truncate">История</h2>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 shrink-0">
                #{cleanCase || 'Без номера'}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-medium truncate hidden sm:block">
              Сохраненные диалоги с ассистентом OmniAI
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={fetchHistory}
            disabled={loading}
            title="Обновить историю"
            className={`p-2 rounded-xl border transition-all ${
              darkMode ? 'border-white/10 hover:bg-white/5 text-slate-300' : 'border-slate-200 hover:bg-slate-100 text-slate-600'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
          </button>

          {!isStandalone && (
            <button
              onClick={handleOpenStandalone}
              title="Открыть в отдельном окне"
              className="p-2 sm:px-3 sm:py-1.5 rounded-xl border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 text-xs font-bold transition-all flex items-center gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">В отдельном окне</span>
            </button>
          )}

          {messages.length > 0 && (
            <button
              onClick={handleClearHistory}
              disabled={clearing}
              title="Очистить историю тикета"
              className="p-2 rounded-xl border border-red-500/20 hover:bg-red-500/10 text-red-400 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          {onClose && (
            <button
              onClick={onClose}
              title="Закрыть историю (Esc)"
              className={`p-2 rounded-xl border transition-all ${
                darkMode ? 'border-white/10 hover:bg-white/10 text-slate-400 hover:text-white' : 'border-slate-200 hover:bg-slate-100 text-slate-600'
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Search and Filters Bar */}
      <div className={`px-6 py-3 border-b shrink-0 flex items-center gap-3 ${darkMode ? 'border-white/5 bg-black/20' : 'border-slate-100 bg-white'}`}>
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск по вопросам, ответам, черновикам или заметкам..."
            className={`w-full pl-9 pr-4 py-1.5 rounded-xl text-xs font-medium border outline-none transition-all ${
              darkMode 
                ? 'bg-white/5 border-white/10 focus:border-indigo-500 text-white placeholder-slate-500' 
                : 'bg-slate-50 border-slate-200 focus:border-indigo-500 text-slate-900 placeholder-slate-400'
            }`}
          />
        </div>
        <span className="text-[11px] font-bold text-slate-400 whitespace-nowrap">
          Записей: {filteredMessages.length}
        </span>
      </div>

      {/* Content Messages List */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
        {loading && messages.length === 0 ? (
          <div className="h-48 flex items-center justify-center">
            <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className={`p-6 sm:p-8 rounded-2xl border text-center max-w-md mx-auto my-8 ${
            darkMode ? 'bg-white/5 border-white/10 text-slate-100' : 'bg-white border-slate-200 text-slate-900 shadow-md'
          }`}>
            <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
            <p className="text-sm font-bold text-rose-400 mb-1">
              {error.includes('401') ? 'Требуется авторизация для просмотра истории' : 'Ошибка загрузки истории'}
            </p>
            <p className="text-xs text-slate-400 mb-4">
              {error.includes('401')
                ? 'Для доступа к истории тикета откройте её через виджет в Omnidesk либо введите секрет виджета (WIDGET_SECRET) / пароль администратора.'
                : error}
            </p>
            {error.includes('401') ? (
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={handleAutoPullSecret}
                  disabled={authResolving}
                  className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-md shadow-indigo-500/20 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${authResolving ? 'animate-spin' : ''}`} />
                  <span>{authResolving ? 'Подтягиваю ключ из виджета...' : 'Подтянуть ключ из виджета'}</span>
                </button>

                <div className="flex items-center gap-2 my-1">
                  <div className={`flex-1 border-t ${darkMode ? 'border-white/10' : 'border-slate-200'}`} />
                  <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">или вручную</span>
                  <div className={`flex-1 border-t ${darkMode ? 'border-white/10' : 'border-slate-200'}`} />
                </div>

                <form onSubmit={handleManualUnlock} className="flex flex-col gap-3 text-left">
                  <div className="relative">
                    <input
                      type="password"
                      placeholder="Секрет виджета или пароль админа..."
                      value={authKeyInput}
                      onChange={(e) => setAuthKeyInput(e.target.value)}
                      className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium border outline-none transition-all ${
                        darkMode
                          ? 'bg-black/40 border-white/20 text-white placeholder-slate-500 focus:border-indigo-500'
                          : 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400 focus:border-indigo-500'
                      }`}
                    />
                  </div>
                  {authError && <p className="text-[11px] text-rose-400 font-bold">{authError}</p>}
                  <button
                    type="submit"
                    disabled={authSubmitting || !authKeyInput.trim()}
                    className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 text-white transition-all border border-white/10 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>{authSubmitting ? 'Проверка...' : 'Разблокировать историю'}</span>
                  </button>
                </form>
              </div>
            ) : (
              <button
                onClick={fetchHistory}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-md shadow-indigo-500/20 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Повторить попытку</span>
              </button>
            )}
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center text-slate-400">
            <History className="w-10 h-10 mb-3 opacity-40 text-indigo-400" />
            <p className="text-sm font-bold">История диалогов пуста</p>
            <p className="text-xs max-w-sm mt-1 text-slate-500">
              {searchQuery ? 'По вашему поисковому запросу ничего не найдено.' : 'Сообщения из виджета по данному тикету сохраняются здесь автоматически.'}
            </p>
          </div>
        ) : (
          filteredMessages.map((msg, idx) => (
            <div 
              key={msg.id || idx}
              className={`p-5 rounded-2xl border transition-all ${
                darkMode ? 'bg-white/[0.03] border-white/10 hover:border-white/20' : 'bg-white border-slate-200 shadow-sm'
              }`}
            >
              {/* Header of message */}
              <div className="flex items-center justify-between gap-3 mb-3 pb-3 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400 text-xs font-bold">
                    #{filteredMessages.length - idx}
                  </div>
                  <span className="text-xs font-bold text-slate-300">
                    {msg.staffEmail || 'Оператор'}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {new Date(msg.timestamp).toLocaleString('ru-RU')}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCopyText(`full_${msg.id || idx}`, `${msg.userQuery ? `Запрос: ${msg.userQuery}\n\n` : ''}Ответ: ${msg.replyText}`)}
                    className="p-1.5 rounded-lg border border-white/10 hover:bg-white/10 text-slate-400 hover:text-white transition-all text-xs flex items-center gap-1"
                    title="Копировать диалог"
                  >
                    {copiedId === `full_${msg.id || idx}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span className="text-[10px] font-bold">Копировать</span>
                  </button>
                </div>
              </div>

              {/* Operator Question if present */}
              {msg.userQuery && (
                <div className="mb-3 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                  <div className="text-[10px] font-black uppercase tracking-wider text-indigo-400 mb-1 flex items-center gap-1.5">
                    <User className="w-3 h-3" />
                    <span>Вопрос оператора</span>
                  </div>
                  <div className="text-xs font-bold text-slate-200 leading-relaxed whitespace-pre-wrap">
                    {msg.userQuery}
                  </div>
                </div>
              )}

              {/* AI Reply */}
              <div className="mb-3">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
                  <Bot className="w-3 h-3 text-indigo-400" />
                  <span>Анализ и рекомендации</span>
                </div>
                <div className="text-xs font-medium text-slate-200 leading-relaxed whitespace-pre-wrap bg-black/20 p-3 rounded-xl border border-white/5">
                  {msg.replyText}
                </div>
              </div>

              {/* Customer Draft Suggestions if present */}
              {msg.suggestions && msg.suggestions.length > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="text-[10px] font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3" />
                    <span>Черновики ответов клиенту ({msg.suggestions.length})</span>
                  </div>
                  {msg.suggestions.map((s, sIdx) => (
                    <div 
                      key={s.id || sIdx}
                      className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 flex flex-col gap-2"
                    >
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="font-black text-emerald-400 uppercase tracking-widest">{s.type || 'Черновик'}</span>
                        <button
                          onClick={() => handleCopyText(`sugg_${msg.id}_${sIdx}`, s.text)}
                          className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-bold"
                        >
                          {copiedId === `sugg_${msg.id}_${sIdx}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          <span>Копировать</span>
                        </button>
                      </div>
                      <div className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">
                        {s.text}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Escalation proposal if present */}
              {msg.escalation && msg.escalation.required && (
                <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3" />
                      <span>Эскалационная заметка для Omnidesk</span>
                    </span>
                    {msg.escalation.notePushed && (
                      <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                        <Check className="w-3 h-3" /> Применена
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap font-mono text-[11px] bg-black/30 p-2 rounded-lg">
                    {msg.escalation.noteContent}
                  </div>
                </div>
              )}

              {/* Classification proposal if present */}
              {msg.classification && msg.classification.fields && Object.keys(msg.classification.fields).length > 0 && (
                <div className="mt-3 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
                  <div className="text-[10px] font-black uppercase tracking-wider text-blue-400 mb-2 flex items-center gap-1.5">
                    <Tag className="w-3 h-3" />
                    <span>Классификация тикета</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
                    {Object.entries(msg.classification.readable || msg.classification.fields).map(([k, v]) => (
                      <div key={k} className="bg-black/30 px-2 py-1 rounded-lg">
                        <span className="text-slate-400 font-bold">{k}:</span> <span className="text-slate-200">{v}</span>
                      </div>
                    ))}
                  </div>
                  {msg.classification.reasoning && (
                    <p className="mt-2 text-[10px] text-slate-400 italic">
                      💡 {msg.classification.reasoning}
                    </p>
                  )}
                </div>
              )}

              {/* Image analysis badges if any */}
              {((msg.imagesAnalyzed ?? 0) > 0 || (msg.imagesCached ?? 0) > 0) && (
                <div className="mt-3 flex items-center gap-2 text-[10px] font-bold text-slate-400">
                  <ImageIcon className="w-3.5 h-3.5 text-blue-400" />
                  <span>
                    Изображения: {msg.imagesAnalyzed || 0} проанализировано, {msg.imagesCached || 0} из кэша
                  </span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
