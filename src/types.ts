// W3C Design Tokens Format Types
// https://tr.designtokens.org/format/

export interface W3CColorValue {
  colorSpace: 'srgb';
  components: [number, number, number];
  alpha: number;
  hex: string;
}

// W3C Typography Token Value
// https://tr.designtokens.org/format/#typography
export interface W3CTypographyValue {
  fontFamily: string;
  fontSize: string;
  fontWeight: number | string;
  lineHeight: string;
  letterSpacing: string;
}

// W3C Shadow Token Value
// https://tr.designtokens.org/format/#shadow
export interface W3CShadowValue {
  color: string;
  offsetX: string;
  offsetY: string;
  blur: string;
  spread: string;
  inset?: boolean;
}

// For multiple shadows (e.g., elevation with multiple layers)
export type W3CShadowLayersValue = W3CShadowValue[];

export interface W3CToken {
  $value: W3CColorValue | W3CTypographyValue | W3CShadowValue | W3CShadowLayersValue | string | number | boolean;
  $type: 'color' | 'typography' | 'shadow' | 'fontFamily' | 'dimension' | 'fontWeight' | 'number' | 'string' | 'boolean';
  $description?: string;
}

export interface W3CTokenGroup {
  [key: string]: W3CToken | W3CTokenGroup;
}

export interface ExportResult {
  filename: string;
  content: string;
}

export interface ExportMessage {
  type: 'export-complete';
  files: ExportResult[];
}

export interface UIMessage {
  type: 'export-json' | 'export-html';
}
