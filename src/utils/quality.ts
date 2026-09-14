// Central quality / mobile detection + auto-scaling.

export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualitySettings {
  level: QualityLevel;
  pixelRatio: number;
  grassCount: number;
  treeCount: number;
  bushCount: number;
  rockCount: number;
  flowerCount: number;
  shadows: boolean;
  shadowMapSize: number;
  renderDistance: number;
}

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  return /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua) || !!coarse;
}

export function defaultQuality(mobile: boolean): QualitySettings {
  if (mobile) {
    return {
      level: 'low',
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
      grassCount: 3500,
      treeCount: 110,
      bushCount: 160,
      rockCount: 90,
      flowerCount: 500,
      shadows: false,
      shadowMapSize: 512,
      renderDistance: 220,
    };
  }
  const cores = navigator.hardwareConcurrency ?? 4;
  if (cores <= 4) {
    return {
      level: 'medium',
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.75),
      grassCount: 7000,
      treeCount: 180,
      bushCount: 260,
      rockCount: 140,
      flowerCount: 900,
      shadows: true,
      shadowMapSize: 1024,
      renderDistance: 320,
    };
  }
  return {
    level: 'high',
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    grassCount: 11000,
    treeCount: 240,
    bushCount: 340,
    rockCount: 180,
    flowerCount: 1300,
    shadows: true,
    shadowMapSize: 2048,
    renderDistance: 380,
  };
}

export function cycleQuality(q: QualitySettings, mobile: boolean): QualitySettings {
  // low -> medium -> high -> low
  if (q.level === 'low') {
    return { ...defaultQuality(false), level: 'medium', grassCount: 7000, shadows: !mobile };
  }
  if (q.level === 'medium') {
    return { ...defaultQuality(false), level: 'high', grassCount: 11000, shadows: true, pixelRatio: Math.min(window.devicePixelRatio || 1, 2) };
  }
  return defaultQuality(mobile);
}
