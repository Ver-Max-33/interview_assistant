/**
 * LLM Service
 * Supports OpenAI and OpenRouter
 */

export type LLMProvider = 'openai' | 'openrouter';

export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  // GPT-5不支持这些参数
  temperature?: number;
  maxTokens?: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class LLMService {
  private config: LLMConfig | null = null;
  
  setConfig(config: LLMConfig): void {
    this.config = config;
  }
  
  async generateResponse(messages: LLMMessage[]): Promise<string> {
    if (!this.config) {
      throw new Error('LLM設定がありません');
    }
    
    const endpoint = this.getEndpoint();
    const headers = this.getHeaders();
    const body = this.buildRequestBody(messages);
    
    console.log('🤖 LLM リクエスト:', {
      provider: this.config.provider,
      model: this.config.model,
      endpoint
    });
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `HTTP ${response.status}`);
      }
      
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) {
        throw new Error('LLM応答が空です');
      }
      
      console.log('✅ LLM 応答受信:', content.substring(0, 100) + '...');
      return content;
    } catch (error) {
      console.error('❌ LLM エラー:', error);
      throw error;
    }
  }
  
  async testConnection(): Promise<{ success: boolean; message: string; models?: string[] }> {
    if (!this.config) {
      return { success: false, message: 'LLM設定がありません' };
    }
    
    const startTime = Date.now();
    
    try {
      // テストメッセージを送信
      await this.generateResponse([
        { role: 'system', content: 'あなたは面接アシスタントです。' },
        { role: 'user', content: 'こんにちは、テストメッセージです。簡潔に応答してください。' }
      ]);
      
      const latency = Date.now() - startTime;
      
      return {
        success: true,
        message: `LLM接続成功 (${latency}ms)`,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : '不明なエラー',
      };
    }
  }
  
  async getAvailableModels(): Promise<string[]> {
    if (!this.config) {
      throw new Error('LLM設定がありません');
    }
    
    try {
      const endpoint = this.config.provider === 'openai'
        ? 'https://api.openai.com/v1/models'
        : 'https://openrouter.ai/api/v1/models';
      
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      };
      
      if (this.config.provider === 'openrouter') {
        headers['HTTP-Referer'] = window.location.origin;
        headers['X-Title'] = 'AI Interview Assistant';
      }
      
      const response = await fetch(endpoint, { headers });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (this.config.provider === 'openai') {
        // OpenAI: GPT-4とGPT-5モデルのみフィルタ
        const models = data.data
          ?.map((m: any) => m.id)
          .filter((id: string) => 
            id.includes('gpt-4') || 
            id.includes('gpt-5') ||
            id.includes('gpt-3.5-turbo')
          ) || [];
        
        console.log('📋 OpenAI利用可能モデル:', models.length, '個');
        return models;
      } else {
        // OpenRouter: すべてのモデル
        const models = data.data?.map((m: any) => m.id) || [];
        console.log('📋 OpenRouter利用可能モデル:', models.length, '個');
        return models;
      }
    } catch (error) {
      console.error('❌ モデル取得エラー:', error);
      throw error;
    }
  }
  
  private getEndpoint(): string {
    if (this.config!.provider === 'openai') {
      return 'https://api.openai.com/v1/chat/completions';
    } else {
      return 'https://openrouter.ai/api/v1/chat/completions';
    }
  }
  
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config!.apiKey}`,
      'Content-Type': 'application/json'
    };
    
    if (this.config!.provider === 'openrouter') {
      headers['HTTP-Referer'] = window.location.origin;
      headers['X-Title'] = 'AI Interview Assistant';
    }
    
    return headers;
  }
  
  private buildRequestBody(messages: LLMMessage[]): any {
    const body: any = {
      model: this.config!.model,
      messages: messages
    };
    
    // GPT-5は temperature, max_tokens などをサポートしない
    const isGPT5 = this.config!.model.includes('gpt-5');
    
    if (!isGPT5) {
      if (this.config!.temperature !== undefined) {
        body.temperature = this.config!.temperature;
      }
      if (this.config!.maxTokens !== undefined) {
        body.max_tokens = this.config!.maxTokens;
      }
    }
    
    return body;
  }
}

export const llmService = new LLMService();

