import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Zap, Maximize2, Droplet } from 'lucide-react';
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
const OPACITY_STORAGE_KEY = 'compact-window-opacity';

export default function CompactWindow() {
  const [state, setState] = useState<CompactStatePayload | null>(null);
  const [opacity, setOpacity] = useState<number>(() => {
    const saved = localStorage.getItem(OPACITY_STORAGE_KEY);
    return saved ? Number(saved) : 0.95;
  });
  const channelRef = useRef<BroadcastChannel | null>(null);

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
      accentBg: isDark ? 'bg-blue-950/40' : 'bg-blue-50',
      accentBorder: isDark ? 'border-blue-900/60' : 'border-blue-200',
      sliderAccent: isDark ? 'accent-blue-300' : 'accent-blue-500',
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
    const label =
      role === 'interviewer' ? '面接官' : role === 'user' ? 'あなた' : '待機中';

    let detail = '話者未判定';
    if (original) {
      const base = original.startsWith('spk')
        ? `Speaker ${original.replace('spk', '')}`
        : original;
      if (!state.interviewerSpeaker) {
        detail = base;
      } else {
        detail =
          original === state.interviewerSpeaker
            ? `面接官 (${base})`
            : `あなた (${base})`;
      }
    }

    const indicatorClass =
      role === 'interviewer'
        ? 'bg-blue-500'
        : role === 'user'
        ? 'bg-green-500'
        : 'bg-gray-400';

    const latestTimestamp = state.latestMessage?.timestamp ?? '';
    const latestLabel =
      state.latestMessage?.speaker === 'interviewer'
        ? '面接官'
        : state.latestMessage?.speaker === 'user'
        ? 'あなた'
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

  const handleOpacityChange = useCallback((value: number) => {
    setOpacity(value);
    localStorage.setItem(OPACITY_STORAGE_KEY, value.toString());
  }, []);

  const handleClose = useCallback(() => {
    sendCommand('close-compact');
  }, [sendCommand]);

  return (
    <div className="w-full h-full bg-transparent px-3 py-4">
      <div
        className={`h-full flex flex-col border ${themeClasses.cardBorder} ${themeClasses.cardBg} ${themeClasses.cardShadow} ${themeClasses.text} rounded-3xl backdrop-blur-xl overflow-hidden`}
        style={{ opacity }}
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

        <div
          className={`px-5 py-3 flex items-center gap-3 border-y ${themeClasses.dividerBorder} ${themeClasses.sectionBg}`}
          data-tauri-drag-region={false}
        >
          <Droplet className={`w-4 h-4 ${themeClasses.textMuted}`} />
          <input
            type="range"
            min={0.4}
            max={1}
            step={0.05}
            value={opacity}
            onChange={event => handleOpacityChange(Number(event.target.value))}
            className={`flex-1 ${themeClasses.sliderAccent}`}
            aria-label="ウィンドウの透明度"
          />
          <span className={`text-xs min-w-[44px] text-right ${themeClasses.textMuted}`}>
            {Math.round(opacity * 100)}%
          </span>
        </div>

        <main className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
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
              <span className="text-sm font-semibold">{activeSpeaker.label}</span>
            </div>
            <p className={`text-xs ${themeClasses.textMuted}`}>{activeSpeaker.detail}</p>
            {activeSpeaker.latestLabel && activeSpeaker.latestTimestamp && (
              <p className={`text-xs ${themeClasses.textMuted}`}>
                最新: {activeSpeaker.latestLabel}・{activeSpeaker.latestTimestamp}
              </p>
            )}
          </section>

          <section
            className={`rounded-2xl border ${themeClasses.sectionBorder} ${themeClasses.sectionBg} p-4 space-y-3`}
          >
            <p className={`text-xs font-semibold uppercase tracking-wide ${themeClasses.textMuted}`}>
              最新の転写
            </p>
            <div
              className={`rounded-xl border ${themeClasses.subtleBorder} ${themeClasses.sectionSubtleBg} px-3 py-2 min-h-[112px]`}
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                {activeSpeaker.transcriptText}
              </p>
            </div>
          </section>

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
              className={`rounded-xl border ${themeClasses.subtleBorder} ${themeClasses.sectionBg} px-3 py-2 min-h-[140px]`}
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{aiInfo.text}</p>
              {aiInfo.timestamp && (
                <p className={`text-xs mt-2 text-right ${themeClasses.textMuted}`}>
                  {aiInfo.timestamp}
                </p>
              )}
            </div>
            {aiInfo.question && (
              <p className={`text-xs ${themeClasses.textMuted}`}>Q: {aiInfo.question}</p>
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
                  onClick={() =>
                    sendCommand(state.isPaused ? 'resume-recording' : 'pause-recording')
                  }
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
                onClick={() => sendCommand('start-recording')}
                className="px-4 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                data-tauri-drag-region={false}
              >
                録音開始
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
