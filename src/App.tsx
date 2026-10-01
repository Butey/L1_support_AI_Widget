/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  BookOpen, 
  Settings, 
  BarChart3, 
  MessageSquare, 
  Moon, 
  Sun, 
  ShieldCheck,
  Bell,
  Download,
  Languages,
  LogOut,
  ExternalLink,
  ChevronRight,
  Plus
} from 'lucide-react';
import Dashboard from './components/Dashboard';
import KnowledgeBase from './components/KnowledgeBase';
import AdminPanel from './components/AdminPanel';
import WidgetPreview from './components/WidgetPreview';
import Analytics from './components/Analytics';
import IntegrationGuide from './components/IntegrationGuide';
import { WidgetUI } from './components/WidgetPreview';
import { AppSettings, User, FREE_TIER_MODELS } from './types';
import { translations } from './i18n';
import Login from './components/Login';
import TicketHistoryView from './components/TicketHistoryView';
import { 
  apiFetch, 
  getSafeSessionItem, 
  setSafeSessionItem, 
  removeSafeSessionItem, 
  removeSafeLocalItem,
  getSafeLocalItem,
  setSafeLocalItem
} from './lib/api';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [darkMode, setDarkMode] = useState(true);
  const [language, setLanguage] = useState<'ru' | 'en'>('ru');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [user] = useState<User>({
    id: 'u1',
    name: 'Admin User',
    role: 'admin',
    email: 'admin@company.com'
  });

  const t = translations[language];

  // Standalone Widget Mode and History Mode for Omnidesk Embedding
  const isWidgetMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mode') === 'widget';
  const isHistoryMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mode') === 'history';
  const historyCaseNumber = typeof window !== 'undefined' 
    ? (new URLSearchParams(window.location.search).get('case_number') 
    || new URLSearchParams(window.location.search).get('ticket') 
    || new URLSearchParams(window.location.search).get('ticket_id') 
    || new URLSearchParams(window.location.search).get('case_id') 
    || new URLSearchParams(window.location.search).get('caseId') 
    || '') 
    : '';

  useEffect(() => {
    // Synchronize auth params from URL if present
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        const secret = params.get('secret') || params.get('ws') || params.get('widget_secret');
        const staffEmail = params.get('staff_email') || params.get('email');
        const token = params.get('token') || params.get('admin_token');

        if (secret) {
          setSafeSessionItem('omni_widget_secret', secret);
          setSafeLocalItem('omni_widget_secret', secret);
        }
        if (staffEmail) {
          setSafeSessionItem('omni_staff_email', staffEmail);
          setSafeLocalItem('omni_staff_email', staffEmail);
        }
        if (token) {
          setSafeSessionItem('admin_token', token);
          setSafeLocalItem('admin_token', token);
        }
      } catch (err) {
        console.warn('URL auth sync error:', err);
      }
    }

    const handleAuthRequired = () => setIsAuthenticated(false);
    window.addEventListener('auth_required', handleAuthRequired);
    
    // Check initial auth status
    if (!isWidgetMode && !isHistoryMode) {
      // Clean up any stale persistent localStorage token so new session requires password
      removeSafeLocalItem('admin_token');

      apiFetch('/api/auth/status')
        .then(res => res.json())
        .then(data => {
          if (!data.required) {
            setIsAuthenticated(true);
            fetchSettings();
          } else {
            const token = getSafeSessionItem('admin_token');
            if (token) {
              fetchSettings();
            } else {
              setIsAuthenticated(false);
            }
          }
        })
        .catch(err => {
          console.error("Auth status error:", err);
          setIsAuthenticated(false);
        });
    } else if (isWidgetMode) {
       // Widget mode needs settings for customization
       fetchSettings();
    }

    return () => window.removeEventListener('auth_required', handleAuthRequired);
  }, [isWidgetMode, isHistoryMode]);

  const fetchSettings = () => {
    apiFetch('/api/settings')
      .then(res => {
         if (res.ok) {
            setIsAuthenticated(true);
            return res.json();
         } else {
            if (!isWidgetMode && !isHistoryMode) {
              setIsAuthenticated(false);
            }
            return null;
         }
      })
      .then(data => {
         if (data) setSettings(data);
      })
      .catch(err => {
         console.error("Fetch settings error:", err);
         setIsAuthenticated(false);
      });
  };

  const handleLogin = (token: string) => {
    setSafeSessionItem('admin_token', token);
    removeSafeLocalItem('admin_token');
    setIsAuthenticated(true);
    fetchSettings();
  };

  const handleLogout = () => {
    removeSafeSessionItem('admin_token');
    removeSafeLocalItem('admin_token');
    setIsAuthenticated(false);
  };

  if (isHistoryMode) {
    const activeSecret = getSafeSessionItem('omni_widget_secret') || getSafeLocalItem('omni_widget_secret') || undefined;
    const activeStaffEmail = getSafeSessionItem('omni_staff_email') || getSafeLocalItem('omni_staff_email') || undefined;
    const activeToken = getSafeSessionItem('admin_token') || getSafeLocalItem('admin_token') || undefined;

    return (
      <div className="h-screen w-screen overflow-hidden">
        <TicketHistoryView 
          caseNumber={historyCaseNumber} 
          darkMode={darkMode} 
          isStandalone={true} 
          widgetSecret={activeSecret}
          staffEmail={activeStaffEmail}
          adminToken={activeToken}
          onClose={() => window.close()}
        />
      </div>
    );
  }

  if (isWidgetMode) {
    return (
      <div className="h-full w-full overflow-hidden flex flex-col box-border">
        <WidgetUI darkMode={darkMode} t={t} settings={settings} />
      </div>
    );
  }

  if (isAuthenticated === null) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${darkMode ? 'bg-[#09090b] text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isAuthenticated === false) {
    return <Login onLogin={handleLogin} darkMode={darkMode} />;
  }

  const toggleTheme = () => setDarkMode(!darkMode);

  const tabs = [
    { id: 'dashboard', label: t.dashboard, icon: LayoutDashboard },
    { id: 'analytics', label: t.analytics, icon: BarChart3 },
    { id: 'kb', label: t.kb, icon: BookOpen },
    { id: 'admin', label: t.admin, icon: Settings },
    { id: 'integration', label: t.integration, icon: ExternalLink },
  ];

  return (
    <div className={`min-h-screen flex ${darkMode ? 'bg-[#09090b] text-slate-100' : 'bg-slate-50 text-slate-900'} font-sans antialiased transition-colors duration-500`}>
      {/* Sidebar */}
      <aside className={`w-64 border-r ${darkMode ? 'border-white/10 bg-black/40' : 'border-slate-200 bg-white/80'} backdrop-blur-xl flex flex-col transition-all overflow-hidden relative`}>
        {!darkMode && <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-indigo-50/50 to-transparent pointer-events-none" />}
        <div className={`p-6 border-b ${darkMode ? 'border-white/10' : 'border-slate-100'} flex items-center gap-3 relative z-10`}>
          <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center shadow-[0_4px_12px_rgba(99,102,241,0.3)]">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight italic">OmniAI Core</span>
        </div>

        <nav className="flex-1 px-4 py-8 space-y-2 relative z-10">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all duration-300 ${
                activeTab === tab.id 
                  ? (darkMode ? 'bg-white/10 border-white/10 text-white shadow-lg' : 'bg-white border-slate-200 text-indigo-600 shadow-md shadow-indigo-500/5') 
                  : (darkMode ? 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5' : 'border-transparent text-slate-500 hover:text-indigo-600 hover:bg-indigo-50/50')
              }`}
            >
              <tab.icon className={`w-5 h-5 ${activeTab === tab.id ? 'text-indigo-500' : ''}`} />
              <span className="text-sm font-semibold">{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className={`p-4 mt-auto border-t ${darkMode ? 'border-white/10' : 'border-slate-100'} relative z-10`}>
          <div className={`${darkMode ? 'bg-white/5 border-white/5' : 'bg-white/60 border-slate-200 shadow-sm'} rounded-2xl p-4 border backdrop-blur-sm transition-all`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center border-2 border-white text-xs font-bold text-white shadow-lg">
                AU
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-bold truncate">Admin Corp</span>
                <span className={`text-[10px] font-bold ${darkMode ? 'text-slate-400' : 'text-slate-500'} uppercase tracking-tight`}>SSO Authorized</span>
              </div>
            </div>
            <button onClick={handleLogout} className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all ${darkMode ? 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10' : 'bg-white border-slate-200 shadow-sm text-slate-600 hover:bg-slate-50'} border`}>
              <LogOut className="w-3.5 h-3.5" />
              {t.sign_out}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Ambient Backdrop for Light Mode */}
        {!darkMode && (
          <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
             <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-indigo-100/40 blur-[120px] rounded-full" />
             <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-50/50 blur-[100px] rounded-full" />
          </div>
        )}

        {/* Header */}
        <header className={`h-16 border-b ${darkMode ? 'border-white/10 bg-black/20' : 'border-slate-200 bg-white/60 shadow-sm shadow-slate-200/50'} flex items-center justify-between px-8 backdrop-blur-md transition-all relative z-20`}>
          <div className="flex items-center gap-4">
            <div className={`${darkMode ? 'bg-white/10 border-white/5' : 'bg-white border-slate-200 shadow-sm'} rounded-full px-4 py-1.5 flex items-center gap-2 border`}>
              <span className={`w-1.5 h-1.5 ${darkMode ? 'bg-blue-400 shadow-[0_0_8px_#60a5fa]' : 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]'} rounded-full animate-pulse`}></span>
              <span className={`text-[10px] font-bold ${darkMode ? 'text-blue-100' : 'text-slate-600'} uppercase tracking-[0.1em]`}>{t.connected_api}</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {settings && (
              <div className={`relative flex items-center`}>
                <select 
                  value={settings.model_name}
                  onChange={async (e) => {
                    const newModel = e.target.value;
                    const updated = { ...settings, model_name: newModel };
                    setSettings(updated);
                    await apiFetch('/api/settings', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(updated)
                    });
                  }}
                  className={`pl-4 pr-8 py-2 rounded-xl border appearance-none transition-all font-bold text-[11px] outline-none cursor-pointer ${darkMode ? 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10' : 'bg-white border-slate-200 shadow-sm text-slate-600 hover:bg-slate-50'}`}
                >
                  {FREE_TIER_MODELS.map(m => (
                    <option key={m} value={m} className={darkMode ? 'bg-zinc-900' : 'bg-white'}>{m}</option>
                  ))}
                  {(() => {
                     let customOptions: any[] = [];
                     try {
                       if (settings.custom_models && settings.custom_models.startsWith('[')) {
                         const parsed = JSON.parse(settings.custom_models);
                         customOptions = parsed.map((m: any) => ({ label: m.name, value: m.model_id }));
                       } else if (settings.custom_models) {
                         customOptions = settings.custom_models.split(',').map(m => m.trim()).filter(Boolean).map(m => ({ label: m, value: m }));
                       }
                     } catch (e) {}
                     
                     const isCurrentCustom = customOptions.some(o => o.value === settings.model_name);
                     const isCurrentBuiltin = FREE_TIER_MODELS.includes(settings.model_name);
                     
                     return (
                       <>
                         {customOptions.map(opt => <option key={opt.value} value={opt.value} className={darkMode ? "bg-zinc-900" : "bg-white"}>{opt.label}</option>)}
                         {settings.model_name && !isCurrentBuiltin && !isCurrentCustom && (
                           <option value={settings.model_name} className={darkMode ? "bg-zinc-900" : "bg-white"}>{settings.model_name}</option>
                         )}
                       </>
                     );
                  })()}
                </select>
                <ChevronRight className="w-3.5 h-3.5 absolute right-3 pointer-events-none opacity-50 rotate-90" />
              </div>
            )}
            <div className={`flex ${darkMode ? 'bg-white/5 border-white/10' : 'bg-slate-100 border-slate-200'} p-1 rounded-xl border transition-all`}>
              <button 
                onClick={() => setLanguage('ru')}
                className={`px-4 py-1.5 text-[11px] font-bold rounded-lg transition-all ${language === 'ru' ? (darkMode ? 'bg-white/10 text-white shadow-inner' : 'bg-white text-indigo-600 shadow-md border border-slate-100') : 'text-slate-500 hover:text-slate-700'}`}
              >
                RU
              </button>
              <button 
                onClick={() => setLanguage('en')}
                className={`px-4 py-1.5 text-[11px] font-bold rounded-lg transition-all ${language === 'en' ? (darkMode ? 'bg-white/10 text-white shadow-inner' : 'bg-white text-indigo-600 shadow-md border border-slate-100') : 'text-slate-500 hover:text-slate-700'}`}
              >
                EN
              </button>
            </div>
            <div className={`w-px h-6 mx-2 ${darkMode ? 'bg-white/10' : 'bg-slate-200'}`} />
            <button className={`p-2.5 rounded-xl transition-all ${darkMode ? 'hover:bg-white/10 text-slate-400 hover:text-white' : 'hover:bg-white border border-transparent hover:border-slate-100 shadow-sm text-slate-500 hover:text-indigo-600'}`}>
              <Bell className="w-5 h-5" />
            </button>
            <button 
              onClick={toggleTheme}
              className={`p-2.5 rounded-xl transition-all ${darkMode ? 'hover:bg-white/10 text-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.1)]' : 'bg-white border border-slate-200 shadow-sm text-indigo-600 hover:bg-slate-50'}`}
            >
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-10 relative z-10">
          {darkMode && (
            <>
              <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 blur-[120px] rounded-full pointer-events-none -mr-48 -mt-48" />
              <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/10 blur-[100px] rounded-full pointer-events-none -ml-32 -mb-32" />
            </>
          )}
          
          <div className="relative z-10 h-full transition-opacity duration-300">
              {activeTab === 'dashboard' && <Dashboard darkMode={darkMode} t={t} />}
              {activeTab === 'analytics' && <Analytics darkMode={darkMode} t={t} />}
              {activeTab === 'kb' && <KnowledgeBase darkMode={darkMode} t={t} />}
              {activeTab === 'admin' && <AdminPanel darkMode={darkMode} settings={settings} onUpdate={setSettings} t={t} />}
              {activeTab === 'integration' && <IntegrationGuide darkMode={darkMode} t={t} />}
              {activeTab === 'widget' && <WidgetPreview darkMode={darkMode} t={t} settings={settings} />}
          </div>
        </div>
      </main>
    </div>
  );
}
