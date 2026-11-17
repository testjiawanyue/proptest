import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface StateNode {
  fingerprint: string;
  url: string;
  heading?: string;
  firstSeenAt: string;
  visitCount: number;
}

export interface StateEdge {
  from: string;
  action: string;
  to: string;
  count: number;
}

export class StateGraph {
  private nodes = new Map<string, StateNode>();
  private edges: StateEdge[] = [];

  async load(filePath: string): Promise<void> {
    try {
      const raw = await readFile(filePath, "utf-8");
      const data = JSON.parse(raw) as { nodes: StateNode[]; edges: StateEdge[] };
      for (const node of data.nodes) this.nodes.set(node.fingerprint, node);
      this.edges = data.edges ?? [];
    } catch {
      // fresh graph
    }
  }

  async save(filePath: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const data = { nodes: [...this.nodes.values()], edges: this.edges };
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  visit(fingerprint: string, url: string, heading?: string): { isNew: boolean; node: StateNode } {
    const existing = this.nodes.get(fingerprint);
    if (existing) {
      existing.visitCount += 1;
      return { isNew: false, node: existing };
    }
    const node: StateNode = { fingerprint, url, heading, firstSeenAt: new Date().toISOString(), visitCount: 1 };
    this.nodes.set(fingerprint, node);
    return { isNew: true, node };
  }

  traverse(from: string, action: string, to: string): void {
    const edge = this.edges.find((item) => item.from === from && item.action === action && item.to === to);
    if (edge) edge.count += 1;
    else this.edges.push({ from, action, to, count: 1 });
  }

  novelty(fingerprint: string): number {
    const node = this.nodes.get(fingerprint);
    return node ? 1 / node.visitCount : 1;
  }

  stats(): { nodes: number; edges: number } {
    return { nodes: this.nodes.size, edges: this.edges.length };
  }
}
