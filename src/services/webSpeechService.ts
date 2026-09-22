let cachedVoices: SpeechSynthesisVoice[] = [];

export function getWebSpeechVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    let voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      cachedVoices = voices;
      resolve(voices);
      return;
    }

    const onVoicesChanged = () => {
      voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        cachedVoices = voices;
      }
      resolve(voices);
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
    };

    window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);

    setTimeout(() => {
      const fallback = window.speechSynthesis.getVoices();
      if (fallback.length > 0) {
        cachedVoices = fallback;
      }
      resolve(fallback);
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
    }, 1500);
  });
}

export interface ParsedVoiceInfo {
  voice: SpeechSynthesisVoice;
  isFemale: boolean;
  isMale: boolean;
  displayName: string;
}

const MALE_KEYWORDS = [
  'guy', 'david', 'george', 'mark', 'richard', 'brian',
  'male', 'paul', 'james', 'alex', 'daniel', 'oliver',
  'stefan', 'man', 'boy', 'andrew', 'thomas', 'ryan',
  'christopher', 'edward', 'charles', 'michael', 'william', 'ravi'
];

const FEMALE_KEYWORDS = [
  'jenny', 'zira', 'aria', 'samantha', 'victoria', 'karen',
  'moira', 'tessa', 'fiona', 'susan', 'cathy', 'hazel',
  'female', 'woman', 'eva', 'stephanie', 'catherine', 'clara',
  'natural', 'online', 'girl', 'lady', 'heera', 'priya', 'neerja',
  'ayanda', 'en-us', 'google us english'
];

export function isMaleVoice(nameOrUri: string): boolean {
  const combined = nameOrUri.toLowerCase();
  return MALE_KEYWORDS.some((k) => combined.includes(k));
}

export function getAllCategorizedVoices(allVoices: SpeechSynthesisVoice[]): ParsedVoiceInfo[] {
  // STRICT REQUIREMENT: Completely purge all male voices
  const strictlyNonMale = allVoices.filter((v) => !isMaleVoice(v.name + ' ' + v.voiceURI));

  return strictlyNonMale.map((v) => {
    const combined = (v.name + ' ' + v.voiceURI).toLowerCase();
    const isFemale = FEMALE_KEYWORDS.some((k) => combined.includes(k));
    
    // Clean up long Microsoft/Google prefixes for UI
    let displayName = v.name
      .replace(/^Microsoft\s+/i, '')
      .replace(/^Google\s+/i, '')
      .replace(/\s*-\s*English\s*\(.*?\)/i, '')
      .trim();

    if (!displayName) displayName = v.name;

    return {
      voice: v,
      isFemale: true,
      isMale: false,
      displayName
    };
  });
}

export function getFemaleVoices(allVoices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const pool = allVoices.length > 0 ? allVoices : cachedVoices;
  // Strictly filter out any voice with male keywords
  const strictlyNonMale = pool.filter((v) => !isMaleVoice(v.name + ' ' + v.voiceURI));

  const femaleMatches = strictlyNonMale.filter((v) => {
    const combined = (v.name + ' ' + v.voiceURI).toLowerCase();
    return FEMALE_KEYWORDS.some((k) => combined.includes(k));
  });

  if (femaleMatches.length > 0) {
    return femaleMatches;
  }

  return strictlyNonMale.length > 0 ? strictlyNonMale : pool;
}

let activeUtteranceSession = 0;

export function stopAllAudioAndSpeech(): void {
  activeUtteranceSession++;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
  const audio = typeof document !== 'undefined' ? (document.getElementById('tts-audio') as HTMLAudioElement | null) : null;
  if (audio) {
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute('src');
      audio.load();
    } catch {}
  }
}

export function speakText(
  text: string,
  voiceOrId: SpeechSynthesisVoice | string | null,
  options: {
    rate?: number;
    pitch?: number;
    onBoundary?: (charIndex: number, charLength?: number) => void;
    onEnd?: () => void;
    onStart?: () => void;
    onError?: (error: any) => void;
  } = {}
): SpeechSynthesisUtterance {
  stopAllAudioAndSpeech();

  const sessionId = ++activeUtteranceSession;
  const utterance = new SpeechSynthesisUtterance(text);

  const rawVoices = window.speechSynthesis.getVoices();
  const allVoices = (rawVoices && rawVoices.length > 0) ? rawVoices : cachedVoices;
  if (rawVoices && rawVoices.length > 0) {
    cachedVoices = rawVoices;
  }

  const femaleVoices = getFemaleVoices(allVoices);

  let chosenVoice: SpeechSynthesisVoice | null = null;
  if (voiceOrId) {
    if (typeof voiceOrId === 'string') {
      const cleanId = voiceOrId.split('::')[0].trim().toLowerCase();
      // Ensure we do not pick a male voice
      if (!isMaleVoice(cleanId)) {
        // 1. Exact match
        chosenVoice = femaleVoices.find(v => 
          v.voiceURI.toLowerCase() === cleanId || 
          v.name.toLowerCase() === cleanId
        ) || null;

        // 2. Partial/contains match
        if (!chosenVoice) {
          chosenVoice = femaleVoices.find(v => 
            v.voiceURI.toLowerCase().includes(cleanId) || 
            v.name.toLowerCase().includes(cleanId)
          ) || null;
        }
      }
    } else if (!isMaleVoice(voiceOrId.name + ' ' + voiceOrId.voiceURI)) {
      chosenVoice = voiceOrId;
    }
  }

  // Fallback strictly to female voice
  if (!chosenVoice) {
    chosenVoice = femaleVoices.length > 0 ? femaleVoices[0] : (allVoices.find(v => !isMaleVoice(v.name)) || allVoices[0] || null);
  }

  if (chosenVoice) {
    utterance.voice = chosenVoice;
  }

  utterance.rate = options.rate !== undefined ? options.rate : 1.0;
  utterance.pitch = options.pitch !== undefined ? options.pitch : 1.0;

  if (options.onBoundary) {
    utterance.onboundary = (event) => {
      if (sessionId !== activeUtteranceSession) return;
      options.onBoundary?.(event.charIndex, event.charLength);
    };
  }

  if (options.onStart) {
    utterance.onstart = () => {
      if (sessionId !== activeUtteranceSession) return;
      options.onStart?.();
    };
  }

  if (options.onEnd) {
    utterance.onend = () => {
      if (sessionId !== activeUtteranceSession) return;
      options.onEnd?.();
    };
  }

  if (options.onError) {
    utterance.onerror = (event) => {
      if (sessionId !== activeUtteranceSession) return;
      if (event.error !== 'canceled' && options.onError) {
        options.onError(event);
      }
    };
  }

  // Use a minimal timeout to let Chrome cancel any previous utterance completely
  setTimeout(() => {
    if (sessionId !== activeUtteranceSession) return;
    try {
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('Speech synthesis speak error:', err);
    }
  }, 25);

  return utterance;
}

export function pauseSpeech(): void {
  window.speechSynthesis.pause();
  const audio = typeof document !== 'undefined' ? (document.getElementById('tts-audio') as HTMLAudioElement | null) : null;
  if (audio) {
    try { audio.pause(); } catch {}
  }
}

export function resumeSpeech(): void {
  window.speechSynthesis.resume();
  const audio = typeof document !== 'undefined' ? (document.getElementById('tts-audio') as HTMLAudioElement | null) : null;
  if (audio && audio.src && audio.paused) {
    try { audio.play().catch(() => {}); } catch {}
  }
}

export function cancelSpeech(): void {
  activeUtteranceSession++;
  stopAllAudioAndSpeech();
}

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export interface SpeechRecognitionHandlers {
  onTranscript: (transcript: string, isFinal: boolean) => void;
  onEnd: () => void;
  onError: (error: string) => void;
}

export interface SpeechRecognizerController {
  start: () => void;
  stop: () => void;
  abort: () => void;
  isActive: () => boolean;
}

export function isSpeechRecognitionSupported(): boolean {
  return typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
}

export function createSpeechRecognizer(handlers: SpeechRecognitionHandlers): SpeechRecognizerController | null {
  const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRec) return null;

  let active = false;
  let recognition: any = null;
  let baseTranscript = '';
  let sessionFinalTranscript = '';
  let restartTimeout: any = null;

  const initRecognition = () => {
    if (recognition) {
      try {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.abort();
      } catch {}
    }

    recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      if (!active) return;

      let currentFinal = '';
      let currentInterim = '';

      for (let i = 0; i < event.results.length; ++i) {
        const res = event.results[i];
        if (res.isFinal) {
          currentFinal += res[0].transcript + ' ';
        } else {
          currentInterim += res[0].transcript;
        }
      }

      sessionFinalTranscript = currentFinal;
      const fullText = (baseTranscript + currentFinal + currentInterim).trim();
      if (fullText && active) {
        const isLastFinal = event.results[event.results.length - 1]?.isFinal ?? false;
        handlers.onTranscript(fullText, isLastFinal);
      }
    };

    recognition.onerror = (event: any) => {
      if (!active) return;
      if (event.error === 'no-speech') {
        // Expected browser silence timeout, keep listening if active
        return;
      }
      if (event.error === 'aborted') {
        return;
      }
      handlers.onError(event.error);
    };

    recognition.onend = () => {
      if (!active) {
        handlers.onEnd();
        return;
      }

      // If browser unexpectedly ends the session while user is still speaking (e.g. Chrome's internal 15s limit),
      // merge finalized text into baseTranscript and cleanly restart recognition without cutting off speech.
      baseTranscript = (baseTranscript + sessionFinalTranscript).trim() + (sessionFinalTranscript ? ' ' : '');
      sessionFinalTranscript = '';

      if (restartTimeout) clearTimeout(restartTimeout);
      restartTimeout = setTimeout(() => {
        if (active) {
          try {
            recognition.start();
          } catch {
            try {
              initRecognition();
              recognition.start();
            } catch {
              active = false;
              handlers.onEnd();
            }
          }
        }
      }, 50);
    };
  };

  initRecognition();

  return {
    start: () => {
      active = true;
      baseTranscript = '';
      sessionFinalTranscript = '';
      try {
        recognition.start();
      } catch {
        try {
          initRecognition();
          recognition.start();
        } catch (err) {
          active = false;
          throw err;
        }
      }
    },
    stop: () => {
      active = false;
      if (restartTimeout) clearTimeout(restartTimeout);
      try { recognition.stop(); } catch {}
      handlers.onEnd();
    },
    abort: () => {
      active = false;
      if (restartTimeout) clearTimeout(restartTimeout);
      try { recognition.abort(); } catch {}
      handlers.onEnd();
    },
    isActive: () => active
  };
}
