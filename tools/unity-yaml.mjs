/**
 * Just enough of Unity's YAML to read localization tables and node positions of a graph asset.
 * Unity writes long strings as folded double-quoted scalars with \uXXXX escapes; this handles those,
 * single-quoted and plain scalars.
 */

/** Entries of a `LocalizationTable` asset (`_entries: - Key: … Value: …`). */
export function parseLocalizationTable(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const entries = new Map();
  let index = lines.findIndex((line) => /^\s*_entries:/.test(line));
  if (index < 0) return entries;
  index++;
  while (index < lines.length) {
    const keyMatch = /^(\s*)- Key:(.*)$/.exec(lines[index]);
    if (!keyMatch) {
      if (/^\s*\S/.test(lines[index]) && !/^\s{4,}/.test(lines[index])) break;
      index++;
      continue;
    }
    const indent = keyMatch[1].length + 2;
    const key = readScalar(lines, index, keyMatch[2], indent);
    index = key.next;
    const valueMatch = new RegExp(`^\\s{${indent}}Value:(.*)$`).exec(lines[index] ?? "");
    let value = "";
    if (valueMatch) {
      const scalar = readScalar(lines, index, valueMatch[1], indent);
      value = scalar.value;
      index = scalar.next;
    }
    entries.set(key.value, value);
  }
  return entries;
}

/** `_id` → rectangle (x, y, width, height) of every node in a graph asset (NodeGraphProcessor `references`). */
export function parseNodePositions(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const positions = new Map();
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s{4}- rid: /.test(line)) {
      if (current?.id && current.position) positions.set(current.id, current.position);
      current = {};
    } else if (current) {
      const id = /^\s{8}_id: ([0-9a-f-]{36})\s*$/.exec(line);
      if (id) current.id = id[1];
      if (/^\s{8}position:\s*$/.test(line)) {
        const field = (offset, name) => Number(new RegExp(String.raw`^\s{10}${name}: (-?[\d.eE+-]+)`).exec(lines[i + offset] ?? "")?.[1] ?? NaN);
        const rect = { x: field(2, "x"), y: field(3, "y"), width: field(4, "width"), height: field(5, "height") };
        if (Number.isFinite(rect.x) && Number.isFinite(rect.y)) current.position = rect;
      }
    }
  }
  if (current?.id && current.position) positions.set(current.id, current.position);
  return positions;
}

/** Reads a scalar starting after `Key:` on line `start`; continuation lines are indented deeper. */
function readScalar(lines, start, first, indent) {
  const head = first.trim();
  const parts = [first.replace(/^\s/, "")];
  let next = start + 1;
  const continues = (line) => line !== undefined && (line.trim() === "" || line.startsWith(" ".repeat(indent + 1)));
  if (head.startsWith('"')) {
    while (!closedDouble(parts.join("\n")) && continues(lines[next])) parts.push(lines[next++]);
    return { value: unescapeDouble(parts.join("\n")), next };
  }
  if (head.startsWith("'")) {
    while (!closedSingle(parts.join("\n")) && continues(lines[next])) parts.push(lines[next++]);
    return { value: fold(parts.join("\n").trim().slice(1, -1)).replace(/''/g, "'"), next };
  }
  while (lines[next] !== undefined && lines[next].startsWith(" ".repeat(indent + 1)) && !/^\s*- Key:/.test(lines[next])) {
    parts.push(lines[next++]);
  }
  return { value: fold(parts.join("\n")).trim(), next };
}

function closedDouble(text) {
  const body = text.trim();
  if (body.length < 2) return false;
  let escaped = false;
  for (let i = 1; i < body.length; i++) {
    const char = body[i];
    if (escaped) escaped = false;
    else if (char === "\\") escaped = true;
    else if (char === '"') return i === body.length - 1;
  }
  return false;
}

function closedSingle(text) {
  const body = text.trim();
  return body.length >= 2 && body.endsWith("'") && !/(^|[^'])('')+'$/.test(body.slice(1));
}

/** YAML line folding: a single line break becomes a space, each empty line a newline. */
function fold(text) {
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? line : line.trimStart()))
    .reduce((result, line, index, all) => {
      if (index === 0) return line;
      if (line === "") return `${result}\n`;
      return result.endsWith("\n") || all[index - 1] === "" ? result + line : `${result} ${line}`;
    }, "");
}

function unescapeDouble(raw) {
  const body = raw.trim().slice(1, -1);
  // Escaped line breaks join without a space; other breaks fold.
  const lines = body.split("\n");
  let folded = "";
  for (let i = 0; i < lines.length; i++) {
    let line = i === 0 ? lines[i] : lines[i].trimStart();
    const escapedBreak = i < lines.length - 1 && /(^|[^\\])(\\\\)*\\$/.test(line);
    if (i < lines.length - 1 && !escapedBreak) line = line.trimEnd();
    if (escapedBreak) line = line.slice(0, -1);
    if (i === 0) folded = line;
    else if (line === "" && i < lines.length - 1) folded += "\n";
    else folded += (previousJoin ? "" : folded.endsWith("\n") ? "" : " ") + line;
    var previousJoin = escapedBreak;
  }
  return folded.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, code) => {
    if (code[0] === "u" || code[0] === "x") return String.fromCharCode(parseInt(code.slice(1), 16));
    return { n: "\n", t: "\t", r: "\r", 0: "\0", " ": " ", "/": "/", '"': '"', "\\": "\\", _: " ", N: "\u0085" }[code] ?? code;
  });
}
