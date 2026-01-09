import { useState, useRef, useEffect } from 'react';
import { RefreshCw, CheckCircle, AlertCircle, ChevronDown, Search } from 'lucide-react';
import { Endpoint } from '../api';

interface EndpointDropdownProps {
  label: string;
  endpoints: Endpoint[];
  selectedEndpointId?: string;
  onSelect: (endpoint: Endpoint | null) => void;
  onRefresh: () => void;
  loading: boolean;
  icon: React.ReactNode;
}

export default function EndpointDropdown({
  label,
  endpoints,
  selectedEndpointId,
  onSelect,
  onRefresh,
  loading,
  icon,
}: EndpointDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedEndpoint = endpoints.find((ep) => ep.id === selectedEndpointId);

  // Filter endpoints based on search term
  const filteredEndpoints = endpoints.filter((ep) =>
    ep.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Clear search when dropdown closes
  const handleClose = () => {
    setIsOpen(false);
    setSearchTerm('');
  };

  const getStatusIcon = (state: string) => {
    const upperState = state.toUpperCase();
    // Check for ready states - green icon
    if (upperState.includes('READY') || upperState === 'RUNNING' || upperState === 'ACTIVE') {
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    }
    // Any other state - orange/warning icon
    return <AlertCircle className="w-4 h-4 text-orange-500" />;
  };

  return (
    <div className="relative">
      <label className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-2">
        {icon}
        {label}
      </label>
      
      <div className="flex gap-2">
        {/* Dropdown */}
        <div className="flex-1 relative">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-left text-gray-200 hover:border-gray-600 focus:outline-none focus:border-blue-500 flex items-center justify-between"
          >
            {selectedEndpoint ? (
              <div className="flex items-center gap-2">
                {getStatusIcon(selectedEndpoint.state)}
                <span>{selectedEndpoint.name}</span>
              </div>
            ) : (
              <span className="text-gray-500">Select endpoint...</span>
            )}
            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Dropdown Menu */}
          {isOpen && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-10"
                onClick={handleClose}
              />
              
              {/* Menu */}
              <div className="absolute z-20 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl flex flex-col max-h-96">
                {/* Search Input */}
                <div className="p-3 border-b border-gray-700">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search endpoints..."
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg pl-10 pr-4 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>

                {/* Scrollable Endpoints List */}
                <div className="overflow-y-auto max-h-64">
                  {/* Clear Selection Option */}
                  {selectedEndpointId && (
                    <button
                      onClick={() => {
                        onSelect(null);
                        handleClose();
                      }}
                      className="w-full px-4 py-2 text-left text-gray-400 hover:bg-gray-700 border-b border-gray-700"
                    >
                      <span className="text-sm">✕ Clear selection</span>
                    </button>
                  )}

                  {/* Endpoints */}
                  {filteredEndpoints.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-500">
                      {searchTerm ? `No endpoints matching "${searchTerm}"` : 'No endpoints available'}
                    </div>
                  ) : (
                    filteredEndpoints.map((endpoint) => (
                    <button
                      key={endpoint.id}
                      onClick={() => {
                        onSelect(endpoint);
                        handleClose();
                      }}
                      className={`w-full px-4 py-3 text-left hover:bg-gray-700 flex items-center justify-between ${
                        endpoint.id === selectedEndpointId ? 'bg-gray-700' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {getStatusIcon(endpoint.state)}
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-gray-200">
                              {endpoint.name}
                            </p>
                            {endpoint.is_mine && (
                              <span className="text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded">
                                You
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400">
                            {endpoint.state}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))
                )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          disabled={loading}
          className={`px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700 transition-colors ${
            loading ? 'cursor-not-allowed opacity-50' : ''
          }`}
          title="Refresh endpoints"
        >
          <RefreshCw className={`w-4 h-4 text-gray-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  );
}
