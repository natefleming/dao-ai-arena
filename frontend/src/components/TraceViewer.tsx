import { useState, useEffect } from 'react';
import { 
  ChevronDown, 
  ChevronRight, 
  Clock, 
  ExternalLink, 
  Loader2, 
  AlertCircle,
  Play,
  Zap,
  MessageSquare,
  Box,
  Search,
  Cpu,
  GitBranch,
  CheckCircle,
  XCircle
} from 'lucide-react';

interface TraceSpan {
  name: string;
  span_type: string;
  start_time_ns: number;
  end_time_ns: number;
  status: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  parent_id?: string;
  span_id?: string;
}

interface TraceData {
  trace_id: string;
  experiment_id?: string;
  timestamp_ms?: number;
  execution_time_ms: number;
  status: string;
  spans: TraceSpan[];
  mlflow_url?: string;
}

interface TraceViewerProps {
  traceId?: string;
  experimentId?: string;
  customOutputs?: Record<string, unknown>;
}

// Icon and color mapping for span types
const SPAN_TYPE_CONFIG: Record<string, { 
  icon: React.ComponentType<{ className?: string }>;
  bg: string; 
  text: string; 
  iconColor: string;
}> = {
  'AGENT': { icon: Zap, bg: 'bg-blue-500/20', text: 'text-blue-400', iconColor: 'text-blue-400' },
  'LLM': { icon: MessageSquare, bg: 'bg-purple-500/20', text: 'text-purple-400', iconColor: 'text-purple-400' },
  'CHAT_MODEL': { icon: MessageSquare, bg: 'bg-purple-500/20', text: 'text-purple-400', iconColor: 'text-purple-400' },
  'CHAIN': { icon: GitBranch, bg: 'bg-green-500/20', text: 'text-green-400', iconColor: 'text-green-400' },
  'TOOL': { icon: Box, bg: 'bg-orange-500/20', text: 'text-orange-400', iconColor: 'text-orange-400' },
  'RETRIEVER': { icon: Search, bg: 'bg-cyan-500/20', text: 'text-cyan-400', iconColor: 'text-cyan-400' },
  'EMBEDDING': { icon: Cpu, bg: 'bg-pink-500/20', text: 'text-pink-400', iconColor: 'text-pink-400' },
  'PARSER': { icon: GitBranch, bg: 'bg-yellow-500/20', text: 'text-yellow-400', iconColor: 'text-yellow-400' },
  'SPAN': { icon: Play, bg: 'bg-gray-500/20', text: 'text-gray-400', iconColor: 'text-gray-400' },
  'UNKNOWN': { icon: Box, bg: 'bg-gray-500/20', text: 'text-gray-400', iconColor: 'text-gray-400' },
};

const getSpanTypeConfig = (spanType: string) => {
  const type = spanType.toUpperCase().replace('_', '');
  // Check for partial matches
  for (const [key, config] of Object.entries(SPAN_TYPE_CONFIG)) {
    if (type.includes(key) || key.includes(type)) {
      return config;
    }
  }
  return SPAN_TYPE_CONFIG['UNKNOWN'];
};

interface SpanNodeProps {
  span: TraceSpan;
  depth: number;
  childSpans: TraceSpan[];
  allSpans: TraceSpan[];
  selectedSpanId: string | null;
  onSelectSpan: (span: TraceSpan) => void;
}

function SpanNode({ span, depth, childSpans, allSpans, selectedSpanId, onSelectSpan }: SpanNodeProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 3);

  const duration = (span.end_time_ns - span.start_time_ns) / 1_000_000; // Convert ns to ms
  const config = getSpanTypeConfig(span.span_type);
  const hasChildren = childSpans.length > 0;
  const isSelected = selectedSpanId === span.span_id;
  const IconComponent = config.icon;

  const formatDuration = (ms: number) => {
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(2)}s`;
    }
    return `${ms.toFixed(0)}ms`;
  };

  return (
    <div>
      {/* Span Row */}
      <div
        className={`flex items-center gap-1 py-1 px-1 cursor-pointer transition-colors rounded ${
          isSelected ? 'bg-blue-600/30 border-l-2 border-blue-500' : 'hover:bg-gray-700/50'
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => onSelectSpan(span)}
      >
        {/* Expand/Collapse */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
          className="w-4 h-4 flex items-center justify-center flex-shrink-0"
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="w-3 h-3 text-gray-400" />
            ) : (
              <ChevronRight className="w-3 h-3 text-gray-400" />
            )
          ) : (
            <span className="w-3" />
          )}
        </button>

        {/* Span Type Icon */}
        <div className={`w-5 h-5 rounded flex items-center justify-center ${config.bg}`}>
          <IconComponent className={`w-3 h-3 ${config.iconColor}`} />
        </div>

        {/* Span Name */}
        <span className={`text-xs truncate flex-1 ${isSelected ? 'text-white' : 'text-gray-300'}`}>
          {span.name}
        </span>

        {/* Duration */}
        <span className="text-[10px] text-gray-500 flex-shrink-0 ml-1">
          {formatDuration(duration)}
        </span>
      </div>

      {/* Child Spans */}
      {isExpanded && childSpans.map((child) => (
        <SpanNode
          key={child.span_id || child.name + child.start_time_ns}
          span={child}
          depth={depth + 1}
          childSpans={allSpans.filter((s) => s.parent_id === child.span_id)}
          allSpans={allSpans}
          selectedSpanId={selectedSpanId}
          onSelectSpan={onSelectSpan}
        />
      ))}
    </div>
  );
}

export default function TraceViewer({ traceId, experimentId, customOutputs }: TraceViewerProps) {
  const [trace, setTrace] = useState<TraceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSpan, setSelectedSpan] = useState<TraceSpan | null>(null);

  useEffect(() => {
    const searchAndFetchTrace = async () => {
      try {
        setLoading(true);
        setError(null);
        
        let targetTraceId = traceId;
        
        // If no direct trace_id, try to search by session/conversation ID
        if (!targetTraceId && customOutputs) {
          console.log('No trace_id provided, searching by custom_outputs:', customOutputs);
          
          // Extract session identifiers from custom_outputs
          const searchParams: Record<string, string> = {};
          
          // Check nested paths for session identifiers
          const configurable = customOutputs.configurable as Record<string, unknown> | undefined;
          const session = customOutputs.session as Record<string, unknown> | undefined;
          
          if (session && typeof session === 'object' && 'conversation_id' in session) {
            searchParams.conversation_id = String(session.conversation_id);
          }
          if (configurable && typeof configurable === 'object') {
            if ('thread_id' in configurable) {
              searchParams.thread_id = String(configurable.thread_id);
            }
            if ('session_id' in configurable) {
              searchParams.session_id = String(configurable.session_id);
            }
          }
          
          if (Object.keys(searchParams).length > 0) {
            // Add experiment_id if available
            if (experimentId) {
              searchParams.experiment_id = experimentId;
              console.log('Searching for trace with params:', searchParams);
              const searchResponse = await fetch('/api/traces/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(searchParams),
              });
              
              if (searchResponse.ok) {
                const searchData = await searchResponse.json();
                targetTraceId = searchData.trace_id;
                console.log(`Found trace via search: ${targetTraceId}`);
              } else {
                const errorData = await searchResponse.json().catch(() => ({}));
                console.warn('Trace search failed:', errorData);
                throw new Error(errorData.error || 'No trace found for this conversation');
              }
            } else {
              // No experiment_id - can't search for traces
              throw new Error('No experiment ID available. For Databricks Apps, ensure the agent has MLflow tracing enabled and is logging to an experiment.');
            }
          } else {
            throw new Error('No session/conversation ID found in custom_outputs');
          }
        }
        
        if (!targetTraceId) {
          throw new Error('No trace ID available');
        }
        
        // Fetch the trace
        const response = await fetch(`/api/traces/${targetTraceId}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to fetch trace');
        }
        const data = await response.json();
        setTrace(data.trace);
        // Auto-select first span
        if (data.trace?.spans?.length > 0) {
          setSelectedSpan(data.trace.spans[0]);
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load trace';
        console.error('Error fetching trace:', err);
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };
    
    if (traceId || customOutputs) {
      searchAndFetchTrace();
    }
  }, [traceId, experimentId, customOutputs]);

  if (loading) {
    return (
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mt-2">
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-blue-400 mr-2" />
          <span className="text-gray-400 text-sm">Loading trace...</span>
        </div>
      </div>
    );
  }

  if (error || !trace) {
    return (
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mt-2">
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4" />
          <span>{error || 'Trace not found'}</span>
        </div>
      </div>
    );
  }

  // Build span hierarchy
  const rootSpans = trace.spans.filter((s) => !s.parent_id);

  const formatDuration = (ms: number) => {
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
    return `${ms.toFixed(0)}ms`;
  };

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg mt-2 overflow-hidden">
      {/* Header - similar to MLflow */}
      <div className="flex items-center gap-2 p-2 border-b border-gray-700 bg-gray-900/50 flex-wrap">
        <span className="text-xs text-gray-400">ID</span>
        <code className="text-xs text-blue-400 font-mono">{trace.trace_id.slice(0, 20)}...</code>
        
        <span className="text-gray-600">•</span>
        
        <Clock className="w-3 h-3 text-gray-400" />
        <span className="text-xs text-gray-300">{formatDuration(trace.execution_time_ms)}</span>
        
        <span className="text-gray-600">•</span>
        
        <span className="text-xs text-gray-400">{trace.spans.length} spans</span>
        
        <span className="text-gray-600">•</span>
        
        <span className={`text-xs flex items-center gap-1 ${trace.status === 'OK' ? 'text-green-400' : 'text-red-400'}`}>
          {trace.status === 'OK' ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
          {trace.status}
        </span>
        
        {trace.mlflow_url && (
          <>
            <span className="flex-1" />
            <a
              href={trace.mlflow_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
            >
              Open in MLflow <ExternalLink className="w-3 h-3" />
            </a>
          </>
        )}
      </div>

      {/* Two-panel layout */}
      <div className="flex" style={{ minHeight: '200px', maxHeight: '400px' }}>
        {/* Left Panel - Trace Tree */}
        <div className="w-1/2 border-r border-gray-700 overflow-y-auto p-1">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider px-2 py-1 border-b border-gray-700/50 mb-1">
            Trace breakdown
          </div>
          {rootSpans.length === 0 ? (
            <div className="text-center py-4 text-gray-500 text-sm">
              No spans found
            </div>
          ) : (
            rootSpans.map((span) => (
              <SpanNode
                key={span.span_id || span.name}
                span={span}
                depth={0}
                childSpans={trace.spans.filter((s) => s.parent_id === span.span_id)}
                allSpans={trace.spans}
                selectedSpanId={selectedSpan?.span_id || null}
                onSelectSpan={setSelectedSpan}
              />
            ))
          )}
        </div>

        {/* Right Panel - Span Details */}
        <div className="w-1/2 overflow-y-auto">
          {selectedSpan ? (
            <div className="p-2">
              {/* Span Header */}
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-700">
                <div className={`w-6 h-6 rounded flex items-center justify-center ${getSpanTypeConfig(selectedSpan.span_type).bg}`}>
                  {(() => {
                    const SpanIcon = getSpanTypeConfig(selectedSpan.span_type).icon;
                    return <SpanIcon className={`w-4 h-4 ${getSpanTypeConfig(selectedSpan.span_type).iconColor}`} />;
                  })()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-200 truncate">{selectedSpan.name}</div>
                  <div className="text-[10px] text-gray-500">{selectedSpan.span_type}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-300">{formatDuration((selectedSpan.end_time_ns - selectedSpan.start_time_ns) / 1_000_000)}</div>
                  <div className={`text-[10px] ${selectedSpan.status === 'OK' ? 'text-green-400' : 'text-red-400'}`}>
                    {selectedSpan.status}
                  </div>
                </div>
              </div>

              {/* Inputs */}
              {selectedSpan.inputs && Object.keys(selectedSpan.inputs).length > 0 && (
                <div className="mb-3">
                  <h4 className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                    → Inputs
                  </h4>
                  <pre className="bg-gray-900 border border-gray-700 p-2 rounded text-[10px] overflow-x-auto text-gray-300 max-h-32 overflow-y-auto">
                    {JSON.stringify(selectedSpan.inputs, null, 2)}
                  </pre>
                </div>
              )}

              {/* Outputs */}
              {selectedSpan.outputs && Object.keys(selectedSpan.outputs).length > 0 && (
                <div className="mb-3">
                  <h4 className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                    ← Outputs
                  </h4>
                  <pre className="bg-gray-900 border border-gray-700 p-2 rounded text-[10px] overflow-x-auto text-gray-300 max-h-32 overflow-y-auto">
                    {JSON.stringify(selectedSpan.outputs, null, 2)}
                  </pre>
                </div>
              )}

              {/* Attributes */}
              {selectedSpan.attributes && Object.keys(selectedSpan.attributes).length > 0 && (
                <div>
                  <h4 className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">
                    Attributes
                  </h4>
                  <pre className="bg-gray-900 border border-gray-700 p-2 rounded text-[10px] overflow-x-auto text-gray-300 max-h-32 overflow-y-auto">
                    {JSON.stringify(selectedSpan.attributes, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">
              Select a span to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
