const INCOMPLETE_TRAILING_WORDS = new Set([
  'and', 'but', 'or', 'so', 'because', 'although', 'though', 'while', 'whereas', 'yet',
  'to', 'for', 'with', 'about', 'of', 'in', 'at', 'from', 'by', 'on', 'into', 'through', 'between', 'under', 'over',
  'that', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how', 'if', 'whether', 'as',
  'the', 'a', 'an', 'my', 'your', 'his', 'her', 'our', 'their', 'this', 'these', 'those',
  'is', 'are', 'was', 'were', 'am', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did',
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'like', 'uh', 'um', 'er', 'ah'
]);

export function getSpeechCompletionDelay(
  transcript: string,
  isFinal: boolean,
  mode: 'conversational' | 'agent' | 'repeat' = 'conversational'
): number {
  if (mode === 'repeat') {
    return isFinal ? 250 : 450;
  }

  const text = transcript.trim().toLowerCase();
  if (!text) return 1200;

  const words = text.split(/\s+/).filter(Boolean);
  const lastWord = words[words.length - 1]?.replace(/[^a-z0-9']/g, '') || '';

  const endsWithIncompleteWord = INCOMPLETE_TRAILING_WORDS.has(lastWord);
  const endsWithTerminalPunctuation = /[.?!]$/.test(transcript.trim());

  // 1. Incomplete connector or filler word (user is pausing to think mid-sentence)
  if (endsWithIncompleteWord) {
    return 1800;
  }

  // 2. Short beginning (< 4 words without punctuation, e.g. "Can you tell me")
  if (words.length <= 4 && !endsWithTerminalPunctuation) {
    return 1600;
  }

  // 3. Clear terminal question/period (user finished their question)
  if (endsWithTerminalPunctuation) {
    return isFinal ? 950 : 1300;
  }

  // 4. Standard conversational pause between sentences
  return isFinal ? 1100 : 1500;
}
