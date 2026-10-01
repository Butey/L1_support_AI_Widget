import React from 'react';
import { Copy, Terminal, ExternalLink, ShieldCheck, Key, Globe, Code2 } from 'lucide-react';

export default function IntegrationGuide({ darkMode, t }: { darkMode: boolean, t: any }) {
  const widgetUrl = `${window.location.origin}/api/omnidesk/widget.js`;
  const widgetPreviewUrl = `${window.location.origin}/?mode=widget`;
  const jsCodeSnippet = `(function() {
  console.log('OmniAI Widget: Script loaded');
  
  function initWidget() {
    if (document.getElementById('omniai-widget-container')) {
      return true; // Already initialized
    }
    
    // Try to find the ticket response area, or any right sidebar
    var renderTarget = document.getElementById('response_answer_area') || 
                       document.querySelector('.request-area') || 
                       document.querySelector('#case_message_area');
    
    if (renderTarget) {
      console.log('OmniAI Widget: Found target container, injecting iframe');
      var container = document.createElement('div');
      container.id = 'omniai-widget-container';
      container.style.marginTop = '20px';
      container.style.marginBottom = '20px';
      container.style.border = '1px solid #e2e8f0';
      container.style.borderRadius = '12px';
      container.style.overflow = 'hidden';
      container.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1)';
      container.style.backgroundColor = '#ffffff';
      
      var iframe = document.createElement('iframe');
      var widgetSecret = 'YOUR_WIDGET_SECRET'; // Замените на значение WIDGET_SECRET из .env
      var staffEmail = (typeof CurrentUserEmail !== 'undefined' && CurrentUserEmail) ? CurrentUserEmail : '';
      var caseId = (typeof CurrentCaseId !== 'undefined' && CurrentCaseId) ? CurrentCaseId : '';
      iframe.src = '${widgetPreviewUrl}&case_number=' + encodeURIComponent(caseId) + '&ws=' + encodeURIComponent(widgetSecret) + (staffEmail ? '&staff_email=' + encodeURIComponent(staffEmail) : '');
      iframe.style.width = '100%';
      iframe.style.height = '600px';
      iframe.style.border = 'none';
      iframe.style.display = 'block';
      
      container.appendChild(iframe);
      
      if (renderTarget.parentNode) {
          renderTarget.parentNode.insertBefore(container, renderTarget.nextSibling);
      } else {
          renderTarget.appendChild(container);
      }
      return true;
    }
    return false;
  }

  if (!initWidget()) {
    console.log('OmniAI Widget: Target not found yet, starting polling...');
    var attempts = 0;
    var interval = setInterval(function() {
      attempts++;
      if (initWidget() || attempts > 20) {
        if (attempts > 20 && !document.getElementById('omniai-widget-container')) {
           console.log('OmniAI Widget: Giving up on finding target, injecting to body');
           var bodyTarget = document.body;
           if(bodyTarget) {
               var container = document.createElement('div');
               container.id = 'omniai-widget-container';
               container.style.position = 'fixed';
               container.style.bottom = '20px';
               container.style.right = '20px';
               container.style.width = '400px';
               container.style.height = '600px';
               container.style.zIndex = '999999';
               container.style.boxShadow = '0 20px 25px -5px rgba(0, 0, 0, 0.1)';
               container.style.borderRadius = '12px';
               container.style.overflow = 'hidden';
               container.style.backgroundColor = '#ffffff';
               
               var iframe = document.createElement('iframe');
               iframe.src = '${widgetPreviewUrl}';
               iframe.style.width = '100%';
               iframe.style.height = '100%';
               iframe.style.border = 'none';
               
               container.appendChild(iframe);
               bodyTarget.appendChild(container);
           }
        }
        clearInterval(interval);
      }
    }, 500);
  }
})();`;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // User feed back could be added here
  };

  return (
    <div className="max-w-6xl space-y-12 pb-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className={`text-4xl font-black tracking-tight italic ${darkMode ? 'bg-gradient-to-r from-white to-slate-500' : 'bg-gradient-to-r from-slate-900 to-slate-500'} bg-clip-text text-transparent`}>
            {t.integration_title}
          </h2>
          <p className="text-slate-500 text-sm mt-3 font-medium italic">{t.integration_subtitle}</p>
        </div>
        <div className="hidden lg:flex items-center gap-2 text-[10px] font-black text-indigo-500 uppercase tracking-[0.2em] bg-indigo-500/5 px-4 py-2 rounded-full border border-indigo-500/10">
          <Globe className="w-3 h-3" />
          Protocol: HTTPS/TLS 1.3
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        {/* Step 1 */}
        <div className={`p-8 rounded-[2.5rem] border transition-all ${darkMode ? 'border-white/10 bg-white/5 shadow-2xl' : 'border-slate-200 bg-white shadow-2xl shadow-slate-200/50'}`}>
          <div className="flex items-center gap-4 mb-8">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border transition-transform ${darkMode ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' : 'bg-indigo-50 border-indigo-100 text-indigo-600 shadow-lg shadow-indigo-500/5'}`}>
              <Key className="w-6 h-6" />
            </div>
            <div>
              <h3 className={`font-black text-lg uppercase tracking-tight ${darkMode ? 'text-white' : 'text-slate-900'}`}>{t.step_key_title}</h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{t.step_key_desc}</p>
            </div>
          </div>
          
          <div className={`p-5 rounded-2xl border mb-6 ${darkMode ? 'bg-black/40 border-white/5' : 'bg-slate-50 border-slate-100'}`}>
            <label className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] block mb-3 ml-1">Example Endpoint</label>
            <div className="flex items-center justify-between gap-4">
              <code className={`text-[11px] font-bold font-mono ${darkMode ? 'text-indigo-300' : 'text-indigo-600'} truncate`}>https://api.omnidesk.ru/v1/</code>
              <button 
                onClick={() => copyToClipboard('https://api.omnidesk.ru/v1/')}
                className={`p-2 rounded-lg transition-all ${darkMode ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-white shadow-sm border border-transparent hover:border-slate-200 text-slate-500'}`}
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
            Make sure to enable <span className="text-indigo-500 font-bold">Suggestions Permission</span> in the Omnidesk API Key settings to allow AI to write drafts.
          </p>
        </div>

        {/* Step 2 */}
        <div className={`p-8 rounded-[2.5rem] border transition-all ${darkMode ? 'border-white/10 bg-white/5 shadow-2xl' : 'border-slate-200 bg-white shadow-2xl shadow-slate-200/50'}`}>
          <div className="flex items-center gap-4 mb-8">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border transition-transform ${darkMode ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' : 'bg-indigo-50 border-indigo-100 text-indigo-600 shadow-lg shadow-indigo-500/5'}`}>
              <Globe className="w-6 h-6" />
            </div>
            <div>
              <h3 className={`font-black text-lg uppercase tracking-tight ${darkMode ? 'text-white' : 'text-slate-900'}`}>{t.step_webhook_title}</h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{t.step_webhook_desc}</p>
            </div>
          </div>
          
          <div className={`p-5 rounded-2xl border mb-6 ${darkMode ? 'bg-black/40 border-white/5' : 'bg-slate-50 border-slate-100'}`}>
            <label className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] block mb-3 ml-1">Target Webhook URL</label>
            <div className="flex items-center justify-between gap-4">
              <code className={`text-[11px] font-bold font-mono ${darkMode ? 'text-indigo-300' : 'text-indigo-600'} truncate`}>
                {window.location.origin}/api/omnidesk/webhook
              </code>
              <button 
                onClick={() => copyToClipboard(`${window.location.origin}/api/omnidesk/webhook`)}
                className={`p-2 rounded-lg transition-all ${darkMode ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-white shadow-sm border border-transparent hover:border-slate-200 text-slate-500'}`}
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-emerald-500 font-black uppercase tracking-widest">
            <ShieldCheck className="w-3.5 h-3.5" />
            Active Payload Validation
          </div>
        </div>

        {/* Step 3 - Full Width */}
        <div className={`lg:col-span-2 p-10 rounded-[3rem] border transition-all ${darkMode ? 'border-white/10 bg-white/5 shadow-2xl' : 'border-slate-200 bg-white shadow-2xl shadow-slate-200/60'}`}>
          <div className="flex items-center gap-6 mb-10">
            <div className={`w-16 h-16 rounded-[1.5rem] flex items-center justify-center border transition-all ${darkMode ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400 shadow-[0_0_30px_rgba(99,102,241,0.1)]' : 'bg-indigo-50 border-indigo-100 text-indigo-600 shadow-xl shadow-indigo-500/10'}`}>
              <Code2 className="w-8 h-8" />
            </div>
            <div>
              <h3 className={`font-black text-2xl tracking-tight italic ${darkMode ? 'text-white' : 'text-slate-900'}`}>{t.step_widget_title}</h3>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-[0.2em] mt-1">{t.step_widget_desc}</p>
            </div>
          </div>
          
          <div className="relative group">
            <div className="absolute -top-3 left-6 px-4 py-1.5 bg-indigo-600 rounded-full text-white text-[9px] font-black uppercase tracking-[0.2em] z-10 shadow-lg shadow-indigo-500/40">
              Omnidesk Custom Widget Code (omni_gemini.js)
            </div>
            <div className={`p-8 pt-10 rounded-[2rem] border overflow-hidden ${darkMode ? 'bg-black/60 border-white/10' : 'bg-slate-900 border-slate-800 shadow-2xl shadow-black/20'}`}>
              <pre className="font-mono text-[11px] leading-relaxed text-indigo-100/90 overflow-x-auto selection:bg-indigo-500/30 max-h-96">
                {jsCodeSnippet}
              </pre>
            </div>
            <div className="mt-6 flex gap-4">
              <button 
                onClick={() => copyToClipboard(jsCodeSnippet)}
                className="p-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl shadow-2xl shadow-indigo-500/50 transition-all font-black text-xs flex items-center gap-2 active:scale-95"
              >
                <Copy className="w-4 h-4" />
                Copy Code
              </button>
              <a 
                href={widgetPreviewUrl} 
                target="_blank" 
                rel="noreferrer"
                className={`p-4 rounded-2xl border transition-all font-black text-xs flex items-center gap-2 ${darkMode ? 'bg-white/5 border-white/10 hover:bg-white/10 text-white' : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-900'}`}
              >
                <ExternalLink className="w-4 h-4" />
                Test Standalone Widget
              </a>
            </div>
          </div>
        </div>

        {/* SSO Awareness */}
        <div className={`lg:col-span-2 p-10 rounded-[3rem] border transition-all flex flex-col md:flex-row items-center gap-8 ${darkMode ? 'border-white/5 bg-indigo-500/5 backdrop-blur-md' : 'border-indigo-100 bg-indigo-50/50 shadow-inner shadow-indigo-500/5'}`}>
           <div className={`w-20 h-20 rounded-[2rem] flex items-center justify-center shrink-0 border-2 ${darkMode ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-400 shadow-[0_0_40px_rgba(99,102,241,0.2)]' : 'bg-white border-indigo-200 text-indigo-600 shadow-xl shadow-indigo-500/10'}`}>
             <ShieldCheck className="w-10 h-10" />
           </div>
           <div className="flex-1 text-center md:text-left">
             <h4 className={`font-black text-2xl tracking-tight italic mb-2 ${darkMode ? 'text-white' : 'text-slate-900'}`}>{t.sso_title}</h4>
             <p className={`text-xs font-bold uppercase tracking-tight leading-relaxed max-w-xl ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>{t.sso_desc}</p>
           </div>
           <button className={`px-10 py-4 rounded-2xl text-[11px] font-black transition-all uppercase tracking-[0.2em] shadow-lg ${darkMode ? 'bg-white/5 border border-white/10 text-white hover:bg-white/10' : 'bg-white border border-indigo-100 text-indigo-600 hover:bg-indigo-50 hover:shadow-xl shadow-indigo-500/5'}`}>
             {t.configure_sso}
           </button>
        </div>
      </div>
    </div>
  );
}
