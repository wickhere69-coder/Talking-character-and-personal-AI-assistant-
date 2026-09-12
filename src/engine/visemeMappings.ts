export const AZURE_VISEME_TO_OCULUS: Record<number, string> = {
  0: 'viseme_sil',
  1: 'viseme_aa',
  2: 'viseme_aa',
  3: 'viseme_O',
  4: 'viseme_E',
  5: 'viseme_RR',
  6: 'viseme_I',
  7: 'viseme_U',
  8: 'viseme_O',
  9: 'viseme_aa',
  10: 'viseme_O',
  11: 'viseme_aa',
  12: 'viseme_sil',
  13: 'viseme_RR',
  14: 'viseme_nn',
  15: 'viseme_SS',
  16: 'viseme_CH',
  17: 'viseme_TH',
  18: 'viseme_FF',
  19: 'viseme_DD',
  20: 'viseme_kk',
  21: 'viseme_PP'
};

export const OCULUS_VISEME_TO_ARKIT: Record<string, Record<string, number>> = {
  'viseme_sil': {},
  'viseme_PP': { mouthClose: 0.6, mouthPressLeft: 0.3, mouthPressRight: 0.3, mouthRollLower: 0.2, mouthRollUpper: 0.2 },
  'viseme_FF': { jawOpen: 0.1, mouthRollLower: 0.45, mouthShrugUpper: 0.25, mouthUpperUpLeft: 0.2, mouthUpperUpRight: 0.2 },
  'viseme_TH': { jawOpen: 0.15, tongueOut: 0.4, mouthSmileLeft: 0.1, mouthSmileRight: 0.1 },
  'viseme_DD': { jawOpen: 0.15, mouthSmileLeft: 0.15, mouthSmileRight: 0.15, mouthClose: 0.1 },
  'viseme_kk': { jawOpen: 0.3, mouthStretchLeft: 0.25, mouthStretchRight: 0.25 },
  'viseme_CH': { jawOpen: 0.2, mouthFunnel: 0.45, mouthPucker: 0.35 },
  'viseme_SS': { jawOpen: 0.08, mouthSmileLeft: 0.25, mouthSmileRight: 0.25, mouthClose: 0.2 },
  'viseme_nn': { jawOpen: 0.2, mouthSmileLeft: 0.15, mouthSmileRight: 0.15 },
  'viseme_RR': { jawOpen: 0.2, mouthFunnel: 0.35, mouthPucker: 0.3 },
  'viseme_aa': { jawOpen: 0.75, mouthFunnel: 0.25, mouthLowerDownLeft: 0.25, mouthLowerDownRight: 0.25 },
  'viseme_E': { jawOpen: 0.35, mouthStretchLeft: 0.3, mouthStretchRight: 0.3, mouthSmileLeft: 0.15, mouthSmileRight: 0.15 },
  'viseme_I': { jawOpen: 0.18, mouthSmileLeft: 0.4, mouthSmileRight: 0.4, mouthStretchLeft: 0.3, mouthStretchRight: 0.3 },
  'viseme_O': { jawOpen: 0.45, mouthFunnel: 0.55, mouthPucker: 0.4 },
  'viseme_U': { jawOpen: 0.15, mouthPucker: 0.75, mouthFunnel: 0.3 }
};

export const ARPABET_TO_OCULUS: Record<string, string> = {
  'P': 'viseme_PP', 'B': 'viseme_PP', 'M': 'viseme_PP',
  'F': 'viseme_FF', 'V': 'viseme_FF',
  'TH': 'viseme_TH', 'DH': 'viseme_TH',
  'T': 'viseme_DD', 'D': 'viseme_DD',
  'N': 'viseme_nn', 'L': 'viseme_nn',
  'K': 'viseme_kk', 'G': 'viseme_kk', 'NG': 'viseme_kk',
  'CH': 'viseme_CH', 'JH': 'viseme_CH', 'SH': 'viseme_CH', 'ZH': 'viseme_CH',
  'S': 'viseme_SS', 'Z': 'viseme_SS',
  'R': 'viseme_RR', 'ER': 'viseme_RR',
  'AA': 'viseme_aa', 'AE': 'viseme_aa', 'AH': 'viseme_aa',
  'EH': 'viseme_E', 'EY': 'viseme_E', 'UH': 'viseme_E',
  'IH': 'viseme_I', 'IY': 'viseme_I',
  'OW': 'viseme_O', 'AO': 'viseme_O', 'OY': 'viseme_O',
  'UW': 'viseme_U', 'W': 'viseme_U',
  'HH': 'viseme_sil', 'Y': 'viseme_sil', 'AW': 'viseme_sil', 'AY': 'viseme_sil'
};

export function getVisemeWeights(visemeId: number): Record<string, number> {
  const oculusName = AZURE_VISEME_TO_OCULUS[visemeId] || 'viseme_sil';
  return OCULUS_VISEME_TO_ARKIT[oculusName] || {};
}

export function getVisemeForPhoneme(phoneme: string): string {
  const cleanPhoneme = phoneme.replace(/[0-9]/g, '').toUpperCase();
  return ARPABET_TO_OCULUS[cleanPhoneme] || 'viseme_sil';
}

export function detectMorphTargetType(dictionary: Record<string, number>): 'oculus' | 'arkit' {
  if (dictionary && typeof dictionary['viseme_sil'] !== 'undefined') {
    return 'oculus';
  }
  return 'arkit';
}
