import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Edit2, Save } from 'lucide-react';
import { CustomModelConfig } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  customModelsJson: string | undefined;
  onSave: (json: string) => void;
  darkMode: boolean;
}

export default function CustomModelsModal({ isOpen, onClose, customModelsJson, onSave, darkMode }: Props) {
  const [models, setModels] = useState<CustomModelConfig[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<CustomModelConfig>>({});

  useEffect(() => {
    if (isOpen) {
      try {
        const parsed = customModelsJson ? JSON.parse(customModelsJson) : [];
        setModels(Array.isArray(parsed) ? parsed : []);
      } catch (e) {
        // Fallback for previous comma-separated format
        if (customModelsJson && !customModelsJson.startsWith('[')) {
           const legacy = customModelsJson.split(',').map(m => m.trim()).filter(Boolean).map(m => ({
             id: Math.random().toString(36).substring(7),
             name: m,
             base_url: 'https://api.openai.com/v1',
             model_id: m,
             api_key: ''
           }));
           setModels(legacy);
        } else {
           setModels([]);
        }
      }
    }
  }, [isOpen, customModelsJson]);

  if (!isOpen) return null;

  const handleSaveModel = () => {
    if (!editForm.name || !editForm.model_id) return;
    
    let updatedModels;
    if (editingId === 'new') {
      updatedModels = [...models, { ...editForm, id: Math.random().toString(36).substring(7) } as CustomModelConfig];
    } else {
      updatedModels = models.map(m => m.id === editingId ? { ...m, ...editForm } as CustomModelConfig : m);
    }
    setModels(updatedModels);
    onSave(JSON.stringify(updatedModels));
    setEditingId(null);
    setEditForm({});
  };

  const handleDelete = (id: string) => {
    const updatedModels = models.filter(m => m.id !== id);
    setModels(updatedModels);
    onSave(JSON.stringify(updatedModels));
  };

  const inputClass = `w-full p-4 rounded-xl border transition-all font-bold text-sm outline-none focus:border-indigo-500/50 ${darkMode ? 'bg-black/40 border-white/10 text-slate-200 placeholder:text-slate-600' : 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400'}`;
  const labelClass = "text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] block mb-2";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className={`w-full max-w-3xl rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] ${darkMode ? 'bg-zinc-950 border border-white/10' : 'bg-white border border-slate-200'}`}>
        <div className={`p-6 flex items-center justify-between border-b ${darkMode ? 'border-white/5' : 'border-slate-100'}`}>
          <h2 className={`font-black text-xl italic tracking-tight ${darkMode ? 'text-white' : 'text-slate-900'}`}>Manage Custom Models</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1">
          {editingId ? (
            <div className={`p-6 rounded-2xl border space-y-5 ${darkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
              <h3 className={`font-bold text-lg ${darkMode ? 'text-white' : 'text-slate-800'}`}>
                {editingId === 'new' ? 'Add New Model' : 'Edit Model'}
              </h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className={labelClass}>Display Name</label>
                  <input type="text" value={editForm.name || ''} onChange={e => setEditForm({...editForm, name: e.target.value})} placeholder="e.g. My Llama 3" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Model Identifier</label>
                  <input type="text" value={editForm.model_id || ''} onChange={e => setEditForm({...editForm, model_id: e.target.value})} placeholder="e.g. meta-llama/Llama-3-8b-chat" className={inputClass} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>Base URL (Endpoint)</label>
                  <input type="text" value={editForm.base_url || ''} onChange={e => setEditForm({...editForm, base_url: e.target.value})} placeholder="e.g. https://api.openai.com/v1" className={inputClass} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>API Key (Optional)</label>
                  <input type="password" value={editForm.api_key || ''} onChange={e => setEditForm({...editForm, api_key: e.target.value})} placeholder="Overrides global API key if set" className={inputClass} />
                </div>
              </div>
              
              <div className="flex justify-end gap-3 pt-4">
                <button onClick={() => setEditingId(null)} className={`px-6 py-3 rounded-xl font-bold text-sm transition-all ${darkMode ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-slate-200 hover:bg-slate-300 text-slate-800'}`}>Cancel</button>
                <button onClick={handleSaveModel} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-sm transition-all flex items-center gap-2">
                  <Save className="w-4 h-4" /> Save Model
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {models.length === 0 ? (
                <div className="text-center py-10 opacity-50 font-medium">No custom models configured.</div>
              ) : (
                <div className="space-y-3">
                  {models.map(model => (
                    <div key={model.id} className={`flex items-center justify-between p-4 rounded-xl border transition-all ${darkMode ? 'bg-black/40 border-white/5 hover:border-white/10' : 'bg-white border-slate-200 shadow-sm'}`}>
                      <div>
                        <div className={`font-bold text-base ${darkMode ? 'text-white' : 'text-slate-900'}`}>{model.name}</div>
                        <div className="text-xs text-slate-500 font-mono mt-1">{model.model_id} &middot; {model.base_url}</div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => { setEditingId(model.id); setEditForm(model); }} className="p-2 hover:bg-indigo-500/20 text-indigo-400 rounded-lg transition-colors"><Edit2 className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(model.id)} className="p-2 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              <button onClick={() => { setEditingId('new'); setEditForm({ base_url: 'https://api.openai.com/v1' }); }} className="w-full py-4 border-2 border-dashed border-indigo-500/30 text-indigo-500 hover:border-indigo-500 hover:bg-indigo-500/10 rounded-xl font-bold transition-all flex items-center justify-center gap-2">
                <Plus className="w-5 h-5" /> Add Custom Model
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
