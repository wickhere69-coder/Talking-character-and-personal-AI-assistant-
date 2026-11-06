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
  | 'pong'
  | 'live.ready'
  | 'live.audio'
  | 'live.transcript'
  | 'live.user_transcript'
  | 'live.interrupted'
  | 'live.turn_complete'
  | 'live.status'
  | 'live.error'
  | 'live.connected'
  | 'live.reconnecting'
  | 'live.turn_started'
  | 'live.generation_complete'
  | 'live.user_transcript_interim'
  | 'live.text_accepted'
  | 'live.go_away'
  | 'tool.cancelled';

export interface BackendEvent {
  type: BackendEventType;
  content?: string;
  request_id?: string;
  model_used?: string;
  session_id?: string;
  tool_name?: string;
  result?: string;
  error?: string;
  text?: string;
  pcm?: string;
  voice_mode?: string;
  model?: string;
  full_text?: string;
  has_gemini?: boolean;
  full?: string;
  user_text?: string;
  voice?: string;
  voices?: string[];
  default_voice_mode?: string;
  resumed?: boolean;
  status?: string;
  fatal?: boolean;
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
  /** Native-voice live turn accepted: audio + transcript now arrive as live.* events. */
  onLiveAccepted?: (requestId: string) => void;
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
  private audioListeners: Array<(pcm: ArrayBuffer) => void> = [];
  private voiceMode: 'custom_voice_pack' | 'native_gemini_live' = 'native_gemini_live';
  private liveVoice = 'Aoede';
  private isIntentionallyClosed = false;
  private eventListeners: Array<(event: BackendEvent) => void> = [];
  private activeCallbacks: Map<string, StreamCallbacks> = new Map();
  private accumulatedResponses: Map<string, string> = new Map();
  private pendingQueue: QueuedMessage[] = [];
  private liveCallbacks: StreamCallbacks | null = null;
  private serverVoiceMode: 'custom_voice_pack' | 'native_gemini_live' = 'custom_voice_pack';

  public getServerVoiceMode(): 'custom_voice_pack' | 'native_gemini_live' {
    return this.serverVoiceMode;
  }

  public setLiveCallbacks(callbacks: StreamCallbacks | null): void {
    this.liveCallbacks = callbacks;
  }

  /** Register a listener for Gemini's native 24 kHz PCM voice (binary frames). */
  public onAudio(listener: (pcm: ArrayBuffer) => void): () => void {
    this.audioListeners.push(listener);
    return () => { this.audioListeners = this.audioListeners.filter((l) => l !== listener); };
  }

  /** Voice mode + Gemini voice; applied on connect (query string) and live via live.config. */
  public setLiveConfig(voiceMode: 'custom_voice_pack' | 'native_gemini_live', voice?: string, force = false): void {
    const changed = force || voiceMode !== this.voiceMode || (!!voice && voice !== this.liveVoice);
    this.voiceMode = voiceMode;
    if (voice) this.liveVoice = voice;
    this.serverVoiceMode = voiceMode;
    if (changed && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'live.config', voice_mode: voiceMode, voice: this.liveVoice }));
    }
  }

  /**
   * Streams a 16 kHz PCM16 mic frame to Gemini Live as a binary frame.
   * Drops frames if the socket is backed up so latency can't accumulate.
   */
  public sendAudioChunk(pcm: ArrayBuffer | Uint8Array): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 192 * 1024) return; // ~6 s of audio queued: network stalled
    try {
      ws.send(pcm);
    } catch (e) {
      console.debug('[PythonBackendService] sendAudioChunk notice:', e);
    }
  }

  /**
   * Notifies Gemini Live that audio stream ended (Hybrid VAD).
   */
  public sendAudioStreamEnd(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'live.audio_end' }));
    }
  }

  /**
   * Handshake to initialize Gemini Live session.
   */
  public connectLive(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'live.connect' }));
    }
  }

  /**
   * Returns the WebSocket base URL.
   * Can be configured via VITE_PYTHON_BACKEND_URL (e.g. ws://127.0.0.1:8000)
   * Connects directly to port 8000 in local dev to bypass Vite proxy latency (<5ms connect).
   */
  public getBaseUrl(): string {
    const envUrl = (import.meta as any).env?.VITE_PYTHON_BACKEND_URL;
    if (envUrl) return envUrl.replace(/\/+$/, '');
    if (typeof window !== 'undefined') {
      const isHttps = window.location.protocol === 'https:';
      const host = window.location.hostname || '127.0.0.1';
      // In local dev, connect directly to Python backend port 8000 for lowest possible latency
      if (host === 'localhost' || host === '127.0.0.1') {
        return `ws://${host}:8000/ws`;
      }
      return `${isHttps ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
    }
    return 'ws://127.0.0.1:8000/ws';
  }

  /**
   * Switch the active conversation session.
   * If WebSocket is already open, sends an instant in-band switch message (0ms, zero reconnect).
   */
  public switchSession(sessionId: string): void {
    if (this.currentSessionId === sessionId && this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    this.currentSessionId = sessionId;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'switch_session', session_id: sessionId }));
        console.log(`[PythonBackendService] Switched session context to ${sessionId} (instant in-band)`);
        return;
      } catch (e) {
        console.debug('[PythonBackendService] switch_session notice:', e);
      }
    }

    this.connect(sessionId);
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
    const qs = `?voice_mode=${encodeURIComponent(this.voiceMode)}&voice=${encodeURIComponent(this.liveVoice)}`;
    const url = (baseUrl.endsWith('/ws')
      ? `${baseUrl}/${sessionId}`
      : `${baseUrl}/ws/${sessionId}`) + qs;

    console.log(`[PythonBackendService] Connecting directly to ${url}...`);

    try {
      const socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      this.ws = socket;

      socket.onopen = () => {
        if (this.ws !== socket) return;
        console.log(`[PythonBackendService] Connected for session: ${sessionId}`);
        this.reconnectAttempts = 0;
        this.flushPendingQueue();
      };

      socket.onmessage = (event) => {
        if (this.ws !== socket) return;
        if (event.data instanceof ArrayBuffer) {
          for (const l of this.audioListeners) {
            try { l(event.data); } catch (e) { console.debug('[PythonBackendService] audio listener notice:', e); }
          }
          return;
        }
        try {
          const parsed: BackendEvent = JSON.parse(event.data);
          this.handleEvent(parsed);
        } catch (e) {
          console.warn('[PythonBackendService] Non-JSON message received:', event.data);
        }
      };

      socket.onerror = (err) => {
        console.warn('[PythonBackendService] WebSocket notice:', err);
      };

      socket.onclose = () => {
        if (this.ws !== socket) return; // a replaced socket closing is expected
        console.log(`[PythonBackendService] Connection closed for session: ${sessionId}`);
        this.eventListeners.forEach((l) => { try { l({ type: 'live.reconnecting' }); } catch {} });
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
      } catch { }
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
          } catch { }
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
   * Cancel an in-flight request on the backend with optional spoken content recorded for resumption.
   */
  public cancel(requestId: string, spokenContent?: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'cancel',
        request_id: requestId,
        spoken_content: spokenContent || '',
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
      try { l(event); } catch { }
    });

    if (event.type === 'live.ready' && event.voice_mode) {
      this.serverVoiceMode = event.voice_mode as any;
      console.log(`[PythonBackendService] Gemini Live ready. Mode: ${this.serverVoiceMode}, model: ${event.model}`);
    }

    const reqId = event.request_id;
    const cbs = reqId ? this.activeCallbacks.get(reqId) : undefined;

    if (cbs) {
      switch (event.type) {
        case 'assistant.started':
          cbs.onStarted?.(reqId!);
          break;

        case 'assistant.delta': {
          const sentence = event.content || '';
          const prev = this.accumulatedResponses.get(reqId!) || '';
          this.accumulatedResponses.set(reqId!, prev ? `${prev} ${sentence}` : sentence);
          cbs.onSentence?.(sentence);
          cbs.onChunk?.(sentence);
          break;
        }

        case 'assistant.done': {
          const full = event.content || this.accumulatedResponses.get(reqId!) || '';
          cbs.onDone?.(full, event.model_used || 'auto', event.session_id);
          this.cleanupRequest(reqId!);
          break;
        }

        case 'assistant.error':
          cbs.onError?.(new Error(event.error || 'Backend streaming error'));
          this.cleanupRequest(reqId!);
          break;

        case 'assistant.cancelled':
          cbs.onCancelled?.(reqId!);
          this.cleanupRequest(reqId!);
          break;

        case 'tool.started':
          cbs.onToolStart?.(event.tool_name || 'tool');
          break;

        case 'tool.completed':
          cbs.onToolEnd?.(event.tool_name || 'tool', event.result || '');
          break;

        case 'live.text_accepted':
          // Native voice: the reply arrives as live.* events handled by the controller.
          if (event.voice_mode !== 'custom_voice_pack') {
            cbs.onLiveAccepted?.(reqId!);
            this.cleanupRequest(reqId!);
          }
          break;
      }
    } else if (this.liveCallbacks) {
      // Direct live callbacks routing for full-duplex session (continuous mic stream or live turns without request ID)
      if (event.type === 'assistant.delta' && event.content) {
        this.liveCallbacks.onSentence?.(event.content);
        this.liveCallbacks.onChunk?.(event.content);
      } else if (event.type === 'assistant.done') {
        this.liveCallbacks.onDone?.(event.content || '', event.model_used || 'gemini-3.8-live', event.session_id);
      } else if (event.type === 'assistant.cancelled' || event.type === 'live.interrupted') {
        this.liveCallbacks.onCancelled?.(reqId || 'live_turn');
      } else if (event.type === 'tool.started') {
        this.liveCallbacks.onToolStart?.(event.tool_name || 'tool');
      } else if (event.type === 'tool.completed') {
        this.liveCallbacks.onToolEnd?.(event.tool_name || 'tool', event.result || '');
      }
    }
  }

  private cleanupRequest(requestId: string): void {
    this.activeCallbacks.delete(requestId);
    this.accumulatedResponses.delete(requestId);
  }

  private scheduleReconnect(): void {
    // Keep trying forever (capped backoff) — a live companion should recover on its own
    // when the backend restarts, instead of going silent after a few attempts.
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(400 * Math.pow(1.6, this.reconnectAttempts - 1), 5000);
    console.log(`[PythonBackendService] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.currentSessionId && !this.isIntentionallyClosed) {
        this.connect(this.currentSessionId);
      }
    }, delay);
  }
}

export const pythonBackendService = new PythonBackendService();
