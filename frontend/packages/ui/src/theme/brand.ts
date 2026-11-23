import { createDarkTheme, createLightTheme, type BrandVariants, type Theme } from '@fluentui/react-components';

export const brandRamp: BrandVariants = {
  10: '#07102B',
  20: '#0C1A43',
  30: '#10245C',
  40: '#142F74',
  50: '#18398D',
  60: '#1C43A5',
  70: '#204DBE',
  80: '#2457D6',
  90: '#3C69DB',
  100: '#547CDF',
  110: '#6C8EE4',
  120: '#84A1E8',
  130: '#9CB3ED',
  140: '#B5C6F1',
  150: '#CDD8F6',
  160: '#E5EBFA',
};

const fontFamilyBase =
  "'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";

export const lightTheme: Theme = {
  ...createLightTheme(brandRamp),
  fontFamilyBase,
};

const generatedDark = createDarkTheme(brandRamp);

export const darkTheme: Theme = {
  ...generatedDark,
  fontFamilyBase,
  colorBrandBackground: brandRamp[70],
  colorBrandBackgroundHover: brandRamp[60],
  colorBrandBackgroundPressed: brandRamp[40],
  colorBrandBackgroundSelected: brandRamp[60],
  colorCompoundBrandBackground: brandRamp[100],
  colorBrandForeground1: brandRamp[110],
  colorBrandForeground2: brandRamp[120],
};

export type ThemeMode = 'light' | 'dark';

export function themeFor(mode: ThemeMode): Theme {
  return mode === 'dark' ? darkTheme : lightTheme;
}
