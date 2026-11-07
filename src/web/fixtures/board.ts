import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { stepFramesFor } from "../../shared/stepFrames";

type Skeleton = Parameters<typeof convertToExcalidrawElements>[0];

function build(skeleton: unknown[]): Record<string, unknown>[] {
  // Pins and step frames name elements by id, so the ids written here must survive the conversion.
  return convertToExcalidrawElements(skeleton as Skeleton, { regenerateIds: false }) as unknown as Record<string, unknown>[];
}

function box(id: string, x: number, y: number, text: string, kind: string, extra: Record<string, unknown> = {}) {
  return {
    type: "rectangle",
    id,
    x,
    y,
    width: 140,
    height: 56,
    backgroundColor: "#e7f5ff",
    fillStyle: "solid",
    strokeColor: "#1971c2",
    roundness: { type: 3 },
    label: { text, fontSize: 18 },
    customData: { kind },
    ...extra,
  };
}

function link(from: string, to: string, x: number, y: number, width: number, height: number, text: string, dashed = false) {
  return {
    type: "arrow",
    x,
    y,
    width,
    height,
    start: { id: from },
    end: { id: to },
    strokeStyle: dashed ? "dashed" : "solid",
    label: { text, fontSize: 16 },
  };
}

function note(id: string, x: number, y: number, text: string, width = 340) {
  return {
    type: "rectangle",
    id,
    x,
    y,
    width,
    height: 64,
    backgroundColor: "#edf0ff",
    fillStyle: "solid",
    strokeColor: "#5c6bd6",
    roundness: { type: 3 },
    label: { text, fontSize: 16 },
  };
}

function free(id: string, x: number, y: number, text: string) {
  return { type: "text", id, x, y, text, fontSize: 20 };
}

/** One frame per step, each holding the ids it was given, tagged with its step the way the room lays them out. */
function framed(track: "hld" | "lld", content: unknown[], children: Record<string, string[]>): Record<string, unknown>[] {
  const frames = stepFramesFor(track).map((f) => ({
    type: "frame",
    id: `frame-${f.step}`,
    name: f.name,
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
    children: children[f.step] ?? [],
  }));
  return build([...frames, ...content]).map((el) => {
    const step = stepFramesFor(track).find((f) => el.id === `frame-${f.step}`)?.step;
    return step ? { ...el, customData: { step } } : el;
  });
}

export function hldBoard(): Record<string, unknown>[] {
  return framed(
    "hld",
    [
      note("req-scope", 80, 120, "Shorten, redirect, custom alias"),
      note("req-latency", 450, 120, "Redirect p99 under 50 ms", 300),
      note("req-avail", 80, 230, "99.99% available for redirects"),
      free("cap-writes", 1120, 130, "100M new links a month"),
      free("cap-rate", 1120, 200, "about 40 writes/s, 4,000 reads/s"),
      free("api-create", 2160, 130, "POST /v1/links -> { code }"),
      free("api-redirect", 2160, 200, "GET /{code} -> 302"),
      box("client", 100, 1060, "Client", "client"),
      box("cdn", 330, 1060, "CDN", "cdn", { backgroundColor: "#fff4e6", strokeColor: "#e8590c" }),
      box("redirect", 560, 1060, "Redirect service", "service", { backgroundColor: "#ebfbee", strokeColor: "#2f9e44", width: 190 }),
      box("redis", 900, 900, "Redis", "cache", { backgroundColor: "#fff5f5", strokeColor: "#e03131" }),
      { ...box("pg", 900, 1230, "Postgres", "database", { backgroundColor: "#f3f0ff", strokeColor: "#6741d9" }), type: "ellipse" },
      box("keygen", 560, 1340, "Key generator", "service", { backgroundColor: "#ebfbee", strokeColor: "#2f9e44", width: 190 }),
      link("client", "cdn", 240, 1088, 90, 0, "GET"),
      link("cdn", "redirect", 470, 1088, 90, 0, "miss"),
      link("redirect", "redis", 750, 1075, 150, -147, "lookup"),
      link("redirect", "pg", 750, 1100, 150, 158, "on miss", true),
    ],
    {
      requirements: ["req-scope", "req-latency", "req-avail"],
      capacity: ["cap-writes", "cap-rate"],
      api: ["api-create", "api-redirect"],
      design: ["client", "cdn", "redirect", "redis", "pg", "keygen"],
    },
  );
}

function classBox(id: string, x: number, y: number, title: string, body: string, kind = "class") {
  return {
    type: "rectangle",
    id,
    x,
    y,
    width: 210,
    height: 120,
    backgroundColor: "#f8f9fa",
    fillStyle: "solid",
    strokeColor: "#495057",
    label: { text: `${title}\n${body}`, fontSize: 16 },
    customData: { kind },
  };
}

function state(id: string, x: number, y: number, text: string) {
  return {
    type: "ellipse",
    id,
    x,
    y,
    width: 150,
    height: 64,
    backgroundColor: "#edf0ff",
    fillStyle: "solid",
    strokeColor: "#5c6bd6",
    label: { text, fontSize: 18 },
  };
}

export function lldBoard(): Record<string, unknown>[] {
  return framed(
    "lld",
    [
      classBox("lot", 400, 120, "ParkingLot", "spots, tickets\nenter(), exit()"),
      classBox("spot", 110, 360, "Spot", "id, floor, size\nticketId"),
      classBox("ticket", 400, 360, "Ticket", "id, spotId\nentryMinute"),
      classBox("pricing", 710, 120, "«interface»\nPricingStrategy", "fee(type, minutes)", "interface"),
      classBox("hourly", 710, 360, "HourlyPricing", "rate per type"),
      link("lot", "spot", 430, 240, -230, 120, "owns"),
      link("lot", "ticket", 505, 240, 0, 120, "owns"),
      link("lot", "pricing", 610, 180, 100, 0, "uses", true),
      link("hourly", "pricing", 815, 360, 0, -120, "implements", true),
      free("states-spot", 1560, 110, "Spot"),
      state("spot-free", 1560, 160, "FREE"),
      state("spot-taken", 1860, 160, "TAKEN"),
      link("spot-free", "spot-taken", 1710, 192, 150, 0, "enter()"),
      free("states-ticket", 1560, 330, "Ticket"),
      state("ticket-open", 1560, 380, "OPEN"),
      state("ticket-closed", 1860, 380, "CLOSED"),
      link("ticket-open", "ticket-closed", 1710, 412, 150, 0, "exit()"),
    ],
    {
      entities: ["lot", "spot", "ticket", "pricing", "hourly"],
      behaviour: ["states-spot", "spot-free", "spot-taken", "states-ticket", "ticket-open", "ticket-closed"],
    },
  );
}

const HLD_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="460" viewBox="0 0 900 460" font-family="Helvetica, Arial, sans-serif">
  <rect width="900" height="460" fill="#ffffff"/>
  <g fill="#e7f5ff" stroke="#1971c2" stroke-width="2">
    <rect x="30" y="170" width="140" height="60" rx="10"/>
    <rect x="250" y="170" width="140" height="60" rx="10" fill="#fff4e6" stroke="#e8590c"/>
    <rect x="470" y="170" width="170" height="60" rx="10" fill="#ebfbee" stroke="#2f9e44"/>
    <rect x="710" y="50" width="140" height="60" rx="10" fill="#fff5f5" stroke="#e03131"/>
    <ellipse cx="780" cy="330" rx="75" ry="38" fill="#f3f0ff" stroke="#6741d9"/>
    <rect x="470" y="340" width="170" height="60" rx="10" fill="#ebfbee" stroke="#2f9e44"/>
  </g>
  <g fill="none" stroke="#343a40" stroke-width="2">
    <path d="M170 200H250"/><path d="M390 200H470"/><path d="M640 185L710 100"/><path d="M640 215L715 305" stroke-dasharray="7 6"/>
  </g>
  <g fill="#212529" font-size="18" text-anchor="middle">
    <text x="100" y="206">Client</text><text x="320" y="206">CDN</text><text x="555" y="206">Redirect service</text>
    <text x="780" y="86">Redis</text><text x="780" y="336">Postgres</text><text x="555" y="376">Key generator</text>
  </g>
  <g fill="#495057" font-size="14" text-anchor="middle">
    <text x="210" y="190">GET</text><text x="430" y="190">miss</text><text x="690" y="125">lookup</text><text x="715" y="268">on miss</text>
  </g>
  <text x="30" y="40" font-size="20" fill="#212529">40 writes/s, 4,000 reads/s</text>
</svg>`;

const LLD_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="460" viewBox="0 0 900 460" font-family="Helvetica, Arial, sans-serif">
  <rect width="900" height="460" fill="#ffffff"/>
  <g fill="#f8f9fa" stroke="#495057" stroke-width="2">
    <rect x="330" y="30" width="220" height="110"/>
    <rect x="40" y="270" width="220" height="110"/>
    <rect x="330" y="270" width="220" height="110"/>
    <rect x="640" y="30" width="220" height="110"/>
    <rect x="640" y="270" width="220" height="110"/>
  </g>
  <g fill="none" stroke="#343a40" stroke-width="2">
    <path d="M380 140L190 270"/><path d="M440 140V270"/><path d="M550 85H640" stroke-dasharray="7 6"/><path d="M750 270V140" stroke-dasharray="7 6"/>
  </g>
  <g fill="#212529" font-size="17" text-anchor="middle">
    <text x="440" y="70" font-weight="bold">ParkingLot</text><text x="440" y="95">spots, tickets</text><text x="440" y="117">enter(), exit()</text>
    <text x="150" y="310" font-weight="bold">Spot</text><text x="150" y="335">id, floor, size</text><text x="150" y="357">ticketId</text>
    <text x="440" y="310" font-weight="bold">Ticket</text><text x="440" y="335">id, spotId</text><text x="440" y="357">entryMinute</text>
    <text x="750" y="62" font-size="14">«interface»</text><text x="750" y="85" font-weight="bold">PricingStrategy</text><text x="750" y="110">fee(type, minutes)</text>
    <text x="750" y="320" font-weight="bold">HourlyPricing</text><text x="750" y="345">rate per type</text>
  </g>
  <g fill="#495057" font-size="14" text-anchor="middle">
    <text x="270" y="200">owns</text><text x="460" y="215">owns</text><text x="595" y="75">uses</text><text x="790" y="210">implements</text>
  </g>
</svg>`;

/** A small stand-in for the final board image, drawn as SVG so the debrief fixture needs no file or network. */
export function boardImageDataUrl(track: "hld" | "lld"): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(track === "hld" ? HLD_IMAGE : LLD_IMAGE)}`;
}
