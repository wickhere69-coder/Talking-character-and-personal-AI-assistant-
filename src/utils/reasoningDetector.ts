/**
 * Detects whether a user prompt explicitly requires Deep Multi-Step Mathematical Reasoning
 * vs Fast High-Speed Conversational Dialogue (Gemini speed engine).
 * 
 * Standard informational and conversational queries ("why is...", "how do I...", "explain...")
 * are routed to the fast engine to ensure instantaneous sub-second response times.
 */
export function isComplexReasoning(prompt: string): boolean {
  if (!prompt) return false;
  const lower = prompt.toLowerCase().trim();

  // 1. Explicit mathematical equations & calculus
  const mathPatterns = [
    /\d+\s*[\+\-\*\/\^%]\s*\d+/,
    /\b(integral|derivative|algebra|quadratic|polynomial|differential equation|solve for x)\b/i,
    /\b(evaluate the equation|calculate the sum of integers)\b/i
  ];
  if (mathPatterns.some(p => p.test(lower))) {
    return true;
  }

  // 2. Explicit request for deep step-by-step reasoning
  if (
    lower.startsWith('think step by step') ||
    lower.startsWith('/think') ||
    lower.includes('deep step-by-step analytical proof') ||
    lower.includes('formal mathematical proof')
  ) {
    return true;
  }

  return false;
}
