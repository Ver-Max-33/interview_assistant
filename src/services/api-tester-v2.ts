/**
 * API测试服务 V2
 * 支持Soniox STT和LLM (OpenAI/OpenRouter)
 */

import type { STTSettings, LLMSettings } from '../types';
import { sonioxService } from './soniox';
import { llmService } from './llm';

export interface TestResult {
  success: boolean;
  message: string;
  details?: string;
  latency?: number;
  models?: string[];
}

export class APITesterV2 {
  /**
   * テストSoniox STT接続
   */
  async testSonioxConnection(settings: STTSettings): Promise<TestResult> {
    const startTime = Date.now();
    
    try {
      // WebSocket接続をテスト
      await sonioxService.connect({
        apiKey: settings.sonioxApiKey,
        model: settings.model,
        audioFormat: settings.audioFormat,
        numChannels: 1,
        sampleRate: 24000,
        languageHints: settings.languageHints,
        context: settings.context,
        enableSpeakerDiarization: settings.enableSpeakerDiarization,
        enableLanguageIdentification: settings.enableLanguageIdentification,
        enableEndpointDetection: settings.enableEndpointDetection
      });
      
      const latency = Date.now() - startTime;
      
      // 接続成功後すぐに切断
      sonioxService.disconnect();
      
      return {
        success: true,
        message: 'Soniox STT接続成功',
        details: `WebSocket接続が確立されました`,
        latency
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      return {
        success: false,
        message: 'Soniox STT接続失敗',
        details: error instanceof Error ? error.message : '不明なエラー',
        latency
      };
    }
  }
  
  /**
   * テストLLM接続
   */
  async testLLMConnection(settings: LLMSettings): Promise<TestResult> {
    const startTime = Date.now();
    
    try {
      llmService.setConfig({
        provider: settings.provider,
        apiKey: settings.apiKey,
        model: settings.model,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens
      });
      
      const result = await llmService.testConnection();
      const latency = Date.now() - startTime;
      
      return {
        success: result.success,
        message: result.message,
        details: result.success ? 'LLM応答テストが成功しました' : undefined,
        latency
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      return {
        success: false,
        message: 'LLM接続失敗',
        details: error instanceof Error ? error.message : '不明なエラー',
        latency
      };
    }
  }
  
  /**
   * LLM利用可能なモデルを取得
   */
  async getLLMModels(settings: LLMSettings): Promise<TestResult> {
    const startTime = Date.now();
    
    try {
      llmService.setConfig({
        provider: settings.provider,
        apiKey: settings.apiKey,
        model: settings.model,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens
      });
      
      const models = await llmService.getAvailableModels();
      const latency = Date.now() - startTime;
      
      return {
        success: true,
        message: `${models.length}個のモデルが利用可能`,
        details: `モデル取得成功`,
        latency,
        models
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      return {
        success: false,
        message: 'モデル取得失敗',
        details: error instanceof Error ? error.message : '不明なエラー',
        latency
      };
    }
  }
  
  /**
   * マイクアクセステスト
   */
  async testMicrophoneAccess(): Promise<TestResult> {
    const startTime = Date.now();
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      const latency = Date.now() - startTime;
      
      // すぐにストリームを停止
      stream.getTracks().forEach(track => track.stop());
      
      return {
        success: true,
        message: 'マイクアクセス成功',
        details: '音声入力デバイスにアクセスできます',
        latency
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          return {
            success: false,
            message: 'マイクアクセス拒否',
            details: 'システム環境設定でマイクのアクセス許可を有効にしてください',
            latency
          };
        } else if (error.name === 'NotFoundError') {
          return {
            success: false,
            message: 'マイクが見つかりません',
            details: 'マイクが接続されているか確認してください',
            latency
          };
        }
      }
      
      return {
        success: false,
        message: 'マイクアクセスエラー',
        details: error instanceof Error ? error.message : '不明なエラー',
        latency
      };
    }
  }
  
  /**
   * すべてのテストを実行
   */
  async runAllTests(sttSettings: STTSettings, llmSettings: LLMSettings): Promise<{
    sttConnection: TestResult;
    llmConnection: TestResult;
    llmModels: TestResult;
    microphoneAccess: TestResult;
    overallSuccess: boolean;
  }> {
    const [sttConnection, llmConnection, llmModels, microphoneAccess] = await Promise.all([
      this.testSonioxConnection(sttSettings),
      this.testLLMConnection(llmSettings),
      this.getLLMModels(llmSettings),
      this.testMicrophoneAccess()
    ]);
    
    const overallSuccess = 
      sttConnection.success && 
      llmConnection.success && 
      llmModels.success &&
      microphoneAccess.success;
    
    return {
      sttConnection,
      llmConnection,
      llmModels,
      microphoneAccess,
      overallSuccess
    };
  }
}

export const apiTesterV2 = new APITesterV2();

