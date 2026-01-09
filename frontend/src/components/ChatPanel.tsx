import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { X, Loader2, Server, Zap, Send, Clock, ExternalLink, Copy, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Endpoint, ChatMessage } from '../api';
import TraceViewer from './TraceViewer';

interface ChatPanelProps {
  endpoint: Endpoint;
  customInput?: string;
  isSynced: boolean;
  inputValue: string;
  onInputChange: (value: string) => void;
  onToggleSync: () => void;
  onRemove: () => void;
  onClearInput: () => void;
  onSyncedSend?: (messageText: string) => void; // Called when synced panel sends
}

export interface ChatPanelRef {
  triggerSend: (messageText: string) => void;
}

interface MessageData {
  role: string;
  content: string;
  latency?: number;
  ttft?: number;
  trace_id?: string;
  experiment_id?: string;
  tokens?: number;
  custom_outputs?: Record<string, unknown>;
}

// Custom Outputs Viewer with Copy Button
function CustomOutputsViewer({ customOutputs }: { customOutputs: Record<string, unknown> }) {
  const [copied, setCopied] = useState(false);
  
  // Filter out trace_id and format as JSON for custom_inputs
  const filteredOutputs = Object.fromEntries(
    Object.entries(customOutputs).filter(([key]) => key !== 'trace_id')
  );
  
  // Format as JSON - the backend will add it as custom_inputs automatically
  const jsonForCopy = JSON.stringify(filteredOutputs, null, 2);
  const jsonDisplay = JSON.stringify(filteredOutputs, null, 2);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonForCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  return (
    <div className="mt-2 text-xs bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
      {/* Header with copy button */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800/50 border-b border-gray-700">
        <span className="text-purple-400 font-medium">Custom Outputs</span>
        <button
          onClick={handleCopy}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
            copied 
              ? 'bg-green-500/20 text-green-400' 
              : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          }`}
          title="Copy JSON to clipboard"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              Copy
            </>
          )}
        </button>
      </div>
      
      {/* JSON Display */}
      <pre className="p-3 overflow-x-auto text-gray-300 font-mono text-[11px] max-h-48 overflow-y-auto">
        {jsonDisplay}
      </pre>
    </div>
  );
}

// Code block component with copy button
function CodeBlock({ inline, className, children }: {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
  node?: unknown;
}) {
  const [copied, setCopied] = useState(false);
  const codeString = String(children).replace(/\n$/, '');
  const language = className?.replace(/language-/, '') || '';

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(codeString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  // Inline code - no copy button
  if (inline) {
    return <code className={className}>{children}</code>;
  }

  // Block code - with copy button
  return (
    <div className="relative my-2 code-block-container">
      {/* Copy button - always visible with subtle opacity, brighter on hover */}
      <button
        onClick={handleCopy}
        className={`absolute right-2 top-2 z-10 p-1.5 rounded transition-all ${
          copied 
            ? 'bg-green-600 text-white' 
            : 'bg-gray-700/80 hover:bg-gray-600 text-gray-300 hover:text-white'
        }`}
        title={copied ? 'Copied!' : 'Copy code'}
        type="button"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>
      
      {/* Language label */}
      {language && (
        <div className="absolute left-2 top-2 px-2 py-0.5 text-[10px] text-gray-400 bg-gray-800/80 rounded z-10">
          {language}
        </div>
      )}
      
      {/* Code content */}
      <pre className={`rounded-lg ${language ? 'pt-9' : 'pt-2'}`}>
        <code className={className}>
          {children}
        </code>
      </pre>
    </div>
  );
}

// Helper to check if custom_outputs contains session/conversation info for trace search
const hasTraceSearchInfo = (customOutputs?: Record<string, unknown>): boolean => {
  if (!customOutputs) return false;
  
  const configurable = customOutputs.configurable as Record<string, unknown> | undefined;
  const session = customOutputs.session as Record<string, unknown> | undefined;
  
  // Check for conversation_id in session
  if (session && typeof session === 'object' && 'conversation_id' in session) {
    return true;
  }
  
  // Check for thread_id or session_id in configurable
  if (configurable && typeof configurable === 'object') {
    if ('thread_id' in configurable || 'session_id' in configurable) {
      return true;
    }
  }
  
  return false;
};

const ChatPanel = forwardRef<ChatPanelRef, ChatPanelProps>(({ 
  endpoint, 
  customInput, 
  isSynced, 
  inputValue,
  onInputChange,
  onToggleSync, 
  onRemove,
  onClearInput,
  onSyncedSend,
}, ref) => {
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(null);
  const [expandedTraceIndex, setExpandedTraceIndex] = useState<number | null>(null);
  const [expandedOutputsIndex, setExpandedOutputsIndex] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Core send function that takes a message directly
  const sendMessage = async (messageText: string) => {
    if (!messageText.trim() || loading) return;

    // Add user message
    const userMessage: MessageData = { role: 'user', content: messageText };
    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);
    setError(null);
    setFallbackMessage(null);
    setExpandedTraceIndex(null);  // Collapse any open trace viewers
    setExpandedOutputsIndex(null);  // Collapse any open custom outputs

    // Add placeholder for assistant message
    const assistantMessageIndex = messages.length + 1;
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: '',
        latency: undefined,
        ttft: undefined,
        trace_id: undefined,
      },
    ]);

    try {
      // Build chat history for context
      const chatMessages: ChatMessage[] = messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      chatMessages.push({ role: 'user', content: messageText });
      
      let accumulatedContent = '';
      let metadata: { ttft_ms?: number; trace_id?: string; experiment_id?: string; custom_outputs?: Record<string, unknown> } = {};

      const { invokeEndpointStreaming } = await import('../api');
      const result = await invokeEndpointStreaming(
        endpoint.id,
        endpoint.endpoint_type,
        chatMessages,
        (chunk: string) => {
          accumulatedContent += chunk;
          setMessages((prev) => {
            const updated = [...prev];
            updated[assistantMessageIndex] = {
              ...updated[assistantMessageIndex],
              content: accumulatedContent,
            };
            return updated;
          });
        },
        (meta) => {
          metadata = meta;
          console.log('Received metadata:', meta);
        },
        customInput,
        (fallbackMsg) => {
          setFallbackMessage(fallbackMsg);
          // Clear after 3 seconds
          setTimeout(() => setFallbackMessage(null), 3000);
        }
      );

      const estimatedTokens = Math.ceil(accumulatedContent.length / 4);

      setMessages((prev) => {
        const updated = [...prev];
        updated[assistantMessageIndex] = {
          ...updated[assistantMessageIndex],
          latency: result.latency_ms,
          ttft: metadata.ttft_ms,
          trace_id: metadata.trace_id,
          experiment_id: metadata.experiment_id,
          tokens: estimatedTokens,
          custom_outputs: metadata.custom_outputs,
        };
        return updated;
      });
    } catch (err: any) {
      console.error('Error invoking endpoint:', err);
      setError(err.message || 'Failed to get response');
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  // Expose triggerSend method to parent via ref
  useImperativeHandle(ref, () => ({
    triggerSend: (messageText: string) => {
      sendMessage(messageText);
    }
  }));

  // Handle send button click
  const handleSend = async () => {
    const messageText = inputValue.trim();
    if (!messageText || loading) return;

    // Clear input immediately for all synced panels
    onClearInput();
    
    // If synced and onSyncedSend provided, broadcast to other panels
    if (isSynced && onSyncedSend) {
      onSyncedSend(messageText);
    } else {
      // Not synced, just send locally
      sendMessage(messageText);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatLatency = (ms: number) => {
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${ms}ms`;
  };

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg flex flex-col h-[calc(100vh-140px)] min-h-[500px]">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${
            endpoint.endpoint_type === 'model_serving' 
              ? 'bg-purple-500/20 text-purple-400' 
              : 'bg-orange-500/20 text-orange-400'
          }`}>
            {endpoint.endpoint_type === 'model_serving' ? (
              <Server className="w-5 h-5" />
            ) : (
              <Zap className="w-5 h-5" />
            )}
          </div>
          <div>
            <h3 className="font-semibold text-gray-200">{endpoint.name}</h3>
            <p className="text-xs text-gray-500">
              {endpoint.endpoint_type === 'model_serving' ? 'Model Serving' : 'Databricks App'}
            </p>
          </div>
        </div>
        
        <button
          onClick={onRemove}
          className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          title="Remove"
        >
          <X className="w-4 h-4 text-gray-400 hover:text-red-400" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Send a message to start
          </div>
        ) : (
          messages.map((msg, index) => (
            <div key={index} className="space-y-2">
              {/* User Message */}
              {msg.role === 'user' && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-white">U</span>
                  </div>
                  <div className="flex-1 pt-1">
                    <p className="text-sm text-gray-200 whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              )}

              {/* Assistant Message */}
              {msg.role === 'assistant' && (
                <div className="flex gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    endpoint.endpoint_type === 'model_serving' ? 'bg-purple-600' : 'bg-orange-600'
                  }`}>
                    {endpoint.endpoint_type === 'model_serving' ? (
                      <Server className="w-4 h-4 text-white" />
                    ) : (
                      <Zap className="w-4 h-4 text-white" />
                    )}
                  </div>
                  <div className="flex-1 pt-1">
                    {msg.content ? (
                      <div className="text-sm text-gray-200 prose prose-invert prose-sm max-w-none">
                        <ReactMarkdown 
                          remarkPlugins={[remarkGfm]}
                          components={{
                            code: CodeBlock
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    ) : loading && index === messages.length - 1 ? (
                      <div className="flex items-center gap-2 text-gray-400 text-sm">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating...
                      </div>
                    ) : null}

                    {/* Metrics Row */}
                    {msg.content && (msg.ttft || msg.latency) && (
                      <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-gray-400">
                        {msg.ttft && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatLatency(msg.ttft)} TTFT
                          </span>
                        )}
                        {msg.latency && (
                          <>
                            <span className="text-gray-600">•</span>
                            <span>Total: {formatLatency(msg.latency)}</span>
                          </>
                        )}
                        {msg.tokens && msg.latency && (
                          <>
                            <span className="text-gray-600">•</span>
                            <span>{Math.round(msg.tokens / (msg.latency / 1000))} tok/s</span>
                          </>
                        )}
                      </div>
                    )}

                    {/* Links Row - Trace and Outputs (always show after message completes) */}
                    {msg.content && !loading && (
                      <div className="flex items-center gap-3 mt-1 text-xs">
                        {/* MLflow Trace Link - enabled if we have trace_id OR session info to search */}
                        <button
                          onClick={() => {
                            const canViewTrace = msg.trace_id || hasTraceSearchInfo(msg.custom_outputs);
                            if (canViewTrace) {
                              setExpandedTraceIndex(expandedTraceIndex === index ? null : index);
                            }
                          }}
                          disabled={!msg.trace_id && !hasTraceSearchInfo(msg.custom_outputs)}
                          className={`flex items-center gap-1 ${
                            msg.trace_id || hasTraceSearchInfo(msg.custom_outputs)
                              ? 'text-blue-400 hover:text-blue-300 cursor-pointer' 
                              : 'text-gray-600 cursor-not-allowed'
                          }`}
                          title={
                            msg.trace_id 
                              ? 'Click to view MLflow trace' 
                              : hasTraceSearchInfo(msg.custom_outputs)
                              ? 'Search for trace by conversation ID'
                              : 'No trace available for this response'
                          }
                        >
                          <ExternalLink className="w-3 h-3" />
                          {expandedTraceIndex === index ? 'Hide MLflow Trace' : 'View MLflow Trace'}
                        </button>
                        
                        {/* Custom Outputs Link */}
                        <button
                          onClick={() => msg.custom_outputs && Object.keys(msg.custom_outputs).filter(k => k !== 'trace_id').length > 0 && setExpandedOutputsIndex(
                            expandedOutputsIndex === index ? null : index
                          )}
                          disabled={!msg.custom_outputs || Object.keys(msg.custom_outputs).filter(k => k !== 'trace_id').length === 0}
                          className={`flex items-center gap-1 ${
                            msg.custom_outputs && Object.keys(msg.custom_outputs).filter(k => k !== 'trace_id').length > 0
                              ? 'text-purple-400 hover:text-purple-300 cursor-pointer' 
                              : 'text-gray-600 cursor-not-allowed'
                          }`}
                          title={msg.custom_outputs && Object.keys(msg.custom_outputs).filter(k => k !== 'trace_id').length > 0 
                            ? 'Click to view custom outputs' 
                            : 'No custom outputs returned'}
                        >
                          📦 {expandedOutputsIndex === index ? 'Hide Custom Outputs' : 'View Custom Outputs'}
                        </button>
                      </div>
                    )}

                    {/* Custom Outputs Expanded - Formatted JSON with Copy Button */}
                    {expandedOutputsIndex === index && msg.custom_outputs && Object.keys(msg.custom_outputs).filter(k => k !== 'trace_id').length > 0 && (
                      <CustomOutputsViewer customOutputs={msg.custom_outputs} />
                    )}

                    {/* MLflow Trace Viewer (expanded) */}
                    {expandedTraceIndex === index && (
                      <TraceViewer 
                        traceId={msg.trace_id}
                        experimentId={msg.experiment_id}
                        customOutputs={msg.custom_outputs}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/30 flex-shrink-0">
          <p className="text-xs text-red-400">⚠️ {error}</p>
        </div>
      )}

      {/* Fallback Warning */}
      {fallbackMessage && (
        <div className="px-4 py-2 bg-yellow-500/10 border-t border-yellow-500/30 flex-shrink-0">
          <p className="text-xs text-yellow-400">{fallbackMessage}</p>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t border-gray-700 p-3 flex-shrink-0">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              disabled={loading}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 pr-20 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none disabled:opacity-50"
              rows={2}
            />
            
            {/* Sync Checkbox */}
            <label 
              className="absolute right-3 bottom-3 flex items-center gap-1.5 cursor-pointer"
              title={isSynced ? "Synced - sends to all synced panels" : "Not synced - sends only to this panel"}
            >
              <input
                type="checkbox"
                checked={isSynced}
                onChange={onToggleSync}
                className="w-3.5 h-3.5 rounded border-gray-500 bg-gray-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
              />
              <span className={`text-xs ${isSynced ? 'text-blue-400' : 'text-gray-500'}`}>
                Sync
              </span>
            </label>
          </div>
          
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || loading}
            className="px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg transition-colors self-end"
            title={isSynced ? "Send to all synced panels" : "Send to this panel only"}
          >
            <Send className="w-4 h-4 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
});

ChatPanel.displayName = 'ChatPanel';

export default ChatPanel;
