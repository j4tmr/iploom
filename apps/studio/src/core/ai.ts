export interface AiConfig { endpoint: string; model: string; apiKey: string }
export interface AiConfigInfo { endpoint: string; model: string; configured: boolean }
export interface AiRequest { id: string; label: string; prompt: string }
export interface AiProgress { id: string; label: string; text: string }
/** Provider-reported token counts, when the endpoint returns them. */
export interface AiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  [key: string]: unknown;
}
export interface AiCompletion { text: string; usage?: AiUsage }
