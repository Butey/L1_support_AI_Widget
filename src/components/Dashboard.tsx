import React, { useState, useEffect } from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { TrendingUp, Users, CheckCircle, Clock, Info } from 'lucide-react';
import { apiFetch } from '../lib/api';

export default function Dashboard({ darkMode, t }: { darkMode: boolean, t: any }) {
  const [stats, setStats] = useState({
    totalRequests: 0,
    activeAgents: 1, // Let's keep 1 for the current session
    acceptanceRate: 0,
    avgResponseTime: 0
  });

  const [chartData, setChartData] = useState<{name: string, queries: number}[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const response = await apiFetch('/api/analytics');
        const logs = await response.json();
        
        const chatLogs = logs.filter((l: any) => l.action === 'chat_request' || l.action === 'suggestion_generated');
        const appliedCount = logs.filter((l: any) => l.action === 'suggestion_applied').length;

        const latencies = chatLogs
          .map((l: any) => l.metadata?.latencyMs)
          .filter((n: any) => typeof n === 'number');
        const avgSeconds = latencies.length
          ? +(latencies.reduce((a: number, b: number) => a + b, 0) / latencies.length / 1000).toFixed(1)
          : 0;

        setStats({
          totalRequests: chatLogs.length,
          activeAgents: 1,
          acceptanceRate: chatLogs.length ? Math.round((appliedCount / chatLogs.length) * 100) : 0,
          avgResponseTime: avgSeconds
        });

        // Group by calendar date (not weekday) so logs older than 7 days
        // don't collide into a same-named bucket for the current week.
        const grouped: Record<string, number> = {};
        chatLogs.forEach((log: any) => {
          const key = new Date(log.timestamp).toDateString();
          grouped[key] = (grouped[key] || 0) + 1;
        });

        const today = new Date();
        const days = Array.from({length: 7}).map((_, i) => {
          const d = new Date(today);
          d.setDate(d.getDate() - 6 + i);
          return {
            name: d.toLocaleDateString(undefined, { weekday: 'short' }),
            queries: grouped[d.toDateString()] || 0
          };
        });

        setChartData(days);
      } catch (err) {
        console.error("Failed to load analytics", err);
      } finally {
        setLoading(false);
      }
    };
    fetchAnalytics();
  }, []);

  const statsDisplay = [
    { label: t.language === 'ru' ? 'Обращений к ИИ' : 'Total AI Requests', value: stats.totalRequests.toString(), change: '0%', icon: TrendingUp, color: 'text-blue-500' },
    { label: t.active_agents, value: stats.activeAgents.toString(), change: '0%', icon: Users, color: 'text-purple-500' },
    { label: t.acceptance_rate, value: stats.acceptanceRate + '%', change: '0%', icon: CheckCircle, color: 'text-green-500' },
    { label: t.avg_response, value: stats.avgResponseTime + 's', change: '0%', icon: Clock, color: 'text-orange-500' },
  ];

  if (loading) {
    return <div className="p-10 text-center">Loading analytics...</div>;
  }

  return (
    <div className="space-y-10">
      {/* Informational Notice */}
      {stats.totalRequests === 0 && (
        <div className={`p-4 rounded-2xl border flex items-start gap-4 ${darkMode ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-300' : 'bg-indigo-50 border-indigo-100 text-indigo-700'}`}>
          <Info className="w-5 h-5 mt-0.5 shrink-0" />
          <div className="text-sm font-bold">
            {t.language === 'ru' 
              ? 'Аналитика пуста. Интегрируйте виджет в Omnidesk и начните использовать ИИ, чтобы здесь появились реальные данные.' 
              : 'Analytics is empty. Integrate the widget into Omnidesk and start using AI to see real data here.'}
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        {statsDisplay.map((stat, i) => (
          <div key={i} className={`p-6 rounded-3xl border ${darkMode ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white shadow-xl shadow-slate-200/40'} backdrop-blur-md transition-all hover:scale-[1.02] active:scale-95 group`}>
            <div className="flex items-start justify-between mb-4">
              <div className={`p-3 rounded-2xl ${darkMode ? 'bg-white/5 border-white/5' : 'bg-slate-50 border-slate-100'} border transition-colors group-hover:border-indigo-500/30`}>
                <stat.icon className={`w-5 h-5 ${stat.color} drop-shadow-[0_0_8px_rgba(99,102,241,0.2)]`} />
              </div>
              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${darkMode ? 'text-slate-400 bg-white/5 border-white/10' : 'text-slate-500 bg-slate-100 border-slate-200'}`}>
                -
              </span>
            </div>
            <div className="flex flex-col">
              <span className={`text-[10px] font-bold uppercase tracking-[0.2em] ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>{stat.label}</span>
              <span className={`text-4xl font-bold tracking-tight mt-1 ${darkMode ? 'bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent' : 'text-slate-900 font-black'}`}>{stat.value}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Main Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <div className={`p-10 rounded-[2.5rem] border ${darkMode ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white shadow-2xl shadow-slate-200/50'} backdrop-blur-md transition-all`}>
          <h3 className={`text-[11px] font-black mb-12 uppercase tracking-[0.3em] ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>{t.language === 'ru' ? 'Запросы к ИИ' : 'AI Queries'}</h3>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorQueries" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={darkMode ? 0.3 : 0.1}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={darkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)"} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 'bold'}} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 'bold'}} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: darkMode ? 'rgba(9, 9, 11, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                    border: darkMode ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.05)',
                    borderRadius: '24px',
                    backdropFilter: 'blur(20px)',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
                  }}
                  itemStyle={{ color: darkMode ? '#fff' : '#0f172a', fontSize: '12px', fontWeight: 'bold' }}
                />
                <Area type="monotone" dataKey="queries" name="Queries" stroke="#6366f1" fillOpacity={1} fill="url(#colorQueries)" strokeWidth={5} dot={{ r: 6, fill: '#6366f1', strokeWidth: 3, stroke: darkMode ? '#09090b' : '#fff' }} activeDot={{ r: 9, stroke: '#6366f1', strokeWidth: 3, fill: '#fff' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={`p-10 rounded-[2.5rem] border ${darkMode ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white shadow-2xl shadow-slate-200/50'} backdrop-blur-md transition-all`}>
          <h3 className={`text-[11px] font-black mb-12 uppercase tracking-[0.3em] ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>{t.language === 'ru' ? 'Активность по дням' : 'Activity by Day'}</h3>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barGap={12}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={darkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)"} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 'bold'}} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 'bold'}} />
                <Tooltip 
                   contentStyle={{ 
                    backgroundColor: darkMode ? 'rgba(9, 9, 11, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                    border: darkMode ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.05)',
                    borderRadius: '24px',
                    backdropFilter: 'blur(20px)'
                  }}
                  itemStyle={{ color: darkMode ? '#fff' : '#0f172a', fontSize: '12px', fontWeight: 'bold' }}
                />
                <Bar dataKey="queries" name="Queries" fill="#6366f1" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
