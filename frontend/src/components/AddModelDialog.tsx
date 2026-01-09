import { useState, useEffect, useRef } from 'react';
import { X, Server, Zap, Search, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Endpoint } from '../api';

interface AddModelDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (endpoint: Endpoint) => void;
  modelServingEndpoints: Endpoint[];
  databricksApps: Endpoint[];
  loading: boolean;
  onRefresh: () => void;
  selectedEndpoints: Endpoint[];
}

export default function AddModelDialog({
  isOpen,
  onClose,
  onAdd,
  modelServingEndpoints,
  databricksApps,
  loading,
  onRefresh,
  selectedEndpoints,
}: AddModelDialogProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'model_serving' | 'databricks_app'>('model_serving');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
    }
  }, [isOpen]);

  const getStatusIcon = (state: string) => {
    const upperState = state.toUpperCase();
    if (upperState.includes('READY') || upperState === 'RUNNING' || upperState === 'ACTIVE') {
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    }
    return <AlertCircle className="w-4 h-4 text-orange-500" />;
  };

  const currentEndpoints = activeTab === 'model_serving' ? modelServingEndpoints : databricksApps;
  
  const filteredEndpoints = currentEndpoints.filter((ep) =>
    ep.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const isAlreadySelected = (endpoint: Endpoint) => {
    return selectedEndpoints.some((e) => e.id === endpoint.id);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Dialog */}
      <div className="relative bg-gray-800 border border-gray-700 rounded-lg shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-gray-100">Add Model to Battle</h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setActiveTab('model_serving')}
            className={`flex-1 px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'model_serving'
                ? 'text-purple-400 border-b-2 border-purple-400 bg-purple-500/10'
                : 'text-gray-400 hover:text-gray-300 hover:bg-gray-700/50'
            }`}
          >
            <Server className="w-4 h-4" />
            Model Serving ({modelServingEndpoints.length})
          </button>
          <button
            onClick={() => setActiveTab('databricks_app')}
            className={`flex-1 px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
              activeTab === 'databricks_app'
                ? 'text-orange-400 border-b-2 border-orange-400 bg-orange-500/10'
                : 'text-gray-400 hover:text-gray-300 hover:bg-gray-700/50'
            }`}
          >
            <Zap className="w-4 h-4" />
            Databricks Apps ({databricksApps.length})
          </button>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-gray-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search endpoints..."
              className="w-full bg-gray-900 border border-gray-600 rounded-lg pl-10 pr-4 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Endpoints List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-blue-400 mr-2" />
              <span className="text-gray-400">Loading endpoints...</span>
            </div>
          ) : filteredEndpoints.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              {searchTerm ? `No endpoints matching "${searchTerm}"` : 'No endpoints available'}
            </div>
          ) : (
            <div className="p-2">
              {filteredEndpoints.map((endpoint) => {
                const alreadySelected = isAlreadySelected(endpoint);
                return (
                  <button
                    key={endpoint.id}
                    onClick={() => {
                      if (!alreadySelected) {
                        onAdd(endpoint);
                        onClose();
                      }
                    }}
                    disabled={alreadySelected}
                    className={`w-full p-3 rounded-lg mb-1 text-left transition-colors ${
                      alreadySelected
                        ? 'bg-gray-700/50 cursor-not-allowed opacity-50'
                        : 'hover:bg-gray-700/70'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {getStatusIcon(endpoint.state)}
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-gray-200">
                              {endpoint.name}
                            </p>
                            {endpoint.is_mine && (
                              <span className="text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded">
                                You
                              </span>
                            )}
                            {alreadySelected && (
                              <span className="text-xs bg-gray-600 text-gray-300 px-1.5 py-0.5 rounded">
                                Added
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {endpoint.state}
                          </p>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-3 border-t border-gray-700 bg-gray-800/50">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="text-sm text-blue-400 hover:text-blue-300 disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh list'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-gray-200"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
