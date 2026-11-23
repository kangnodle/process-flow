import { describe, expect, it } from 'vitest';
import { detectLocale } from './locale';
import { initialPreferences, resolveMode } from './preferences';

describe('detectLocale', () => {
  it('선호 언어 중 처음 맞는 지원 언어를 고른다', () => {
    expect(detectLocale(['en-US', 'ko'])).toBe('en');
    expect(detectLocale(['ja', 'ko-KR'])).toBe('ko');
    expect(detectLocale(['EN'])).toBe('en');
  });

  it('지원 언어가 없으면 한국어로 시작한다', () => {
    expect(detectLocale(['fr', 'de'])).toBe('ko');
    expect(detectLocale([])).toBe('ko');
  });
});

describe('initialPreferences', () => {
  it('override → 선호 언어/시스템 순서로 고른다', () => {
    expect(initialPreferences(undefined, ['en-US'])).toEqual({ locale: 'en', theme: 'system' });
    expect(initialPreferences({ locale: 'en' }, ['ko'])).toEqual({ locale: 'en', theme: 'system' });
    expect(initialPreferences({ locale: 'ko', theme: 'dark' }, ['en-US'])).toEqual({ locale: 'ko', theme: 'dark' });
  });
});

describe('resolveMode', () => {
  it('시스템 설정이면 운영체제 모드를, 아니면 고른 모드를 쓴다', () => {
    expect(resolveMode('system', 'dark')).toBe('dark');
    expect(resolveMode('light', 'dark')).toBe('light');
    expect(resolveMode('dark', 'light')).toBe('dark');
  });
});
