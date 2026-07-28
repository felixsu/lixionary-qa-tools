import type { UserGuideSummary } from "../context/AppContext";

// Mirrors MAX_GUIDE_DEPTH in backend/routes/user_guides.py — the server re-validates.
export const MAX_GUIDE_DEPTH = 5;

export interface GuideTreeNode extends UserGuideSummary {
  children: GuideTreeNode[];
  depth: number; // 1-based
}

function sortSiblings(nodes: GuideTreeNode[]) {
  nodes.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
}

// Builds the page tree from the flat list endpoint. Guides whose parentId is
// missing from the list, or which sit on a cycle in legacy data, are promoted
// to root so bad data never blanks the navigation.
export function buildGuideTree(guides: UserGuideSummary[]): GuideTreeNode[] {
  const byId = new Map<string, GuideTreeNode>();
  for (const g of guides) {
    byId.set(g.id, { ...g, children: [], depth: 1 });
  }

  const isOnCycle = (id: string): boolean => {
    const seen = new Set<string>();
    let current: string | null | undefined = id;
    while (current && byId.has(current)) {
      if (seen.has(current)) return true;
      seen.add(current);
      current = byId.get(current)!.parentId;
    }
    return false;
  };

  const roots: GuideTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && !isOnCycle(node.id)) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const assignDepth = (nodes: GuideTreeNode[], depth: number) => {
    sortSiblings(nodes);
    for (const node of nodes) {
      node.depth = depth;
      assignDepth(node.children, depth + 1);
    }
  };
  assignDepth(roots, 1);
  return roots;
}

// Pre-order flatten preserving depth. skipSubtreeId excludes that node and its
// descendants — used by the studio's parent picker to prevent self-nesting.
export function flattenGuideTree(roots: GuideTreeNode[], skipSubtreeId?: string): GuideTreeNode[] {
  const out: GuideTreeNode[] = [];
  const visit = (node: GuideTreeNode) => {
    if (node.id === skipSubtreeId) return;
    out.push(node);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return out;
}

export function subtreeHeight(node: GuideTreeNode): number {
  if (node.children.length === 0) return 1;
  return 1 + Math.max(...node.children.map(subtreeHeight));
}
