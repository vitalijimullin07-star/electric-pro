import type { CopperLayer, LayerId, Side } from './types';

export interface LayerInfo {
  id: LayerId;
  /** Название в интерфейсе. */
  name: string;
  /** Цвет по умолчанию (тёмная тема, как в EasyEDA). */
  color: string;
  side: Side | null;
  /** Функция файла Gerber (X2 FileFunction). */
  gerberFunction: string;
  /** Суффикс имени файла Gerber. */
  gerberExt: string;
}

export const LAYERS: Record<LayerId, LayerInfo> = {
  'F.Cu': { id: 'F.Cu', name: 'Верхняя медь', color: '#e0474c', side: 'top', gerberFunction: 'Copper,L1,Top', gerberExt: 'GTL' },
  'B.Cu': { id: 'B.Cu', name: 'Нижняя медь', color: '#3d7be0', side: 'bottom', gerberFunction: 'Copper,L2,Bot', gerberExt: 'GBL' },
  'F.Silk': { id: 'F.Silk', name: 'Верхняя шелкография', color: '#f2e98b', side: 'top', gerberFunction: 'Legend,Top', gerberExt: 'GTO' },
  'B.Silk': { id: 'B.Silk', name: 'Нижняя шелкография', color: '#d9a3e6', side: 'bottom', gerberFunction: 'Legend,Bot', gerberExt: 'GBO' },
  'F.Mask': { id: 'F.Mask', name: 'Верхняя маска', color: '#a3417d', side: 'top', gerberFunction: 'Soldermask,Top', gerberExt: 'GTS' },
  'B.Mask': { id: 'B.Mask', name: 'Нижняя маска', color: '#1d8f8f', side: 'bottom', gerberFunction: 'Soldermask,Bot', gerberExt: 'GBS' },
  'F.Paste': { id: 'F.Paste', name: 'Верхняя паста', color: '#8c8c8c', side: 'top', gerberFunction: 'Paste,Top', gerberExt: 'GTP' },
  'B.Paste': { id: 'B.Paste', name: 'Нижняя паста', color: '#6e6e6e', side: 'bottom', gerberFunction: 'Paste,Bot', gerberExt: 'GBP' },
  'F.Fab': { id: 'F.Fab', name: 'Верхний сборочный', color: '#9aa7b8', side: 'top', gerberFunction: 'Other,Fab,Top', gerberExt: 'GTF' },
  'B.Fab': { id: 'B.Fab', name: 'Нижний сборочный', color: '#7d8795', side: 'bottom', gerberFunction: 'Other,Fab,Bot', gerberExt: 'GBF' },
  'F.Courtyard': { id: 'F.Courtyard', name: 'Верхний габарит', color: '#d6d6d6', side: 'top', gerberFunction: 'Other,Courtyard,Top', gerberExt: 'GTC' },
  'B.Courtyard': { id: 'B.Courtyard', name: 'Нижний габарит', color: '#b3b3b3', side: 'bottom', gerberFunction: 'Other,Courtyard,Bot', gerberExt: 'GBC' },
  'Edge.Cuts': { id: 'Edge.Cuts', name: 'Контур платы', color: '#e8c44a', side: null, gerberFunction: 'Profile,NP', gerberExt: 'GKO' },
};

/** Порядок в панели слоёв. */
export const LAYER_ORDER: LayerId[] = [
  'F.Cu',
  'B.Cu',
  'F.Silk',
  'B.Silk',
  'F.Mask',
  'B.Mask',
  'F.Paste',
  'B.Paste',
  'F.Fab',
  'B.Fab',
  'F.Courtyard',
  'B.Courtyard',
  'Edge.Cuts',
];

export const COPPER_LAYERS: CopperLayer[] = ['F.Cu', 'B.Cu'];

const FLIP: Partial<Record<LayerId, LayerId>> = {
  'F.Cu': 'B.Cu',
  'B.Cu': 'F.Cu',
  'F.Silk': 'B.Silk',
  'B.Silk': 'F.Silk',
  'F.Mask': 'B.Mask',
  'B.Mask': 'F.Mask',
  'F.Paste': 'B.Paste',
  'B.Paste': 'F.Paste',
  'F.Fab': 'B.Fab',
  'B.Fab': 'F.Fab',
  'F.Courtyard': 'B.Courtyard',
  'B.Courtyard': 'F.Courtyard',
};

/** Слой корпуса (заданный для верхней стороны) с учётом стороны установки. */
export function sideLayer(layer: LayerId, side: Side): LayerId {
  return side === 'bottom' ? (FLIP[layer] ?? layer) : layer;
}

export const isCopper = (l: LayerId): l is CopperLayer => l === 'F.Cu' || l === 'B.Cu';

/** Слои меди, которые реально есть на плате. */
export function boardCopperLayers(copperLayers: 1 | 2): CopperLayer[] {
  return copperLayers === 2 ? ['F.Cu', 'B.Cu'] : ['B.Cu'];
}

export const otherCopper = (l: CopperLayer): CopperLayer => (l === 'F.Cu' ? 'B.Cu' : 'F.Cu');
