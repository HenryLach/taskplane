export function truncateToWidth(input: string, width?: number): string {
  if (typeof width !== "number" || width <= 0 || input.length <= width) return input;
  return input.slice(0, width);
}

export function visibleWidth(input: string): number {
  return input.length;
}

export function wrapTextWithAnsi(input: string, width: number): string[] {
  if (!input) return [""];
  if (width <= 0) return [input];

  const lines: string[] = [];
  for (const rawLine of input.split("\n")) {
    if (rawLine.length === 0) {
      lines.push("");
      continue;
    }

    let line = rawLine;
    while (line.length > width) {
      lines.push(line.slice(0, width));
      line = line.slice(width);
    }
    lines.push(line);
  }

  return lines;
}

// Stub TUI components used by source files
export class Container {
  children: any[] = [];

  addChild(child: any): void {
    this.children.push(child);
  }

  removeChild(child: any): void {
    this.children = this.children.filter((existing) => existing !== child);
  }

  clear(): void {
    this.children = [];
  }

  invalidate(): void {
    for (const child of this.children) child.invalidate?.();
  }

  render(width: number): string[] {
    return this.children.flatMap((child) => child.render(width));
  }
}

export class Text {
  private text: string;
  private paddingX: number;
  private _paddingY: number;

  constructor(
    text: string = "",
    paddingX: number = 0,
    paddingY: number = 0,
  ) {
    this.text = text;
    this.paddingX = paddingX;
    this._paddingY = paddingY;
  }

  setText(text: string): void {
    this.text = text;
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (!this.text) return [];

    const contentWidth = Math.max(1, width - this.paddingX * 2);
    const leftPad = " ".repeat(this.paddingX);
    const rendered: string[] = [];

    for (const rawLine of this.text.split("\n")) {
      if (rawLine.length === 0) {
        rendered.push(leftPad);
        continue;
      }

      let line = rawLine;
      while (line.length > contentWidth) {
        rendered.push(leftPad + line.slice(0, contentWidth));
        line = line.slice(contentWidth);
      }
      rendered.push(leftPad + line);
    }

    return rendered;
  }
}
export class SelectList {}
export class SettingsList {}

// Type stubs
export type SelectItem = any;
export type SettingItem = any;
