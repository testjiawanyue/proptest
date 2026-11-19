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

export interface StateCoverage {
  /** Total unique states ever visited across all runs (cumulative) */
  totalStatesEverVisited: number;
  /** Total distinct edges (transitions) ever observed */
  totalTransitions: number;
  /** How many states were first visited *this* run (quantifies discovery yield) */
  novelStatesThisRun: number;
  /** Top 10 states sorted by visitCount desc ("hot spots" the agent keeps revisiting) */
  hotspots: { fingerprint: string; url: string; heading?: string; visits: number }[];
  /**
   * Edges whose `to` node has never itself been visited.
   * These are "promised but undelivered" transitions — the agent should try
   * to follow them in future runs to uncover more states.
   */
  unvisitedTargets: { fingerprint: string; url: string; incomingTransitions: string[] }[];
  /** States grouped by URL module (first path segment). Quick answer to "how deep did we go in /customer vs /order". */
  byModule: Record<string, { states: number; transitions: number; novelThisRun: number }>;
  /** Average visits per node. High = agent is stuck in a small loop. */
  avgVisitsPerNode: number;
}

export class StateGraph {
  private nodes = new Map<string, StateNode>();
  private edges: StateEdge[] = [];
  /** Fingerprint snapshot captured at the start of the current run, used for novel-this-run accounting. */
  private runStartFingerprints = new Set<string>();

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

  /** Take a snapshot of existing fingerprints. Call before each Charter run so coverage() can diff. */
  beginRun(): void {
    this.runStartFingerprints = new Set(this.nodes.keys());
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

  /**
   * Produce a read-only coverage snapshot answering:
   *   - How much of the app have we seen overall?
   *   - Did this run discover anything new, or just walk in circles?
   *   - Which states are we visiting over and over (possible loop)?
   *   - Which "promised" states (edge.to) have we never actually landed on?
   *   - Per-module depth?
   */
  coverage(): StateCoverage {
    const nodes = [...this.nodes.values()];
    const totalStates = nodes.length;

    // 1. Novel states discovered in the current run
    let novelStatesThisRun = 0;
    const novelByModule = new Map<string, number>();
    for (const node of nodes) {
      if (!this.runStartFingerprints.has(node.fingerprint)) {
        novelStatesThisRun += 1;
        const moduleKey = this.moduleOf(node.url);
        novelByModule.set(moduleKey, (novelByModule.get(moduleKey) ?? 0) + 1);
      }
    }

    // 2. Hotspots — top 10 most-visited states
    const hotspots = nodes
      .sort((a, b) => b.visitCount - a.visitCount)
      .slice(0, 10)
      .map((n) => ({ fingerprint: n.fingerprint, url: n.url, heading: n.heading, visits: n.visitCount }));

    // 3. Unvisited edge targets
    const visitedSet = new Set(this.nodes.keys());
    const incoming = new Map<string, { url?: string; transitions: string[] }>();
    for (const edge of this.edges) {
      if (!visitedSet.has(edge.to)) {
        const list = incoming.get(edge.to) ?? { url: undefined, transitions: [] as string[] };
        list.transitions.push(`${edge.from.slice(0, 6)} → ${edge.action}`);
        incoming.set(edge.to, list);
      }
    }
    const unvisitedTargets = [...incoming.entries()]
      .slice(0, 20)
      .map(([fp, data]) => ({
        fingerprint: fp,
        url: data.url ?? "(never landed — no node record)",
        incomingTransitions: data.transitions.slice(0, 5),
      }));

    // 4. Per-module grouping
    const byModule: Record<string, { states: number; transitions: number; novelThisRun: number }> = {};
    for (const node of nodes) {
      const key = this.moduleOf(node.url);
      if (!byModule[key]) byModule[key] = { states: 0, transitions: 0, novelThisRun: novelByModule.get(key) ?? 0 };
      byModule[key].states += 1;
    }
    for (const edge of this.edges) {
      const targetNode = this.nodes.get(edge.to);
      const fromNode = this.nodes.get(edge.from);
      const targetKey = targetNode ? this.moduleOf(targetNode.url) : this.moduleOf(fromNode?.url ?? "");
      if (!targetKey) continue;
      if (!byModule[targetKey]) byModule[targetKey] = { states: 0, transitions: 0, novelThisRun: 0 };
      byModule[targetKey].transitions += 1;
    }

    // 5. Average visits per node (higher = more looping / fewer new discoveries)
    const avgVisitsPerNode = totalStates > 0
      ? nodes.reduce((sum, n) => sum + n.visitCount, 0) / totalStates
      : 0;

    return {
      totalStatesEverVisited: totalStates,
      totalTransitions: this.edges.length,
      novelStatesThisRun,
      hotspots,
      unvisitedTargets,
      byModule,
      avgVisitsPerNode,
    };
  }

  /** Extract the top-level module key from a URL path.
   *  Handles both full URLs ("http://host/customer/detail/123") and bare paths ("/customer/detail/123").
   *  → "customer" in both cases. */
  private moduleOf(url: string): string {
    let path = url;
    try {
      // If it's a full URL, extract just the path segment
      if (/^https?:\/\//i.test(url)) path = new URL(url).pathname;
    } catch { /* fall through */ }
    const match = path.match(/^\/([^/?#]+)/);
    if (!match) return "other";
    const raw = match[1];
    // Strip common file extensions
    return raw.replace(/\.[a-z0-9]+$/i, "");
  }
}
