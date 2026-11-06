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
  patterns: RegExp[];
  keywords: string[];
  emotion: EmotionType;
  weight: number;
}

const RULES: PatternRule[] = [
  {
    emotion: 'happy',
    weight: 1.0,
    patterns: [/!\s*$/, /😊|😄|🎉/, /welcome/i, /glad to/i, /nice to/i],
    keywords: [
      'great', 'wonderful', 'fantastic', 'awesome', 'love', 'glad',
      'happy', 'pleased', 'delighted', 'excellent', 'perfect', 'beautiful',
      'amazing', 'brilliant', 'magnificent', 'superb', 'terrific',
      'good news', 'congratulations', 'well done', 'nice work',
      'good', 'nice', 'welcome', 'enjoy', 'pleasure', 'friend', 'smile',
      'hello', 'hi', 'hey', 'greetings',
    ],
  },
  {
    emotion: 'excited',
    weight: 1.2,
    patterns: [/!{2,}/, /can't wait/i, /so excited/i, /breakthrough/i],
    keywords: [
      'exciting', 'thrilling', 'incredible', 'unbelievable', 'wow',
      'absolutely', 'definitely', "let's go", 'ready', 'pumped',
      'power', 'huge', 'fast', 'speed', 'rocket', 'launch', 'revolution',
      'breakthrough', 'energy', 'bold', 'advance', 'future',
    ],
  },
  {
    emotion: 'curious',
    weight: 1.1,
    patterns: [/\?/, /^(what|how|why|who|where|when|can you|could you|tell me)/i, /I wonder/i, /what if/i, /have you considered/i],
    keywords: [
      'interesting', 'fascinating', 'curious', 'intriguing', 'wonder',
      'tell me more', 'how does', 'why does', 'what about', 'explore',
      'what', 'how', 'why', 'who', 'where', 'when', 'which', 'tell me',
      'explain', 'search', 'find', 'space', 'universe', 'mars', 'science',
      'discover', 'inquire', 'learn',
    ],
  },
  {
    emotion: 'concerned',
    weight: 1.0,
    patterns: [/be careful/i, /watch out/i, /heads up/i],
    keywords: [
      'careful', 'warning', 'caution', 'risk', 'danger', 'problem',
      'issue', 'trouble', 'worried', 'concern', 'unfortunately',
      'difficult', 'challenging', 'struggle', 'tough',
    ],
  },
  {
    emotion: 'empathetic',
    weight: 1.1,
    patterns: [/I understand/i, /that must be/i, /I can see/i, /don't worry/i],
    keywords: [
      'sorry', 'understand', 'feel', 'tough', 'hard', 'empathize',
      'sympathize', 'support', 'here for you', 'take your time',
      'no rush', 'it\'s okay', 'don\'t worry', 'completely valid',
      'help', 'care', 'listen', 'comfort', 'gently',
    ],
  },
  {
    emotion: 'thoughtful',
    weight: 0.9,
    patterns: [/on the other hand/i, /however/i, /that said/i, /consider/i, /because/i, /for example/i],
    keywords: [
      'perhaps', 'maybe', 'consider', 'think about', 'perspective',
      'on one hand', 'alternatively', 'nuanced', 'complex', 'depends',
      'weigh', 'balance', 'trade-off', 'reflect', 'because', 'reason',
      'analyze', 'strategy', 'process', 'meaning', 'concept', 'theory',
    ],
  },
  {
    emotion: 'surprised',
    weight: 1.3,
    patterns: [/really\?/i, /no way/i, /oh my/i, /whoa/i],
    keywords: [
      'wow', 'surprising', 'unexpected', 'astonishing', 'remarkable',
      'didn\'t expect', 'never knew', 'mind-blowing', 'shocking',
    ],
  },
  {
    emotion: 'amused',
    weight: 1.0,
    patterns: [/haha/i, /lol/i, /😂|😄/, /that's funny/i],
    keywords: [
      'funny', 'hilarious', 'amusing', 'laughing', 'joke', 'humor',
      'witty', 'clever', 'heh', 'chuckle', 'fun', 'silly',
    ],
  },
  {
    emotion: 'confident',
    weight: 1.0,
    patterns: [/I can help/i, /here's how/i, /the answer is/i, /founded by/i, /in fact/i],
    keywords: [
      'certainly', 'definitely', 'sure', 'exactly', 'precisely',
      'of course', 'no doubt', 'guaranteed', 'clearly', 'obviously',
      'founded', 'established', 'succeeded', 'built', 'created',
      'leading', 'achieved', 'proven', 'fact',
    ],
  },
];

export function detectEmotion(text: string): EmotionState {
  if (!text || text.length < 3) {
    return { primary: 'neutral', intensity: 0.3, secondary: null };
  }

  const lower = text.toLowerCase();
  const scores = new Map<EmotionType, number>();

  for (const rule of RULES) {
    let score = 0;

    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        score += rule.weight;
      }
    }

    for (const pat of rule.patterns) {
      if (pat.test(text)) {
        score += rule.weight * 1.5;
      }
    }

    if (score > 0) {
      scores.set(rule.emotion, (scores.get(rule.emotion) || 0) + score);
    }
  }

  if (scores.size === 0) {
    return { primary: 'neutral', intensity: 0.3, secondary: null };
  }

  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const topScore = sorted[0][1];
  const intensity = Math.min(1.0, 0.3 + topScore * 0.12);

  return {
    primary: sorted[0][0],
    intensity,
    secondary: sorted.length > 1 && sorted[1][1] > topScore * 0.4
      ? sorted[1][0]
      : null,
  };
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
  const lower = sentence.toLowerCase();

  if (/\?$/.test(sentence.trim())) cues.push('head_tilt');
  if (/^(hi|hello|hey|welcome|greetings)/i.test(sentence.trim())) cues.push('wave');
  if (/first|second|third|one,|two,|three,|on one hand/i.test(lower)) cues.push('both_hands');
  if (/important|key|crucial|essential|absolutely|definitely/i.test(lower)) cues.push('emphasis');
  if (/not sure|maybe|perhaps|i think|probably|could be/i.test(lower)) cues.push('shrug');
  if (/look at|check out|notice|here|this/i.test(lower)) cues.push('point');
  if (/let me think|hmm|well,|actually,|so,/i.test(lower)) cues.push('thinking_pose');
  if (/yes|right|exactly|correct|agree|indeed/i.test(lower)) cues.push('nod');

  return cues.length > 0 ? cues : ['none'];
}
