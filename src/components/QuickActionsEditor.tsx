import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Smile } from 'lucide-react';

interface QuickAction {
  icon: string;
  ru: string;
  en: string;
  prompt: string;
}

export default function QuickActionsEditor({
  value,
  onChange,
  darkMode
}: {
  value: string;
  onChange: (val: string) => void;
  darkMode: boolean;
}) {
  const [actions, setActions] = useState<QuickAction[]>([]);

  useEffect(() => {
    try {
      if (value) {
        setActions(JSON.parse(value));
      } else {
        setActions([]);
      }
    } catch (e) {
      setActions([]);
    }
  }, [value]);

  const updateActions = (newActions: QuickAction[]) => {
    setActions(newActions);
    onChange(JSON.stringify(newActions, null, 2));
  };

  const addAction = () => {
    updateActions([...actions, { icon: '✨', ru: 'Новое действие', en: 'New action', prompt: '' }]);
  };

  const removeAction = (index: number) => {
    const newActions = [...actions];
    newActions.splice(index, 1);
    updateActions(newActions);
  };

  const handleChange = (index: number, field: keyof QuickAction, val: string) => {
    const newActions = [...actions];
    newActions[index][field] = val;
    updateActions(newActions);
  };

  return (
    <div className={`space-y-3 p-4 rounded-2xl border ${darkMode ? 'bg-black/20 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
      <div className="flex justify-between items-center mb-4">
        <h3 className={`text-xs font-bold uppercase tracking-wider ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
          Quick Actions List
        </h3>
        <button
          type="button"
          onClick={addAction}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {actions.map((action, index) => (
        <div key={index} className={`flex flex-col gap-2 p-3 rounded-xl border relative ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200 shadow-sm'}`}>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={action.icon}
              onChange={(e) => handleChange(index, 'icon', e.target.value)}
              placeholder="Emoji"
              className={`w-12 h-10 p-2 text-center rounded-lg border text-lg focus:border-indigo-500/50 outline-none ${darkMode ? 'bg-black/40 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
              maxLength={2}
            />
            <input
              type="text"
              value={action.en}
              onChange={(e) => handleChange(index, 'en', e.target.value)}
              placeholder="Label (EN)"
              className={`flex-1 p-2 rounded-lg border text-sm font-medium focus:border-indigo-500/50 outline-none ${darkMode ? 'bg-black/40 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
            />
            <input
              type="text"
              value={action.ru}
              onChange={(e) => handleChange(index, 'ru', e.target.value)}
              placeholder="Label (RU)"
              className={`flex-1 p-2 rounded-lg border text-sm font-medium focus:border-indigo-500/50 outline-none ${darkMode ? 'bg-black/40 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
            />
            <button
              type="button"
              onClick={() => removeAction(index)}
              className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <input
            type="text"
            value={action.prompt}
            onChange={(e) => handleChange(index, 'prompt', e.target.value)}
            placeholder="Prompt to send when clicked"
            className={`w-full p-2 rounded-lg border text-sm font-medium focus:border-indigo-500/50 outline-none ${darkMode ? 'bg-black/40 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
          />
        </div>
      ))}

      {actions.length === 0 && (
        <div className={`text-center py-6 text-sm font-medium ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>
          No quick actions defined. Add one to get started.
        </div>
      )}
    </div>
  );
}
