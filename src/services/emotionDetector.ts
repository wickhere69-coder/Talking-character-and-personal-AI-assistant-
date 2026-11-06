export type EmotionType =
  | 'neutral'
  | 'happy'
  | 'excited'
  | 'curious'
  | 'concerned'
  | 'empathetic'
  | 'thoughtful'
  | 'surprised'
  | 'amused'
  | 'confident';

export interface EmotionState {
  primary: EmotionType;
  intensity: number;
  secondary: EmotionType | null;
}

interface PatternRule {
  emotion: EmotionType;
  weight: number;
  patterns: RegExp[];
  keywords: string[];
}

const NEUTRAL: EmotionState = { primary: 'neutral', intensity: 0.3, secondary: null };

// What Aura says → how Aura's face should look while saying it.
const SPEAKER_RULES: PatternRule[] = [
  {
    emotion: 'happy',
    weight: 1.0,
    patterns: [/😊|😄|🎉|🥰/, /\b(glad|nice|great) to\b/i, /\bso happy\b/i],
    keywords: [
      'great', 'wonderful', 'fantastic', 'awesome', 'love', 'lovely', 'glad', 'happy', 'pleased',
      'delighted', 'excellent', 'perfect', 'beautiful', 'brilliant', 'congratulations', 'congrats',
      'well done', 'nice work', 'welcome', 'enjoy', 'cute', 'adorable', 'sweet', 'yay',
      'hello', 'hi', 'hey', 'good morning', 'good evening',
    ],
  },
  {
    emotion: 'excited',
    weight: 1.2,
    patterns: [/!{2,}/, /\bcan'?t wait\b/i, /\bso excited\b/i, /\boh my gosh\b/i],
    keywords: ['exciting', 'thrilling', 'incredible', 'unbelievable', 'wow', "let's go", 'pumped', 'huge', 'epic', 'insane', 'whoa'],
  },
  {
    emotion: 'curious',
    weight: 0.9,
    patterns: [/\?\s*$/, /\bI wonder\b/i, /\bwhat if\b/i, /\btell me more\b/i, /\bhow come\b/i],
    keywords: ['interesting', 'fascinating', 'curious', 'intriguing', 'wonder', 'mysterious', 'universe', 'cosmos'],
  },
  {
    emotion: 'concerned',
    weight: 1.0,
    patterns: [/\bbe careful\b/i, /\bwatch out\b/i, /\bheads up\b/i, /\bmake sure you\b/i],
    keywords: ['careful', 'warning', 'caution', 'risk', 'risky', 'danger', 'dangerous', 'unfortunately', 'worried', 'worrying', 'concerning', 'serious'],
  },
  {
    emotion: 'empathetic',
    weight: 1.15,
    patterns: [
      /\bI('m| am) (so )?sorry\b/i,
      /\bthat (must|sounds) (be )?(hard|tough|rough|awful|exhausting|overwhelming|stressful)/i,
      /\bdon'?t be (too )?hard on yourself\b/i, /\bit'?s (gonna be )?okay\b/i, /\bI'?m here\b/i,
      /\b(that'?s|that is|it'?s) (so much|a lot|a heavy)\b/i, /\bon your plate\b/i, /\bdeep breath\b/i,
    ],
    keywords: ['sorry', 'oh no', 'ugh', 'overwhelming', 'exhausting', 'tough', 'rough', 'heavy', 'pressure', 'hang in there', 'take your time', 'no rush', 'gently', 'breathe', 'you got this', 'proud of you', 'understandable', 'one step at a time'],
  },
  {
    emotion: 'thoughtful',
    weight: 0.8,
    patterns: [/\bon the other hand\b/i, /\bthat said\b/i, /\bit depends\b/i, /\bhmm+\b/i, /\blet me think\b/i],
    keywords: ['perhaps', 'maybe', 'consider', 'nuanced', 'complex', 'trade-off', 'tradeoff', 'honestly', 'actually', 'technically', 'reason'],
  },
  {
    emotion: 'surprised',
    weight: 1.3,
    patterns: [/\breally\?/i, /\bno way\b/i, /\boh my(?! gosh)\b/i, /\bwait,? what\b/i, /\bseriously\?/i],
    keywords: ['surprising', 'unexpected', 'astonishing', 'mind-blowing', 'shocking', "didn't expect", 'never knew'],
  },
  {
    emotion: 'amused',
    weight: 1.1,
    patterns: [
      /\b(ha){2,}\b/i, /\bhaha\w*\b/i, /\blol\b/i, /😂|🤣/, /\bthat'?s (so )?funny\b/i,
      /\bwhy (don'?t|did|do|does|was|is|can'?t)\b[^?]{3,80}\?/i,  // joke setup
      /\bbecause they\b/i, /\bwhat do you call\b/i,
    ],
    keywords: ['funny', 'hilarious', 'joke', 'kidding', 'silly', 'pun', 'heh', 'ha', 'pivot'],
  },
  {
    emotion: 'confident',
    weight: 0.9,
    patterns: [/\bhere'?s (how|what)\b/i, /\bthe answer is\b/i, /\btrust me\b/i, /\byou can do\b/i],
    keywords: ['definitely', 'absolutely', 'exactly', 'precisely', 'of course', 'no doubt', 'clearly', 'guaranteed', 'easy', 'simple'],
  },
];

// What the user says → how Aura's face should react while *listening*.
const LISTENER_RULES: PatternRule[] = [
  {
    emotion: 'empathetic',
    weight: 1.3,
    patterns: [/\bI('m| am) (so |really |honestly )?(stressed|sad|tired|exhausted|anxious|worried|lonely|overwhelmed|depressed|scared|burnt? out|sick)\b/i, /\b(bad|rough|long|terrible) day\b/i, /\bI can'?t (do|handle|take)\b/i],
    keywords: ['stressed', 'sad', 'tired', 'exhausted', 'anxious', 'lonely', 'overwhelmed', 'upset', 'hurt', 'cry', 'crying', 'miss', 'lost', 'died', 'passed away', 'breakup', 'broke up', 'fired', 'sick', 'ugh'],
  },
  {
    emotion: 'concerned',
    weight: 1.1,
    patterns: [/\b(so |really )?(angry|mad|furious|annoyed|frustrated)\b/i, /\bwhat should I do\b/i],
    keywords: ['problem', 'broken', 'urgent', 'emergency', 'help me', 'scared', 'afraid', 'deadline', 'pain'],
  },
  {
    emotion: 'happy',
    weight: 1.1,
    patterns: [/\bI('m| am) (so |really )?(happy|glad|excited|thrilled|proud)\b/i, /\bguess what\b/i],
    keywords: ['got the job', 'promoted', 'passed', 'won', 'adopted', 'engaged', 'married', 'birthday', 'vacation', 'great news', 'love', 'amazing', 'awesome', 'yay'],
  },
  {
    emotion: 'excited',
    weight: 1.0,
    patterns: [/!{2,}/, /\bcan'?t wait\b/i, /\boh my god\b/i],
    keywords: ['excited', 'finally', 'incredible', 'insane', 'wow'],
  },
  {
    emotion: 'amused',
    weight: 1.0,
    patterns: [/\b(ha){2,}\b/i, /\blol\b/i, /\blmao\b/i, /\bjoke\b/i],
    keywords: ['funny', 'hilarious', 'kidding'],
  },
  {
    emotion: 'curious',
    weight: 0.7,
    patterns: [/\?\s*$/, /^(what|how|why|who|where|when|can you|could you|tell me|explain)\b/i],
    keywords: ['wonder', 'curious', 'explain'],
  },
];

const NEGATORS = /\b(not|no|never|hardly|barely|isn'?t|wasn'?t|aren'?t|don'?t|doesn'?t|didn'?t|n't)\s+(\w+\s+){0,2}$/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const compiled = new WeakMap<PatternRule, RegExp>();
function keywordRegex(rule: PatternRule): RegExp {
  let re = compiled.get(rule);
  if (!re) {
    re = new RegExp(`\\b(?:${rule.keywords.map(escapeRe).join('|')})\\b`, 'gi');
    compiled.set(rule, re);
  }
  re.lastIndex = 0;
  return re;
}

function scoreText(text: string, rules: PatternRule[]): Map<EmotionType, number> {
  const scores = new Map<EmotionType, number>();
  for (const rule of rules) {
    let score = 0;
    const re = keywordRegex(rule);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const before = text.slice(Math.max(0, m.index - 24), m.index);
      if (NEGATORS.test(before)) continue; // "not happy" isn't happy
      score += rule.weight;
    }
    for (const pat of rule.patterns) {
      if (pat.test(text)) score += rule.weight * 1.5;
    }
    if (score > 0) scores.set(rule.emotion, (scores.get(rule.emotion) || 0) + score);
  }
  return scores;
}

function toState(scores: Map<EmotionType, number>): EmotionState {
  if (scores.size === 0) return { ...NEUTRAL };
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted[0][1];
  return {
    primary: sorted[0][0],
    intensity: Math.min(1, 0.35 + top * 0.14),
    secondary: sorted.length > 1 && sorted[1][1] > top * 0.4 ? sorted[1][0] : null,
  };
}

/** Emotion Aura should express while saying `text`. */
export function detectEmotion(text: string): EmotionState {
  if (!text || text.trim().length < 2) return { ...NEUTRAL };
  return toState(scoreText(text, SPEAKER_RULES));
}

/** Expression Aura should show while *listening* to the user say `text`. */
export function detectListenerEmotion(text: string): EmotionState {
  if (!text || text.trim().length < 2) return { ...NEUTRAL };
  return toState(scoreText(text, LISTENER_RULES));
}

/**
 * Smooths raw per-sentence detections into believable facial emotion:
 * evidence accumulates and decays (half-life ~3.5 s), a new emotion has to clearly
 * beat the current one to take over (hysteresis), short "pulses" model reactions
 * like a flicker of surprise on being interrupted, and voice energy modulates
 * intensity. Returns a new state only when it meaningfully changes.
 */
export class EmotionTracker {
  private evidence = new Map<EmotionType, number>();
  private lastDecay = performance.now();
  private current: EmotionState = { ...NEUTRAL };
  private pulseState: { state: EmotionState; until: number } | null = null;
  private energy = 0;
  private lastEmitted: EmotionState = { ...NEUTRAL };

  private static HALF_LIFE_MS = 3500;
  private static THRESHOLD = 0.45;

  private decay(now: number): void {
    const dt = now - this.lastDecay;
    this.lastDecay = now;
    if (dt <= 0) return;
    const k = Math.pow(0.5, dt / EmotionTracker.HALF_LIFE_MS);
    for (const [e, v] of this.evidence) {
      const nv = v * k;
      if (nv < 0.02) this.evidence.delete(e);
      else this.evidence.set(e, nv);
    }
  }

  /** Feed a new piece of text. `source` picks the speaker or listener lexicon. */
  public observe(text: string, source: 'assistant' | 'user' = 'assistant', weight = 1): EmotionState | null {
    const now = performance.now();
    this.decay(now);
    const detected = source === 'user' ? detectListenerEmotion(text) : detectEmotion(text);
    if (detected.primary !== 'neutral') {
      const add = (detected.intensity - 0.2) * weight;
      this.evidence.set(detected.primary, (this.evidence.get(detected.primary) || 0) + add);
      if (detected.secondary) {
        this.evidence.set(detected.secondary, (this.evidence.get(detected.secondary) || 0) + add * 0.35);
      }
    }
    return this.recompute(now);
  }

  /** A brief involuntary reaction (e.g. surprise when interrupted). */
  public pulse(primary: EmotionType, intensity: number, ms: number): EmotionState | null {
    this.pulseState = { state: { primary, intensity, secondary: null }, until: performance.now() + ms };
    return this.recompute(performance.now());
  }

  /** 0..1 loudness of the voice right now (prosody → intensity). */
  public setEnergy(energy: number): void {
    this.energy = this.energy * 0.85 + energy * 0.15;
  }

  /** Call periodically (e.g. every 250 ms) so emotions relax back to neutral. */
  public tick(): EmotionState | null {
    const now = performance.now();
    this.decay(now);
    return this.recompute(now);
  }

  public reset(): EmotionState | null {
    this.evidence.clear();
    this.pulseState = null;
    return this.recompute(performance.now());
  }

  public get state(): EmotionState {
    return this.lastEmitted;
  }

  private recompute(now: number): EmotionState | null {
    if (this.pulseState && now < this.pulseState.until) {
      return this.emit(this.pulseState.state);
    }
    this.pulseState = null;

    let best: EmotionType = 'neutral';
    let bestScore = 0;
    let second: EmotionType | null = null;
    let secondScore = 0;
    for (const [e, v] of this.evidence) {
      if (v > bestScore) { second = best === 'neutral' ? null : best; secondScore = bestScore; best = e; bestScore = v; }
      else if (v > secondScore) { second = e; secondScore = v; }
    }

    const curScore = this.evidence.get(this.current.primary) || 0;
    let primary: EmotionType = this.current.primary;
    if (this.current.primary === 'neutral' || curScore < EmotionTracker.THRESHOLD * 0.6) {
      primary = bestScore >= EmotionTracker.THRESHOLD ? best : 'neutral';
    } else if (best !== this.current.primary && bestScore > curScore * 1.3) {
      primary = best; // clearly stronger new feeling takes over
    }

    const score = primary === 'neutral' ? 0 : (this.evidence.get(primary) || 0);
    let intensity = primary === 'neutral' ? 0.3 : Math.min(1, 0.35 + score * 0.3);
    if (primary === 'happy' || primary === 'excited' || primary === 'amused') {
      intensity = Math.min(1, intensity + this.energy * 0.25);
    }
    this.current = {
      primary,
      intensity,
      secondary: second && second !== primary && secondScore > score * 0.45 ? second : null,
    };
    return this.emit(this.current);
  }

  private emit(state: EmotionState): EmotionState | null {
    const prev = this.lastEmitted;
    if (prev.primary === state.primary && Math.abs(prev.intensity - state.intensity) < 0.1 && prev.secondary === state.secondary) {
      return null;
    }
    this.lastEmitted = { ...state };
    return this.lastEmitted;
  }
}

export type NavarasaType =
  | 'shringara'  // 1. Warmth, Charm, Affection (happy)
  | 'hasya'      // 2. Humor, Wit, Banter (amused)
  | 'karuna'     // 3. Compassion, Empathy, Care (empathetic)
  | 'raudra'     // 4. Passion, Conviction, Energy (excited)
  | 'vira'       // 5. Confidence, Heroism, Boldness (confident)
  | 'bhayanaka'  // 6. Protective Care, Caution (concerned)
  | 'bibhatsa'   // 7. High Discernment, Poised Reflection (thoughtful)
  | 'adbhuta'    // 8. Wonder, Awe, Curiosity (curious, surprised)
  | 'shanta';    // 9. Serenity, Peace, Calm (neutral)

export function mapToNavarasa(emotion: EmotionType | string): NavarasaType {
  switch (emotion) {
    case 'happy': return 'shringara';
    case 'amused': return 'hasya';
    case 'empathetic': return 'karuna';
    case 'excited': return 'raudra';
    case 'confident': return 'vira';
    case 'concerned': return 'bhayanaka';
    case 'thoughtful': return 'bibhatsa';
    case 'curious':
    case 'surprised': return 'adbhuta';
    default: return 'shanta';
  }
}

export type GestureCue =
  | 'nod'
  | 'head_tilt'
  | 'hand_raise'
  | 'both_hands'
  | 'shrug'
  | 'point'
  | 'wave'
  | 'thinking_pose'
  | 'emphasis'
  | 'none';

export function detectGestureCues(sentence: string): GestureCue[] {
  const cues: GestureCue[] = [];
  const s = sentence.trim();
  if (/\?$/.test(s)) cues.push('head_tilt');
  if (/^(hi|hello|hey|welcome|greetings)\b/i.test(s)) cues.push('wave');
  if (/\b(first|second|third|on one hand)\b/i.test(s)) cues.push('both_hands');
  if (/\b(important|key|crucial|essential|absolutely|definitely)\b/i.test(s)) cues.push('emphasis');
  if (/\b(not sure|maybe|perhaps|probably|could be)\b/i.test(s)) cues.push('shrug');
  if (/\b(look at|check out|notice)\b/i.test(s)) cues.push('point');
  if (/\b(let me think|hmm+|well,|actually,)/i.test(s)) cues.push('thinking_pose');
  if (/\b(yes|yeah|right|exactly|correct|agree|indeed)\b/i.test(s)) cues.push('nod');
  return cues.length > 0 ? cues : ['none'];
}
