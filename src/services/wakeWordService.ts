export interface WakeWordServiceConfig {
  onWakeDetected: (phrase: string) => void;
  onError?: (error: string) => void;
}

export interface WakeWordController {
  start: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  isRunning: () => boolean;
}

const WAKE_PATTERN = /\baura\b/i;

export function createWakeWordService(
  config: WakeWordServiceConfig
): WakeWordController | null {
  const SpeechRecognition =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  let running = false;
  let paused = false;
  let recognition: any = null;
  let restartTimeout: ReturnType<typeof setTimeout> | null = null;

  function createRecognition() {
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';
    rec.maxAlternatives = 3;

    rec.onresult = (event: any) => {
      if (paused) return;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        for (let alt = 0; alt < event.results[i].length; alt++) {
          const text = (event.results[i][alt].transcript || '').trim();
          if (WAKE_PATTERN.test(text)) {
            config.onWakeDetected(text);
            return;
          }
        }
      }
    };

    rec.onend = () => {
      if (running && !paused) {
        restartTimeout = setTimeout(() => {
          if (running && !paused) {
            try {
              recognition.start();
            } catch {
              try {
                recognition = createRecognition();
                recognition.start();
              } catch {
                config.onError?.('Wake-word recognition failed to restart');
              }
            }
          }
        }, 150);
      }
    };

    rec.onerror = (event: any) => {
      const code = event?.error || '';
      if (code === 'no-speech' || code === 'aborted') return;
      if (code === 'not-allowed') {
        config.onError?.('Microphone permission denied');
        running = false;
      }
    };

    return rec;
  }

  return {
    start() {
      if (running) return;
      running = true;
      paused = false;
      recognition = createRecognition();
      try {
        recognition.start();
      } catch {
        config.onError?.('Could not start wake-word listener');
      }
    },

    stop() {
      running = false;
      paused = false;
      if (restartTimeout) {
        clearTimeout(restartTimeout);
        restartTimeout = null;
      }
      if (recognition) {
        try { recognition.abort(); } catch {}
        recognition = null;
      }
    },

    pause() {
      if (!running) return;
      paused = true;
      if (restartTimeout) {
        clearTimeout(restartTimeout);
        restartTimeout = null;
      }
      if (recognition) {
        try { recognition.abort(); } catch {}
      }
    },

    resume() {
      if (!running || !paused) return;
      paused = false;
      recognition = createRecognition();
      try {
        recognition.start();
      } catch {}
    },

    isRunning() {
      return running && !paused;
    }
  };
}
