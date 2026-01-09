/**
 * API client for DAO AI Arena backend
 */
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

export interface Endpoint {
  id: string;
  name: string;
  endpoint_type: 'model_serving' | 'databricks_app';
  state: string;
  url: string;
  description?: string;
  config?: any;
  creator?: string;
  is_mine?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface InvokeResponse {
  response: string;
  latency_ms: number;
  ttft_ms: number;
  endpoint_type: string;
  endpoint_id: string;
  trace_id?: string;
  error?: string;
}

export interface FetchEndpointsResponse {
  endpoints: Endpoint[];
  errors?: string[];
  scope_configuration_needed?: boolean;
}

/**
 * Fetch all available endpoints
 */
export async function fetchEndpoints(): Promise<FetchEndpointsResponse> {
  const response = await api.get<FetchEndpointsResponse>('/endpoints/all');
  return response.data;
}

/**
 * Invoke an endpoint with streaming support
 */
export interface StreamingMetadata {
  ttft_ms?: number;
  trace_id?: string;
  experiment_id?: string;
  custom_outputs?: Record<string, unknown>;
}

export async function invokeEndpointStreaming(
  endpointId: string,
  endpointType: string,
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
  onMetadata: (metadata: StreamingMetadata) => void,
  customInput?: string,
  onFallback?: (message: string) => void
): Promise<{ latency_ms: number }> {
  const startTime = Date.now();
  
  const body: any = {
    endpoint_id: endpointId,
    endpoint_type: endpointType,
    messages,
  };
  
  // Add custom input if provided
  if (customInput && customInput.trim()) {
    try {
      body.custom_input = JSON.parse(customInput);
    } catch (e) {
      console.error('Failed to parse custom input:', e);
    }
  }
  
  try {
    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to invoke endpoint');
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('No response body');
    }

    let buffer = '';
    let ttft_ms: number | undefined;
    let trace_id: string | undefined;
    let experiment_id: string | undefined;

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data: ')) continue;
        
        const data = line.slice(6); // Remove 'data: ' prefix
        
        if (data === '[DONE]') {
          continue;
        }
        
        try {
          const parsed = JSON.parse(data);
          
          if (parsed.type === 'content') {
            onChunk(parsed.content);
          } else if (parsed.type === 'metadata') {
            ttft_ms = parsed.ttft_ms;
            trace_id = parsed.trace_id;
            experiment_id = parsed.experiment_id;
            onMetadata({ 
              ttft_ms, 
              trace_id,
              experiment_id,
              custom_outputs: parsed.custom_outputs 
            });
          } else if (parsed.type === 'error') {
            throw new Error(parsed.error || 'Streaming error');
          }
        } catch (e) {
          console.error('Error parsing SSE data:', e, data);
        }
      }
    }

    const latency_ms = Date.now() - startTime;
    return { latency_ms };
    
  } catch (error: any) {
    console.warn('Streaming failed, falling back to non-streaming:', error.message);
    
    // Notify about fallback
    if (onFallback) {
      onFallback('⚠️ Streaming unavailable, using batch mode...');
    }
    
    // Fallback to non-streaming
    const fallbackResponse = await invokeEndpoint(endpointId, endpointType, messages);
    
    // Send response as single chunk
    onChunk(fallbackResponse.response);
    
    // Send metadata
    onMetadata({
      ttft_ms: fallbackResponse.ttft_ms,
      trace_id: fallbackResponse.trace_id,
    });
    
    const latency_ms = Date.now() - startTime;
    return { latency_ms };
  }
}

/**
 * Invoke an endpoint with a message (non-streaming, kept for compatibility)
 */
export async function invokeEndpoint(
  endpointId: string,
  endpointType: string,
  messages: ChatMessage[]
): Promise<InvokeResponse> {
  const response = await api.post<InvokeResponse>('/chat/invoke', {
    endpoint_id: endpointId,
    endpoint_type: endpointType,
    messages,
    stream: false,
  });
  return response.data;
}

/**
 * Get authentication info
 */
export async function getAuthInfo() {
  const response = await api.get('/auth/info');
  return response.data;
}
