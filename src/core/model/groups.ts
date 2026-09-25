import type { ItemRef, Project } from './types';

/* Группы: набор объектов, которые выделяются и двигаются вместе. */

const key = (r: ItemRef) => r.kind + ':' + r.id;

/** Есть ли объект в проекте. */
export function itemExists(p: Project, r: ItemRef): boolean {
  switch (r.kind) {
    case 'component':
      return !!p.components[r.id];
    case 'track':
      return !!p.tracks[r.id];
    case 'via':
      return !!p.vias[r.id];
    case 'wire':
      return !!p.wires[r.id];
    case 'zone':
      return !!p.zones[r.id];
    case 'ruleArea':
      return !!p.ruleAreas[r.id];
    case 'drawing':
      return !!p.drawings[r.id];
  }
}

/** Выделение, дополненное всеми участниками групп, в которые входят выбранные объекты. */
export function expandGroups(p: Project, refs: ItemRef[]): ItemRef[] {
  const groups = Object.values(p.groups ?? {});
  if (!groups.length || !refs.length) return refs;
  const keys = new Set(refs.map(key));
  const out = [...refs];
  for (const g of groups)
    if (g.members.some((m) => keys.has(key(m))))
      for (const m of g.members)
        if (!keys.has(key(m)) && itemExists(p, m)) {
          keys.add(key(m));
          out.push(m);
        }
  return out;
}

/** Убирает из групп удалённые объекты и группы, где осталось меньше двух. */
export function pruneGroups(p: Project): void {
  if (!p.groups) return;
  for (const g of Object.values(p.groups)) {
    const alive = g.members.filter((m) => itemExists(p, m));
    if (alive.length < 2) delete p.groups[g.id];
    else if (alive.length !== g.members.length) g.members = alive;
  }
}

/** Группа, в которую входит объект. */
export const groupOf = (p: Project, r: ItemRef) => Object.values(p.groups ?? {}).find((g) => g.members.some((m) => m.kind === r.kind && m.id === r.id));
