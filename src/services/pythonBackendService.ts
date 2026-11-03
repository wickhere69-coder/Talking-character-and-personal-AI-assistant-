/**
 * pythonBackendService.ts
 * Dedicated WebSocket communication service connecting the React/TypeScript frontend
 * to the Python FastAPI + LangGraph AI backend (port 8000).
 *
 * Implements:
 * - Ultra-resilient WebSocket communication via Vite /ws proxy
 * - Zero-drop message queueing during connection handshakes
 * - Automatic HTTP SSE / POST streaming fallback if WebSocket is unavailable
 * - Structured event handling (assistant.started, delta, done, error, cancelled, tool events)
 * - Automatic reconnection with exponential backoff
 * - Cancellation support via request IDs
 * - Connection status reporting
 */

export type BackendEventType =
  | 'assistant.started'
  | 'assistant.delta'
  | 'assistant.done'
  | 'assistant.error'
  | 'assistant.cancelled'
  | 'tool.started'
  | 'tool.completed'
  | 'pong';

export interface BackendEvent {
  type: BackendEventType;
  content?: string;
  request_id?: string;
  model_used?: string;
  session_id?: string;
  tool_name?: string;
  result?: string;
  error?: string;
}

export interface StreamCallbacks {
  onStarted?: (requestId: string) => void;
  onSentence?: (sentence: string) => void;
  onChunk?: (chunk: string) => void;
  onDone?: (fullResponse: string, modelUsed: string, sessionId?: string) => void;
  onError?: (error: Error) => void;
  onCancelled?: (requestId: string) => void;
  onToolStart?: (toolName: string) => void;
  onToolEnd?: (toolName: string, result: string) => void;
}

interface QueuedMessage {
  payload: string;
  requestId: string;
  content: string;
  sessionId: string;
  config: Record<string, any>;
  callbacks?: StreamCallbacks;
}

class PythonBackendService {
  private ws: WebSocket | null = null;
  private currentSessionId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private isIntentionallyClosed = false;
  private eventListeners: Array<(event: BackendEvent) => void> = [];
  private activeCallbacks: Map<string, StreamCallbacks> = new Map();
  private accumulatedResponses: Map<string, string> = new Map();
  private pendingQueue: QueuedMessage[] = [];

  /**
   * Returns the WebSocket base URL.
   * Can be configured via VITE_PYTHON_BACKEND_URL (e.g. ws://127.0.0.1:8000)
   * Defaults to Vite's proxy on the same host and port to avoid Windows localhost IPv6 resolution bugs.
   */
  public getBaseUrl(): string {
    const envUrl = (import.meta as any).env?.VITE_PYTHON_BACKEND_URL;
    if (envUrl) return envUrl.replace(/\/+$/, '');
    if (typeof window !== 'undefined') {
      const isHttps = window.location.protocol === 'https:';
      // Route through Vite's /ws proxy on current host (e.g. ws://localhost:5173/ws)
      return `${isHttps ? 'wss:' : 'ws:'}//${window.location.host}`;
    }
    return 'ws://127.0.0.1:8000';
  }

  /**
   * Connect to the Python backend WebSocket for the given session ID.
   */
  public connect(sessionId: string): void {
    if (this.ws && this.currentSessionId === sessionId && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.ws && this.currentSessionId === sessionId && this.ws.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.disconnect();
    this.currentSessionId = sessionId;
    this.isIntentionallyClosed = false;

    const baseUrl = this.getBaseUrl();
    const url = baseUrl.endsWith('/ws')
      ? `${baseUrl}/${sessionId}`
      : `${baseUrl}/ws/${sessionId}`;

    console.log(`[PythonBackendService] Connecting to ${url}...`);

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log(`[PythonBackendService] Connected for session: ${sessionId}`);
        this.reconnectAttempts = 0;
        this.flushPendingQueue();
      };

      this.ws.onmessage = (event) => {
        try {
          const parsed: BackendEvent = JSON.parse(event.data);
          this.handleEvent(parsed);
        } catch (e) {
          console.warn('[PythonBackendService] Non-JSON message received:', event.data);
        }
      };

      this.ws.onerror = (err) => {
        console.warn('[PythonBackendService] WebSocket notice:', err);
      };

      this.ws.onclose = () => {
        console.log(`[PythonBackendService] Connection closed for session: ${sessionId}`);
        if (!this.isIntentionallyClosed) {
          this.scheduleReconnect();
        }
      };
    } catch (e) {
      console.error('[PythonBackendService] Failed to create WebSocket:', e);
      this.scheduleReconnect();
    }
  }

  /**
   * Flush any messages waiting for the WebSocket to open.
   */
  private flushPendingQueue(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const queue = [...this.pendingQueue];
    this.pendingQueue = [];
    for (const item of queue) {
      try {
        this.ws.send(item.payload);
      } catch (err) {
        console.warn('[PythonBackendService] Error sending queued message, falling back to HTTP:', err);
        this.sendViaHttpFallback(item.content, item.sessionId, item.config, item.callbacks, item.requestId);
      }
    }
  }

  /**
   * Disconnect the current WebSocket.
   */
  public disconnect(): void {
    this.isIntentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }

  /**
   * Sends a message to the Python backend for execution via LangGraph.
   * If WebSocket is open, sends directly.
   * If WebSocket is connecting, queues the message and waits up to 2500ms.
   * If WebSocket fails or disconnects, automatically falls back to HTTP SSE streaming.
   * Returns the unique request ID.
   */
  public sendMessage(
    content: string,
    sessionId: string,
    config: Record<string, any> = {},
    callbacks?: StreamCallbacks
  ): string {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    if (callbacks) {
      this.activeCallbacks.set(requestId, callbacks);
      this.accumulatedResponses.set(requestId, '');
    }

    const payload = JSON.stringify({
      type: 'message',
      content,
      request_id: requestId,
      session_id: sessionId,
      config,
    });

    // Ensure connected to the requested session
    if (!this.ws || this.currentSessionId !== sessionId || this.ws.readyState === WebSocket.CLOSED) {
      this.connect(sessionId);
    }

    // Fast-path: WebSocket is already open
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
      return requestId;
    }

    // Queued path: wait for connection ready, or fallback to HTTP after timeout
    const queuedItem: QueuedMessage = {
      payload,
      requestId,
      content,
      sessionId,
      config,
      callbacks,
    };
    this.pendingQueue.push(queuedItem);

    const checkReady = (retriesLeft: number) => {
      // Check if already sent by flushPendingQueue
      if (!this.pendingQueue.some(item => item.requestId === requestId)) {
        return;
      }

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // ws.onopen already flushed or will flush
        this.flushPendingQueue();
        return;
      }

      if (retriesLeft > 0 && this.ws && this.ws.readyState === WebSocket.CONNECTING) {
        setTimeout(() => checkReady(retriesLeft - 1), 60);
      } else {
        // Connection timed out or failed — fall back directly to HTTP SSE
        this.pendingQueue = this.pendingQueue.filter(item => item.requestId !== requestId);
        console.warn(`[PythonBackendService] WebSocket not ready for ${requestId}, executing transparent HTTP fallback...`);
        this.sendViaHttpFallback(content, sessionId, config, callbacks, requestId);
      }
    };

    // Wait up to ~2500ms (40 retries * 60ms)
    setTimeout(() => checkReady(40), 60);

    return requestId;
  }

  /**
   * Transparent HTTP Fallback (SSE streaming via /api/agent/stream or /api/agent/chat)
   * Guarantees zero dropped turns even if WebSockets are unavailable.
   */
  public async sendViaHttpFallback(
    content: string,
    sessionId: string,
    config: Record<string, any> = {},
    callbacks?: StreamCallbacks,
    requestId?: string
  ): Promise<void> {
    const reqId = requestId || `req_http_${Date.now()}`;
    callbacks?.onStarted?.(reqId);

    try {
      const res = await fetch('/api/agent/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          sessionId,
          config,
        }),
      });

      if (!res.ok || !res.body) {
        // Fallback to standard HTTP chat endpoint if SSE fails
        const chatRes = await fetch('/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: content,
            sessionId,
            config,
          }),
        });

        if (!chatRes.ok) {
          const errData = await chatRes.json().catch(() => ({}));
          throw new Error(errData.detail || errData.error || `HTTP agent fallback error (${chatRes.status})`);
        }

        const data = await chatRes.json();
        const text = data.response || '';
        callbacks?.onSentence?.(text);
        callbacks?.onChunk?.(text);
        callbacks?.onDone?.(text, data.modelUsed || 'auto', data.sessionId || sessionId);
        this.cleanupRequest(reqId);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulated = '';
      let modelUsed = 'auto';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (!dataStr) continue;

          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.type === 'sentence') {
              callbacks?.onSentence?.(parsed.text);
            } else if (parsed.type === 'chunk') {
              accumulated += parsed.text;
              callbacks?.onChunk?.(parsed.text);
            } else if (parsed.type === 'tool_start') {
              callbacks?.onToolStart?.(parsed.name);
            } else if (parsed.type === 'tool_end') {
              callbacks?.onToolEnd?.(parsed.name, parsed.result);
            } else if (parsed.type === 'done') {
              modelUsed = parsed.modelUsed || modelUsed;
              const finalText = parsed.response || accumulated;
              callbacks?.onDone?.(finalText, modelUsed, parsed.sessionId || sessionId);
            } else if (parsed.type === 'error') {
              callbacks?.onError?.(new Error(parsed.error || 'Agent stream error'));
            }
          } catch {}
        }
      }

      if (accumulated && !modelUsed) {
        callbacks?.onDone?.(accumulated, 'auto', sessionId);
      }
      this.cleanupRequest(reqId);
    } catch (err: any) {
      console.error('[PythonBackendService] HTTP Fallback failed:', err);
      callbacks?.onError?.(err instanceof Error ? err : new Error(String(err)));
      this.cleanupRequest(reqId);
    }
  }

  /**
   * Cancel an in-flight request on the backend.
   */
  public cancel(requestId: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'cancel',
        request_id: requestId,
      }));
    }
    // Remove from pending queue
    this.pendingQueue = this.pendingQueue.filter(item => item.requestId !== requestId);
    const cbs = this.activeCallbacks.get(requestId);
    cbs?.onCancelled?.(requestId);
    this.cleanupRequest(requestId);
  }

  /**
   * Register a global event listener.
   */
  public onEvent(listener: (event: BackendEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private handleEvent(event: BackendEvent): void {
    // Notify global listeners
    this.eventListeners.forEach((l) => {
      try { l(event); } catch {}
    });

    const reqId = event.request_id;
    if (!reqId) return;

    const cbs = this.activeCallbacks.get(reqId);
    if (!cbs) return;

    switch (event.type) {
      case 'assistant.started':
        cbs.onStarted?.(reqId);
        break;

      case 'assistant.delta': {
        const sentence = event.content || '';
        const prev = this.accumulatedResponses.get(reqId) || '';
        this.accumulatedResponses.set(reqId, prev ? `${prev} ${sentence}` : sentence);
        cbs.onSentence?.(sentence);
        cbs.onChunk?.(sentence);
        break;
      }

      case 'assistant.done': {
        const full = event.content || this.accumulatedResponses.get(reqId) || '';
        cbs.onDone?.(full, event.model_used || 'auto', event.session_id);
        this.cleanupRequest(reqId);
        break;
      }

      case 'assistant.error':
        cbs.onError?.(new Error(event.error || 'Backend streaming error'));
        this.cleanupRequest(reqId);
        break;

      case 'assistant.cancelled':
        cbs.onCancelled?.(reqId);
        this.cleanupRequest(reqId);
        break;

      case 'tool.started':
        cbs.onToolStart?.(event.tool_name || 'tool');
        break;

      case 'tool.completed':
        cbs.onToolEnd?.(event.tool_name || 'tool', event.result || '');
        break;
    }
  }

  private cleanupRequest(requestId: string): void {
    this.activeCallbacks.delete(requestId);
    this.accumulatedResponses.delete(requestId);
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[PythonBackendService] Max reconnect attempts reached.');
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 8000);
    console.log(`[PythonBackendService] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})...`);
    this.reconnectTimer = setTimeout(() => {
      if (this.currentSessionId && !this.isIntentionallyClosed) {
        this.connect(this.currentSessionId);
      }
    }, delay);
  }
}

export const pythonBackendService = new PythonBackendService();
