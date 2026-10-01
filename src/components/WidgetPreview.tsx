import React, { useState, useEffect } from 'react';
import { Send, Bot, User, CornerDownRight, Sparkles, Copy, ThumbsUp, ThumbsDown, Brain, Settings, ChevronDown, ChevronUp, Tag, Check, History, ExternalLink, AlertTriangle, X, BookOpen } from 'lucide-react';
import { Suggestion, AppSettings, EscalationInfo, ClassificationInfo } from '../types';
import { apiFetch, setSafeSessionItem, getSafeSessionItem, setSafeLocalItem, getSafeLocalItem } from '../lib/api';
import TicketHistoryView from './TicketHistoryView';

// Strips markdown characters so plain-text destinations like Omnidesk input fields don't get polluted
const stripMarkdown = (text: string): string => {
  if (!text) return '';
  return text
    // Remove :::writing{...} directives and :::
    .replace(/:::writing\{[^}]*\}[\r\n]*/gi, '')
    .replace(/:::[\w-]*[\r\n]*/gi, '')
    .replace(/[\r\n]*:::/g, '')
    // Remove code fences
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    // Remove internal notes / agent comments
    .replace(/^###\s*(?:Комментарий для сотрудника|Notes? for (?:You|Staff))[\s\S]*?(?=\n\n|\n[A-ZА-Я]|$)/gi, '')
    // Convert links [Text](URL) -> Text (URL) so links are preserved in plain text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    // Remove bold/italic formatting
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove inline code block
    .replace(/`([^`]+)`/g, '$1')
    // Remove headers (e.g. ### Header)
    .replace(/^(#{1,6})\s*(.+)$/gm, '$2')
    // Remove lists markers (e.g. * Item, - Item, but keep bullet structure)
    .replace(/^[-*+]\s+(.+)$/gm, '• $1')
    .trim();
};

const parseInlineStyles = (text: string) => {
  if (!text) return '';
  
  // Split by markdown links: [Text](URL)
  const linkParts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
  
  return linkParts.map((part, idx) => {
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const [_, linkText, linkUrl] = linkMatch;
      return (
        <a 
          key={idx} 
          href={linkUrl} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-indigo-500 dark:text-indigo-400 hover:underline font-extrabold"
        >
          {linkText}
        </a>
      );
    }
    
    const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
    return boldParts.map((bPart, bIdx) => {
      const key = `${idx}-${bIdx}`;
      if (bPart.startsWith('**') && bPart.endsWith('**')) {
        return <strong key={key} className="font-extrabold text-indigo-500 dark:text-indigo-400">{bPart.slice(2, -2)}</strong>;
      }
      
      const italicParts = bPart.split(/(\*[^*]+\*)/g);
      return italicParts.map((iPart, iIdx) => {
        const iKey = `${key}-${iIdx}`;
        if (iPart.startsWith('*') && iPart.endsWith('*')) {
          return <em key={iKey} className="italic">{iPart.slice(1, -1)}</em>;
        }
        return iPart;
      });
    });
  });
};

const renderSimpleMarkdown = (text: string) => {
  if (!text) return null;
  const cleaned = text
    .replace(/:::writing\{[^}]*\}[\r\n]*/gi, '')
    .replace(/:::[\w-]*[\r\n]*/gi, '')
    .replace(/[\r\n]*:::/g, '');
  const lines = cleaned.split('\n');
  return lines.map((line, idx) => {
    if (/^:::/.test(line.trim())) return null;
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const content = headerMatch[2];
      if (level === 1) return <h1 key={idx} className="text-lg font-black mt-3 mb-1.5">{parseInlineStyles(content)}</h1>;
      if (level === 2) return <h2 key={idx} className="text-base font-black mt-2.5 mb-1">{parseInlineStyles(content)}</h2>;
      return <h3 key={idx} className="text-sm font-black mt-2 mb-1">{parseInlineStyles(content)}</h3>;
    }

    const listMatch = line.match(/^[-*+]\s+(.+)$/);
    if (listMatch) {
      return (
        <div key={idx} className="flex gap-2 pl-2 my-1 align-top">
          <span className="text-indigo-500">•</span>
          <span>{parseInlineStyles(listMatch[1])}</span>
        </div>
      );
    }

    if (line.trim() === '') {
      return <div key={idx} className="h-2" />;
    }

    return (
      <p key={idx} className="my-1 text-sm font-bold leading-relaxed">
        {parseInlineStyles(line)}
      </p>
    );
  });
};

export function WidgetUI({ darkMode, t, settings }: { darkMode: boolean, t: any, settings?: AppSettings | null }) {
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [chatHistory, setChatHistory] = useState<{ 
    role: 'ai' | 'user'; 
    text: string; 
    suggestions?: Suggestion[]; 
    escalation?: EscalationInfo; 
    classification?: ClassificationInfo;
    imagesAnalyzed?: number; 
    imageFiles?: string[]; 
    imagesCached?: number; 
    cachedImageFiles?: string[]; 
  }[]>([]);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [fallbackInfo, setFallbackInfo] = useState<{model: string, used: boolean} | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [applyingEscalation, setApplyingEscalation] = useState(false);
  const [applyingClassification, setApplyingClassification] = useState(false);
  const [actionsExpanded, setActionsExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = getSafeLocalItem('omni_widget_actions_expanded');
      if (saved !== null) {
        return saved === 'true';
      }
    }
    return false;
  });

  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isCollapsed) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, loading, isCollapsed]);

  const [widgetSecret, setWidgetSecret] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('secret') || params.get('ws') || params.get('widget_secret') || getSafeSessionItem('omni_widget_secret') || getSafeLocalItem('omni_widget_secret') || '';
    }
    return '';
  });

  const [staffEmail, setStaffEmail] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('staff_email') || params.get('email') || getSafeSessionItem('omni_staff_email') || getSafeLocalItem('omni_staff_email') || '';
    }
    return '';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        const secret = params.get('secret') || params.get('ws') || params.get('widget_secret');
        const email = params.get('staff_email') || params.get('email');
        let changed = false;

        if (secret) {
          setWidgetSecret(secret);
          setSafeSessionItem('omni_widget_secret', secret);
          setSafeLocalItem('omni_widget_secret', secret);
          params.delete('secret');
          params.delete('ws');
          params.delete('widget_secret');
          changed = true;
        }
        if (email) {
          setStaffEmail(email);
          setSafeSessionItem('omni_staff_email', email);
          setSafeLocalItem('omni_staff_email', email);
          params.delete('staff_email');
          params.delete('email');
          changed = true;
        }

        if (changed) {
          try {
            const cleanPath = window.location.pathname.replace(/\/+/g, '/') || '/';
            const cleanSearch = params.toString();
            const newUrl = cleanPath + (cleanSearch ? `?${cleanSearch}` : '') + window.location.hash;
            window.history.replaceState({}, document.title, newUrl);
          } catch (e) {
            // Some iframe sandbox environments forbid replaceState
          }
        }
      } catch (err) {
        console.warn('Widget param init error:', err);
      }
    }
  }, []);

  const [caseNumber, setCaseNumber] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('case_number') || params.get('ticket_id') || 'OMNIDESK_ACTIVE_TICKET';
    }
    return 'OMNIDESK_ACTIVE_TICKET';
  });

  const [conversationSummary, setConversationSummary] = useState<{
    summaryText: string;
    messageCount: number;
    lastUpdatedAt?: string;
    hasDrafts?: boolean;
    lastDraft?: Suggestion;
    hasEscalation?: boolean;
  } | null>(null);
  const [summaryDismissed, setSummaryDismissed] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        if (event.data && (event.data.type === 'OMNIDESK_INIT' || event.data.type === 'OMNIDESK_AUTH_CONFIG')) {
          if (event.data.secret) {
            setWidgetSecret(event.data.secret);
            setSafeSessionItem('omni_widget_secret', event.data.secret);
            setSafeLocalItem('omni_widget_secret', event.data.secret);
          }
          if (event.data.staffEmail) {
            setStaffEmail(event.data.staffEmail);
            setSafeSessionItem('omni_staff_email', event.data.staffEmail);
            setSafeLocalItem('omni_staff_email', event.data.staffEmail);
          }
          const incomingTicket = event.data.caseNumber || event.data.caseId || event.data.ticketId;
          if (incomingTicket) {
            const cleanIncoming = String(incomingTicket).replace(/^[№#\s]+/, '').trim();
            if (cleanIncoming) {
              setCaseNumber(prev => {
                if (prev !== cleanIncoming) {
                  setHistoryLoaded(false);
                  return cleanIncoming;
                }
                return prev;
              });
            }
          }
        }
        if (event.data && (event.data.type === 'OMNIDESK_REQUEST_AUTH' || event.data.type === 'OMNIDESK_GET_CONFIG')) {
          const sec = widgetSecret || getSafeSessionItem('omni_widget_secret') || getSafeLocalItem('omni_widget_secret') || '';
          const email = staffEmail || getSafeSessionItem('omni_staff_email') || getSafeLocalItem('omni_staff_email') || '';
          const tok = getSafeSessionItem('admin_token') || getSafeLocalItem('admin_token') || '';
          if (event.source && typeof (event.source as any).postMessage === 'function') {
            (event.source as any).postMessage({
              type: 'OMNIDESK_PROVIDE_AUTH',
              secret: sec,
              staffEmail: email,
              adminToken: tok
            }, '*');
          }
        }
        if (event.data && event.data.type === 'OMNIDESK_DRAG_END') {
          setIsDragging(false);
          if (event.data.wasClick) {
            setIsCollapsed(prev => !prev);
          }
        }
      } catch (e) {
        console.warn('Widget message error:', e);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [widgetSecret, staffEmail]);

  // Expose credentials on window and broadcast across tabs/frames
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const getActiveAuth = () => ({
        secret: widgetSecret || getSafeSessionItem('omni_widget_secret') || getSafeLocalItem('omni_widget_secret') || '',
        staffEmail: staffEmail || getSafeSessionItem('omni_staff_email') || getSafeLocalItem('omni_staff_email') || '',
        adminToken: getSafeSessionItem('admin_token') || getSafeLocalItem('admin_token') || ''
      });

      (window as any).__OMNI_GET_AUTH__ = getActiveAuth;
      if (widgetSecret) {
        (window as any).__OMNI_WIDGET_SECRET = widgetSecret;
      }
      if (staffEmail) {
        (window as any).__OMNI_STAFF_EMAIL = staffEmail;
      }

      // Broadcast to any listening tabs/popups/windows via BroadcastChannel
      if ('BroadcastChannel' in window) {
        try {
          const ch = new BroadcastChannel('omniai_auth');
          const auth = getActiveAuth();
          if (auth.secret || auth.adminToken) {
            ch.postMessage({
              type: 'OMNIDESK_PROVIDE_AUTH',
              ...auth
            });
          }
          ch.close();
        } catch (e) {}
      }
    }
  }, [widgetSecret, staffEmail]);

  // Listen on BroadcastChannel for standalone windows requesting auth
  useEffect(() => {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        const ch = new BroadcastChannel('omniai_auth');
        ch.onmessage = (event) => {
          if (event.data && event.data.type === 'OMNIDESK_REQUEST_AUTH') {
            const sec = widgetSecret || getSafeSessionItem('omni_widget_secret') || getSafeLocalItem('omni_widget_secret') || '';
            const email = staffEmail || getSafeSessionItem('omni_staff_email') || getSafeLocalItem('omni_staff_email') || '';
            const tok = getSafeSessionItem('admin_token') || getSafeLocalItem('admin_token') || '';
            ch.postMessage({
              type: 'OMNIDESK_PROVIDE_AUTH',
              secret: sec,
              staffEmail: email,
              adminToken: tok
            });
          }
        };
        return () => {
          try { ch.close(); } catch (e) {}
        };
      } catch (e) {}
    }
  }, [widgetSecret, staffEmail]);

  // If secret is not known locally, attempt to auto-fetch from server config
  useEffect(() => {
    if (!widgetSecret) {
      apiFetch('/api/widget/config')
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.widgetSecret) {
            setWidgetSecret(data.widgetSecret);
            setSafeSessionItem('omni_widget_secret', data.widgetSecret);
            setSafeLocalItem('omni_widget_secret', data.widgetSecret);
          }
        })
        .catch(() => {});
    }
  }, [widgetSecret]);

  const [isStandalone] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.self === window.top;
    }
    return false;
  });

  const [classifying, setClassifying] = useState(false);
  const [classificationResult, setClassificationResult] = useState<{
    readable?: Record<string, string>;
    reasoning?: string;
    pushed?: boolean;
    error?: string;
  } | null>(null);

  const handleClassify = async () => {
    if (classifying) return;
    setClassifying(true);
    try {
      const res = await apiFetch(`/api/omnidesk/cases/${encodeURIComponent(caseNumber)}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true })
      });
      const data = await res.json();
      if (data.classified) {
        setClassificationResult({
          readable: data.readable,
          reasoning: data.reasoning,
          pushed: data.pushed,
          error: data.pushError
        });
      } else {
        setClassificationResult({
          error: data.message || data.error || 'Ошибка классификации'
        });
      }
    } catch (err: any) {
      setClassificationResult({ error: err.message });
    } finally {
      setClassifying(false);
    }
  };

  // Preload ticket history summary from server on ticket load
  useEffect(() => {
    if (caseNumber && !historyLoaded) {
      apiFetch(`/api/omnidesk/cases/${encodeURIComponent(caseNumber)}/history`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data && Array.isArray(data.messages) && data.messages.length > 0) {
            const lastMsg = data.messages[data.messages.length - 1];
            const lastDraft = lastMsg.suggestions && lastMsg.suggestions.length > 0 ? lastMsg.suggestions[0] : undefined;

            setConversationSummary({
              summaryText: data.summary || `Ранее по тикету проведено ${data.messages.length} диалогов с ассистентом.`,
              messageCount: data.messages.length,
              lastUpdatedAt: data.updatedAt,
              hasDrafts: Boolean(lastDraft),
              lastDraft,
              hasEscalation: Boolean(lastMsg.escalation?.required)
            });
            setSummaryDismissed(false);
          } else {
            setConversationSummary(null);
          }
          setHistoryLoaded(true);
        })
        .catch(err => {
          console.warn('Could not preload ticket conversation summary:', err);
          setHistoryLoaded(true);
        });
    }
  }, [caseNumber, historyLoaded]);

  const handleConfirmEscalationNote = async (content: string, msgIndex?: number) => {
    if (!content.trim() || applyingEscalation) return;
    setApplyingEscalation(true);
    try {
      const res = await apiFetch(`/api/omnidesk/cases/${encodeURIComponent(caseNumber)}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setChatHistory(prev => prev.map((msg, idx) => {
          if ((msgIndex !== undefined && idx === msgIndex) || (msg.escalation && msg.escalation.noteContent === content)) {
            return {
              ...msg,
              escalation: {
                ...msg.escalation!,
                notePushed: true,
                pendingConfirmation: false
              }
            };
          }
          return msg;
        }));
        alert('Заметка эскалации успешно добавлена в Omnidesk!');
      } else {
        alert(`Ошибка при добавлении заметки: ${data.error || 'Неизвестная ошибка'}`);
      }
    } catch (e: any) {
      alert(`Ошибка: ${e.message}`);
    } finally {
      setApplyingEscalation(false);
    }
  };

  const handleConfirmClassification = async (fields: Record<string, string>, msgIndex?: number) => {
    if (!fields || Object.keys(fields).length === 0 || applyingClassification) return;
    setApplyingClassification(true);
    try {
      const res = await apiFetch(`/api/omnidesk/cases/${encodeURIComponent(caseNumber)}/classify/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setChatHistory(prev => prev.map((msg, idx) => {
          if ((msgIndex !== undefined && idx === msgIndex) || (msg.classification && msg.classification.fields === fields)) {
            return {
              ...msg,
              classification: {
                ...msg.classification!,
                pushed: true,
                pendingConfirmation: false
              }
            };
          }
          return msg;
        }));
        alert('Классификация тикета успешно применена в Omnidesk!');
      } else {
        alert(`Ошибка при сохранении классификации: ${data.error || 'Неизвестная ошибка'}`);
      }
    } catch (e: any) {
      alert(`Ошибка: ${e.message}`);
    } finally {
      setApplyingClassification(false);
    }
  };

  // Messaging Bridge: Send content to Omnidesk Parent
  const applyDraft = async (text: string, target: 'message' | 'note' = 'message') => {
    let rawDraft = text || '';
    if (caseNumber && caseNumber !== 'OMNIDESK_ACTIVE_TICKET') {
      const cleanCase = caseNumber.replace(/^[№#\s]+/, '').trim();
      if (cleanCase) {
        const escapedCase = cleanCase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        rawDraft = rawDraft
          .replace(/(?:№|#)\s*\[?(?:номер\s+обращения|номер\s+тикета|номер\s+заявки|номер\s+кейса|номер|case_number|ticket_number|XXX-XXXXXX|\.{2,}|…|___+)\]?/gi, `#${cleanCase}`)
          .replace(/\[(?:номер\s+обращения|номер\s+тикета|номер\s+заявки|номер\s+кейса|case_number|ticket_number)\]/gi, `#${cleanCase}`)
          .replace(/\{(?:case_number|ticket_number)\}/gi, `#${cleanCase}`)
          .replace(/(обращени[яеюи]|тикет[аеу]|заявк[еуи])\s*(?:№|#)?\s*XXX-XXXXXX/gi, `$1 #${cleanCase}`)
          .replace(new RegExp(`(?:№|#)\\s*${escapedCase}`, 'gi'), `#${cleanCase}`)
          .replace(/[#№]\s*[#№]\s*/g, '#');
      }
    }
    const cleanText = stripMarkdown(rawDraft);
    const uniqueMessageId = Date.now() + '_' + Math.random().toString(36).substring(2, 11);

    // 1. Send postMessage for injection inside parent Omnidesk window.
    // SECURITY: this carries the actual drafted reply text, which can
    // include confidential ticket/customer content. Because this app's CSP
    // allows any site to <iframe> the widget unless omnidesk_domain is
    // configured, a targetOrigin of '*' would hand that content to whatever
    // page embedded us. Target the configured Omnidesk domain when we know
    // it, and only fall back to '*' when it isn't set (matches the server's
    // frame-ancestors fallback in server.ts).
    const trustedParentOrigin = settings?.omnidesk_domain
      ? `https://${settings.omnidesk_domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`
      : '*';
    if (typeof window !== 'undefined' && window.parent) {
      window.parent.postMessage({
        type: 'OMNIDESK_INJECT_RESPONSE',
        target: target,
        content: cleanText,
        messageId: uniqueMessageId
      }, trustedParentOrigin);
    }

    // Record the accept so the dashboard can compute acceptance rate. Fire-and-forget.
    apiFetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'suggestion_applied', metadata: { target } })
    }).catch(() => {});

    // 2. Clipboard fallback (still very helpful for support agents)
    let copied = false;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(cleanText);
        copied = true;
      }
    } catch (err) {
      console.warn('Failed to copy to clipboard:', err);
    }

    const btn = document.activeElement as HTMLElement;
    const originalText = btn ? btn.innerText : '';
    if (btn) {
      btn.innerText = target === 'message' 
        ? (copied ? 'Вставлено в ответ!' : 'Отправлено!') 
        : (copied ? 'Вставлено в заметку!' : 'Отправлено!');
      btn.style.pointerEvents = 'none';
      setTimeout(() => {
        btn.style.pointerEvents = 'auto';
        btn.innerText = originalText;
      }, 2000);
    }
  };

  const handleSend = async (manualText?: string) => {
    const messageText = manualText || input;
    if (!messageText.trim() && !manualText) return;

    setChatHistory(prev => [...prev, { role: 'user', text: messageText }]);
    if (!manualText) {
      setInput('');
    }

    setLoading(true);
    try {
      const response = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketContext: {
            id: caseNumber,
            case_number: caseNumber,
            description: "Context fetched from active Omnidesk ticket..."
          },
          history: chatHistory.length > 0
            ? chatHistory.map(h => ({ role: h.role === 'ai' ? 'assistant' : 'user', content: h.text }))
            : (conversationSummary ? [{ role: 'assistant', content: `[Саммари предыдущих диалогов по тикету]: ${conversationSummary.summaryText}` }] : []),
          userQuery: messageText
        })
      });
      const data = await response.json();
      
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Ошибка авторизации (401): секрет виджета не передан или неверен');
        }
        if (response.status === 403) {
          throw new Error(data.error || 'Доступ к тикету ограничен или тикет не найден (403 Forbidden)');
        }
        throw new Error(data.error || 'Server error');
      }

      if (data.fallback_used) {
        setFallbackInfo({ model: data.actual_model, used: true });
        // Auto-clear after 10 seconds
        setTimeout(() => setFallbackInfo(null), 10000);
      } else {
        setFallbackInfo(null);
      }

      if (data.classification) {
        setClassificationResult({
          readable: data.classification.readable,
          reasoning: data.classification.reasoning,
          pushed: data.classification.pushed,
          error: data.classification.pushError
        });
      }

      if (data.case_number && data.case_number !== 'OMNIDESK_ACTIVE_TICKET') {
        setCaseNumber(prev => (prev !== data.case_number ? data.case_number : prev));
      }

      const imagesAnalyzed = data.images_analyzed || 0;
      const imageFiles: string[] = data.image_files || [];
      const imagesCached = data.images_cached || 0;
      const cachedImageFiles: string[] = data.cached_image_files || [];

      setChatHistory(prev => [...prev, { 
        role: 'ai', 
        text: data.reply || 'Вот мои рекомендации по этому тикету:',
        suggestions: data.suggestions || [],
        escalation: data.escalation || undefined,
        classification: data.classification || undefined,
        imagesAnalyzed,
        imageFiles,
        imagesCached,
        cachedImageFiles
      }]);
    } catch (error: any) {
      console.error(error);
      setChatHistory(prev => [...prev, {
        role: 'ai',
        text: `Error: ${error.message}. Please check your API key and server settings.`
      }]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (typeof window !== 'undefined' && window.parent && !isStandalone) {
        window.parent.postMessage({ type: 'OMNIDESK_DRAG_END' }, '*');
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [isStandalone]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.parent && !isStandalone) {
      window.parent.postMessage({
        type: 'OMNIDESK_RESIZE_WIDGET',
        isCollapsed: isCollapsed
      }, '*');
    }
  }, [isCollapsed, isStandalone]);

  const content = (
    <div className={`h-full w-full p-4 rounded-2xl border transition-all flex flex-col box-border ${
      darkMode 
        ? 'border-indigo-500/30 bg-slate-900 shadow-2xl' 
        : 'border-indigo-100 bg-white shadow-2xl shadow-indigo-500/10'
    }`}>
        <div 
          className={`flex items-center justify-between shrink-0 cursor-grab active:cursor-grabbing select-none ${isCollapsed ? '' : 'mb-3'}`}
          onMouseDown={(e) => {
            // Only initiate drag if left clicking and not clicking a button or link
            if (e.button !== 0) return;
            const target = e.target as HTMLElement;
            if (target.closest('button') || target.closest('a')) return;
            
            setIsDragging(true);

            if (typeof window !== 'undefined' && window.parent && !isStandalone) {
              window.parent.postMessage({
                type: 'OMNIDESK_DRAG_START',
                clientX: e.clientX,
                clientY: e.clientY
              }, '*');
            }
          }}
          onClick={(e) => {
            if (isStandalone) {
              const target = e.target as HTMLElement;
              if (target.closest('button') || target.closest('a')) return;
              setIsCollapsed(prev => !prev);
            }
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1 pointer-events-none">
             <div className="w-9 h-9 rounded-xl bg-indigo-500 flex items-center justify-center shadow-md shadow-indigo-500/40 pointer-events-auto shrink-0">
                <Brain className="w-4 h-4 text-white" />
             </div>
             <div className="min-w-0 flex-1 pointer-events-auto">
                <div className="flex items-center gap-1.5 min-w-0">
                  <h3 className={`font-black text-sm sm:text-base italic tracking-tight leading-none truncate ${darkMode ? 'text-white' : 'text-slate-900'}`}>
                    {t.ai_assistant}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5 mt-1 min-w-0">
                   <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shrink-0" />
                   <span className="text-[8px] font-black uppercase text-slate-500 tracking-widest shrink-0">Active Sync</span>
                   {fallbackInfo?.used && (
                     <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[8px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 animate-pulse shrink-0 truncate max-w-[90px]">
                       ⚡ {fallbackInfo.model}
                     </span>
                   )}
                </div>
             </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 pointer-events-auto">
            <button 
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsCollapsed(!isCollapsed);
              }} 
              title={isCollapsed ? "Развернуть виджет" : "Свернуть виджет"}
              className={`p-2 rounded-xl border transition-colors inline-flex shrink-0 ${darkMode ? 'border-white/10 hover:bg-white/5 text-slate-400' : 'border-slate-100 hover:bg-slate-50 text-slate-500'}`}
            >
               {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            <a 
              href="/" 
              target="_blank" 
              rel="noopener noreferrer" 
              title="Настройки" 
              className={`p-2 rounded-xl border transition-colors inline-flex shrink-0 ${darkMode ? 'border-white/10 hover:bg-white/5 text-slate-400' : 'border-slate-100 hover:bg-slate-50 text-slate-500'}`}
            >
               <Settings className="w-4 h-4" />
            </a>
          </div>
        </div>

        {!isCollapsed && (
          <>
            {/* Панель быстрых действий по тикету ("под кат") */}
            <div className={`shrink-0 mb-2 rounded-2xl border transition-all overflow-hidden ${
              darkMode 
                ? 'bg-slate-800/40 border-white/10 hover:border-white/15' 
                : 'bg-slate-50 border-slate-200/80 hover:border-slate-300 shadow-xs'
            }`}>
              <div 
                onClick={() => setActionsExpanded(prev => {
                  const next = !prev;
                  setSafeLocalItem('omni_widget_actions_expanded', String(next));
                  return next;
                })}
                className="flex items-center justify-between px-3 py-2 cursor-pointer select-none transition-colors"
                title={actionsExpanded ? 'Свернуть панель действий' : 'Развернуть панель действий'}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-5 h-5 rounded-lg flex items-center justify-center shrink-0 ${
                    darkMode ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-50 text-indigo-600'
                  }`}>
                    <Sparkles className="w-3 h-3" />
                  </div>
                  <span className={`text-xs font-black tracking-tight truncate ${darkMode ? 'text-slate-200' : 'text-slate-800'}`}>
                    Действия с тикетом
                  </span>
                  {(conversationSummary?.messageCount ?? 0) > 0 && !actionsExpanded && (
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-indigo-500 text-white shrink-0">
                      {conversationSummary?.messageCount}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActionsExpanded(prev => {
                      const next = !prev;
                      setSafeLocalItem('omni_widget_actions_expanded', String(next));
                      return next;
                    });
                  }}
                  className="flex items-center gap-1 text-[11px] font-bold text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 shrink-0"
                >
                  <span>{actionsExpanded ? 'Свернуть' : 'Развернуть'}</span>
                  {actionsExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              </div>

              {actionsExpanded && (
                <div className="px-3.5 pb-3 pt-1 border-t border-slate-200/60 dark:border-white/5 space-y-1.5">
                  <button
                    onClick={() => handleSend('Проанализируй тикет и подготовь черновик ответа клиенту.')}
                    disabled={loading}
                    title="Анализировать тикет и подготовить черновик ответа"
                    className={`w-full px-3 py-2 rounded-xl border transition-all flex items-center justify-between gap-2 text-xs font-bold ${
                      loading 
                        ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400 animate-pulse'
                        : darkMode 
                          ? 'bg-indigo-500/10 border-indigo-500/20 hover:bg-indigo-500/25 text-indigo-300 hover:text-white' 
                          : 'bg-indigo-50 border-indigo-200/70 hover:bg-indigo-100/80 text-indigo-700 shadow-2xs'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Sparkles className={`w-3.5 h-3.5 shrink-0 ${loading ? 'animate-spin text-indigo-400' : 'text-indigo-500'}`} />
                      <span className="truncate">{loading ? 'Анализирую...' : 'Анализировать тикет'}</span>
                    </div>
                    <span className="text-[10px] font-medium text-indigo-400/80 shrink-0">Черновик</span>
                  </button>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={handleClassify}
                      disabled={classifying}
                      title="Автоклассификация тикета в Omnidesk"
                      className={`px-2.5 py-2 rounded-xl border transition-all flex items-center justify-center gap-1.5 text-xs font-bold ${
                        classifying 
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-400 animate-pulse'
                          : darkMode 
                            ? 'bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/25 text-amber-300 hover:text-white' 
                            : 'bg-amber-50 border-amber-200/70 hover:bg-amber-100/80 text-amber-700 shadow-2xs'
                      }`}
                    >
                      <Tag className={`w-3.5 h-3.5 shrink-0 ${classifying ? 'animate-spin text-amber-400' : 'text-amber-500'}`} />
                      <span className="truncate">{classifying ? 'Классифицирую...' : 'Классификация'}</span>
                    </button>

                    <button
                      onClick={() => setShowHistoryModal(true)}
                      title="История диалогов по тикету"
                      className={`px-2.5 py-2 rounded-xl border transition-all flex items-center justify-center gap-1.5 text-xs font-bold ${
                        darkMode 
                          ? 'bg-white/5 border-white/10 hover:bg-white/10 text-slate-300 hover:text-white' 
                          : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700 shadow-2xs'
                      }`}
                    >
                      <History className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                      <span className="truncate">История</span>
                      {(conversationSummary?.messageCount ?? 0) > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-indigo-500 text-white shrink-0 leading-none">
                          {conversationSummary?.messageCount}
                        </span>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1.5 space-y-2.5 mb-2">
            {classificationResult && (
              <div className={`p-3 rounded-2xl border text-xs ${
                classificationResult.error
                  ? 'bg-red-500/10 border-red-500/30 text-red-400'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              }`}>
                <div className="flex items-center justify-between font-bold mb-1.5">
                  <span className="flex items-center gap-1.5">
                    {classificationResult.error ? '⚠️' : <Check className="w-3.5 h-3.5" />}
                    {classificationResult.error ? 'Ошибка классификации' : (classificationResult.pushed ? 'Тикет классифицирован в Omnidesk' : 'Классификация определена')}
                  </span>
                  <button 
                    onClick={() => setClassificationResult(null)}
                    className="opacity-60 hover:opacity-100 text-[10px]"
                  >
                    ✕
                  </button>
                </div>
                {classificationResult.readable && (
                  <div className="grid grid-cols-1 gap-1.5 mt-2 font-medium text-[11px] text-slate-300 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                    {Object.entries(classificationResult.readable).map(([key, val]) => (
                      <div key={key} className="bg-black/30 px-2 py-1 rounded-lg">
                        <span className="text-slate-400 font-bold">{key}:</span> {val}
                      </div>
                    ))}
                  </div>
                )}
                {classificationResult.reasoning && (
                  <p className="mt-2 text-[10px] text-slate-400 italic">
                    💡 {classificationResult.reasoning}
                  </p>
                )}
                {classificationResult.error && (
                  <p className="mt-1 text-[11px] text-red-300">{classificationResult.error}</p>
                )}
              </div>
            )}

            {conversationSummary && !summaryDismissed && (
              <div className={`p-3 rounded-2xl border transition-all ${
                darkMode 
                  ? 'bg-gradient-to-br from-indigo-950/40 via-slate-900 to-indigo-900/20 border-indigo-500/30 text-slate-200 shadow-md' 
                  : 'bg-gradient-to-br from-indigo-50 via-white to-indigo-50/50 border-indigo-200 text-slate-800 shadow-sm'
              }`}>
                <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-indigo-500/15">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
                      <BookOpen className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-black tracking-tight truncate">Саммари диалога</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 shrink-0">
                      {conversationSummary.messageCount} {conversationSummary.messageCount === 1 ? 'запись' : (conversationSummary.messageCount < 5 ? 'записи' : 'записей')}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => setShowHistoryModal(true)}
                      title="Открыть всю историю переписки"
                      className="px-2.5 py-1 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-400 hover:text-indigo-300 font-bold text-[11px] transition-all flex items-center gap-1"
                    >
                      <History className="w-3 h-3" />
                      <span>Вся история</span>
                    </button>
                    <button
                      onClick={() => setSummaryDismissed(true)}
                      title="Скрыть саммари"
                      className="p-1 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 opacity-60 hover:opacity-100 transition-all text-slate-400"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <p className="text-[11px] sm:text-xs leading-relaxed font-medium text-slate-300">
                  {conversationSummary.summaryText}
                </p>

                {conversationSummary.lastDraft && (
                  <div className="mt-2.5 pt-2 border-t border-indigo-500/10 flex items-center justify-between gap-2">
                    <div className="text-[11px] text-emerald-400 font-bold flex items-center gap-1.5 truncate">
                      <Sparkles className="w-3 h-3 shrink-0" />
                      <span className="truncate">Есть черновик ответа: «{conversationSummary.lastDraft.title || 'Черновик'}»</span>
                    </div>
                    <button
                      onClick={() => setShowHistoryModal(true)}
                      className="text-[11px] text-emerald-400 hover:text-emerald-300 font-bold underline shrink-0 cursor-pointer"
                    >
                      Посмотреть
                    </button>
                  </div>
                )}
              </div>
            )}

            {chatHistory.length === 0 && !loading && !conversationSummary && (
              <div className="py-6 flex flex-col items-center justify-center text-center px-4">
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center mb-3 shadow-xs ${
                  darkMode ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'bg-indigo-50 text-indigo-600 border border-indigo-100'
                }`}>
                  <Sparkles className="w-5 h-5" />
                </div>
                <h4 className={`text-sm font-black mb-1 ${darkMode ? 'text-white' : 'text-slate-800'}`}>
                  Готов к анализу тикета
                </h4>
                <p className={`text-xs max-w-xs mb-3.5 font-medium leading-relaxed ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  Нажмите кнопку для анализа и подготовки черновика ответа или напишите свой вопрос ниже.
                </p>
                <button
                  onClick={() => handleSend('Проанализируй тикет и подготовь черновик ответа клиенту.')}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5 hover:scale-[1.02] active:scale-95"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Анализировать тикет</span>
                </button>
              </div>
            )}
            {chatHistory.map((msg, i) => (
              <div 
                key={i} 
                className={`flex flex-col transition-all duration-300 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                {(msg.imagesAnalyzed ?? 0) > 0 && (
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold mb-2 ${
                    darkMode ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-blue-50 text-blue-700 border border-blue-100'
                  }`}>
                    🖼️ Проанализировано {msg.imagesAnalyzed} {msg.imagesAnalyzed === 1 ? 'изображение' : (msg.imagesAnalyzed ?? 0) < 5 ? 'изображения' : 'изображений'}
                    <span className="text-[10px] font-medium opacity-70 ml-1">
                      ({(msg.imageFiles || []).join(', ')})
                    </span>
                  </div>
                )}
                {(msg.imagesAnalyzed ?? 0) === 0 && (msg.imagesCached ?? 0) > 0 && (
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold mb-2 ${
                    darkMode ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                  }`}>
                    💾 Использовано {msg.imagesCached} {msg.imagesCached === 1 ? 'изображение' : (msg.imagesCached ?? 0) < 5 ? 'изображения' : 'изображений'} из кэша
                    {(msg.cachedImageFiles && msg.cachedImageFiles.length > 0) && (
                      <span className="text-[10px] font-medium opacity-70 ml-1">
                        ({msg.cachedImageFiles.join(', ')})
                      </span>
                    )}
                  </div>
                )}
                <div className={`max-w-[88%] p-3.5 rounded-2xl text-xs sm:text-sm font-bold leading-relaxed break-words select-text ${
                  msg.role === 'user' 
                    ? (darkMode ? 'bg-indigo-600 text-white' : 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20')
                    : (darkMode ? 'bg-white/5 border border-white/10 text-slate-200' : 'bg-slate-50 border border-slate-100 text-slate-900')
                }`}>
                  {msg.role === 'user' ? msg.text : renderSimpleMarkdown(msg.text)}
                </div>

                {msg.escalation?.required && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {msg.escalation.notePushed ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-sm">
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        Заметка эскалации сохранена в Omnidesk
                      </span>
                    ) : msg.escalation.noteError ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                        ⚠️ Не удалось сохранить заметку эскалации: {msg.escalation.noteError}
                      </span>
                    ) : null}
                  </div>
                )}
                
                {msg.suggestions && msg.suggestions.length > 0 && (
                  <div className="mt-3 w-full space-y-2.5">
                    {msg.suggestions.map((s, si) => (
                      <div 
                        key={si}
                        className={`p-3 rounded-xl border transition-all ${darkMode ? 'bg-black/40 border-white/10 hover:border-indigo-500/50' : 'bg-white border-slate-200 hover:border-indigo-500/50 shadow-xs'}`}
                      >
                         <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] font-black uppercase tracking-widest text-indigo-500">{s.type}</span>
                            <span className="text-[9px] font-bold text-slate-500 opacity-50">{s.confidence}% Match</span>
                         </div>
                         <div className={`text-xs font-bold leading-relaxed mb-2.5 break-words select-text ${darkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                           {renderSimpleMarkdown(s.text)}
                         </div>
                         <div className="flex gap-2">
                           <button 
                             onClick={() => applyDraft(s.text, 'message')}
                             className="flex-1 py-1.5 bg-indigo-600/10 hover:bg-indigo-600 hover:text-white border border-indigo-500/20 text-indigo-500 dark:text-indigo-400 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all"
                           >
                             {'Вставить в ответ'}
                           </button>
                           <button 
                             onClick={() => applyDraft(s.text, 'note')}
                             className="flex-1 py-1.5 bg-emerald-600/10 hover:bg-emerald-600 hover:text-white border border-emerald-500/20 text-emerald-500 dark:text-emerald-400 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all"
                           >
                             {'Вставить в заметку'}
                           </button>
                         </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          {loading && (
            <div className="flex gap-2 p-4">
              <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
              <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
              <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="shrink-0 relative flex flex-col gap-1.5 pt-1.5 border-t border-slate-200/60 dark:border-white/5">
          <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
             {(() => {
               try {
                 const actions = settings?.quick_actions ? JSON.parse(settings.quick_actions) : null;
                 return (actions || [
                   { icon: '📊', ru: 'Анализ кейса', en: 'Analyze Case', prompt: 'Проанализируй этот тикет и дай краткую сводку.' },
                   { icon: '❓', ru: 'Что запросить', en: 'What to ask', prompt: 'Что еще нужно запросить у клиента для решения вопроса?' },
                   { icon: '✂️', ru: 'Сократить', en: 'Shorten', prompt: 'Сократи предложенный ответ, сделай его более лаконичным.' },
                   { icon: '📝', ru: 'Формально', en: 'Formal', prompt: 'Перепиши ответ в более формальном и деловом стиле.' },
                   { icon: '🌐', ru: 'На English', en: 'To English', prompt: 'Переведи ответ на английский язык.' },
                   { icon: '💡', ru: 'Просто', en: 'Simple', prompt: 'Объясни решение простыми словами, без сложных терминов.' }
                 ]).map((action: any, i: number) => (
                    <button 
                      key={i}
                      onClick={() => handleSend(action.prompt || (action.ru))}
                      className={`flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-colors shrink-0 ${
                        darkMode 
                          ? 'bg-white/5 border-white/10 hover:bg-white/10 text-slate-300' 
                          : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-600 shadow-2xs'
                      }`}
                    >
                      <span className="text-xs">{action.icon}</span>
                      <span>{action.ru}</span>
                    </button>
                 ));
               } catch (e) {
                 return <div className="text-red-500 text-xs">Invalid Quick Actions JSON</div>;
               }
             })()}
          </div>
          <div className="relative">
            <input 
              type="text" 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={'Спросить ИИ...'}
              className={`w-full py-2.5 px-3.5 pr-11 rounded-xl border outline-none transition-all font-bold text-xs sm:text-sm ${
                darkMode 
                  ? 'bg-black/40 border-white/10 focus:border-indigo-500/50 text-white placeholder:text-slate-600' 
                  : 'bg-slate-50 border-slate-200 focus:border-indigo-500/50 text-slate-900 placeholder:text-slate-400'
              }`}
            />
            <button 
              onClick={() => handleSend()}
              disabled={loading}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow-md shadow-indigo-600/30 transition-all disabled:opacity-50 active:scale-95"
            >
              {loading ? <Sparkles className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        </>
        )}

        {showHistoryModal && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setShowHistoryModal(false)}
          >
            <div 
              className={`w-full max-w-2xl h-[92vh] max-h-[720px] rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl border flex flex-col ${
                darkMode ? 'bg-slate-900 border-white/10' : 'bg-white border-slate-200'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <TicketHistoryView 
                caseNumber={caseNumber}
                darkMode={darkMode}
                onClose={() => setShowHistoryModal(false)}
                widgetSecret={widgetSecret}
                staffEmail={staffEmail}
                adminToken={getSafeSessionItem('admin_token') || getSafeLocalItem('admin_token') || undefined}
              />
            </div>
          </div>
        )}
    </div>
  );

  if (isStandalone) {
    return (
      <div className={`min-h-screen ${darkMode ? 'bg-[#09090b]' : 'bg-slate-50'} flex flex-col items-center p-4`}>
        <div className="w-full max-w-[400px] mb-3">
          <div className={`p-3 rounded-xl text-xs ${darkMode ? 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/30' : 'bg-indigo-50 text-indigo-700 border border-indigo-200'}`}>
            <p className="font-bold mb-0.5">Режим отладки (Standalone)</p>
            <p className="text-[11px] opacity-80 leading-relaxed">Виджет открыт вне Omnidesk по прямой ссылке. При нажатии «Вставить в ответ» текст будет скопирован в буфер обмена.</p>
          </div>
        </div>
        <div className={`w-full max-w-[400px] transition-all duration-200 ${isCollapsed ? 'h-[84px]' : 'h-[620px] max-h-[calc(100vh-140px)]'}`}>
          {content}
        </div>
      </div>
    );
  }

  return content;
}

export default function WidgetPreview({ darkMode, t, settings }: { darkMode: boolean, t: any, settings?: AppSettings | null }) {
  const [messages, setMessages] = useState<any[]>([
    { role: 'user', text: 'Здравствуйте! Пытаюсь войти в свой аккаунт, но кнопка "Войти" не нажимается. Пробовал в разных браузерах.' },
    { role: 'agent', text: 'Добрый день! Пожалуйста, очистите кэш вашего браузера и попробуйте еще раз.' },
    { role: 'user', text: 'Кэш очистил, проблема осталась. Также не вижу ссылку на сброс пароля.' },
  ]);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeDraftTab, setActiveDraftTab] = useState<'reply' | 'note'>('reply');
  const [replyDraft, setReplyDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');

  // Intercept the postMessage call from the widget within the same window to simulate Omnidesk's side
  useEffect(() => {
    const handleMessageInPreview = (event: MessageEvent) => {
      if (event.data && event.data.type === 'OMNIDESK_INJECT_RESPONSE') {
        const { target, content } = event.data;
        if (target === 'note') {
          setNoteDraft(prev => (prev ? prev + '\n\n' : '') + content);
          setActiveDraftTab('note');
        } else {
          setReplyDraft(prev => (prev ? prev + '\n\n' : '') + content);
          setActiveDraftTab('reply');
        }
      }
    };
    window.addEventListener('message', handleMessageInPreview);
    return () => window.removeEventListener('message', handleMessageInPreview);
  }, []);

  const [caseNumber] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('case_number') || params.get('ticket_id') || '#4820';
    }
    return '#4820';
  });

  const generateSuggestions = async () => {
    setLoading(true);
    try {
      const response = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketContext: {
            id: caseNumber,
            case_number: caseNumber,
            subject: 'Login Button Unresponsive',
            status: 'Open',
            priority: 'High',
            description: messages.map(m => `${m.role.toUpperCase()}: ${m.text}`).join('\n')
          },
          history: messages
        })
      });
      const data = await response.json();
      setSuggestions(data.suggestions);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col xl:flex-row gap-10 min-h-[calc(100vh-14rem)] h-auto xl:h-[calc(100vh-14rem)]">
      {/* Mock Omnidesk Ticket Surface */}
      <div className={`flex-1 p-10 rounded-[2.5rem] border transition-all flex flex-col ${darkMode ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white shadow-2xl shadow-slate-200/50'}`}>
        <div className="flex flex-wrap items-center justify-between gap-6 mb-10">
          <div className="flex items-center gap-6">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border ${darkMode ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-indigo-50 border-indigo-100 shadow-sm'}`}>
              <User className="w-7 h-7 text-indigo-500" />
            </div>
            <div>
               <h3 className={`font-black text-2xl italic tracking-tight ${darkMode ? 'text-white' : 'text-slate-900'}`}>
                 {'Проблема с кнопкой входа'}
               </h3>
               <div className="flex flex-wrap items-center gap-3 mt-1.5">
                  <span className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em]">Ticket {caseNumber}</span>
                  <span className="w-1 h-1 bg-slate-500 rounded-full opacity-30" />
                  <span className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em]">isbuteev@gmail.com</span>
                  <span className="w-1 h-1 bg-slate-500 rounded-full opacity-30" />
                  <span className="text-[10px] font-black uppercase text-emerald-500 tracking-[0.2em]">Status: Open</span>
               </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <div className={`px-5 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-[0.2em] ${darkMode ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' : 'bg-indigo-50 border-indigo-100 text-indigo-600 shadow-sm'}`}>Tech Support</div>
             <div className={`px-5 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-[0.2em] ${darkMode ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-red-50 border-red-100 text-red-600'}`}>High Priority</div>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-8 mb-8 pr-4 custom-scrollbar">
          {messages.map((msg, idx) => {
            const isAgent = msg.role === 'agent';
            const isNote = msg.role === 'note';
            
            let cardBg = '';
            let labelText = '';
            let labelColor = 'text-slate-500';
            let iconBox = null;

            if (isAgent) {
              cardBg = darkMode ? 'bg-indigo-500/5 border-indigo-500/10' : 'bg-indigo-50/30 border-indigo-100/50';
              labelText = 'Support Agent';
              iconBox = (
                <div className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center border ${darkMode ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' : 'bg-indigo-50 border-indigo-100 text-indigo-600'}`}>
                  <Bot className="w-5 h-5" />
                </div>
              );
            } else if (isNote) {
              cardBg = darkMode ? 'bg-amber-500/5 border-amber-500/20' : 'bg-amber-50/40 border-amber-200/50';
              labelText = 'Internal Note';
              labelColor = 'text-amber-500';
              iconBox = (
                <div className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center border ${darkMode ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-amber-50 border-amber-100 text-amber-600'}`}>
                  <Bot className="w-5 h-5 text-amber-500" />
                </div>
              );
            } else {
              cardBg = darkMode ? 'bg-black/20 border-white/5' : 'bg-slate-50 border-slate-100';
              labelText = 'Customer Account';
              iconBox = (
                <div className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center border ${darkMode ? 'bg-slate-800 border-white/5 text-slate-400' : 'bg-slate-100 border-slate-200 text-slate-500'}`}>
                  <User className="w-5 h-5" />
                </div>
              );
            }

            return (
              <div key={idx} className={`flex gap-6 ${isAgent ? 'flex-row-reverse' : ''}`}>
                 {iconBox}
                 <div className={`flex-1 p-6 rounded-3xl border transition-all ${cardBg}`}>
                    <div className="flex items-center justify-between mb-3">
                       <span className={`text-[9px] font-black uppercase tracking-[0.2em] ${labelColor}`}>{labelText}</span>
                       <span className="text-[9px] font-bold text-slate-500 opacity-50">12:45 PM</span>
                    </div>
                    <p className={`text-sm font-bold leading-relaxed whitespace-pre-line ${darkMode ? 'text-slate-300' : 'text-slate-900'}`}>{msg.text}</p>
                 </div>
              </div>
            );
          })}
        </div>
        
        <div className="flex flex-col gap-6">
          <div className={`p-6 rounded-3xl border transition-all ${darkMode ? 'bg-black/40 border-white/5' : 'bg-slate-50 border-slate-100 shadow-inner'}`}>
             <div className="flex items-center justify-between gap-2 mb-4 border-b border-slate-500/10 pb-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => setActiveDraftTab('reply')}
                    className={`px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all border ${activeDraftTab === 'reply' ? (darkMode ? 'bg-indigo-600/20 border-indigo-500/30 text-indigo-400' : 'bg-indigo-50 border-indigo-100 text-indigo-600') : (darkMode ? 'border-transparent text-slate-500 hover:text-slate-300' : 'border-transparent text-slate-400 hover:text-slate-600')}`}
                  >
                    Ответ клиенту
                  </button>
                  <button
                    onClick={() => setActiveDraftTab('note')}
                    className={`px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all border ${activeDraftTab === 'note' ? (darkMode ? 'bg-emerald-600/20 border-emerald-500/30 text-emerald-400' : 'bg-emerald-50 border-emerald-100 text-emerald-600') : (darkMode ? 'border-transparent text-slate-500 hover:text-slate-300' : 'border-transparent text-slate-400 hover:text-slate-600')}`}
                  >
                    Внутренняя заметка
                  </button>
                </div>
             </div>
             
             <div className="flex gap-4">
                {activeDraftTab === 'reply' ? (
                  <textarea 
                    value={replyDraft}
                    onChange={(e) => setReplyDraft(e.target.value)}
                    className={`flex-1 bg-transparent border-none outline-none resize-none text-sm leading-relaxed font-bold ${darkMode ? 'text-slate-300 placeholder:text-slate-600' : 'text-slate-900 placeholder:text-slate-400'}`}
                    placeholder={'Напишите ответ клиенту или вставьте ответ из OmniAI...'}
                    rows={3}
                  />
                ) : (
                  <textarea 
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    className={`flex-1 bg-transparent border-none outline-none resize-none text-sm leading-relaxed font-bold ${darkMode ? 'text-slate-300 placeholder:text-slate-600' : 'text-slate-900 placeholder:text-slate-400'}`}
                    placeholder={'Добавьте внутреннюю заметку или вставьте рекомендации из OmniAI...'}
                    rows={3}
                  />
                )}
                <div className="flex flex-col gap-2 self-end">
                   <button 
                     onClick={() => {
                       if (activeDraftTab === 'reply') {
                         if (!replyDraft.trim()) return;
                         setMessages(prev => [...prev, { role: 'agent', text: replyDraft }]);
                         apiFetch(`/api/omnidesk/cases/${caseNumber}/messages`, {
                           method: 'POST',
                           headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify({ content: replyDraft })
                         }).catch(err => console.error('Error sending message:', err));
                         setReplyDraft('');
                       } else {
                         if (!noteDraft.trim()) return;
                         setMessages(prev => [...prev, { role: 'note', text: noteDraft }]);
                         apiFetch(`/api/omnidesk/cases/${caseNumber}/notes`, {
                           method: 'POST',
                           headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify({ content: noteDraft })
                         }).catch(err => console.error('Error sending note:', err));
                         setNoteDraft('');
                       }
                     }}
                     className={`p-4 rounded-2xl text-white transition-all shadow-lg active:scale-95 ${activeDraftTab === 'reply' ? 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30' : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/30'}`}
                   >
                      <Send className="w-5 h-5" />
                   </button>
                </div>
             </div>
          </div>

          <button 
            onClick={generateSuggestions}
            disabled={loading}
            className="w-full py-5 bg-indigo-600/10 hover:bg-indigo-500 hover:text-white border border-indigo-500/20 text-indigo-400 rounded-2xl font-black text-xs flex items-center justify-center gap-3 transition-all uppercase tracking-[0.2em] active:scale-95 disabled:opacity-50"
          >
            {loading ? <div className="w-5 h-5 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" /> : <Sparkles className="w-5 h-5" />}
            {t.generate_rec}
          </button>
          <div className="text-[9px] font-bold text-slate-500 text-center opacity-40 uppercase tracking-[0.1em]">
            Tip: AI suggestions can be directly injected into the reply box
          </div>
        </div>
      </div>

      {/* Widget UI */}
      <div className={`w-full xl:w-[400px] rounded-[3rem] border transition-all flex flex-col overflow-hidden backdrop-blur-2xl shadow-2xl ${darkMode ? 'border-white/10 bg-black/60 shadow-indigo-500/10' : 'border-slate-200 bg-white shadow-slate-200/50'}`}>
        <div className="p-6 bg-indigo-600 text-white flex items-center gap-4 relative">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/50 to-transparent pointer-events-none" />
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-sm shadow-inner relative z-10">
            <Bot className="w-6 h-6" />
          </div>
          <div className="flex flex-col relative z-10">
            <span className="font-black text-sm tracking-tight">OmniAI Assistant</span>
            <span className="text-[9px] opacity-70 uppercase tracking-[0.2em] font-black">Model v3.5-flash</span>
          </div>
          <div className="ml-auto relative z-10">
             <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_8px_#34d399]" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="space-y-6">
            {suggestions.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center h-full text-center px-10">
                <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-8 border-2 ${darkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-100 shadow-xl shadow-slate-200/50'}`}>
                  <Sparkles className={`w-10 h-10 ${darkMode ? 'text-indigo-500/20' : 'text-indigo-600/30'}`} />
                </div>
                <p className="text-[10px] uppercase tracking-[0.3em] font-black text-slate-500 opacity-60">Scanning Knowledge Base...</p>
              </div>
            )}

            {loading && (
              <div className="space-y-6">
                {[1,2,3].map(i => (
                  <div key={i} className={`animate-pulse h-32 rounded-3xl border ${darkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-100'}`} />
                ))}
              </div>
            )}

            {suggestions.map((s, i) => (
              <div
                key={s.id}
                className={`p-6 rounded-[1.5rem] border transition-all cursor-pointer group relative overflow-hidden ${darkMode ? 'border-white/10 bg-white/5 hover:bg-indigo-500/10 hover:border-indigo-500/30' : 'border-slate-100 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-500/20 shadow-sm'}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[9px] font-black text-indigo-500 uppercase tracking-[0.2em]">Recommendation #{i+1}</span>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className={`p-2 rounded-lg text-[9px] font-black flex items-center gap-1.5 transition-all ${darkMode ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-white shadow-sm text-slate-500 border border-slate-200'}`}><Copy className="w-3 h-3" /> COPY</button>
                  </div>
                </div>
                <p className={`text-xs leading-relaxed mb-4 font-bold ${darkMode ? 'text-slate-200' : 'text-slate-900'}`}>
                  {s.text}
                </p>
                <div className="flex gap-2 mb-4">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setReplyDraft(prev => (prev ? prev + '\n\n' : '') + s.text);
                      setActiveDraftTab('reply');
                    }}
                    className="flex-1 py-1.5 bg-indigo-600/10 hover:bg-indigo-600 hover:text-white border border-indigo-500/20 text-indigo-400 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all text-center"
                  >
                    Вставить в ответ
                  </button>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setNoteDraft(prev => (prev ? prev + '\n\n' : '') + s.text);
                      setActiveDraftTab('note');
                    }}
                    className="flex-1 py-1.5 bg-emerald-600/10 hover:bg-emerald-600 hover:text-white border border-emerald-500/20 text-emerald-400 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all text-center"
                  >
                    Вставить в заметку
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <div className={`flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-lg border ${darkMode ? 'bg-white/5 border-white/5 text-slate-500' : 'bg-white border-slate-100 text-slate-400 shadow-sm'}`}>
                    <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                    {Math.round(s.confidence * 100)}% Reliable
                  </div>
                  <div className="ml-auto flex gap-1.5">
                    <button className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-white/10 text-slate-500 hover:text-emerald-400' : 'hover:bg-white text-slate-400 hover:text-emerald-500 shadow-sm'}`}><ThumbsUp className="w-4 h-4" /></button>
                    <button className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-white/10 text-slate-500 hover:text-red-400' : 'hover:bg-white text-slate-400 hover:text-red-500 shadow-sm'}`}><ThumbsDown className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="absolute left-0 bottom-0 top-0 w-1 bg-indigo-600 opacity-30" />
              </div>
            ))}
          </div>
        </div>

        <div className={`p-4 border-t flex flex-col gap-2 shrink-0 ${darkMode ? 'border-white/10 bg-black/40' : 'border-slate-100 bg-slate-50/50'}`}>
          <div className={`flex items-center gap-3 px-3.5 py-2 rounded-xl border transition-all focus-within:border-indigo-500/50 ${darkMode ? 'bg-black/40 border-white/10' : 'bg-white border-slate-200 shadow-inner'}`}>
            <input 
              type="text" 
              placeholder="Ask OmniAI specific detail..." 
              className={`flex-1 bg-transparent border-none outline-none text-xs font-bold ${darkMode ? 'text-slate-300 placeholder:text-slate-600' : 'text-slate-900 placeholder:text-slate-400'}`}
            />
            <button className="p-1.5 bg-indigo-600 rounded-lg text-white hover:bg-indigo-500 transition-all shadow-md shadow-indigo-500/30">
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
