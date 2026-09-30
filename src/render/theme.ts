export const theme = {
  canvasBackground: 0x18191d,
  gridMinor: { color: 0x33363b, alpha: 0.55 },
  gridMajor: { color: 0x43464d, alpha: 0.7 },

  nodeBackground: 0x333539,
  nodeHeader: 0x45484f,
  nodePorts: 0x2b2d32,
  nodeBorder: 0x636770,
  nodeBorderHover: 0x91959e,
  nodeBorderSelected: 0xdcdfe4,
  placeholderHeader: 0x6b3a3a,

  textPrimary: 0xf5f6f8,
  textSecondary: 0xcfd2d8,
  textPort: 0xd6d9de,
  textMuted: 0x9ca1ab,

  widgetBackground: 0x24262b,
  widgetBorder: 0x5b5f68,
  buttonBackground: 0x41444b,
  buttonHover: 0x535760,
  buttonPressed: 0x303237,

  connection: 0xb8bcc5,
  connectionSelected: 0xfad860,
  connectionPreview: 0xb8bcc5,
  portIncompatibleAlpha: 0.25,

  selectionFill: { color: 0x8ab4ff, alpha: 0.08 },
  selectionStroke: { color: 0x8ab4ff, alpha: 0.6 },
} as const;

const knownTypeColors: Record<string, number> = {
  "system.float": 0x6fc3b2,
  "system.int": 0x6f9fe0,
  "system.bool": 0xe07a6f,
  "system.string": 0xe0c56f,
  "system.object": 0xb8bcc5,
};

const typeColorCache = new Map<string, number>();

/** Stable per-data-type color used for port dots and edges. */
export function typeColor(typeId: string): number {
  const known = knownTypeColors[typeId];
  if (known !== undefined) {
    return known;
  }
  let cached = typeColorCache.get(typeId);
  if (cached === undefined) {
    let hash = 0;
    for (let i = 0; i < typeId.length; i++) {
      hash = (hash * 31 + typeId.charCodeAt(i)) | 0;
    }
    cached = hslToHex(((hash >>> 0) % 360) / 360, 0.5, 0.66);
    typeColorCache.set(typeId, cached);
  }
  return cached;
}

function hslToHex(h: number, s: number, l: number): number {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const r = Math.round(channel(h + 1 / 3) * 255);
  const g = Math.round(channel(h) * 255);
  const b = Math.round(channel(h - 1 / 3) * 255);
  return (r << 16) | (g << 8) | b;
}
