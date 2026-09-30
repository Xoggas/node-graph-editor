export const theme = {
  canvasBackground: 0x18191d,
  dotMinor: { color: 0x575c66, alpha: 0.9, radius: 1.15 },
  dotMajor: { color: 0x7a808c, alpha: 1, radius: 1.7 },

  nodeBackground: 0x333539,
  nodeHeader: 0x45484f,
  nodePorts: 0x2b2d32,
  nodeBorder: 0x636770,
  nodeBorderHover: 0x91959e,
  nodeBorderSelected: 0xdcdfe4,
  placeholderHeader: 0x6b3a3a,
  /** Linked copies (aliases) and the highlight of other views of a selected node. */
  aliasBorder: 0x6f8fc9,
  aliasBorderHover: 0x9db5e3,
  linkHighlight: 0x8ab4ff,
  linkText: 0xa9c3f5,

  textPrimary: 0xf5f6f8,
  textSecondary: 0xcfd2d8,
  textPort: 0xd6d9de,
  textMuted: 0x9ca1ab,
  textDisabled: 0x5d616a,
  textWarning: 0xf0b45a,

  widgetBackground: 0x24262b,
  widgetBorder: 0x5b5f68,
  widgetBorderMuted: 0x44474e,
  checkboxChecked: 0x4a78c0,
  checkboxCheckedBorder: 0x6f9be0,
  checkMark: 0xffffff,
  segmentActive: 0x4a78c0,
  buttonBackground: 0x41444b,
  buttonHover: 0x535760,
  buttonPressed: 0x303237,
  buttonDisabled: 0x2f3136,
  listItemBackground: 0x2e3035,
  previewBackground: 0x1f2024,

  connection: 0xb8bcc5,
  connectionSelected: 0xfad860,
  /** Connections on the way from a line to a choice it shows through other nodes, and their ports' rings. */
  choiceRoute: 0xe0a93a,
  connectionPreview: 0xb8bcc5,
  portIncompatibleAlpha: 0.25,

  noteText: 0x25262b,
  noteShadow: 0x000000,

  selectionFill: { color: 0x8ab4ff, alpha: 0.08 },
  selectionStroke: { color: 0x8ab4ff, alpha: 0.6 },
} as const;

/** Sticky note colors by palette key (`NOTE_COLORS`): the sheet, and its top band and folded corner. */
export const noteColors: Record<string, { body: number; band: number; swatch: string }> = {
  yellow: { body: 0xebd583, band: 0xd8bd5c, swatch: "#ebd583" },
  green: { body: 0xacd6a0, band: 0x8cc27e, swatch: "#acd6a0" },
  blue: { body: 0xa3c4ec, band: 0x7fa9df, swatch: "#a3c4ec" },
  pink: { body: 0xedb0c9, band: 0xdc8fb0, swatch: "#edb0c9" },
  purple: { body: 0xc6b3ec, band: 0xa993dc, swatch: "#c6b3ec" },
  gray: { body: 0xc8ccd3, band: 0xaab0b9, swatch: "#c8ccd3" },
};

export function noteColor(key: string) {
  return noteColors[key] ?? noteColors.yellow;
}

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
