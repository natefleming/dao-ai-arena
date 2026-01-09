import { useState, useEffect } from 'react';
import { X, Settings, Info } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  customInput: string;
  onSave: (customInput: string) => void;
}

export default function SettingsModal({ isOpen, onClose, customInput, onSave }: SettingsModalProps) {
  const [input, setInput] = useState(customInput);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInput(customInput);
  }, [customInput, isOpen]);

  const handleSave = () => {
    // Validate JSON if not empty
    if (input.trim()) {
      try {
        JSON.parse(input);
        setError(null);
      } catch (e) {
        setError('Invalid JSON format');
        return;
      }
    }
    
    onSave(input);
    onClose();
  };

  const handleReset = () => {
    setInput('');
    setError(null);
  };

  const exampleInput = {
    "max_tokens": 2000,
    "temperature": 0.7,
    "stop": ["END"],
    "top_p": 0.95
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-gray-800 border border-gray-700 rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Settings className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-100">Custom Input Configuration</h2>
              <p className="text-sm text-gray-400 mt-0.5">
                Override Databricks Responses Agent API parameters
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Info Banner */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-blue-300 space-y-2">
                <p>
                  Add custom parameters that will be merged with the Responses Agent API request.
                  This allows you to control generation settings like temperature, max_tokens, etc.
                </p>
                <p className="font-semibold">
                  Note: These parameters will be applied to ALL endpoints in the battle.
                </p>
              </div>
            </div>
          </div>

          {/* JSON Input */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Custom Input (JSON format)
            </label>
            <textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(null);
              }}
              placeholder="Enter custom input as JSON..."
              className="w-full h-64 bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono text-sm resize-none"
            />
            {error && (
              <p className="text-red-400 text-sm mt-2">⚠️ {error}</p>
            )}
          </div>

          {/* Example */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Example Custom Input
            </label>
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 overflow-x-auto">
              <pre className="text-sm text-gray-400 font-mono">
                {JSON.stringify(exampleInput, null, 2)}
              </pre>
            </div>
            <button
              onClick={() => setInput(JSON.stringify(exampleInput, null, 2))}
              className="mt-2 text-sm text-blue-400 hover:text-blue-300"
            >
              Use this example
            </button>
          </div>

          {/* Documentation Link */}
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-gray-300 mb-2">
              Common Parameters
            </h4>
            <ul className="text-sm text-gray-400 space-y-1">
              <li>• <code className="bg-gray-800 px-1.5 py-0.5 rounded">max_tokens</code> - Maximum tokens to generate</li>
              <li>• <code className="bg-gray-800 px-1.5 py-0.5 rounded">temperature</code> - Sampling temperature (0.0 - 2.0)</li>
              <li>• <code className="bg-gray-800 px-1.5 py-0.5 rounded">top_p</code> - Nucleus sampling parameter</li>
              <li>• <code className="bg-gray-800 px-1.5 py-0.5 rounded">stop</code> - Array of stop sequences</li>
              <li>• <code className="bg-gray-800 px-1.5 py-0.5 rounded">presence_penalty</code> - Penalize repeated tokens</li>
              <li>• <code className="bg-gray-800 px-1.5 py-0.5 rounded">frequency_penalty</code> - Penalize frequent tokens</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-700 bg-gray-800/50">
          <button
            onClick={handleReset}
            className="px-4 py-2 text-gray-400 hover:text-gray-300 transition-colors"
          >
            Clear All
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors font-semibold text-white"
            >
              Save Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
