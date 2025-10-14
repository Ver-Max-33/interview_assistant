import { useState, useEffect } from 'react';
import WelcomeView from './components/WelcomeView';
import MainView from './components/MainView';
import SettingsView from './components/SettingsView';
import FunctionTestView from './components/FunctionTestView';
import type { PreparationData, Settings } from './types';
import { storageService } from './services/storage';

export default function App() {
  const [currentView, setCurrentView] = useState<'welcome' | 'main' | 'settings' | 'functionTest'>('welcome');
  const [preparationData, setPreparationData] = useState<PreparationData>({
    resume: { type: 'none', file: null, text: '' },
    careerHistory: { type: 'none', file: null, text: '' },
    interviewScript: { type: 'none', file: null, text: '' },
    position: { type: 'none', file: null, text: '' },
    companyResearch: { type: 'none', file: null, text: '' },
    industry: '',
    company: '',
    voiceCalibrated: false
  });
  
  const [settings, setSettings] = useState<Settings>({
    // 保留旧字段用于兼容性
    apiKey: '',
    model: 'gpt-5-2025-08-07',
    // STT设置
    sttSettings: {
      provider: 'soniox',
      sonioxApiKey: '',
      model: 'stt-rt-preview',
      audioFormat: 'pcm_s16le',
      languageHints: ['ja'],
      context: '',
      enableSpeakerDiarization: true,
      enableLanguageIdentification: false,
      enableEndpointDetection: true
    },
    // LLM设置
    llmSettings: {
      provider: 'openai',
      apiKey: '',
      model: 'gpt-5-2025-08-07',
      temperature: 0.7,
      maxTokens: 500
    },
    audioSettings: {
      inputDevice: 'system',
      micVolume: 80,
      noiseReduction: 'medium',
      silenceDetection: 'medium'
    },
    aiSettings: {
      responseLength: 'standard',
      exampleAmount: 'normal',
      scriptPriority: 'similar'
    },
    displaySettings: {
      fontSize: 'medium',
      theme: 'light',
      historyLimit: 50
    }
  });

  // 初回読み込み時にローカルストレージから設定を復元
  useEffect(() => {
    const savedSettings = storageService.loadSettings();
    if (savedSettings) {
      setSettings(savedSettings);
    }

    const savedPreparation = storageService.loadPreparationData();
    if (savedPreparation) {
      setPreparationData(savedPreparation);
    }
  }, []);

  // 設定が変更されたら保存
  useEffect(() => {
    storageService.saveSettings(settings);
  }, [settings]);

  // 準備データが変更されたら保存
  useEffect(() => {
    storageService.savePreparationData(preparationData);
  }, [preparationData]);

  const canStartInterview = () => {
    return (
      preparationData.resume.type !== 'none' &&
      preparationData.careerHistory.type !== 'none' &&
      preparationData.interviewScript.type !== 'none' &&
      preparationData.industry &&
      preparationData.position.type !== 'none' &&
      preparationData.company &&
      preparationData.voiceCalibrated
    );
  };

  return (
    <div className="w-screen h-screen overflow-hidden">
      {currentView === 'welcome' && (
        <WelcomeView
          preparationData={preparationData}
          setPreparationData={setPreparationData}
          onStartInterview={() => setCurrentView('main')}
          onOpenSettings={() => setCurrentView('settings')}
          settings={settings}
        />
      )}
      
      {currentView === 'main' && (
        <MainView
          preparationData={preparationData}
          settings={settings}
          onBackToWelcome={() => setCurrentView('welcome')}
          onOpenSettings={() => setCurrentView('settings')}
        />
      )}
      
      {currentView === 'settings' && (
        <SettingsView
          settings={settings}
          setSettings={setSettings}
          onClose={() => setCurrentView(canStartInterview() ? 'main' : 'welcome')}
          onOpenFunctionTest={() => setCurrentView('functionTest')}
        />
      )}
      
      {currentView === 'functionTest' && (
        <FunctionTestView
          settings={settings}
          onClose={() => setCurrentView('settings')}
        />
      )}
    </div>
  );
}
