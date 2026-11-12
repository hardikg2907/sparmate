import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DiagramBlock as DiagramBlockType } from "../../../shared/blocks";
import { layoutFlowDiagram, layoutSequenceDiagram, type PositionedEdgeLabel } from "./diagramLayout";

export interface DiagramBlockProps {
  block: DiagramBlockType;
}

function EdgePill({ pill }: { pill: PositionedEdgeLabel }) {
  const cx = pill.x + pill.width / 2;
  const firstBaseline = pill.y + 12.5;
  return (
    <g>
      <rect x={pill.x} y={pill.y} width={pill.width} height={pill.height} rx={5} fill="var(--card)" stroke="var(--border)" strokeWidth={1} />
      <text x={cx} textAnchor="middle" fill="var(--muted-foreground)" fontSize={10.5} fontWeight={500}>
        {pill.lines.map((line, i) => (
          <tspan key={i} x={cx} y={firstBaseline + i * 13}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

export function DiagramBlock({ block }: DiagramBlockProps) {
  const rawId = useId();
  const markerId = `diag-arrow-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);

  const flow = useMemo(() => (block.layout === "flow" ? layoutFlowDiagram(block) : null), [block]);
  const seq = useMemo(() => (block.layout === "sequence" ? layoutSequenceDiagram(block) : null), [block]);
  const width = flow?.width ?? seq?.width ?? 280;
  const height = flow?.height ?? seq?.height ?? 120;
  const ariaLabel = flow?.ariaLabel ?? seq?.ariaLabel ?? "Diagram";

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setWide(el.scrollWidth > el.clientWidth);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [width, height]);

  return (
    <figure className="m-0 rounded-lg border border-border bg-raised/60 p-3">
      {block.title ? <figcaption className="mb-2 text-meta font-semibold text-muted-foreground">{block.title}</figcaption> : null}
      <div ref={scrollRef} className="max-w-full overflow-x-auto" {...(wide ? { tabIndex: 0, role: "region", "aria-label": `${ariaLabel}, scrolls sideways` } : {})}>
        <svg
          role="img"
          aria-label={ariaLabel}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="mx-auto block select-none text-muted-foreground"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          <defs>
            <marker id={markerId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto">
              <path d="M 0 1 L 7 4 L 0 7 z" fill="var(--muted-foreground)" />
            </marker>
          </defs>

          {flow ? (
            <>
              <g fill="none" stroke="var(--muted-foreground)" strokeWidth={1.35}>
                {flow.edges.map((edge, idx) => (
                  <path key={idx} d={edge.path} strokeDasharray={edge.dashed ? "4 3" : undefined} markerEnd={`url(#${markerId})`} />
                ))}
              </g>
              {flow.nodes.map((node) => {
                const cx = node.x + node.width / 2;
                const totalTextHeight = node.labelLines.length * 14 + (node.detailLine ? 13 : 0);
                const topTextY = node.y + (node.height - totalTextHeight) / 2 + 11;
                return (
                  <g key={node.id}>
                    <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={7} fill="var(--card)" stroke="var(--border-strong)" strokeWidth={1.2} />
                    <text x={cx} textAnchor="middle" fill="var(--foreground)" fontSize={11.5} fontWeight={600}>
                      {node.labelLines.map((line, i) => (
                        <tspan key={i} x={cx} y={topTextY + i * 14}>
                          {line}
                        </tspan>
                      ))}
                    </text>
                    {node.detailLine ? (
                      <text x={cx} y={topTextY + node.labelLines.length * 14} textAnchor="middle" fill="var(--muted-foreground)" fontSize={10} fontWeight={500}>
                        {node.detailLine}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {flow.edges.map((edge, idx) => (edge.label ? <EdgePill key={idx} pill={edge.label} /> : null))}
            </>
          ) : null}

          {seq ? (
            <>
              <g stroke="var(--border-strong)" strokeWidth={1.1} strokeDasharray="3 3">
                {seq.actors.map((actor) => (
                  <line key={actor.id} x1={actor.cx} y1={actor.lifelineStartY} x2={actor.cx} y2={actor.lifelineEndY} />
                ))}
              </g>
              {seq.actors.map((actor) => {
                const totalTextH = actor.labelLines.length * 13;
                const startY = actor.y + (actor.height - totalTextH) / 2 + 10.5;
                return (
                  <g key={actor.id}>
                    <rect x={actor.x} y={actor.y} width={actor.width} height={actor.height} rx={6} fill="var(--card)" stroke="var(--border-strong)" strokeWidth={1.2} />
                    <text x={actor.cx} textAnchor="middle" fill="var(--foreground)" fontSize={11.5} fontWeight={600}>
                      {actor.labelLines.map((line, i) => (
                        <tspan key={i} x={actor.cx} y={startY + i * 13}>
                          {line}
                        </tspan>
                      ))}
                    </text>
                  </g>
                );
              })}
              <g fill="none" stroke="var(--muted-foreground)" strokeWidth={1.35}>
                {seq.steps.map((step) => (
                  <path key={step.index} d={step.path} strokeDasharray={step.dashed ? "4 3" : undefined} markerEnd={`url(#${markerId})`} />
                ))}
              </g>
              {seq.steps.map((step) => (
                <EdgePill key={step.index} pill={step.label} />
              ))}
            </>
          ) : null}
        </svg>
      </div>
    </figure>
  );
}
