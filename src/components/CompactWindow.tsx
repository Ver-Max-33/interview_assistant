import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Zap, Maximize2 } from 'lucide-react';
import type { Message, Settings as SettingsType, Suggestion } from '../types';

type CompactChannelMessage =
  | { type: 'state'; payload: CompactStatePayload }
  | { type: 'request_state' }
  | { type: 'command'; payload: CompactCommand };

type CompactCommand =
  | 'start-recording'
  | 'pause-recording'
  | 'resume-recording'
  | 'stop-recording'
  | 'close-compact';

interface CompactStatePayload {
  settings: SettingsType;
  isRecording: boolean;
  isPaused: boolean;
  currentSpeaker: 'interviewer' | 'user' | null;
  currentOriginalSpeaker: string | null;
  interviewerSpeaker: 'spk1' | 'spk2' | null;
  latestMessage: Message | null;
  latestSuggestion: Suggestion | null;
}

const CHANNEL_NAME = 'compact-view-channel';
export default function CompactWindow() {
  const [state, setState] = useState<CompactStatePayload | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const micPrimedRef = useRef(false);
  const [micError, setMicError] = useState<string | null>(null);

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;

    const handleMessage = (event: MessageEvent<CompactChannelMessage>) => {
      const data = event.data;
      if (!data || typeof data !== 'object') {
        return;
      }

      if (data.type === 'state') {
        setState(data.payload);
      }
    };

    channel.addEventListener('message', handleMessage);
    channel.postMessage({ type: 'request_state' });

    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
      channelRef.current = null;
    };
  }, []);

  const themeClasses = useMemo(() => {
    const isDark = state?.settings.displaySettings.theme === 'dark';
    return {
      isDark,
      cardBg: isDark ? 'bg-slate-900/80' : 'bg-white/95',
      cardBorder: isDark ? 'border-slate-700/70' : 'border-slate-200/70',
      cardShadow: isDark
        ? 'shadow-[0_24px_70px_rgba(15,23,42,0.55)]'
        : 'shadow-[0_20px_60px_rgba(15,23,42,0.15)]',
      text: isDark ? 'text-slate-100' : 'text-slate-900',
      textMuted: isDark ? 'text-slate-400' : 'text-slate-600',
      textLabel: isDark ? 'text-slate-300' : 'text-slate-700',
      dragBg: isDark ? 'bg-slate-900/70' : 'bg-white/70',
      sectionBg: isDark ? 'bg-slate-900/55' : 'bg-white/80',
      sectionBorder: isDark ? 'border-slate-800/60' : 'border-slate-200/80',
      subtleBorder: isDark ? 'border-slate-800/40' : 'border-slate-200/60',
      sectionSubtleBg: isDark ? 'bg-slate-900/40' : 'bg-slate-100/60',
      accentBg: isDark ? 'bg-blue-950/35' : 'bg-blue-50',
      accentBorder: isDark ? 'border-blue-900/60' : 'border-blue-200',
      hoverMuted: isDark ? 'hover:bg-slate-800/70' : 'hover:bg-slate-100/70',
      buttonMutedBg: isDark ? 'bg-slate-800/70' : 'bg-slate-100/80',
      dividerBorder: isDark ? 'border-slate-900/40' : 'border-slate-200/60'
    };
  }, [state?.settings.displaySettings.theme]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const previousBody = document.body.style.backgroundColor;
    const previousRoot = document.documentElement.style.backgroundColor;
    document.body.style.backgroundColor = 'transparent';
    document.documentElement.style.backgroundColor = 'transparent';

    return () => {
      document.body.style.backgroundColor = previousBody;
      document.documentElement.style.backgroundColor = previousRoot;
    };
  }, []);

  const activeSpeaker = useMemo(() => {
    if (!state) {
      return {
        label: '待機中',
        detail: '話者未判定',
        indicatorClass: 'bg-gray-400'
      };
    }

    const role = state.currentSpeaker ?? state.latestMessage?.speaker ?? null;
    const original = state.currentOriginalSpeaker ?? state.latestMessage?.originalSpeaker ?? null;
    const hasSpeakerMapping = Boolean(state.interviewerSpeaker);

    let label = '待機中';
    if (role) {
      label = hasSpeakerMapping
        ? role === 'interviewer'
          ? '面接官'
          : 'あなた'
        : '判定中';
    }

    let detail = hasSpeakerMapping ? '話者未判定' : '話者の特定中';
    if (original) {
      const base = original.startsWith('spk')
        ? `Speaker ${original.replace('spk', '')}`
        : original;
      if (!hasSpeakerMapping) {
        detail = `判定中 (${base})`;
      } else {
        detail =
          original === state.interviewerSpeaker
            ? `面接官 (${base})`
            : `あなた (${base})`;
      }
    }

    const indicatorClass =
      role && hasSpeakerMapping
        ? role === 'interviewer'
          ? 'bg-blue-500'
          : 'bg-green-500'
        : 'bg-gray-400';

    const latestTimestamp = state.latestMessage?.timestamp ?? '';
    const latestRole = state.latestMessage?.speaker ?? null;
    const latestLabel =
      latestRole && hasSpeakerMapping
        ? latestRole === 'interviewer'
          ? '面接官'
          : 'あなた'
        : latestRole
        ? '判定中'
        : '';

    return {
      label,
      detail,
      indicatorClass,
      latestLabel,
      latestTimestamp,
      transcriptText:
        state.latestMessage && state.latestMessage.text.trim().length > 0
          ? state.latestMessage.text
          : '転写はまだありません'
    };
  }, [state]);

  const aiInfo = useMemo(() => {
    if (!state) {
      return {
        text: 'AIの回答はまだありません',
        sourceLabel: null as string | null,
        timestamp: ''
      };
    }

    const suggestion = state.latestSuggestion;
    const text =
      suggestion && suggestion.answer.trim().length > 0
        ? suggestion.answer
        : 'AIの回答はまだありません';

    const sourceLabel = suggestion
      ? suggestion.source === 'script'
        ? 'スクリプト'
        : 'AI生成'
      : null;

    const timestamp = suggestion?.timestamp ?? '';

    return {
      text,
      sourceLabel,
      timestamp,
      question: suggestion?.question ?? ''
    };
  }, [state]);

  const sendCommand = useCallback(
    (command: CompactCommand) => {
      channelRef.current?.postMessage({ type: 'command', payload: command });
    },
    []
  );

  const handleClose = useCallback(() => {
    sendCommand('close-compact');
  }, [sendCommand]);

  const ensureMicrophonePermission = useCallback(async () => {
    if (micPrimedRef.current) {
      return true;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError('マイクアクセスがサポートされていません');
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false
        }
      });
      stream.getTracks().forEach(track => track.stop());
      micPrimedRef.current = true;
      return true;
    } catch (error) {
      console.error('❌ マイクアクセスに失敗しました:', error);
      let message = 'マイクアクセスに失敗しました';
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') {
          message = 'マイクアクセスが拒否されました。設定で許可してください。';
        } else if (error.name === 'NotFoundError') {
          message = 'マイクデバイスが見つかりません。';
        }
      }
      setMicError(message);
      return false;
    }
  }, []);

  const handleStartClick = useCallback(async () => {
    setMicError(null);
    const granted = await ensureMicrophonePermission();
    if (!granted) {
      return;
    }
    sendCommand('start-recording');
  }, [ensureMicrophonePermission, sendCommand]);

  useEffect(() => {
    if (state?.isRecording) {
      setMicError(null);
    }
  }, [state?.isRecording]);

  return (
    <div className="w-full h-full bg-transparent px-4 py-5">
      <div
        className={`h-full flex flex-col border ${themeClasses.cardBorder} ${themeClasses.cardBg} ${themeClasses.cardShadow} ${themeClasses.text} rounded-3xl backdrop-blur-xl overflow-hidden`}
      >
        <header
          className={`px-5 py-4 flex items-center justify-between gap-4 ${themeClasses.dragBg}`}
          data-tauri-drag-region
        >
          <div className="flex items-center gap-3 cursor-move select-none">
            <span data-tauri-drag-region={false}>
              <Zap className="w-6 h-6 text-blue-500" />
            </span>
            <div>
              <p className="text-sm font-semibold">コンパクトビュー</p>
              <p className={`text-xs ${themeClasses.textMuted}`}>話者とAI回答を素早く確認</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className={`p-2 rounded-xl ${themeClasses.buttonMutedBg} ${themeClasses.hoverMuted} transition-colors`}
            aria-label="通常モードに戻る"
            data-tauri-drag-region={false}
          >
            <Maximize2 className={`w-4 h-4 ${themeClasses.textLabel}`} />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          <section
            className={`rounded-2xl border ${themeClasses.accentBorder} ${themeClasses.accentBg} p-4 space-y-3`}
          >
            <div className="flex items-center justify-between">
              <p className={`text-xs font-semibold uppercase tracking-wide ${themeClasses.textLabel}`}>
                AIの回答
              </p>
              {aiInfo.sourceLabel && (
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    aiInfo.sourceLabel === 'スクリプト'
                      ? 'bg-green-500/20 text-green-700 dark:text-green-200'
                      : 'bg-blue-500/20 text-blue-700 dark:text-blue-200'
                  }`}
                >
                  {aiInfo.sourceLabel}
                </span>
              )}
            </div>
            <div
              className={`rounded-xl border ${themeClasses.subtleBorder} ${themeClasses.sectionBg} px-3 py-3 min-h-[200px]`}
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{aiInfo.text}</p>
              {aiInfo.timestamp && (
                <p className={`text-xs mt-3 text-right ${themeClasses.textMuted}`}>{aiInfo.timestamp}</p>
              )}
            </div>
            {aiInfo.question && (
              <p className={`text-xs ${themeClasses.textMuted}`}>Q: {aiInfo.question}</p>
            )}
          </section>

          <section
            className={`rounded-2xl border ${themeClasses.sectionBorder} ${themeClasses.sectionBg} p-4 space-y-3`}
          >
            <p className={`text-xs font-semibold uppercase tracking-wide ${themeClasses.textMuted}`}>
              最新の転写
            </p>
            <div
              className={`rounded-xl border ${themeClasses.subtleBorder} ${themeClasses.sectionSubtleBg} px-3 py-2 min-h-[120px]`}
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                {activeSpeaker.transcriptText}
              </p>
            </div>
          </section>

          <section
            className={`rounded-2xl border ${themeClasses.sectionBorder} ${themeClasses.sectionBg} p-4 space-y-3`}
          >
            <p className={`text-xs font-semibold uppercase tracking-wide ${themeClasses.textMuted}`}>
              現在の話者
            </p>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex w-2.5 h-2.5 rounded-full ${activeSpeaker.indicatorClass}`}
              />
              <div className="flex flex-col">
                <span className="text-sm font-semibold">{activeSpeaker.label}</span>
                <span className={`text-xs ${themeClasses.textMuted}`}>{activeSpeaker.detail}</span>
              </div>
            </div>
            {activeSpeaker.latestLabel && activeSpeaker.latestTimestamp && (
              <p className={`text-xs ${themeClasses.textMuted}`}>
                最新: {activeSpeaker.latestLabel}・{activeSpeaker.latestTimestamp}
              </p>
            )}
          </section>
        </main>

        <footer
          className={`px-5 py-4 border-t ${themeClasses.dividerBorder} ${themeClasses.sectionBg} flex items-center justify-between`}
          data-tauri-drag-region={false}
        >
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`inline-flex w-2.5 h-2.5 rounded-full ${
                state?.isRecording
                  ? state.isPaused
                    ? 'bg-yellow-500'
                    : 'bg-green-500 animate-pulse'
                  : 'bg-gray-400'
              }`}
            />
            <span className={themeClasses.textMuted}>
              {state?.isRecording
                ? state.isPaused
                  ? '一時停止中'
                  : '録音中'
                : '待機中'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {state?.isRecording ? (
              <>
                <button
                  onClick={() => sendCommand(state.isPaused ? 'resume-recording' : 'pause-recording')}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    state.isPaused
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                  }`}
                  data-tauri-drag-region={false}
                >
                  {state.isPaused ? '再開' : '一時停止'}
                </button>
                <button
                  onClick={() => sendCommand('stop-recording')}
                  className="px-3 py-1.5 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
                  data-tauri-drag-region={false}
                >
                  停止
                </button>
              </>
            ) : (
              <button
                onClick={handleStartClick}
                className="px-4 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                data-tauri-drag-region={false}
              >
                録音開始
              </button>
            )}
          </div>
        </footer>
        {micError && (
          <div className="px-6 pb-4">
            <p className="text-xs text-red-400">{micError}</p>
          </div>
        )}
      </div>
    </div>
  );
}
