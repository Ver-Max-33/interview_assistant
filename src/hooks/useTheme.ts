import type { DisplaySettings } from '../types';

export function useTheme(displaySettings: DisplaySettings) {
  const isDark = displaySettings.theme === 'dark';
  
  const getFontSize = () => {
    switch (displaySettings.fontSize) {
      case 'small': return 'text-xs';
      case 'large': return 'text-base';
      default: return 'text-sm';
    }
  };
  
  const themeClasses = {
    bg: isDark ? 'bg-gray-900' : 'bg-gray-50',
    bgCard: isDark ? 'bg-gray-800' : 'bg-white',
    bgHover: isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100',
    border: isDark ? 'border-gray-700' : 'border-gray-200',
    text: isDark ? 'text-gray-100' : 'text-gray-900',
    textMuted: isDark ? 'text-gray-400' : 'text-gray-500',
    textLabel: isDark ? 'text-gray-300' : 'text-gray-700',
    input: isDark 
      ? 'bg-gray-700 border-gray-600 text-gray-100 focus:ring-blue-500 focus:border-blue-500'
      : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500 focus:border-blue-500'
  };
  
  return { isDark, getFontSize, themeClasses };
}

