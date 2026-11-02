import type { ArcDef, ArcNode } from '@ed/schema';

/**
 * Remove one authored substory beat without leaving dangling successors or
 * deleting the last node. The editor owns the separate event-side binding.
 */
export function removeAuthoredArcNode(arc: ArcDef, id: string): ArcNode | undefined {
  if (arc.inline || arc.nodes.length <= 1) return undefined;
  const index = arc.nodes.findIndex((node) => node.id === id);
  if (index < 0) return undefined;

  const [removed] = arc.nodes.splice(index, 1);
  for (const node of arc.nodes) {
    for (const successor of node.successors) {
      if (successor.to === id) successor.to = 'end';
    }
  }
  if (arc.entry === id) arc.entry = arc.nodes[0]!.id;
  return removed;
}
