import type { FlowDiagramBlock, SequenceDiagramBlock } from "../../../shared/blocks";

export interface PositionedEdgeLabel {
  lines: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PositionedFlowNode {
  id: string;
  rank: number;
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
  labelLines: string[];
  detailLine: string | null;
}

export interface PositionedFlowEdge {
  from: string;
  to: string;
  path: string;
  dashed: boolean;
  backEdge: boolean;
  label: PositionedEdgeLabel | null;
}

export interface FlowDiagramLayout {
  width: number;
  height: number;
  ariaLabel: string;
  nodes: PositionedFlowNode[];
  edges: PositionedFlowEdge[];
}

export interface PositionedActor {
  id: string;
  cx: number;
  x: number;
  y: number;
  width: number;
  height: number;
  lifelineStartY: number;
  lifelineEndY: number;
  labelLines: string[];
}

export interface PositionedSequenceStep {
  index: number;
  from: string;
  to: string;
  self: boolean;
  dashed: boolean;
  path: string;
  label: PositionedEdgeLabel;
}

export interface SequenceDiagramLayout {
  width: number;
  height: number;
  ariaLabel: string;
  actors: PositionedActor[];
  steps: PositionedSequenceStep[];
}

const MAX_FLOW_COLS = 3;
const LABEL_CHAR_W = 5.8;
const EDGE_LINE_H = 13;

/** Greedy word wrapper that caps line count and truncates overflow cleanly with an ellipsis. */
export function wrapDiagramText(raw: string, maxChars: number, maxLines: number): string[] {
  const clean = raw.replace(/\s+/g, " ").trim();
  if (!clean) return [""];
  if (maxLines <= 1) {
    return [clean.length <= maxChars ? clean : `${clean.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`];
  }

  const words = clean.split(" ");
  const lines: string[] = [];
  let current = "";
  let wordIdx = 0;

  while (wordIdx < words.length) {
    const word = words[wordIdx] ?? "";
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      wordIdx++;
      continue;
    }

    if (lines.length === maxLines - 1) {
      const rest = [current, ...words.slice(wordIdx)].filter(Boolean).join(" ");
      lines.push(rest.length <= maxChars ? rest : `${rest.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`);
      return lines;
    }

    if (current) {
      lines.push(current);
      current = "";
    } else {
      lines.push(word.slice(0, maxChars));
      const leftover = word.slice(maxChars);
      words[wordIdx] = leftover;
      if (!leftover) wordIdx++;
    }
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [clean];
}

function measurePill(lines: readonly string[]): { width: number; height: number } {
  let maxLen = 0;
  for (const line of lines) {
    if (line.length > maxLen) maxLen = line.length;
  }
  return {
    width: Math.ceil(Math.max(24, maxLen * LABEL_CHAR_W + 12)),
    height: lines.length * EDGE_LINE_H + 6,
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function cubicMidpoint(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): { x: number; y: number } {
  return {
    x: 0.125 * x0 + 0.375 * x1 + 0.375 * x2 + 0.125 * x3,
    y: 0.125 * y0 + 0.375 * y1 + 0.375 * y2 + 0.125 * y3,
  };
}

interface BoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boxesOverlap(a: BoxRect, b: BoxRect, gap = 3): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

function placeFlowEdgeLabel(
  lines: string[],
  size: { width: number; height: number },
  anchor: { x: number; y: number },
  horizDir: 1 | -1,
  nodes: readonly PositionedFlowNode[],
  placedLabels: readonly PositionedEdgeLabel[],
): PositionedEdgeLabel {
  const baseX = round(anchor.x - size.width / 2);
  const baseY = round(anchor.y - size.height / 2);
  const isClear = (cand: BoxRect): boolean => cand.y >= 4 && !nodes.some((node) => boxesOverlap(cand, node, 4)) && !placedLabels.some((other) => boxesOverlap(cand, other, 3));

  const tryPos = (x: number, y: number): PositionedEdgeLabel | null => {
    const cand: PositionedEdgeLabel = { lines, x: round(x), y: round(y), width: size.width, height: size.height };
    return isClear(cand) ? cand : null;
  };

  const direct = tryPos(baseX, baseY);
  if (direct) return direct;

  // Skip-rank curves run alongside an intermediate node, so nudging outward toward the detour side keeps the pill on the arc.
  for (const node of nodes) {
    if (!boxesOverlap({ x: baseX, y: baseY, width: size.width, height: size.height }, node, 4)) continue;
    const primaryX = horizDir > 0 ? node.x + node.width + 6 : node.x - size.width - 6;
    const oppositeX = horizDir > 0 ? node.x - size.width - 6 : node.x + node.width + 6;
    for (const dy of [0, -12, 12, -24, 24]) {
      const hit = tryPos(primaryX, baseY + dy) ?? tryPos(oppositeX, baseY + dy);
      if (hit) return hit;
    }
  }

  const dxSteps = [0, horizDir * 24, -horizDir * 24, horizDir * 48, -horizDir * 48, horizDir * 76, -horizDir * 76, horizDir * 108, -horizDir * 108];
  const dySteps = [0, -12, 12, -24, 24, -36, 36, -48, 48];
  for (const dy of dySteps) {
    for (const dx of dxSteps) {
      const hit = tryPos(baseX + dx, baseY + dy);
      if (hit) return hit;
    }
  }

  const minNodeLeft = nodes.reduce((acc, n) => Math.min(acc, n.x), 0);
  const maxNodeRight = nodes.reduce((acc, n) => Math.max(acc, n.x + n.width), 0);
  const railX = horizDir > 0 ? maxNodeRight + 8 : minNodeLeft - size.width - 8;
  const stepY = size.height + 5;
  for (let slot = 0; slot < 24; slot++) {
    const offset = slot === 0 ? 0 : (slot % 2 === 1 ? 1 : -1) * Math.ceil(slot / 2) * stepY;
    const hit = tryPos(railX, Math.max(4, baseY + offset));
    if (hit) return hit;
  }

  return { lines, x: round(railX), y: Math.max(4, baseY), width: size.width, height: size.height };
}

export function layoutFlowDiagram(block: FlowDiagramBlock): FlowDiagramLayout {
  const nodeOrder = new Map<string, number>();
  const nodeById = new Map<string, FlowDiagramBlock["nodes"][number]>();
  for (const [idx, node] of block.nodes.entries()) {
    if (!nodeOrder.has(node.id)) {
      nodeOrder.set(node.id, idx);
      nodeById.set(node.id, node);
    }
  }
  const nodeIds = [...nodeOrder.keys()];

  const validEdges = block.edges.map((edge, index) => ({ ...edge, index })).filter((edge) => edge.from !== edge.to && nodeById.has(edge.from) && nodeById.has(edge.to));

  // Detect cycle-closing back-edges via DFS from in-degree-0 roots first so natural forward edges stay downward.
  const rawInDegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const adj = new Map<string, typeof validEdges>();
  for (const id of nodeIds) adj.set(id, []);
  for (const edge of validEdges) {
    adj.get(edge.from)?.push(edge);
    rawInDegree.set(edge.to, (rawInDegree.get(edge.to) ?? 0) + 1);
  }

  const state = new Map<string, 0 | 1 | 2>(nodeIds.map((id) => [id, 0]));
  const backEdgeIndices = new Set<number>();

  const dfs = (u: string) => {
    state.set(u, 1);
    for (const edge of adj.get(u) ?? []) {
      const targetState = state.get(edge.to) ?? 0;
      if (targetState === 1) {
        backEdgeIndices.add(edge.index);
      } else if (targetState === 0) {
        dfs(edge.to);
      }
    }
    state.set(u, 2);
  };

  const roots = nodeIds.filter((id) => (rawInDegree.get(id) ?? 0) === 0);
  for (const id of [...roots, ...nodeIds]) {
    if ((state.get(id) ?? 0) === 0) dfs(id);
  }

  // Longest-path layering on the guaranteed-acyclic forward graph.
  const forwardInDegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const forwardOut = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  const forwardIn = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const edge of validEdges) {
    if (backEdgeIndices.has(edge.index)) continue;
    forwardOut.get(edge.from)?.push(edge.to);
    forwardIn.get(edge.to)?.push(edge.from);
    forwardInDegree.set(edge.to, (forwardInDegree.get(edge.to) ?? 0) + 1);
  }

  const rank = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const queue = nodeIds.filter((id) => (forwardInDegree.get(id) ?? 0) === 0).sort((a, b) => (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0));
  const visitedCount = new Set<string>();

  while (queue.length > 0) {
    const u = queue.shift();
    if (!u || visitedCount.has(u)) continue;
    visitedCount.add(u);
    const uRank = rank.get(u) ?? 0;
    for (const v of forwardOut.get(u) ?? []) {
      if (uRank + 1 > (rank.get(v) ?? 0)) rank.set(v, uRank + 1);
      const nextDeg = (forwardInDegree.get(v) ?? 1) - 1;
      forwardInDegree.set(v, nextDeg);
      if (nextDeg === 0) {
        queue.push(v);
        queue.sort((a, b) => (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0));
      }
    }
  }

  let maxRank = 0;
  for (const r of rank.values()) {
    if (r > maxRank) maxRank = r;
  }

  const layers: string[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const id of nodeIds) {
    layers[rank.get(id) ?? 0]?.push(id);
  }

  // Barycenter sweeps reduce crossings before wide ranks are wrapped into 3-node rows.
  const positionInRanks = () => {
    const pos = new Map<string, number>();
    for (const layer of layers) {
      const span = Math.max(1, layer.length - 1);
      for (const [idx, id] of layer.entries()) {
        pos.set(id, layer.length === 1 ? 0.5 : idx / span);
      }
    }
    return pos;
  };

  for (let pass = 0; pass < 2; pass++) {
    const downPos = positionInRanks();
    for (let r = 1; r <= maxRank; r++) {
      const layer = layers[r];
      if (!layer || layer.length <= 1) continue;
      const weights = new Map<string, number>();
      for (const [idx, id] of layer.entries()) {
        const preds = forwardIn.get(id) ?? [];
        if (preds.length === 0) {
          weights.set(id, downPos.get(id) ?? idx);
        } else {
          const sum = preds.reduce((acc, p) => acc + (downPos.get(p) ?? 0.5), 0);
          weights.set(id, sum / preds.length);
        }
      }
      layer.sort((a, b) => (weights.get(a) ?? 0) - (weights.get(b) ?? 0) || (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0));
    }

    const upPos = positionInRanks();
    for (let r = maxRank - 1; r >= 0; r--) {
      const layer = layers[r];
      if (!layer || layer.length <= 1) continue;
      const weights = new Map<string, number>();
      for (const [idx, id] of layer.entries()) {
        const succs = forwardOut.get(id) ?? [];
        if (succs.length === 0) {
          weights.set(id, upPos.get(id) ?? idx);
        } else {
          const sum = succs.reduce((acc, s) => acc + (upPos.get(s) ?? 0.5), 0);
          weights.set(id, sum / succs.length);
        }
      }
      layer.sort((a, b) => (weights.get(a) ?? 0) - (weights.get(b) ?? 0) || (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0));
    }
  }

  // Split any rank wider than 3 nodes into stacked rows of at most 3 so labels stay legible in a ~360px chat pane.
  const rows: { ids: string[]; rank: number }[] = [];
  for (const [r, layer] of layers.entries()) {
    if (layer.length === 0) continue;
    for (let i = 0; i < layer.length; i += MAX_FLOW_COLS) {
      rows.push({ ids: layer.slice(i, i + MAX_FLOW_COLS), rank: r });
    }
  }

  let maxCols = 1;
  for (const row of rows) {
    if (row.ids.length > maxCols) maxCols = row.ids.length;
  }

  const boxWidth = maxCols === 1 ? 176 : maxCols === 2 ? 132 : 88;
  const colGap = maxCols === 1 ? 0 : maxCols === 2 ? 18 : 10;
  const maxLabelChars = maxCols === 1 ? 26 : maxCols === 2 ? 19 : 12;
  const maxDetailChars = maxCols === 1 ? 30 : maxCols === 2 ? 21 : 14;
  const contentWidth = maxCols * boxWidth + Math.max(0, maxCols - 1) * colGap;
  const basePadX = 8;
  const padY = 8;

  const nodeText = new Map<string, { labelLines: string[]; detailLine: string | null; height: number }>();
  for (const id of nodeIds) {
    const raw = nodeById.get(id);
    const labelLines = wrapDiagramText(raw?.label ?? id, maxLabelChars, 2);
    const detailLine = raw?.detail ? (wrapDiagramText(raw.detail, maxDetailChars, 1)[0] ?? null) : null;
    const height = 16 + labelLines.length * 14 + (detailLine ? 14 : 0);
    nodeText.set(id, { labelLines, detailLine, height: Math.max(36, height) });
  }

  const rowOfNode = new Map<string, number>();
  for (const [rowIdx, row] of rows.entries()) {
    for (const id of row.ids) rowOfNode.set(id, rowIdx);
  }

  const gapHasLabel = new Set<number>();
  for (const edge of validEdges) {
    if (!edge.label || backEdgeIndices.has(edge.index)) continue;
    const rFrom = rowOfNode.get(edge.from) ?? 0;
    const rTo = rowOfNode.get(edge.to) ?? 0;
    for (let g = rFrom; g < rTo; g++) gapHasLabel.add(g);
  }

  const positionedNodes: PositionedFlowNode[] = [];
  const positionedById = new Map<string, PositionedFlowNode>();
  let cursorY = padY;

  for (const [rowIdx, row] of rows.entries()) {
    let rowHeight = 36;
    for (const id of row.ids) {
      const h = nodeText.get(id)?.height ?? 36;
      if (h > rowHeight) rowHeight = h;
    }
    const rowWidth = row.ids.length * boxWidth + Math.max(0, row.ids.length - 1) * colGap;
    const startX = basePadX + (contentWidth - rowWidth) / 2;

    for (const [colIdx, id] of row.ids.entries()) {
      const meta = nodeText.get(id) ?? { labelLines: [id], detailLine: null, height: 36 };
      const node: PositionedFlowNode = {
        id,
        rank: row.rank,
        row: rowIdx,
        col: colIdx,
        x: round(startX + colIdx * (boxWidth + colGap)),
        y: round(cursorY + (rowHeight - meta.height) / 2),
        width: boxWidth,
        height: meta.height,
        labelLines: meta.labelLines,
        detailLine: meta.detailLine,
      };
      positionedNodes.push(node);
      positionedById.set(id, node);
    }

    cursorY += rowHeight;
    if (rowIdx < rows.length - 1) {
      cursorY += gapHasLabel.has(rowIdx) ? 50 : 38;
    }
  }

  const totalNodesBottom = cursorY + padY;

  // Spread multiple forward ports along node top and bottom edges so fan-out and fan-in lines stay distinct.
  const forwardEdges = validEdges.filter((e) => !backEdgeIndices.has(e.index));
  const outGroup = new Map<string, typeof forwardEdges>();
  const inGroup = new Map<string, typeof forwardEdges>();
  for (const edge of forwardEdges) {
    const outs = outGroup.get(edge.from) ?? [];
    outs.push(edge);
    outGroup.set(edge.from, outs);
    const ins = inGroup.get(edge.to) ?? [];
    ins.push(edge);
    inGroup.set(edge.to, ins);
  }

  const outPortX = new Map<number, number>();
  for (const [id, list] of outGroup.entries()) {
    const fromNode = positionedById.get(id);
    if (!fromNode) continue;
    const sorted = [...list].sort((a, b) => {
      const ax = positionedById.get(a.to)?.x ?? 0;
      const bx = positionedById.get(b.to)?.x ?? 0;
      return ax - bx || a.index - b.index;
    });
    const maxSpread = Math.min(fromNode.width * 0.52, (sorted.length - 1) * 14);
    for (const [i, edge] of sorted.entries()) {
      const offset = sorted.length === 1 ? 0 : -maxSpread / 2 + (i / (sorted.length - 1)) * maxSpread;
      outPortX.set(edge.index, fromNode.x + fromNode.width / 2 + offset);
    }
  }

  const inPortX = new Map<number, number>();
  for (const [id, list] of inGroup.entries()) {
    const toNode = positionedById.get(id);
    if (!toNode) continue;
    const sorted = [...list].sort((a, b) => {
      const ax = positionedById.get(a.from)?.x ?? 0;
      const bx = positionedById.get(b.from)?.x ?? 0;
      return ax - bx || a.index - b.index;
    });
    const maxSpread = Math.min(toNode.width * 0.52, (sorted.length - 1) * 14);
    for (const [i, edge] of sorted.entries()) {
      const offset = sorted.length === 1 ? 0 : -maxSpread / 2 + (i / (sorted.length - 1)) * maxSpread;
      inPortX.set(edge.index, toNode.x + toNode.width / 2 + offset);
    }
  }

  const positionedEdges: PositionedFlowEdge[] = [];
  const placedLabels: PositionedEdgeLabel[] = [];
  const curveMidXs: number[] = [];
  let backEdgeSlot = 0;

  for (const edge of validEdges) {
    const fromNode = positionedById.get(edge.from);
    const toNode = positionedById.get(edge.to);
    if (!fromNode || !toNode) continue;

    const isBack = backEdgeIndices.has(edge.index) || fromNode.row >= toNode.row;
    let path: string;
    let labelAnchor: { x: number; y: number };
    let horizDir: 1 | -1;

    if (isBack) {
      const x0 = round(fromNode.x + fromNode.width);
      const y0 = round(fromNode.y + fromNode.height * 0.55);
      const x3 = round(toNode.x + toNode.width);
      const y3 = round(toNode.y + toNode.height * 0.45);
      const railX = round(basePadX + contentWidth + 24 + backEdgeSlot * 18);
      backEdgeSlot++;
      path = `M ${x0} ${y0} C ${railX} ${y0}, ${railX} ${y3}, ${x3} ${y3}`;
      labelAnchor = cubicMidpoint(x0, y0, railX, y0, railX, y3, x3, y3);
      horizDir = 1;
    } else {
      const x0 = round(outPortX.get(edge.index) ?? fromNode.x + fromNode.width / 2);
      const y0 = round(fromNode.y + fromNode.height);
      const x3 = round(inPortX.get(edge.index) ?? toNode.x + toNode.width / 2);
      const y3 = round(toNode.y);
      const dy = Math.max(16, (y3 - y0) * 0.45);
      let cx1 = x0;
      let cx2 = x3;
      horizDir = x3 >= x0 ? 1 : -1;

      // Bow skip-row curves far enough that the t=0.5 cubic midpoint clears every intermediate box in between.
      if (toNode.row - fromNode.row > 1) {
        const blocking = positionedNodes.filter((midNode) => {
          if (midNode.row <= fromNode.row || midNode.row >= toNode.row) return false;
          const t = (midNode.y + midNode.height / 2 - y0) / Math.max(1, y3 - y0);
          const lineX = x0 + (x3 - x0) * t;
          return lineX >= midNode.x - 6 && lineX <= midNode.x + midNode.width + 6;
        });
        if (blocking.length > 0) {
          const first = blocking[0]!;
          const tFirst = (first.y + first.height / 2 - y0) / Math.max(1, y3 - y0);
          const lineX = x0 + (x3 - x0) * tFirst;
          const goLeft = lineX < first.x + first.width / 2;
          horizDir = goLeft ? -1 : 1;
          const targetMidX = goLeft ? Math.min(...blocking.map((n) => n.x)) - 14 : Math.max(...blocking.map((n) => n.x + n.width)) + 14;
          const detour = (targetMidX - 0.125 * (x0 + x3)) / 0.75;
          cx1 = round(detour);
          cx2 = round(detour);
        }
      }

      const cy1 = round(y0 + dy);
      const cy2 = round(y3 - dy);
      path = `M ${x0} ${y0} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x3} ${y3}`;
      labelAnchor = cubicMidpoint(x0, y0, cx1, cy1, cx2, cy2, x3, y3);
    }

    curveMidXs.push(labelAnchor.x);

    let label: PositionedEdgeLabel | null = null;
    if (edge.label) {
      const lines = wrapDiagramText(edge.label, 18, 2);
      const size = measurePill(lines);
      label = placeFlowEdgeLabel(lines, size, labelAnchor, horizDir, positionedNodes, placedLabels);
      placedLabels.push(label);
    }

    positionedEdges.push({
      from: edge.from,
      to: edge.to,
      path,
      dashed: isBack || edge.style === "dashed",
      backEdge: isBack,
      label,
    });
  }

  // Ensure negative X excursions (from wide edge pills or detours) shift cleanly into positive viewBox space.
  let minX = 0;
  let maxX = basePadX * 2 + contentWidth + (backEdgeSlot > 0 ? 28 + (backEdgeSlot - 1) * 18 : 0);
  let maxY = totalNodesBottom;

  for (const node of positionedNodes) {
    if (node.x < minX + 4) minX = node.x - 4;
    if (node.x + node.width + 4 > maxX) maxX = node.x + node.width + 4;
    if (node.y + node.height + padY > maxY) maxY = node.y + node.height + padY;
  }
  for (const midX of curveMidXs) {
    if (midX - 6 < minX) minX = midX - 6;
    if (midX + 6 > maxX) maxX = midX + 6;
  }
  for (const edge of positionedEdges) {
    if (edge.label) {
      if (edge.label.x - 4 < minX) minX = edge.label.x - 4;
      if (edge.label.x + edge.label.width + 4 > maxX) maxX = edge.label.x + edge.label.width + 4;
      if (edge.label.y + edge.label.height + padY > maxY) maxY = edge.label.y + edge.label.height + padY;
    }
  }

  if (minX < 0) {
    const shiftX = round(-minX);
    maxX += shiftX;
    for (const node of positionedNodes) node.x = round(node.x + shiftX);
    for (const edge of positionedEdges) {
      edge.path = shiftSvgPathX(edge.path, shiftX);
      if (edge.label) edge.label.x = round(edge.label.x + shiftX);
    }
  }

  const ariaLabel = block.title ? `Flow diagram: ${block.title}` : `Flow diagram with ${positionedNodes.length} nodes`;

  return {
    width: Math.ceil(maxX),
    height: Math.ceil(maxY),
    ariaLabel,
    nodes: positionedNodes,
    edges: positionedEdges,
  };
}

function shiftSvgPathX(path: string, dx: number): string {
  // Path grammar emitted above is strictly `M x y C x1 y1, x2 y2, x3 y3`.
  const tokens = path.split(/(\s+|,)/);
  const out: string[] = [];
  let coordIndex = 0;
  for (const tok of tokens) {
    if (tok === "M" || tok === "C" || tok === "," || /^\s+$/.test(tok) || tok === "") {
      out.push(tok);
      continue;
    }
    const n = Number(tok);
    if (Number.isFinite(n)) {
      out.push(String(round(coordIndex % 2 === 0 ? n + dx : n)));
      coordIndex++;
    } else {
      out.push(tok);
    }
  }
  return out.join("");
}

function sequenceColumnMetrics(count: number): {
  actorWidth: number;
  baseSpacing: number;
  maxSpacing: number;
  padX: number;
  actorChars: number;
} {
  // Shrink columns monotonically with actor count so 2–4 lifelines fit inside the narrow chat column without horizontal scroll.
  if (count <= 2) return { actorWidth: 96, baseSpacing: 156, maxSpacing: 176, padX: 12, actorChars: 14 };
  if (count === 3) return { actorWidth: 78, baseSpacing: 104, maxSpacing: 112, padX: 8, actorChars: 11 };
  if (count === 4) return { actorWidth: 66, baseSpacing: 76, maxSpacing: 82, padX: 8, actorChars: 10 };
  if (count === 5) return { actorWidth: 58, baseSpacing: 62, maxSpacing: 66, padX: 6, actorChars: 9 };
  return { actorWidth: 52, baseSpacing: 54, maxSpacing: 56, padX: 6, actorChars: 8 };
}

function clampSequencePillX(rawX: number, pillWidth: number, padX: number, totalWidth: number): number {
  const innerWidth = totalWidth - padX * 2;
  if (pillWidth <= innerWidth) {
    return round(Math.max(padX, Math.min(totalWidth - padX - pillWidth, rawX)));
  }
  return round(Math.max(4, rawX));
}

export function layoutSequenceDiagram(block: SequenceDiagramBlock): SequenceDiagramLayout {
  const actorList = block.actors;
  const count = actorList.length;
  const { actorWidth, baseSpacing, maxSpacing, padX, actorChars } = sequenceColumnMetrics(count);
  const padY = 8;

  const actorWrapped = actorList.map((actor) => wrapDiagramText(actor.label, actorChars, 2));
  let headerHeight = 32;
  for (const lines of actorWrapped) {
    if (lines.length > 1) headerHeight = 44;
  }

  const actorIndex = new Map<string, number>();
  for (const [idx, actor] of actorList.entries()) {
    actorIndex.set(actor.id, idx);
  }

  // Allow slight breathing room up to maxSpacing when labels are wordy, without ever shrinking below baseSpacing.
  let colSpacing = baseSpacing;
  for (const step of block.steps) {
    const a = actorIndex.get(step.from);
    const b = actorIndex.get(step.to);
    if (a === undefined || b === undefined || a === b) continue;
    const span = Math.abs(b - a);
    const lines = wrapDiagramText(step.label, 22, 2);
    const pill = measurePill(lines);
    const neededPerCol = Math.ceil((pill.width + 16) / span);
    colSpacing = Math.max(colSpacing, Math.min(maxSpacing, neededPerCol));
  }
  colSpacing = Math.max(baseSpacing, Math.min(maxSpacing, colSpacing));

  const actors: PositionedActor[] = actorList.map((actor, idx) => {
    const x = round(padX + idx * colSpacing);
    const cx = round(x + actorWidth / 2);
    return {
      id: actor.id,
      cx,
      x,
      y: padY,
      width: actorWidth,
      height: headerHeight,
      lifelineStartY: padY + headerHeight,
      lifelineEndY: padY + headerHeight + 24,
      labelLines: actorWrapped[idx] ?? [actor.label],
    };
  });

  const actorById = new Map(actors.map((a) => [a.id, a]));
  const steps: PositionedSequenceStep[] = [];
  let cursorY = padY + headerHeight + 16;
  const totalWidth = padX * 2 + actorWidth + Math.max(0, count - 1) * colSpacing;
  let maxX = totalWidth;

  for (const [idx, step] of block.steps.entries()) {
    const fromActor = actorById.get(step.from);
    const toActor = actorById.get(step.to);
    if (!fromActor || !toActor) continue;

    const self = step.from === step.to;
    const dashed = step.style === "dashed";

    if (self) {
      const lines = wrapDiagramText(step.label, count <= 2 ? 20 : 16, 2);
      const pill = measurePill(lines);
      const loopW = 26;
      const loopH = 18;
      const topY = round(cursorY + pill.height + 3);
      const bottomY = round(topY + loopH);
      const cx = fromActor.cx;
      const path = `M ${cx} ${topY} H ${round(cx + loopW - 4)} Q ${round(cx + loopW)} ${topY} ${round(cx + loopW)} ${round(topY + 4)} V ${round(bottomY - 4)} Q ${round(cx + loopW)} ${bottomY} ${round(cx + loopW - 4)} ${bottomY} H ${round(cx + 2)}`;
      const pillX = clampSequencePillX(cx - 6, pill.width, padX, totalWidth);
      const label: PositionedEdgeLabel = {
        lines,
        x: pillX,
        y: round(cursorY),
        width: pill.width,
        height: pill.height,
      };
      if (cx + loopW + 6 > maxX) maxX = cx + loopW + 6;
      if (label.x + label.width + padX > maxX) maxX = label.x + label.width + padX;
      steps.push({
        index: idx,
        from: step.from,
        to: step.to,
        self: true,
        dashed,
        path,
        label,
      });
      cursorY = bottomY + 16;
    } else {
      const dist = Math.abs(toActor.cx - fromActor.cx);
      const availablePx = Math.max(48, dist - 10);
      const maxChars = Math.max(8, Math.min(28, Math.floor(availablePx / LABEL_CHAR_W)));
      const lines = wrapDiagramText(step.label, maxChars, maxChars < 16 ? 3 : 2);
      const pill = measurePill(lines);
      const arrowY = round(cursorY + pill.height + 4);
      const dir = toActor.cx > fromActor.cx ? 1 : -1;
      const x1 = fromActor.cx;
      const x2 = round(toActor.cx - dir * 2);
      const path = `M ${x1} ${arrowY} L ${x2} ${arrowY}`;
      const midX = (fromActor.cx + toActor.cx) / 2;
      const pillX = clampSequencePillX(midX - pill.width / 2, pill.width, padX, totalWidth);
      const label: PositionedEdgeLabel = {
        lines,
        x: pillX,
        y: round(cursorY),
        width: pill.width,
        height: pill.height,
      };
      if (label.x + label.width + padX > maxX) maxX = label.x + label.width + padX;
      steps.push({
        index: idx,
        from: step.from,
        to: step.to,
        self: false,
        dashed,
        path,
        label,
      });
      cursorY = arrowY + 16;
    }
  }

  const lifelineEndY = round(cursorY);
  for (const actor of actors) {
    actor.lifelineEndY = lifelineEndY;
  }

  const height = Math.ceil(lifelineEndY + padY);
  const actorSummary = actorList.map((a) => a.label).join(", ");
  const ariaLabel = block.title ? `Sequence diagram: ${block.title}` : `Sequence diagram between ${actorSummary}`;

  return {
    width: Math.ceil(maxX),
    height,
    ariaLabel,
    actors,
    steps,
  };
}
