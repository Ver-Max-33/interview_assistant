export interface FileOrText {
  type: 'none' | 'file' | 'text';
  file: { name: string; size: string } | null;
  text: string;
}

export interface PreparationData {
  resume: FileOrText;
  careerHistory: FileOrText;
  interviewScript: FileOrText;
  position: FileOrText;
  companyResearch: FileOrText;
  industry: string;
  company: string;
  voiceCalibrated: boolean;
}

export interface AudioSettings {
  inputDevice: 'system' | 'microphone';
  micVolume: number;
  noiseReduction: 'weak' | 'medium' | 'strong';
  silenceDetection: 'low' | 'medium' | 'high';
}

export interface AISettings {
  responseLength: 'brief' | 'standard' | 'detailed';
  exampleAmount: 'few' | 'normal' | 'many';
  scriptPriority: 'exact' | 'similar';
}

export interface DisplaySettings {
  fontSize: 'small' | 'medium' | 'large';
  theme: 'light' | 'dark';
  historyLimit: number;
}

export interface STTSettings {
  provider: 'soniox';
  sonioxApiKey: string;
  model: string;
  audioFormat: string;
  languageHints: string[];
  context: string;
  enableSpeakerDiarization: boolean;
  enableLanguageIdentification: boolean;
  enableEndpointDetection: boolean;
}

export interface LLMSettings {
  provider: 'openai' | 'openrouter';
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface Settings {
  // 旧的字段保留用于兼容性
  apiKey: string;
  model: string;
  // 新的STT和LLM设置
  sttSettings: STTSettings;
  llmSettings: LLMSettings;
  audioSettings: AudioSettings;
  aiSettings: AISettings;
  displaySettings: DisplaySettings;
}

export interface Message {
  id: string;
  speaker: 'interviewer' | 'user';
  text: string;
  timestamp: string;
  originalSpeaker?: string; // spk1, spk2 など（面接官識別用）
  isFinal?: boolean; // 最終結果かどうか（転写用）
}

export interface Suggestion {
  id: string;
  question: string;
  answer: string;
  source: 'script' | 'generated';
  timestamp: string;
}

export interface QAPair {
  question: string;
  answer: string;
}

export interface MatchResult {
  match: QAPair | null;
  similarity: number;
  source: 'exact' | 'similar' | 'none';
}

export interface InterviewSession {
  conversation: Message[];
  suggestions: Suggestion[];
  interviewerSpeaker: 'spk1' | 'spk2' | null;
  isIdentifying: boolean;
  identificationTranscripts: Array<{ speaker: string; text: string }>;
  savedAt: string;
  summary?: string;
}
