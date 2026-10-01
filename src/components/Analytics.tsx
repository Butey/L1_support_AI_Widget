import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Download, 
  Filter, 
  RefreshCw, 
  ArrowUpRight, 
  ArrowDownRight,
  Database,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import { AnalyticsRecord } from '../types';
import { apiFetch } from '../lib/api';

export default function Analytics({ darkMode, t }: { darkMode: boolean, t: any }) {
  const [logs, setLogs] = useState<AnalyticsRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/analytics')
      .then(res => res.json())
      .then(data => {
        setLogs(data);
        setLoading(false);
      });
  }, []);

  const exportCSV = () => {
    window.location.href = '/api/export/csv';
  };

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className={`text-4xl font-black tracking-tight italic ${darkMode ? 'bg-gradient-to-r from-white to-slate-500' : 'bg-gradient-to-r from-slate-900 to-slate-500'} bg-clip-text text-transparent`}>{t.audit_trail}</h2>
          <p className="text-slate-500 text-sm mt-2 font-medium italic">{t.audit_desc}</p>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={exportCSV}
            className={`px-6 py-3 rounded-2xl flex items-center gap-2 text-[10px] font-black border transition-all uppercase tracking-[1.5px] ${darkMode ? 'border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10' : 'border-slate-200 bg-white shadow-lg shadow-slate-200/40 text-slate-500 hover:text-indigo-600'}`}
          >
             <Download className="w-4 h-4" />
             {t.export_ledger}
          </button>
          <button className={`px-6 py-3 rounded-2xl flex items-center gap-2 text-[10px] font-black border transition-all uppercase tracking-[1.5px] ${darkMode ? 'border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10' : 'border-slate-200 bg-white shadow-lg shadow-slate-200/40 text-slate-500 hover:text-indigo-600 font-bold'}`}>
            <Filter className="w-4 h-4" />
            {t.filter_stream}
          </button>
        </div>
      </div>

      <div className={`rounded-[2.5rem] border overflow-hidden backdrop-blur-md ${darkMode ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white shadow-2xl shadow-slate-200/50'}`}>
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className={`border-b ${darkMode ? 'border-white/10 bg-white/5' : 'border-slate-100 bg-slate-50/50'}`}>
                <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] w-32">Timestamp</th>
                <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] w-48">Vector Event</th>
                <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] w-56">Authenticated Identity</th>
                <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Payload Metadata</th>
                <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] text-right w-40">Audit Status</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${darkMode ? 'divide-white/5' : 'divide-slate-100'}`}>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-8 py-24 text-center text-slate-500">
                     <RefreshCw className="w-12 h-12 animate-spin mx-auto mb-6 text-indigo-500/40" />
                     <p className="text-[10px] uppercase font-black tracking-[0.3em]">Decrypting event stream...</p>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                   <td colSpan={5} className="px-8 py-24 text-center text-slate-500 font-black uppercase tracking-widest text-xs">
                     Zero active vectors detected in current session.
                  </td>
                </tr>
              ) : (
                logs.map(log => (
                  <tr key={log.id} className={`group transition-colors ${darkMode ? 'hover:bg-white/5' : 'hover:bg-slate-50'}`}>
                    <td className="px-8 py-6">
                       <span className={`text-[11px] font-mono font-black px-3 py-1 rounded-lg border ${darkMode ? 'text-indigo-400/80 bg-indigo-500/5 border-indigo-500/10' : 'text-indigo-600 bg-indigo-50 border-indigo-100 shadow-sm'}`}>
                         {new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}
                       </span>
                    </td>
                    <td className="px-8 py-6">
                       <div className="flex items-center gap-4">
                         <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${log.action === 'suggestion_generated' ? (darkMode ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' : 'bg-indigo-50 border-indigo-100 text-indigo-600') : (darkMode ? 'bg-purple-500/10 border-purple-500/20 text-purple-400' : 'bg-purple-50 border-purple-100 text-purple-600')}`}>
                           {log.action === 'suggestion_generated' ? <Activity className="w-5 h-5" /> : <Database className="w-5 h-5" />}
                         </div>
                         <span className={`text-xs font-black uppercase tracking-tight ${darkMode ? 'text-slate-200' : 'text-slate-900'}`}>{log.action.replace('_', ' ')}</span>
                       </div>
                    </td>
                    <td className="px-8 py-6">
                       <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[9px] font-black font-mono shadow-inner border ${darkMode ? 'bg-black/60 border-white/10 text-slate-400' : 'bg-white border-slate-200 text-slate-500 shadow-sm'}`}>ID</div>
                          <span className={`text-[11px] font-black transition-colors ${darkMode ? 'text-slate-500 group-hover:text-slate-300' : 'text-slate-500 group-hover:text-indigo-600'}`}>system_core_agent</span>
                       </div>
                    </td>
                    <td className="px-8 py-6">
                       <code className={`text-[10px] px-4 py-2 rounded-xl block max-w-sm truncate font-mono border ${darkMode ? 'bg-black/60 border-white/5 text-indigo-300/70' : 'bg-slate-50 border-slate-100 text-slate-600 shadow-sm'}`}>
                          {JSON.stringify(log.metadata)}
                       </code>
                    </td>
                    <td className="px-8 py-6 text-right">
                       <span className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border text-[9px] font-black uppercase tracking-[1.5px] shadow-sm ${darkMode ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-emerald-50 border-emerald-100 text-emerald-600'}`}>
                          <ShieldCheck className="w-3.5 h-3.5" />
                          Authorized
                       </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
