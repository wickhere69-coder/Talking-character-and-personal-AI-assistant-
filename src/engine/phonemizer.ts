import { ARPABET_TO_OCULUS } from './visemeMappings';

export const PRONUNCIATION_DICT: Record<string, string[]> = {
  "the": ["DH", "AH"], "be": ["B", "IY"], "to": ["T", "UW"], "of": ["AH", "V"], "and": ["AE", "N", "D"],
  "a": ["AH"], "in": ["IH", "N"], "that": ["DH", "AE", "T"], "have": ["HH", "AE", "V"], "i": ["AY"],
  "it": ["IH", "T"], "for": ["F", "AO", "R"], "not": ["N", "AA", "T"], "on": ["AA", "N"], "with": ["W", "IH", "DH"],
  "he": ["HH", "IY"], "as": ["AE", "Z"], "you": ["Y", "UW"], "do": ["D", "UW"], "at": ["AE", "T"],
  "this": ["DH", "IH", "S"], "but": ["B", "AH", "T"], "his": ["HH", "IH", "Z"], "by": ["B", "AY"],
  "from": ["F", "R", "AH", "M"], "they": ["DH", "EY"], "we": ["W", "IY"], "her": ["HH", "ER"],
  "she": ["SH", "IY"], "or": ["AO", "R"], "an": ["AE", "N"], "will": ["W", "IH", "L"], "my": ["M", "AY"],
  "one": ["W", "AH", "N"], "all": ["AO", "L"], "would": ["W", "UH", "D"], "there": ["DH", "EH", "R"],
  "their": ["DH", "EH", "R"], "what": ["W", "AH", "T"], "so": ["S", "OW"], "up": ["AH", "P"],
  "out": ["AW", "T"], "if": ["IH", "F"], "about": ["AH", "B", "AW", "T"], "who": ["HH", "UW"],
  "get": ["G", "EH", "T"], "which": ["W", "IH", "CH"], "go": ["G", "OW"], "me": ["M", "IY"],
  "when": ["W", "EH", "N"], "make": ["M", "EY", "K"], "can": ["K", "AE", "N"], "like": ["L", "AY", "K"],
  "time": ["T", "AY", "M"], "no": ["N", "OW"], "just": ["JH", "AH", "S", "T"], "him": ["HH", "IH", "M"],
  "know": ["N", "OW"], "take": ["T", "EY", "K"], "people": ["P", "IY", "P", "AH", "L"], "into": ["IH", "N", "T", "UW"],
  "year": ["Y", "IH", "R"], "your": ["Y", "AO", "R"], "good": ["G", "UH", "D"], "some": ["S", "AH", "M"],
  "could": ["K", "UH", "D"], "them": ["DH", "EH", "M"], "see": ["S", "IY"], "other": ["AH", "DH", "ER"],
  "than": ["DH", "AE", "N"], "then": ["DH", "EH", "N"], "now": ["N", "AW"], "look": ["L", "UH", "K"],
  "only": ["OW", "N", "L", "IY"], "come": ["K", "AH", "M"], "its": ["IH", "T", "S"], "over": ["OW", "V", "ER"],
  "think": ["TH", "IH", "NG", "K"], "also": ["AO", "L", "S", "OW"], "back": ["B", "AE", "K"],
  "after": ["AE", "F", "T", "ER"], "use": ["Y", "UW", "S"], "two": ["T", "UW"], "how": ["HH", "AW"],
  "our": ["AW", "ER"], "work": ["W", "ER", "K"], "first": ["F", "ER", "S", "T"], "well": ["W", "EH", "L"],
  "way": ["W", "EY"], "even": ["IY", "V", "IH", "N"], "new": ["N", "UW"], "want": ["W", "AA", "N", "T"],
  "because": ["B", "IH", "K", "AO", "Z"], "any": ["EH", "N", "IY"], "these": ["DH", "IY", "Z"],
  "give": ["G", "IH", "V"], "day": ["D", "EY"], "most": ["M", "OW", "S", "T"], "us": ["AH", "S"],
  "great": ["G", "R", "EY", "T"], "hello": ["HH", "AH", "L", "OW"], "world": ["W", "ER", "L", "D"],
  "welcome": ["W", "EH", "L", "K", "AH", "M"], "today": ["T", "AH", "D", "EY"], "please": ["P", "L", "IY", "Z"],
  "thank": ["TH", "AE", "NG", "K"], "speak": ["S", "P", "IY", "K"], "talk": ["T", "AO", "K"],
  "listen": ["L", "IH", "S", "AH", "N"], "hear": ["HH", "IH", "R"], "watch": ["W", "AA", "CH"],
  "say": ["S", "EY"], "tell": ["T", "EH", "L"], "voice": ["V", "OY", "S"], "word": ["W", "ER", "D"],
  "text": ["T", "EH", "K", "S", "T"], "speech": ["S", "P", "IY", "CH"], "sound": ["S", "AW", "N", "D"],
  "character": ["K", "EH", "R", "IH", "K", "T", "ER"], "avatar": ["AE", "V", "AH", "T", "AA", "R"],
  "virtual": ["V", "ER", "CH", "UW", "AH", "L"], "digital": ["D", "IH", "JH", "IH", "T", "AH", "L"],
  "face": ["F", "EY", "S"], "mouth": ["M", "AW", "TH"], "eye": ["AY"], "head": ["HH", "EH", "D"],
  "hand": ["HH", "AE", "N", "D"], "body": ["B", "AA", "D", "IY"], "move": ["M", "UW", "V"],
  "open": ["OW", "P", "AH", "N"], "close": ["K", "L", "OW", "S"], "smile": ["S", "M", "AY", "L"],
  "feel": ["F", "IY", "L"], "love": ["L", "AH", "V"], "life": ["L", "AY", "F"], "right": ["R", "AY", "T"],
  "left": ["L", "EH", "F", "T"], "long": ["L", "AO", "NG"], "little": ["L", "IH", "T", "AH", "L"],
  "own": ["OW", "N"], "old": ["OW", "L", "D"], "big": ["B", "IH", "G"], "high": ["HH", "AY"],
  "small": ["S", "M", "AO", "L"], "large": ["L", "AA", "R", "JH"], "next": ["N", "EH", "K", "S", "T"],
  "early": ["ER", "L", "IY"], "young": ["Y", "AH", "NG"], "important": ["IH", "M", "P", "AO", "R", "T", "AH", "N", "T"],
  "few": ["F", "Y", "UW"], "public": ["P", "AH", "B", "L", "IH", "K"], "bad": ["B", "AE", "D"],
  "same": ["S", "EY", "M"], "able": ["EY", "B", "AH", "L"], "last": ["L", "AE", "S", "T"],
  "point": ["P", "OY", "N", "T"], "start": ["S", "T", "AA", "R", "T"], "end": ["EH", "N", "D"],
  "run": ["R", "AH", "N"], "play": ["P", "L", "EY"], "stop": ["S", "T", "AA", "P"],
  "help": ["HH", "EH", "L", "P"], "try": ["T", "R", "AY"], "ask": ["AE", "S", "K"],
  "need": ["N", "IY", "D"], "find": ["F", "AY", "N", "D"], "keep": ["K", "IY", "P"],
  "let": ["L", "EH", "T"], "begin": ["B", "IH", "G", "IH", "N"], "show": ["SH", "OW"],
  "every": ["EH", "V", "R", "IY"], "where": ["W", "EH", "R"], "call": ["K", "AO", "L"],
  "here": ["HH", "IY", "R"], "name": ["N", "EY", "M"], "read": ["R", "IY", "D"],
  "write": ["R", "AY", "T"], "number": ["N", "AH", "M", "B", "ER"], "line": ["L", "AY", "N"],
  "turn": ["T", "ER", "N"], "real": ["R", "IY", "L"], "leave": ["L", "IY", "V"],
  "home": ["HH", "OW", "M"], "live": ["L", "IH", "V"], "might": ["M", "AY", "T"],
  "still": ["S", "T", "IH", "L"], "part": ["P", "AA", "R", "T"], "side": ["S", "AY", "D"],
  "case": ["K", "EY", "S"], "place": ["P", "L", "EY", "S"], "school": ["S", "K", "UW", "L"],
  "group": ["G", "R", "UW", "P"], "country": ["K", "AH", "N", "T", "R", "IY"], "down": ["D", "AW", "N"],
  "must": ["M", "AH", "S", "T"], "should": ["SH", "UH", "D"], "study": ["S", "T", "AH", "D", "IY"],
  "program": ["P", "R", "OW", "G", "R", "AE", "M"], "system": ["S", "IH", "S", "T", "AH", "M"],
  "company": ["K", "AH", "M", "P", "AH", "N", "IY"], "problem": ["P", "R", "AA", "B", "L", "AH", "M"],
  "fact": ["F", "AE", "K", "T"], "idea": ["AY", "D", "IY", "AH"], "room": ["R", "UW", "M"],
  "food": ["F", "UW", "D"], "water": ["W", "AO", "T", "ER"], "state": ["S", "T", "EY", "T"],
  "money": ["M", "AH", "N", "IY"], "story": ["S", "T", "AO", "R", "IY"], "since": ["S", "IH", "N", "S"],
  "house": ["HH", "AW", "S"], "many": ["M", "EH", "N", "IY"], "never": ["N", "EH", "V", "ER"],
  "kind": ["K", "AY", "N", "D"], "off": ["AO", "F"], "much": ["M", "AH", "CH"],
  "question": ["K", "W", "EH", "S", "CH", "AH", "N"], "again": ["AH", "G", "EH", "N"],
  "change": ["CH", "EY", "N", "JH"], "went": ["W", "EH", "N", "T"], "follow": ["F", "AA", "L", "OW"],
  "area": ["EH", "R", "IY", "AH"], "different": ["D", "IH", "F", "R", "AH", "N", "T"],
  "once": ["W", "AH", "N", "S"], "center": ["S", "EH", "N", "T", "ER"], "enough": ["IH", "N", "AH", "F"],
  "second": ["S", "EH", "K", "AH", "N", "D"], "ready": ["R", "EH", "D", "IY"]
};

export function phonemizeWord(word: string): string[] {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return [];
  if (PRONUNCIATION_DICT[w]) return PRONUNCIATION_DICT[w];
  return fallbackPhonemize(w);
}

export function fallbackPhonemize(word: string): string[] {
  let phonemes: string[] = [];
  let i = 0;
  const isSilentE = word.length > 2 && word.endsWith('e') && !/[aeiou]/.test(word[word.length-2]);
  
  while (i < word.length) {
    if (i === word.length - 1 && isSilentE) { i++; continue; }
    
    // Digraphs
    if (i < word.length - 1) {
      const pair = word.substring(i, i + 2);
      if (pair === 'th') { phonemes.push('TH'); i += 2; continue; }
      if (pair === 'sh') { phonemes.push('SH'); i += 2; continue; }
      if (pair === 'ch') { phonemes.push('CH'); i += 2; continue; }
      if (pair === 'ph') { phonemes.push('F'); i += 2; continue; }
      if (pair === 'wh') { phonemes.push('W'); i += 2; continue; }
      if (pair === 'ck') { phonemes.push('K'); i += 2; continue; }
      if (pair === 'ng') { phonemes.push('NG'); i += 2; continue; }
      if (pair === 'qu') { phonemes.push('K', 'W'); i += 2; continue; }
      // Double consonants
      if (pair[0] === pair[1] && !/[aeiou]/.test(pair[0])) { i++; continue; } 
    }
    
    const c = word[i];
    const nextC = i < word.length - 1 ? word[i+1] : '';
    
    if (c === 'a') phonemes.push(isSilentE ? 'EY' : 'AE');
    else if (c === 'e') phonemes.push(isSilentE ? 'IY' : 'EH');
    else if (c === 'i') phonemes.push(isSilentE ? 'AY' : 'IH');
    else if (c === 'o') phonemes.push(isSilentE ? 'OW' : 'AA');
    else if (c === 'u') phonemes.push(isSilentE ? 'UW' : 'AH');
    else if (c === 'b') phonemes.push('B');
    else if (c === 'c') phonemes.push(/[eiy]/.test(nextC) ? 'S' : 'K');
    else if (c === 'd') phonemes.push('D');
    else if (c === 'f') phonemes.push('F');
    else if (c === 'g') phonemes.push(/[eiy]/.test(nextC) ? 'JH' : 'G');
    else if (c === 'h') phonemes.push('HH');
    else if (c === 'j') phonemes.push('JH');
    else if (c === 'k') phonemes.push('K');
    else if (c === 'l') phonemes.push('L');
    else if (c === 'm') phonemes.push('M');
    else if (c === 'n') phonemes.push('N');
    else if (c === 'p') phonemes.push('P');
    else if (c === 'r') phonemes.push('R');
    else if (c === 's') phonemes.push('S');
    else if (c === 't') phonemes.push('T');
    else if (c === 'v') phonemes.push('V');
    else if (c === 'w') phonemes.push('W');
    else if (c === 'x') phonemes.push('K', 'S');
    else if (c === 'y') phonemes.push('Y');
    else if (c === 'z') phonemes.push('Z');
    
    i++;
  }
  return phonemes;
}

export function phonemizeText(text: string): { word: string, phonemes: string[] }[] {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  return words.map(w => {
    const cleanWord = w.replace(/[^a-zA-Z]/g, '');
    return {
      word: w,
      phonemes: phonemizeWord(cleanWord)
    };
  });
}

export function estimatePhonemeTimings(phonemes: string[], wordDurationMs: number): { phoneme: string, startMs: number, endMs: number }[] {
  if (!phonemes.length) return [];
  const VOWELS = ['AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW'];
  let totalWeight = 0;
  const weights = phonemes.map(p => {
    const w = VOWELS.includes(p) ? 1.4 : 1.0;
    totalWeight += w;
    return w;
  });
  
  let currentMs = 0;
  return phonemes.map((p, i) => {
    const dur = (weights[i] / totalWeight) * wordDurationMs;
    const item = { phoneme: p, startMs: currentMs, endMs: currentMs + dur };
    currentMs += dur;
    return item;
  });
}

export interface SpeechVisemeCue {
  timeMs: number;
  durationMs: number;
  viseme: string;
  word: string;
  charIndex: number;
  intensity: number;
  jawOpen: number;
}

const VISEME_JAW_MAP: Record<string, number> = {
  viseme_aa: 0.75,
  viseme_E: 0.4,
  viseme_I: 0.25,
  viseme_O: 0.55,
  viseme_U: 0.35,
  viseme_PP: 0.0,
  viseme_FF: 0.15,
  viseme_TH: 0.2,
  viseme_DD: 0.22,
  viseme_kk: 0.3,
  viseme_CH: 0.25,
  viseme_SS: 0.12,
  viseme_nn: 0.22,
  viseme_RR: 0.25,
  viseme_sil: 0.0
};

export function buildSpeechVisemeTimeline(text: string, rate: number = 1.0): SpeechVisemeCue[] {
  const cues: SpeechVisemeCue[] = [];
  if (!text || !text.trim()) return cues;

  const VOWEL_PHONEMES = ['AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW'];
  let currentTimeMs = 130; // Natural acoustic speech onset lead-in

  const regex = /(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const rawWord = match[0];
    const charIndex = match.index;
    const cleanWord = rawWord.toLowerCase().replace(/[^a-z]/g, '');

    let phonemes = cleanWord ? phonemizeWord(cleanWord) : [];
    if (!phonemes.length && cleanWord.length > 0) {
      phonemes = fallbackPhonemize(cleanWord);
    }
    if (!phonemes.length) {
      phonemes = ['AH'];
    }

    // Dynamic word duration calibrated to natural 150-160 WPM neural speech cadence
    const baseDuration = Math.max(240, Math.min(680, (rawWord.length * 52 + 150) / rate));
    const timings = estimatePhonemeTimings(phonemes, baseDuration);

    for (const t of timings) {
      const cleanP = t.phoneme.replace(/[0-9]/g, '').toUpperCase();
      const visemeName = ARPABET_TO_OCULUS[cleanP] || 'viseme_sil';
      const isVowel = VOWEL_PHONEMES.includes(cleanP);
      const jaw = VISEME_JAW_MAP[visemeName] ?? 0.2;
      const intensity = isVowel ? 0.95 : 0.85;

      cues.push({
        timeMs: Math.round(currentTimeMs + t.startMs),
        durationMs: Math.round(t.endMs - t.startMs),
        viseme: visemeName,
        word: rawWord,
        charIndex,
        intensity,
        jawOpen: jaw
      });
    }

    currentTimeMs += baseDuration;

    // Detect punctuation pause
    if (/[,\;]/.test(rawWord)) {
      const pauseDur = 200 / rate;
      cues.push({
        timeMs: Math.round(currentTimeMs),
        durationMs: Math.round(pauseDur),
        viseme: 'viseme_sil',
        word: '',
        charIndex,
        intensity: 0,
        jawOpen: 0
      });
      currentTimeMs += pauseDur;
    } else if (/[\.\!\?]/.test(rawWord)) {
      const pauseDur = 350 / rate;
      cues.push({
        timeMs: Math.round(currentTimeMs),
        durationMs: Math.round(pauseDur),
        viseme: 'viseme_sil',
        word: '',
        charIndex,
        intensity: 0,
        jawOpen: 0
      });
      currentTimeMs += pauseDur;
    } else {
      // micro inter-word gap
      const gap = 30 / rate;
      currentTimeMs += gap;
    }
  }

  // Final trailing silence cue
  cues.push({
    timeMs: Math.round(currentTimeMs),
    durationMs: 300,
    viseme: 'viseme_sil',
    word: '',
    charIndex: text.length,
    intensity: 0,
    jawOpen: 0
  });

  return cues;
}
