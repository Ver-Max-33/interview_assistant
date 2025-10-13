import React, { useState, useRef } from 'react';
import { Settings, FileText, Upload, X, Check, AlertCircle, Zap, Briefcase, BookOpen, ArrowRight, Building2 } from 'lucide-react';
import type { PreparationData, Settings as SettingsType } from '../types';

interface WelcomeViewProps {
  preparationData: PreparationData;
  setPreparationData: React.Dispatch<React.SetStateAction<PreparationData>>;
  onStartInterview: () => void;
  onOpenSettings: () => void;
  settings: SettingsType;
}

export default function WelcomeView({
  preparationData,
  setPreparationData,
  onStartInterview,
  onOpenSettings,
  settings
}: WelcomeViewProps) {
  const [activeTab, setActiveTab] = useState('documents');
  
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

  const fileInputRefs = {
    resume: useRef<HTMLInputElement>(null),
    careerHistory: useRef<HTMLInputElement>(null),
    position: useRef<HTMLInputElement>(null),
    companyResearch: useRef<HTMLInputElement>(null),
    interviewScript: useRef<HTMLInputElement>(null)
  };

  const handleFileUpload = async (type: keyof typeof fileInputRefs, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    // PDFファイルかチェック
    if (file.type !== 'application/pdf') {
      alert('❌ エラー\n\nPDFファイルのみアップロード可能です。');
      return;
    }
    
    console.log('📄 ファイルアップロード:', file.name);
    
    // まず file情報を保存
    setPreparationData(prev => ({
      ...prev,
      [type]: { 
        type: 'file', 
        file: { 
          name: file.name, 
          size: (file.size / 1024).toFixed(2) + ' KB' 
        }, 
        text: '' 
      }
    }));
    
    // PDF解析を試みる
    try {
      console.log('🔄 PDF解析を開始...');
      const { extractTextFromPDF } = await import('../services/pdf-parser');
      const extractedText = await extractTextFromPDF(file);
      
      if (extractedText.trim()) {
        console.log(`✅ PDF解析成功: ${extractedText.length}文字抽出`);
        
        // 抽出したテキストを保存
        setPreparationData(prev => ({
          ...prev,
          [type]: { 
            type: 'file', 
            file: { 
              name: file.name, 
              size: (file.size / 1024).toFixed(2) + ' KB' 
            }, 
            text: extractedText // 抽出したテキストを保存
          }
        }));
        
        // 成功メッセージ
        setTimeout(() => {
          alert(`✅ PDF解析成功\n\nファイル: ${file.name}\n抽出文字数: ${extractedText.length}文字\n\nAIはこの内容を使用します。`);
        }, 100);
      } else {
        throw new Error('PDFからテキストを抽出できませんでした');
      }
      
    } catch (err: any) {
      console.error('❌ PDF解析エラー:', err);
      
      // エラーメッセージを表示
      const errorMessage = err.message || 'PDFの解析に失敗しました';
      
      setTimeout(() => {
        alert(
          `❌ PDF解析エラー\n\n${errorMessage}\n\n` +
          '以下のいずれかをお試しください：\n' +
          '1. 別のPDFファイルをアップロード\n' +
          '2. 「手動入力」を選択してテキストを直接入力'
        );
      }, 100);
    }
  };

  const canStartInterview = () => {
    return preparationData.resume.type !== 'none' &&
           preparationData.careerHistory.type !== 'none' &&
           preparationData.interviewScript.type !== 'none' &&
           preparationData.industry &&
           preparationData.position.type !== 'none' &&
           preparationData.company;
  };

  const renderFileOrTextInput = (
    type: keyof typeof fileInputRefs, 
    label: string, 
    placeholder: string, 
    rows = 8, 
    isRequired = false
  ) => {
    const data = preparationData[type];
    
    return (
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <label className="block text-sm font-semibold text-gray-900 mb-3">
          {label} {isRequired && <span className="text-red-500">*</span>}
        </label>
        {type === 'interviewScript' && (
          <p className="text-xs text-gray-600 mb-4">
            事前に準備した面接の質問と回答をアップロードまたは入力してください。AIはこの内容を優先的に使用します。
          </p>
        )}
        {type === 'companyResearch' && !isRequired && (
          <p className="text-xs text-gray-600 mb-4">
            企業研究資料を入力するとAIの回答がより具体的になります。
          </p>
        )}
        
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setPreparationData(prev => ({ 
              ...prev, 
              [type]: { type: 'file', file: null, text: '' }
            }))}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              data.type === 'file'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            PDFアップロード
          </button>
          <button
            onClick={() => setPreparationData(prev => ({ 
              ...prev, 
              [type]: { type: 'text', file: null, text: '' }
            }))}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              data.type === 'text'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            手動入力
          </button>
        </div>

        {data.type === 'file' && (
          <>
            {data.file ? (
              <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg border border-green-200">
                <div className="flex items-center gap-3">
                  <Check className="w-5 h-5 text-green-600" />
                  <div>
                    <div className="text-sm font-medium text-gray-900">{data.file.name}</div>
                    <div className="text-xs text-gray-500">{data.file.size}</div>
                  </div>
                </div>
                <button
                  onClick={() => setPreparationData(prev => ({ 
                    ...prev, 
                    [type]: { ...prev[type], file: null }
                  }))}
                  className="p-2 hover:bg-green-100 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-gray-600" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRefs[type].current?.click()}
                className="w-full flex items-center justify-center gap-3 px-6 py-4 border-2 border-dashed border-gray-300 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-colors"
              >
                <Upload className="w-5 h-5 text-gray-600" />
                <span className="text-sm font-medium text-gray-700">PDFをアップロード</span>
              </button>
            )}
            <input
              ref={fileInputRefs[type]}
              type="file"
              accept=".pdf"
              onChange={(e) => handleFileUpload(type, e)}
              className="hidden"
            />
          </>
        )}

        {data.type === 'text' && (
          <textarea
            value={data.text}
            onChange={(e) => setPreparationData(prev => ({
              ...prev,
              [type]: { ...prev[type], text: e.target.value }
            }))}
            placeholder={placeholder}
            rows={rows}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        )}
      </div>
    );
  };

  return (
    <div className={`flex flex-col h-full ${themeClasses.bg}`}>
      {/* Header */}
      <div className={`${themeClasses.bgCard} border-b ${themeClasses.border} px-6 py-4 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className={`text-lg font-semibold ${themeClasses.text}`}>面接アシスタント - 準備</h1>
            <p className={`text-xs ${themeClasses.textMuted}`}>Interview Assistant - Setup</p>
          </div>
        </div>
        <button
          onClick={onOpenSettings}
          className={`p-2 ${themeClasses.bgHover} rounded-lg transition-colors`}
        >
          <Settings className={`w-5 h-5 ${themeClasses.textLabel}`} />
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Tabs */}
        <div className={`w-64 ${themeClasses.bgCard} border-r ${themeClasses.border} p-4`}>
          <div className="space-y-2">
            <button
              onClick={() => setActiveTab('documents')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                activeTab === 'documents'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <FileText className="w-5 h-5" />
              <div className="flex-1 text-left">
                <div className="text-sm font-medium">基本資料</div>
                <div className="text-xs opacity-75">履歴書・経歴書</div>
              </div>
              {preparationData.resume.type !== 'none' && preparationData.careerHistory.type !== 'none' && (
                <Check className="w-4 h-4 text-green-600" />
              )}
            </button>

            <button
              onClick={() => setActiveTab('interview')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                activeTab === 'interview'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Briefcase className="w-5 h-5" />
              <div className="flex-1 text-left">
                <div className="text-sm font-medium">面接情報</div>
                <div className="text-xs opacity-75">企業・職種</div>
              </div>
              {preparationData.industry && preparationData.position.type !== 'none' && 
               preparationData.company && (
                <Check className="w-4 h-4 text-green-600" />
              )}
            </button>

            <button
              onClick={() => setActiveTab('script')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                activeTab === 'script'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <BookOpen className="w-5 h-5" />
              <div className="flex-1 text-left">
                <div className="text-sm font-medium">面接稿</div>
                <div className="text-xs opacity-75">準備資料（必須）</div>
              </div>
              {preparationData.interviewScript.type !== 'none' && (
                <Check className="w-4 h-4 text-green-600" />
              )}
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-8 py-8">
            {activeTab === 'documents' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 mb-2">基本資料のアップロード</h2>
                  <p className="text-sm text-gray-600">あなたの履歴書と職務経歴書をアップロードまたは入力してください。</p>
                </div>

                {renderFileOrTextInput('resume', '履歴書', '学歴、職歴などを入力してください...', 10, true)}
                {renderFileOrTextInput('careerHistory', '職務経歴書', '詳しい職務経験、プロジェクト、成果などを入力してください...', 12, true)}
              </div>
            )}

            {activeTab === 'interview' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 mb-2">面接情報</h2>
                  <p className="text-sm text-gray-600">面接する企業と職種の情報を入力してください。</p>
                </div>

                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
                  <label className="block text-sm font-semibold text-gray-900 mb-3">
                    現在の所属業界 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={preparationData.industry}
                    onChange={(e) => setPreparationData(prev => ({ ...prev, industry: e.target.value }))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">業界を選択してください</option>
                    <option value="IT・インターネット・通信">IT・インターネット・通信</option>
                    <option value="ソフトウェア・情報処理">ソフトウェア・情報処理</option>
                    <option value="メーカー（電気・電子・機械）">メーカー（電気・電子・機械）</option>
                    <option value="メーカー（素材・化学・食品・化粧品）">メーカー（素材・化学・食品・化粧品）</option>
                    <option value="商社（総合商社・専門商社）">商社（総合商社・専門商社）</option>
                    <option value="金融（銀行・証券・保険）">金融（銀行・証券・保険）</option>
                    <option value="コンサルティング">コンサルティング</option>
                    <option value="広告・マスコミ・出版">広告・マスコミ・出版</option>
                    <option value="小売・流通・サービス">小売・流通・サービス</option>
                    <option value="不動産・建設・設備">不動産・建設・設備</option>
                    <option value="運輸・物流・倉庫">運輸・物流・倉庫</option>
                    <option value="医療・福祉・介護">医療・福祉・介護</option>
                    <option value="教育・人材サービス">教育・人材サービス</option>
                    <option value="官公庁・団体・その他">官公庁・団体・その他</option>
                  </select>
                </div>

                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
                  <label className="block text-sm font-semibold text-gray-900 mb-3">
                    面接企業名 <span className="text-red-500">*</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <Building2 className="w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      value={preparationData.company}
                      onChange={(e) => setPreparationData(prev => ({ ...prev, company: e.target.value }))}
                      placeholder="例: 株式会社ABC"
                      className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {renderFileOrTextInput('position', '応募職種情報', '職種名、業務内容、必要なスキルなどを入力...', 6, true)}
                {renderFileOrTextInput('companyResearch', '企業研究資料（オプション）', '企業の強み、事業内容、文化、最近のニュースなどを入力...', 8, false)}
              </div>
            )}

            {activeTab === 'script' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 mb-2">面接稿（必須）</h2>
                  <p className="text-sm text-gray-600">
                    事前に準備した面接の質問と回答をアップロードまたは入力してください。
                  </p>
                </div>

                <div className="bg-blue-50 rounded-xl p-6 border border-blue-100">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <h4 className="text-sm font-semibold text-blue-900 mb-2">重要：面接稿の使用方法</h4>
                      <ul className="text-xs text-blue-700 space-y-2">
                        <li>• <strong>面接稿に含まれる質問</strong> → AIは面接稿の回答をそのまま提案します</li>
                        <li>• <strong>類似した質問</strong> → AIは面接稿の回答を基に提案します</li>
                        <li>• <strong>面接稿にない質問</strong> → AIが5W1Hを意識して新しい回答を生成します</li>
                        <li className="mt-3 pt-3 border-t border-blue-200">
                          <strong>5W1H原則：</strong> When（いつ）、Where（どこで）、Who（だれが）、What（なにを）、Why（なぜ）、How（どのように）を意識した回答を心がけます。
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>

                {renderFileOrTextInput(
                  'interviewScript', 
                  '面接準備資料・想定Q&A', 
                  '例:\n\nQ: 自己紹介をお願いします。\nA: 私は田中太郎と申します。2019年に東京大学工学部を卒業後...\n\nQ: 志望動機を教えてください。\nA: 御社を志望する理由は3点あります...',
                  14,
                  true
                )}

                <div className="bg-green-50 rounded-xl p-6 border border-green-100">
                  <div className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <h4 className="text-sm font-semibold text-green-900 mb-2">推奨フォーマット</h4>
                      <p className="text-xs text-green-700 leading-relaxed">
                        質問と回答をペアで記載してください。AIが自動的に質問を識別し、マッチングします。
                        回答には具体的な数字、エピソード、成果を含めると効果的です。
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="px-8 py-4 bg-white border-t border-gray-200">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {canStartInterview() ? (
              <span className="text-green-600 font-medium">✓ すべての準備が完了しました</span>
            ) : (
              <span>必須項目（*）を入力してください</span>
            )}
          </div>
          <button
            onClick={() => canStartInterview() && onStartInterview()}
            disabled={!canStartInterview()}
            className={`flex items-center gap-2 px-8 py-3 rounded-xl transition-colors shadow-sm font-medium ${
              canStartInterview()
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            <span>面接を開始</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

