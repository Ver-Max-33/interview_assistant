import type { Settings, PreparationData, Message, InterviewSession } from '../types';

export class StorageService {
  private static SETTINGS_KEY = 'interview_assistant_settings';
  private static PREPARATION_KEY = 'interview_assistant_preparation';
  private static CONVERSATION_KEY = 'interview_assistant_conversation';
  private static SESSION_KEY = 'interview_assistant_session';

  saveSettings(settings: Settings): void {
    try {
      localStorage.setItem(StorageService.SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error('設定の保存に失敗しました:', error);
    }
  }
  
  loadSettings(): Settings | null {
    try {
      const data = localStorage.getItem(StorageService.SETTINGS_KEY);
      if (!data) return null;
      const parsed = JSON.parse(data);
      
      // Remove legacy privacy settings if present
      if (parsed?.privacySettings) {
        delete parsed.privacySettings;
      }
      
      return parsed;
    } catch (error) {
      console.error('設定の読み込みに失敗しました:', error);
      return null;
    }
  }
  
  savePreparationData(data: PreparationData): void {
    try {
      localStorage.setItem(StorageService.PREPARATION_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('準備データの保存に失敗しました:', error);
    }
  }
  
  loadPreparationData(): PreparationData | null {
    try {
      const data = localStorage.getItem(StorageService.PREPARATION_KEY);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('準備データの読み込みに失敗しました:', error);
      return null;
    }
  }

  saveConversation(messages: Message[]): void {
    try {
      const data = {
        messages,
        timestamp: new Date().toISOString()
      };
      localStorage.setItem(StorageService.CONVERSATION_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('会話履歴の保存に失敗しました:', error);
    }
  }

  loadConversation(): Message[] {
    try {
      const data = localStorage.getItem(StorageService.CONVERSATION_KEY);
      if (!data) return [];
      const parsed = JSON.parse(data);
      return parsed.messages || [];
    } catch (error) {
      console.error('会話履歴の読み込みに失敗しました:', error);
      return [];
    }
  }

  clearConversation(): void {
    try {
      localStorage.removeItem(StorageService.CONVERSATION_KEY);
    } catch (error) {
      console.error('会話履歴の削除に失敗しました:', error);
    }
  }

  saveSession(session: InterviewSession): void {
    try {
      localStorage.setItem(StorageService.SESSION_KEY, JSON.stringify(session));
    } catch (error) {
      console.error('セッションの保存に失敗しました:', error);
    }
  }

  loadSession(): InterviewSession | null {
    try {
      const data = localStorage.getItem(StorageService.SESSION_KEY);
      if (!data) return null;
      const parsed = JSON.parse(data);

      // 旧データとの互換性確保: interviewerSpeaker → interviewerSpeakers
      if (parsed && !parsed.interviewerSpeakers) {
        if (parsed.interviewerSpeaker) {
          parsed.interviewerSpeakers = [parsed.interviewerSpeaker];
        } else {
          parsed.interviewerSpeakers = [];
        }
        delete parsed.interviewerSpeaker;
      }

      return parsed;
    } catch (error) {
      console.error('セッションの読み込みに失敗しました:', error);
      return null;
    }
  }

  clearSession(): void {
    try {
      localStorage.removeItem(StorageService.SESSION_KEY);
    } catch (error) {
      console.error('セッションの削除に失敗しました:', error);
    }
  }

  clearAll(): void {
    try {
      localStorage.removeItem(StorageService.SETTINGS_KEY);
      localStorage.removeItem(StorageService.PREPARATION_KEY);
      localStorage.removeItem(StorageService.CONVERSATION_KEY);
      localStorage.removeItem(StorageService.SESSION_KEY);
    } catch (error) {
      console.error('データの削除に失敗しました:', error);
    }
  }
}

export const storageService = new StorageService();
