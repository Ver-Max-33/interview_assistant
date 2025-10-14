import React, { useState } from 'react';
import { X, Settings, Mic, Brain, AlertCircle, CheckCircle, XCircle, Loader2, PlayCircle, RefreshCw } from 'lucide-react';
import type { Settings as SettingsType } from '../types';
import { apiTesterV2, type TestResult } from '../services/api-tester-v2';

interface SettingsViewProps {
  settings: SettingsType;
  setSettings: React.Dispatch<React.SetStateAction<SettingsType>>;
  onClose: () => void;
  onOpenFunctionTest: () => void;
}

export default function SettingsView({
  settings,
  setSettings,
  onClose,
  onOpenFunctionTest
}: SettingsViewProps) {
  const [isTesting, setIsTesting] = useState(false);
  const [sttTestResult, setSTTTestResult] = useState<TestResult | null>(null);
  const [llmTestResult, setLLMTestResult] = useState<TestResult | null>(null);
  const [micTestResult, setMicTestResult] = useState<TestResult | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  
  // テーマ設定
  const isDark = settings.displaySettings.theme === 'dark';
  const themeClasses = {
    bg: isDark ? 'bg-gray-900' : 'bg-gray-50',
    bgCard: isDark ? 'bg-gray-800' : 'bg-white',
    bgHover: isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100',
    border: isDark ? 'border-gray-700' : 'border-gray-200',
    text: isDark ? 'text-gray-100' : 'text-gray-900',
    textMuted: isDark ? 'text-gray-400' : 'text-gray-500',
    textLabel: isDark ? 'text-gray-300' : 'text-gray-700'
  };

  const handleAPITest = async () => {
    if (!settings.sttSettings.sonioxApiKey) {
      alert('Soniox APIキーを入力してください');
      return;
    }
    if (!settings.llmSettings.apiKey) {
      alert('LLM APIキーを入力してください');
      return;
    }

    setIsTesting(true);
    setSTTTestResult(null);
    setLLMTestResult(null);
    setMicTestResult(null);

    try {
      const results = await apiTesterV2.runAllTests(
        settings.sttSettings,
        settings.llmSettings
      );

      setSTTTestResult(results.sttConnection);
      setLLMTestResult(results.llmConnection);
      setMicTestResult(results.microphoneAccess);

      // モデルリストを取得
      if (results.llmModels.success && results.llmModels.models) {
        setAvailableModels(results.llmModels.models);
        
        // 現在のモデルがリストにない場合、更新
        if (!results.llmModels.models.includes(settings.llmSettings.model)) {
          const defaultModel = results.llmModels.models.find(m => 
            m.includes('gpt-5') || m.includes('gpt-4')
          ) || results.llmModels.models[0];
          
          setSettings(prev => ({
            ...prev,
            llmSettings: { ...prev.llmSettings, model: defaultModel }
          }));
        }
      }
    } catch (error) {
      console.error('❌ APIテストエラー:', error);
    } finally {
      setIsTesting(false);
    }
  };

  const handleLoadModels = async () => {
    if (!settings.llmSettings.apiKey) {
      alert('LLM APIキーを入力してください');
      return;
    }

    setIsLoadingModels(true);
    try {
      const result = await apiTesterV2.getLLMModels(settings.llmSettings);
      
      if (result.success && result.models) {
        setAvailableModels(result.models);
        
        // 現在のモデルがリストにない場合、更新
        if (!result.models.includes(settings.llmSettings.model)) {
          const defaultModel = result.models.find(m => 
            m.includes('gpt-5') || m.includes('gpt-4')
          ) || result.models[0];
          
          setSettings(prev => ({
            ...prev,
            llmSettings: { ...prev.llmSettings, model: defaultModel }
          }));
        }
      } else {
        alert(`モデル取得失敗: ${result.details || result.message}`);
      }
    } catch (error) {
      console.error('❌ モデル取得エラー:', error);
      alert('モデルの取得に失敗しました');
    } finally {
      setIsLoadingModels(false);
    }
  };

  const renderTestResult = (result?: TestResult | null) => {
    if (!result) return null;

    return (
      <div className={`flex items-start gap-2 p-3 rounded-lg ${
        result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
      }`}>
        {result.success ? (
          <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
        ) : (
          <XCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${
            result.success ? 'text-green-900' : 'text-red-900'
          }`}>
            {result.message}
          </p>
          {result.details && (
            <p className={`text-xs mt-1 ${
              result.success ? 'text-green-700' : 'text-red-700'
            }`}>
              {result.details}
            </p>
          )}
          {result.latency && (
            <p className="text-xs text-gray-500 mt-1">
              応答時間: {result.latency}ms
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`flex flex-col h-full ${themeClasses.bg}`}>
      {/* Header */}
      <div className={`${themeClasses.bgCard} border-b ${themeClasses.border} px-6 py-4 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className={`p-2 ${themeClasses.bgHover} rounded-lg transition-colors`}
          >
            <X className={`w-5 h-5 ${themeClasses.textLabel}`} />
          </button>
          <h1 className={`text-lg font-semibold ${themeClasses.text}`}>設定</h1>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* STT Settings (Soniox) */}
          <div className={`${themeClasses.bgCard} rounded-xl p-6 shadow-sm border ${themeClasses.border}`}>
            <h3 className={`text-sm font-semibold ${themeClasses.text} mb-4 flex items-center gap-2`}>
              <Mic className="w-4 h-4" />
              STT設定（音声認識）
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  Soniox APIキー
                </label>
                <input
                  type="password"
                  value={settings.sttSettings.sonioxApiKey}
                  onChange={(e) => setSettings(prev => ({
                    ...prev,
                    sttSettings: { ...prev.sttSettings, sonioxApiKey: e.target.value }
                  }))}
                  placeholder="Soniox API Key"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  STTモデル
                </label>
                <select
                  value={settings.sttSettings.model}
                  onChange={(e) => setSettings(prev => ({
                    ...prev,
                    sttSettings: { ...prev.sttSettings, model: e.target.value }
                  }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="stt-rt-preview">stt-rt-preview (リアルタイム)</option>
                  <option value="stt-en-v1">stt-en-v1 (英語)</option>
                  <option value="stt-ja-v1">stt-ja-v1 (日本語)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  言語ヒント
                </label>
                <input
                  type="text"
                  value={settings.sttSettings.languageHints.join(', ')}
                  onChange={(e) => {
                    const hints = e.target.value.split(',').map(h => h.trim()).filter(Boolean);
                    setSettings(prev => ({
                      ...prev,
                      sttSettings: { ...prev.sttSettings, languageHints: hints }
                    }));
                  }}
                  placeholder="ja, en（カンマ区切り）"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  コンテキスト（オプション）
                </label>
                <textarea
                  value={settings.sttSettings.context}
                  onChange={(e) => setSettings(prev => ({
                    ...prev,
                    sttSettings: { ...prev.sttSettings, context: e.target.value }
                  }))}
                  placeholder="会話のコンテキストを入力（任意）"
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-gray-900">話者分離</label>
                  <p className="text-xs text-gray-500 mt-0.5">面接官とあなたを識別します</p>
                </div>
                <button
                  onClick={() => setSettings(prev => ({
                    ...prev,
                    sttSettings: {
                      ...prev.sttSettings,
                      enableSpeakerDiarization: !prev.sttSettings.enableSpeakerDiarization
                    }
                  }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.sttSettings.enableSpeakerDiarization ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.sttSettings.enableSpeakerDiarization ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-gray-900">言語識別</label>
                  <p className="text-xs text-gray-500 mt-0.5">自動的に言語を検出します</p>
                </div>
                <button
                  onClick={() => setSettings(prev => ({
                    ...prev,
                    sttSettings: {
                      ...prev.sttSettings,
                      enableLanguageIdentification: !prev.sttSettings.enableLanguageIdentification
                    }
                  }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.sttSettings.enableLanguageIdentification ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.sttSettings.enableLanguageIdentification ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-gray-900">エンドポイント検出</label>
                  <p className="text-xs text-gray-500 mt-0.5">発話の終わりを自動検出</p>
                </div>
                <button
                  onClick={() => setSettings(prev => ({
                    ...prev,
                    sttSettings: {
                      ...prev.sttSettings,
                      enableEndpointDetection: !prev.sttSettings.enableEndpointDetection
                    }
                  }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settings.sttSettings.enableEndpointDetection ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.sttSettings.enableEndpointDetection ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* LLM Settings */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Brain className="w-4 h-4" />
              LLM設定（回答生成）
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  LLMプロバイダー
                </label>
                <div className="flex gap-2">
                  {[
                    { value: 'openai', label: 'OpenAI' },
                    { value: 'openrouter', label: 'OpenRouter' }
                  ].map(option => (
                    <button
                      key={option.value}
                      onClick={() => setSettings(prev => ({
                        ...prev,
                        llmSettings: { ...prev.llmSettings, provider: option.value as any }
                      }))}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        settings.llmSettings.provider === option.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  {settings.llmSettings.provider === 'openai' ? 'OpenAI' : 'OpenRouter'} APIキー
                </label>
                <input
                  type="password"
                  value={settings.llmSettings.apiKey}
                  onChange={(e) => setSettings(prev => ({
                    ...prev,
                    llmSettings: { ...prev.llmSettings, apiKey: e.target.value }
                  }))}
                  placeholder={settings.llmSettings.provider === 'openai' ? 'sk-...' : 'sk-or-v1-...'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium text-gray-700">
                    LLMモデル {availableModels.length > 0 && (
                      <span className="text-green-600">({availableModels.length}個検出)</span>
                    )}
                  </label>
                  <button
                    onClick={handleLoadModels}
                    disabled={isLoadingModels || !settings.llmSettings.apiKey}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingModels ? 'animate-spin' : ''}`} />
                    更新
                  </button>
                </div>
                <select
                  value={settings.llmSettings.model}
                  onChange={(e) => setSettings(prev => ({
                    ...prev,
                    llmSettings: { ...prev.llmSettings, model: e.target.value }
                  }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {availableModels.length > 0 ? (
                    availableModels.map(model => (
                      <option key={model} value={model}>{model}</option>
                    ))
                  ) : settings.llmSettings.provider === 'openai' ? (
                    <>
                      <option value="gpt-5-2025-08-07">gpt-5-2025-08-07</option>
                      <option value="gpt-4o">gpt-4o</option>
                      <option value="gpt-4-turbo">gpt-4-turbo</option>
                    </>
                  ) : (
                    <>
                      <option value="openai/gpt-5-2025-08-07">openai/gpt-5-2025-08-07</option>
                      <option value="openai/gpt-4o">openai/gpt-4o</option>
                      <option value="anthropic/claude-3-opus">anthropic/claude-3-opus</option>
                    </>
                  )}
                </select>
                {settings.llmSettings.model.includes('gpt-5') && (
                  <p className="text-xs text-amber-600 mt-1">
                    ⚠️ GPT-5はtemperature/max_tokensパラメータをサポートしません
                  </p>
                )}
              </div>

              {!settings.llmSettings.model.includes('gpt-5') && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">
                      Temperature: {settings.llmSettings.temperature}
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={settings.llmSettings.temperature}
                      onChange={(e) => setSettings(prev => ({
                        ...prev,
                        llmSettings: { ...prev.llmSettings, temperature: parseFloat(e.target.value) }
                      }))}
                      className="w-full"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      低い値ほど確実な回答、高い値ほど創造的な回答
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">
                      最大トークン数: {settings.llmSettings.maxTokens}
                    </label>
                    <input
                      type="range"
                      min="100"
                      max="2000"
                      step="50"
                      value={settings.llmSettings.maxTokens}
                      onChange={(e) => setSettings(prev => ({
                        ...prev,
                        llmSettings: { ...prev.llmSettings, maxTokens: parseInt(e.target.value) }
                      }))}
                      className="w-full"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      生成する回答の最大長
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* API Test Section */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Settings className="w-4 h-4" />
              API接続テスト
            </h3>
            
            <div className="space-y-4">
              {/* 统一测试按钮 */}
              <button
                onClick={handleAPITest}
                disabled={isTesting || !settings.sttSettings.sonioxApiKey || !settings.llmSettings.apiKey}
                className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  isTesting || !settings.sttSettings.sonioxApiKey || !settings.llmSettings.apiKey
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {isTesting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>テスト中...</span>
                  </>
                ) : (
                  <>
                    <PlayCircle className="w-4 h-4" />
                    <span>すべてのAPIをテスト</span>
                  </>
                )}
              </button>

              {/* 测试结果 */}
              {(sttTestResult || llmTestResult || micTestResult) && (
                <div className="space-y-3">
                  {sttTestResult && (
                    <div>
                      <p className="text-xs font-medium text-gray-700 mb-2">STT接続</p>
                      {renderTestResult(sttTestResult)}
                    </div>
                  )}
                  {llmTestResult && (
                    <div>
                      <p className="text-xs font-medium text-gray-700 mb-2">LLM接続</p>
                      {renderTestResult(llmTestResult)}
                    </div>
                  )}
                  {micTestResult && (
                    <div>
                      <p className="text-xs font-medium text-gray-700 mb-2">マイクアクセス</p>
                      {renderTestResult(micTestResult)}
                    </div>
                  )}
                </div>
              )}

              {/* 功能测试入口 */}
              <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4 border border-purple-200">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-1">機能テスト</h4>
                    <p className="text-xs text-gray-600 mb-2">
                      実際の音声を使って、STT転写とLLM応答をリアルタイムでテスト
                    </p>
                    <ul className="text-xs text-gray-600 space-y-0.5">
                      <li>• リアルタイム音声転写の確認</li>
                      <li>• 話者分離の動作確認</li>
                      <li>• LLM応答生成の確認</li>
                    </ul>
                  </div>
                  <button
                    onClick={onOpenFunctionTest}
                    disabled={!settings.sttSettings.sonioxApiKey || !settings.llmSettings.apiKey}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      !settings.sttSettings.sonioxApiKey || !settings.llmSettings.apiKey
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700 shadow-sm'
                    }`}
                  >
                    <PlayCircle className="w-4 h-4" />
                    <span>開始</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* AI Response Settings */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Brain className="w-4 h-4" />
              AI回答設定
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  回答の長さ
                </label>
                <div className="flex gap-2">
                  {[
                    { value: 'brief', label: '簡潔' },
                    { value: 'standard', label: '標準' },
                    { value: 'detailed', label: '詳細' }
                  ].map(option => (
                    <button
                      key={option.value}
                      onClick={() => setSettings(prev => ({ 
                        ...prev, 
                        aiSettings: { ...prev.aiSettings, responseLength: option.value as any }
                      }))}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        settings.aiSettings.responseLength === option.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  具体例の含有量
                </label>
                <div className="flex gap-2">
                  {[
                    { value: 'few', label: '少なめ' },
                    { value: 'normal', label: '普通' },
                    { value: 'many', label: '多め' }
                  ].map(option => (
                    <button
                      key={option.value}
                      onClick={() => setSettings(prev => ({ 
                        ...prev, 
                        aiSettings: { ...prev.aiSettings, exampleAmount: option.value as any }
                      }))}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        settings.aiSettings.exampleAmount === option.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  面接稿の優先度
                </label>
                <div className="flex gap-2">
                  {[
                    { value: 'exact', label: '完全一致のみ' },
                    { value: 'similar', label: '類似も含む' }
                  ].map(option => (
                    <button
                      key={option.value}
                      onClick={() => setSettings(prev => ({ 
                        ...prev, 
                        aiSettings: { ...prev.aiSettings, scriptPriority: option.value as any }
                      }))}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        settings.aiSettings.scriptPriority === option.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  「類似も含む」：面接稿にない質問でも、似た質問があれば参考にします
                </p>
              </div>

              {/* 固定のスタイル説明 */}
              <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-blue-900 mb-1">回答スタイル</p>
                    <p className="text-xs text-blue-700 leading-relaxed">
                      AIは常に自然で簡潔な日本語表現を使用します。難しい言葉や硬い表現は避け、わかりやすく話しやすい回答を提供します。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Display Settings */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Settings className="w-4 h-4" />
              表示設定
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  フォントサイズ
                </label>
                <div className="flex gap-2">
                  {[
                    { value: 'small', label: '小' },
                    { value: 'medium', label: '中' },
                    { value: 'large', label: '大' }
                  ].map(option => (
                    <button
                      key={option.value}
                      onClick={() => setSettings(prev => ({ 
                        ...prev, 
                        displaySettings: { ...prev.displaySettings, fontSize: option.value as any }
                      }))}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        settings.displaySettings.fontSize === option.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  カラーテーマ
                </label>
                <div className="flex gap-2">
                  {[
                    { value: 'light', label: 'ライト' },
                    { value: 'dark', label: 'ダーク' }
                  ].map(option => (
                    <button
                      key={option.value}
                      onClick={() => setSettings(prev => ({ 
                        ...prev, 
                        displaySettings: { ...prev.displaySettings, theme: option.value as any }
                      }))}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        settings.displaySettings.theme === option.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  会話履歴の表示件数
                </label>
                <select
                  value={settings.displaySettings.historyLimit}
                  onChange={(e) => setSettings(prev => ({ 
                    ...prev, 
                    displaySettings: { ...prev.displaySettings, historyLimit: parseInt(e.target.value) }
                  }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="30">30件</option>
                  <option value="50">50件</option>
                  <option value="100">100件</option>
                  <option value="999">すべて</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="px-6 py-4 bg-white border-t border-gray-200">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={onClose}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm font-medium"
          >
            保存して閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
