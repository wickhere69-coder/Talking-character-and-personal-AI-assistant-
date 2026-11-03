/**
 * Detects whether a user prompt explicitly requires Deep Multi-Step Mathematical Reasoning
 * vs Fast High-Speed Conversational Dialogue (Gemini speed engine).
 * 
 * Standard informational and conversational queries ("why is...", "how do I...", "explain...",
 * arithmetic like "5 + 7") are routed to the fast engine to ensure instantaneous sub-second response times.
 */
export function isComplexReasoning(prompt: string): boolean {
  if (!prompt) return false;
  const lower = prompt.toLowerCase().trim();

  // 1. Explicit request for deep step-by-step reasoning or mathematical proofs
  if (
    lower.startsWith('think step by step') ||
    lower.startsWith('/think') ||
    lower.includes('deep step-by-step') ||
    lower.includes('deep reasoning') ||
    lower.includes('formal mathematical proof') ||
    lower.includes('analytical proof')
  ) {
    return true;
  }

  // 2. Advanced higher-order mathematics (calculus, differential equations)
  const advancedMathPatterns = [
    /\b(differential equation|solve the differential|laplace transform|fourier series)\b/i,
    /\b(prove that|derive the formula for|formal proof)\b/i
  ];
  if (advancedMathPatterns.some(p => p.test(lower))) {
    return true;
  }

  return false;
}

/**
 * Detects whether a query requires live web search or real-time internet knowledge
 * (news, current events, scores, weather, stock prices, latest updates).
 */
export function isWebSearchQuery(prompt: string): boolean {
  if (!prompt) return false;
  const lower = prompt.toLowerCase().trim();

  // Explicit search phrases
  if (
    lower.startsWith('search') ||
    lower.startsWith('/search') ||
    lower.includes('search the web') ||
    lower.includes('look up') ||
    lower.includes('find online') ||
    lower.includes('google')
  ) {
    return true;
  }

  // Live real-time knowledge keywords
  const liveKeywords = /\b(news|latest|today|current|recent|who is|who won|score|winner|what happened|stock price|election|super bowl|championship|weather)\b/i;
  return liveKeywords.test(lower);
}
