import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Loader2, AlertCircle, Settings } from 'lucide-react';
import { fetchEndpoints, Endpoint } from './api';
import ChatPanel, { ChatPanelRef } from './components/ChatPanel';
import SettingsModal from './components/SettingsModal';
import AddModelDialog from './components/AddModelDialog';

interface SelectedModel {
  id: string;
  endpoint: Endpoint;
  isSynced: boolean;
  inputValue: string;
}

function App() {
  const [allEndpoints, setAllEndpoints] = useState<Endpoint[]>([]);
  const [selectedModels, setSelectedModels] = useState<SelectedModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scopeErrors, setScopeErrors] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showAddModel, setShowAddModel] = useState(false);

  // Refs for all chat panels to trigger concurrent sends
  const chatPanelRefs = useRef<Map<string, ChatPanelRef>>(new Map());

  useEffect(() => {
    loadEndpoints();
  }, []);

  const loadEndpoints = async () => {
    try {
      setLoading(true);
      setError(null);
      setScopeErrors([]);
      const data = await fetchEndpoints();
      setAllEndpoints(data.endpoints);
      if (data.errors && data.errors.length > 0) {
        setScopeErrors(data.errors);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to load endpoints');
    } finally {
      setLoading(false);
    }
  };

  const modelServingEndpoints = allEndpoints.filter((ep) => ep.endpoint_type === 'model_serving');
  const databricksApps = allEndpoints.filter((ep) => ep.endpoint_type === 'databricks_app');

  const handleAddModel = (endpoint: Endpoint) => {
    if (selectedModels.some((m) => m.endpoint.id === endpoint.id)) {
      return;
    }
    
    const newModel: SelectedModel = {
      id: `${endpoint.id}-${Date.now()}`,
      endpoint,
      isSynced: true,
      inputValue: '',
    };
    setSelectedModels([...selectedModels, newModel]);
  };

  const handleRemoveModel = useCallback((id: string) => {
    chatPanelRefs.current.delete(id);
    setSelectedModels(prev => prev.filter((m) => m.id !== id));
  }, []);

  const handleToggleSync = useCallback((id: string) => {
    setSelectedModels(prev => prev.map((m) => 
      m.id === id ? { ...m, isSynced: !m.isSynced } : m
    ));
  }, []);

  // Handle input change - sync across all synced panels
  const handleInputChange = useCallback((id: string, value: string) => {
    setSelectedModels(prev => {
      const model = prev.find(m => m.id === id);
      if (!model) return prev;

      if (model.isSynced) {
        // Update all synced panels with the same value
        return prev.map(m => 
          m.isSynced ? { ...m, inputValue: value } : m
        );
      } else {
        // Only update this panel
        return prev.map(m => 
          m.id === id ? { ...m, inputValue: value } : m
        );
      }
    });
  }, []);

  // Clear input for a specific panel after sending
  const handleClearInput = useCallback((id: string) => {
    setSelectedModels(prev => {
      const model = prev.find(m => m.id === id);
      if (!model) return prev;

      if (model.isSynced) {
        // Clear all synced panels
        return prev.map(m => 
          m.isSynced ? { ...m, inputValue: '' } : m
        );
      } else {
        // Only clear this panel
        return prev.map(m => 
          m.id === id ? { ...m, inputValue: '' } : m
        );
      }
    });
  }, []);

  // Handle synced send - broadcast to all synced panels concurrently
  const handleSyncedSend = useCallback((messageText: string) => {
    // Get all synced model IDs
    const syncedModelIds = selectedModels
      .filter(m => m.isSynced)
      .map(m => m.id);
    
    console.log(`Broadcasting message to ${syncedModelIds.length} synced panels`);
    
    // Trigger send on ALL synced panels concurrently
    syncedModelIds.forEach(modelId => {
      const panelRef = chatPanelRefs.current.get(modelId);
      if (panelRef) {
        panelRef.triggerSend(messageText);
      }
    });
  }, [selectedModels]);

  // Register chat panel ref
  const registerChatPanelRef = useCallback((id: string, ref: ChatPanelRef | null) => {
    if (ref) {
      chatPanelRefs.current.set(id, ref);
    } else {
      chatPanelRefs.current.delete(id);
    }
  }, []);

  // Calculate grid columns based on number of models
  const getGridCols = () => {
    const count = selectedModels.length;
    if (count === 1) return 'grid-cols-1';
    if (count === 2) return 'grid-cols-1 lg:grid-cols-2';
    return 'grid-cols-1 lg:grid-cols-2 xl:grid-cols-3';
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900 sticky top-0 z-40">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Settings Button */}
              <button
                onClick={() => setShowSettings(true)}
                className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors group"
                title="Custom Input Configuration"
              >
                <Settings className="w-4 h-4 text-gray-400 group-hover:text-blue-400 transition-colors" />
                <span className="text-sm text-gray-400 group-hover:text-gray-200">Custom Inputs</span>
                {customInput && (
                  <span className="w-2 h-2 bg-blue-500 rounded-full" />
                )}
              </button>
              
              {/* Sync indicator */}
              {selectedModels.filter(m => m.isSynced).length > 1 && (
                <span className="text-xs text-blue-400 bg-blue-500/20 px-2 py-1 rounded">
                  {selectedModels.filter(m => m.isSynced).length} panels synced
                </span>
              )}
            </div>

            {/* Add Model Button - only show when at least one model is added */}
            {selectedModels.length > 0 && (
              <button
                onClick={() => setShowAddModel(true)}
                className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors text-sm font-medium text-white"
              >
                <Plus className="w-4 h-4" />
                Add Model
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        customInput={customInput}
        onSave={setCustomInput}
      />

      {/* Add Model Dialog */}
      <AddModelDialog
        isOpen={showAddModel}
        onClose={() => setShowAddModel(false)}
        onAdd={handleAddModel}
        modelServingEndpoints={modelServingEndpoints}
        databricksApps={databricksApps}
        loading={loading}
        onRefresh={loadEndpoints}
        selectedEndpoints={selectedModels.map(m => m.endpoint)}
      />

      {/* Main Content */}
      <main className="flex-1 p-4 overflow-hidden">
        {/* Error State */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          </div>
        )}

        {/* Scope Configuration Warning */}
        {scopeErrors.length > 0 && (
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 mb-4">
            <details className="text-xs">
              <summary className="cursor-pointer text-orange-400 font-medium">
                ⚠️ API Scopes Need Configuration ({scopeErrors.length} issue{scopeErrors.length > 1 ? 's' : ''})
              </summary>
              <div className="mt-2 text-orange-300 space-y-1">
                {scopeErrors.map((err, idx) => (
                  <p key={idx}>• {err}</p>
                ))}
                <p className="mt-2 text-gray-400">
                  Go to Apps → dao-ai-arena → Configure → Add scopes: <code className="bg-gray-800 px-1 rounded">serving.serving-endpoints</code> and <code className="bg-gray-800 px-1 rounded">apps</code>
                </p>
              </div>
            </details>
          </div>
        )}

        {/* Chat Panels Grid */}
        {selectedModels.length > 0 ? (
          <div className={`grid ${getGridCols()} gap-4 h-full`}>
            {selectedModels.map((model) => (
              <ChatPanel
                key={model.id}
                ref={(ref) => registerChatPanelRef(model.id, ref)}
                endpoint={model.endpoint}
                customInput={customInput}
                isSynced={model.isSynced}
                inputValue={model.inputValue}
                onInputChange={(value) => handleInputChange(model.id, value)}
                onToggleSync={() => handleToggleSync(model.id)}
                onRemove={() => handleRemoveModel(model.id)}
                onClearInput={() => handleClearInput(model.id)}
                onSyncedSend={handleSyncedSend}
              />
            ))}
          </div>
        ) : (
          /* Empty State */
          <div className="flex flex-col items-center justify-center h-full py-20">
            <div className="w-16 h-16 mb-4 rounded-full bg-gray-800 flex items-center justify-center">
              <Plus className="w-8 h-8 text-gray-600" />
            </div>
            <h2 className="text-lg font-medium text-gray-400 mb-2">
              No models selected
            </h2>
            <p className="text-sm text-gray-500 mb-4 text-center max-w-sm">
              Add models to start comparing AI agents
            </p>
            <button
              onClick={() => setShowAddModel(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors text-sm font-medium text-white flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Model
            </button>

            {loading && (
              <div className="flex items-center gap-2 mt-6 text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Loading endpoints...</span>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
