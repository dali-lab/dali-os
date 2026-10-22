import { create } from 'twrnc';

export const tw = create(require('../tailwind.config.js'));

export const colors = {
  coolWhite: '#F5F9FF',
  coolBlack: '#0B1C29',
  darkGray: '#404040',
  paleBlue: '#D4EDFF',
  mediumGray: '#A7B5C8',
  navy: '#0C4876',
  teal: '#24B1B1',
  coral: '#E45768',
  yellow: '#FFCF88',
  darkNavy: '#083858',
  lightTeal: '#4CD5C5',
  paleTeal: '#8CE0D6',
  darkCoral: '#CF4253',
  lightCoral: '#F97979',
  paleCoral: '#FFA89C',
  lightYellow: '#FFF3B5',
  lightGreen: '#A2D483',
  green: '#64B598',
  lightPurple: '#E68FBE',
  purple: '#CA60AC',
  white: '#FFFFFF',
  slate100: '#F1F5F9',
  slate200: '#E2E8F0',
  slate300: '#CBD5E1',
  slate400: '#94A3B8',
  slate500: '#64748B',
};

export const fonts = {
  heading: 'Inter_700Bold',
  body: 'PTSans_400Regular',
  bodyBold: 'PTSans_700Bold',
  mono: 'DMMono_400Regular',
  monoMedium: 'DMMono_500Medium',
};

export const shadow = {
  sm: { shadowColor: '#101828', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  lg: { shadowColor: '#101828', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
};
