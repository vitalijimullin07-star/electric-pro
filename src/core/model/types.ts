import type { Vec2 } from '../math/vec';

/*
 * Модель проекта печатной платы.
 *
 * Все размеры и координаты в миллиметрах, ось Y направлена вниз, углы в градусах
 * (положительный угол — против часовой стрелки на экране). Проект — обычный
 * сериализуемый объект: его можно сохранить в JSON как есть. Все изменения
 * делаются неизменяемо (через immer), благодаря этому история отмены хранит
 * просто предыдущие версии проекта.
 */

export type Id = string;

/** Слои платы. Имена как в KiCad: их понимают все, и они прямо соответствуют файлам Gerber. */
export type LayerId =
  | 'F.Cu'
  | 'B.Cu'
  | 'F.Silk'
  | 'B.Silk'
  | 'F.Mask'
  | 'B.Mask'
  | 'F.Paste'
  | 'B.Paste'
  | 'F.Fab'
  | 'B.Fab'
  | 'F.Courtyard'
  | 'B.Courtyard'
  | 'Edge.Cuts';

export type CopperLayer = 'F.Cu' | 'B.Cu';
/** Сторона установки компонента: top — сторона деталей, bottom — сторона пайки. */
export type Side = 'top' | 'bottom';

/* ---------------- корпуса (посадочные места) ---------------- */

export type PadShape = 'circle' | 'rect' | 'roundrect' | 'oval';
/** smd — планарная площадка; tht — металлизированное отверстие; npth — отверстие без металлизации. */
export type PadType = 'smd' | 'tht' | 'npth';

export interface PadDef {
  /** Номер вывода, по нему компонент связывается с цепями: "1", "A0", "+". */
  number: string;
  /** Функция вывода для подписи на плате: "GND", "SDA". */
  name?: string;
  type: PadType;
  shape: PadShape;
  /** Центр площадки в координатах корпуса. */
  at: Vec2;
  /** Ширина и высота площадки (для круга — диаметр в обоих полях). */
  size: Vec2;
  rotation?: number;
  /** Скругление для roundrect: доля от меньшей стороны, 0…0,5. */
  roundness?: number;
  /** Диаметр отверстия для tht и npth. */
  drill?: number;
  /** Отступ маски от края площадки; если не задан, берётся из правил проекта. */
  maskMargin?: number;
  /** Планарная площадка на обратной стороне корпуса (торцевые разъёмы): 'B.Cu' — напротив стороны установки. */
  layer?: 'F.Cu' | 'B.Cu';
}

/** Графика в корпусе или на плате. Слой корпуса задаётся для верхней стороны, при установке снизу F.* меняется на B.*. */
export type Graphic =
  | { kind: 'line'; layer: LayerId; a: Vec2; b: Vec2; width: number }
  | { kind: 'rect'; layer: LayerId; a: Vec2; b: Vec2; width: number; fill?: boolean }
  | { kind: 'circle'; layer: LayerId; c: Vec2; r: number; width: number; fill?: boolean }
  | { kind: 'arc'; layer: LayerId; c: Vec2; r: number; start: number; sweep: number; width: number }
  | { kind: 'poly'; layer: LayerId; pts: Vec2[]; width: number; fill?: boolean; closed?: boolean }
  /** Размерная линия: расстояние от a до b, вынесенное на offset (со знаком, влево от a→b). */
  | { kind: 'dimension'; layer: LayerId; a: Vec2; b: Vec2; offset: number; width: number; size: number }
  | {
      kind: 'text';
      layer: LayerId;
      at: Vec2;
      /** Текст; ${REF} и ${VALUE} подставляются из компонента. */
      text: string;
      size: number;
      thickness?: number;
      rotation?: number;
      align?: 'left' | 'center' | 'right';
    };

export interface FootprintDef {
  /** Уникальный идентификатор в библиотеке, например "R_0805_2012Metric". */
  id: string;
  /** Короткое имя для списка: "0805". */
  name: string;
  description?: string;
  /** Раздел библиотеки: «Резисторы», «Микросхемы»… */
  category: string;
  /** Подраздел: «SMD чип», «DIP», «Выводные»… */
  group?: string;
  tags?: string[];
  pads: PadDef[];
  graphics: Graphic[];
  /** Габарит установки (courtyard) в координатах корпуса. */
  courtyard?: { min: Vec2; max: Vec2 };
  /** Буква позиционного обозначения по умолчанию: R, C, U, J… */
  refPrefix?: string;
  /** Откуда взяты размеры (стандарт, даташит). */
  source?: string;
  /** Размеры сверены с даташитом или стандартом. false — типовые, проверить перед заказом. */
  verified?: boolean;
  /** Высота корпуса над платой, мм (для будущего 3D). */
  height?: number;
}

/* ---------------- размещённые объекты ---------------- */

export interface Component {
  id: Id;
  /** Позиционное обозначение: R1, U2. */
  ref: string;
  value: string;
  description?: string;
  /** Идентификатор корпуса в project.footprints. */
  footprint: string;
  /** Корпуса, на которые можно заменить (у всех должны совпадать номера выводов). */
  alternatives?: string[];
  at: Vec2;
  rotation: number;
  side: Side;
  locked?: boolean;
  /** Номер вывода → цепь. Выводы без цепи не подключаются. */
  padNets: Record<string, Id>;
  /** Не включать в перечень элементов (крепёжные отверстия, логотипы). */
  excludeFromBom?: boolean;
  /** Дополнительные поля: производитель, артикул, ссылка. */
  fields?: Record<string, string>;
  hideRef?: boolean;
  hideValue?: boolean;
}

export interface Track {
  id: Id;
  layer: CopperLayer;
  width: number;
  /** Ломаная из двух и более точек. */
  points: Vec2[];
  locked?: boolean;
}

/** Переходное отверстие через всю плату. На односторонней плате — площадка с отверстием под перемычку. */
export interface Via {
  id: Id;
  at: Vec2;
  diameter: number;
  drill: number;
  locked?: boolean;
}

/** Перемычка проводом со стороны деталей (для односторонних плат). Концы должны попадать на площадки или переходные. */
export interface Wire {
  id: Id;
  a: Vec2;
  b: Vec2;
}

/** Полигон заливки медью: заливку считает src/core/model/zone-fill.ts. */
export interface Zone {
  id: Id;
  name?: string;
  layer: CopperLayer;
  net: Id | null;
  outline: Vec2[];
  clearance: number;
  minWidth: number;
  priority: number;
  /** Площадки своей цепи: термобарьер со спицами (по умолчанию, удобно паять) или сплошная медь. */
  padConnection?: 'thermal' | 'solid';
  /** Зазор термобарьера вокруг площадки, мм (по умолчанию — зазор полигона). */
  thermalGap?: number;
  /** Ширина спицы термобарьера, мм (по умолчанию 0,5). */
  thermalWidth?: number;
}

/**
 * Область правил: например, зона 230 В, куда нельзя заводить низковольтные цепи,
 * или запрет дорожек под антенной модуля.
 */
export interface RuleArea {
  id: Id;
  name: string;
  outline: Vec2[];
  /** Если задано: дорожки и переходные только этих классов цепей. */
  onlyClasses?: string[];
  keepoutTracks?: boolean;
  keepoutVias?: boolean;
  /** Показывать подпись с названием на шелкографии. */
  showLabel?: boolean;
}

/** Графика и надписи на уровне платы (логотип, надписи, размеры). */
export type Drawing = Graphic & { id: Id; locked?: boolean };

/* ---------------- цепи и правила ---------------- */

export interface Net {
  id: Id;
  name: string;
  description?: string;
  /** Имя класса цепей из project.netClasses. */
  netClass: string;
}

export interface NetClass {
  name: string;
  description?: string;
  /** Минимальный зазор от меди этого класса до чужой меди. */
  clearance: number;
  /** Ширина дорожки по умолчанию для ручной и автотрассировки. */
  trackWidth: number;
  viaDiameter: number;
  viaDrill: number;
  color?: string;
}

export interface ClassClearance {
  /** Имя класса; '*' означает любой другой класс. */
  a: string;
  b: string;
  clearance: number;
}

export interface DesignRules {
  minClearance: number;
  minTrackWidth: number;
  minViaDiameter: number;
  minViaDrill: number;
  minDrill: number;
  minAnnularRing: number;
  /** Зазор от меди до края платы. */
  edgeClearance: number;
  /** Минимальное расстояние между краями отверстий. */
  holeToHole: number;
  /** Особые зазоры между классами (например, 6 мм между 230 В и логикой). */
  classClearances: ClassClearance[];
  /** Отступ маски от площадок. */
  maskMargin: number;
  /** Закрывать переходные отверстия маской. */
  tentVias: boolean;
  /** Каплевидные переходы от дорожек к площадкам и переходным. */
  teardrops?: boolean;
}

/* ---------------- плата и проект ---------------- */

export interface Board {
  /** Контур платы (многоугольник по часовой или против). */
  outline: Vec2[];
  /** Радиус скругления углов контура. */
  cornerRadius: number;
  /** Вырезы внутри платы. */
  cutouts: Vec2[][];
  /** 1 — односторонняя (медь снизу, как для ЛУТ), 2 — двусторонняя. */
  copperLayers: 1 | 2;
  /** Толщина платы, мм. */
  thickness: number;
  /** Цвет маски для вида и будущего 3D. */
  maskColor?: string;
}

export interface ProjectMeta {
  name: string;
  description?: string;
  author?: string;
  created: string;
  modified: string;
  /** Откуда создан: идентификатор шаблона. */
  template?: string;
}

export const PROJECT_FORMAT = 'plata-project';
export const PROJECT_VERSION = 1;

export interface Project {
  format: typeof PROJECT_FORMAT;
  version: number;
  meta: ProjectMeta;
  board: Board;
  rules: DesignRules;
  netClasses: Record<string, NetClass>;
  nets: Record<Id, Net>;
  /** Копии корпусов, используемых в проекте: файл проекта самодостаточен. */
  footprints: Record<string, FootprintDef>;
  components: Record<Id, Component>;
  tracks: Record<Id, Track>;
  vias: Record<Id, Via>;
  wires: Record<Id, Wire>;
  zones: Record<Id, Zone>;
  ruleAreas: Record<Id, RuleArea>;
  drawings: Record<Id, Drawing>;
  /** Группы: выделяются и двигаются вместе. */
  groups?: Record<Id, Group>;
}

/** Группа объектов (Ctrl+G): щелчок по любому выделяет всю группу. */
export interface Group {
  id: Id;
  name: string;
  members: ItemRef[];
}

/** Ссылка на объект проекта: для выделения, подсветки и сообщений проверки. */
export type ItemKind = 'component' | 'track' | 'via' | 'wire' | 'zone' | 'ruleArea' | 'drawing';
export interface ItemRef {
  kind: ItemKind;
  id: Id;
}
/** Ссылка на конкретную площадку компонента. */
export interface PadRef {
  component: Id;
  pad: string;
}

export const itemKey = (r: ItemRef): string => `${r.kind}:${r.id}`;
export const padKey = (componentId: Id, pad: string): string => `${componentId}#${pad}`;
