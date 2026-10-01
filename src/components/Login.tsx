import React, { useState } from 'react';
import { Shield, Key, ArrowRight, Loader2 } from 'lucide-react';

interface Props {
  onLogin: (token: string) => void;
  darkMode: boolean;
}

export default function Login({ onLogin, darkMode }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    
    setError('');
    setLoading(true);
    
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      
      const data = await res.json();
      
      if (res.ok && data.success) {
        onLogin(data.token);
      } else {
        setError(data.error || 'Invalid password');
      }
    } catch (err) {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${darkMode ? 'bg-[#09090b] text-slate-100' : 'bg-slate-50 text-slate-900'} font-sans antialiased transition-colors duration-500`}>
      <div className={`w-full max-w-md p-8 rounded-3xl border shadow-xl ${darkMode ? 'bg-zinc-950 border-white/5' : 'bg-white border-slate-200'}`}>
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 mb-2">
            <Shield className="w-8 h-8" />
          </div>
        </div>
        
        <h1 className="text-2xl font-black text-center mb-2 tracking-tight italic">Admin Login</h1>
        <p className={`text-center text-sm font-medium mb-8 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
          Enter the management password to continue.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <div className="relative">
              <Key className={`w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`} />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className={`w-full py-4 pl-12 pr-4 rounded-2xl border transition-all font-bold text-sm outline-none focus:border-indigo-500/50 ${darkMode ? 'bg-black/40 border-white/10 text-slate-200 placeholder:text-slate-600' : 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400'}`}
                autoFocus
              />
            </div>
          </div>
          
          {error && (
            <div className="text-red-500 text-sm font-bold text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className={`w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${loading || !password ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
              <>
                Login <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
