export interface AiConfig { endpoint: string; model: string; apiKey: string }
export interface AiConfigInfo { endpoint: string; model: string; configured: boolean }
export interface AiRequest { id: string; label: string; prompt: string }
export interface AiProgress { id: string; label: string; text: string }
