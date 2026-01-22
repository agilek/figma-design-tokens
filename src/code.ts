import type { W3CToken, W3CTokenGroup, W3CColorValue, W3CTypographyValue, W3CShadowValue, W3CShadowLayersValue, ExportResult, ExportMessage, UIMessage } from './types';

figma.showUI(__html__, { width: 280, height: 180 });

figma.ui.onmessage = async (msg: UIMessage) => {
  if (msg.type === 'export-json' || msg.type === 'export-html') {
    const file = await exportTokens(msg.type === 'export-html');
    const message: ExportMessage = { type: 'export-complete', files: file ? [file] : [] };
    figma.ui.postMessage(message);
  }
};

async function exportTokens(asHtml: boolean): Promise<ExportResult | null> {
  const variables = await figma.variables.getLocalVariablesAsync();
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const textStyles = await figma.getLocalTextStylesAsync();
  const effectStyles = await figma.getLocalEffectStylesAsync();

  if (collections.length === 0 && textStyles.length === 0 && effectStyles.length === 0) {
    return null;
  }

  // Group variables by collection
  const variablesByCollection = new Map<string, Variable[]>();
  for (const variable of variables) {
    const existing = variablesByCollection.get(variable.variableCollectionId) || [];
    existing.push(variable);
    variablesByCollection.set(variable.variableCollectionId, existing);
  }

  // Build a map of variable IDs to their resolved paths for alias handling
  const variablePathMap = new Map<string, string>();
  for (const variable of variables) {
    const collection = collections.find(c => c.id === variable.variableCollectionId);
    const collectionPrefix = collection ? sanitizeName(collection.name) : '';
    const variablePath = variable.name.split('/').map(sanitizeName).join('.');
    variablePathMap.set(variable.id, `${collectionPrefix}.${variablePath}`);
  }

  // Build single merged structure: { Collection: { Mode: { tokens } } }
  const merged: W3CTokenGroup = {};

  for (const collection of collections) {
    const collectionVariables = variablesByCollection.get(collection.id) || [];
    if (collectionVariables.length === 0) continue;

    const collectionKey = sanitizeName(collection.name);
    merged[collectionKey] = {};

    for (const mode of collection.modes) {
      const modeKey = sanitizeName(mode.name);
      const tokens = buildTokensForMode(collectionVariables, mode.modeId, variablePathMap, collection.name);
      (merged[collectionKey] as W3CTokenGroup)[modeKey] = tokens;
    }
  }

  // Add typography tokens from text styles (primitives + composites)
  if (textStyles.length > 0) {
    const { primitives, composites } = buildTypographyTokensWithPrimitives(textStyles);
    merged['font'] = primitives;
    merged['typography'] = composites;
  }

  // Add shadow tokens from effect styles
  if (effectStyles.length > 0) {
    const shadowTokens = buildShadowTokens(effectStyles);
    merged['Shadows'] = { 'Default': shadowTokens };
  }

  // Apply token ordering (groups) and sorting (primitives before aliases)
  const ordered = orderTokenGroups(merged);
  const sorted = sortPrimitivesBeforeAliases(ordered);

  const fileUrl = figma.fileKey ? `https://www.figma.com/file/${figma.fileKey}` : null;
  const fileName = figma.root.name;

  if (asHtml) {
    return { filename: 'tokens-preview.html', content: generateHtmlPreview(sorted, fileUrl, fileName) };
  } else {
    return { filename: 'tokens.json', content: JSON.stringify(sorted, null, 2) };
  }
}

function buildTokensForMode(
  variables: Variable[],
  modeId: string,
  variablePathMap: Map<string, string>,
  collectionName: string
): W3CTokenGroup {
  const root: W3CTokenGroup = {};

  for (const variable of variables) {
    const value = variable.valuesByMode[modeId];
    if (value === undefined) continue;

    const pathParts = variable.name.split('/').map(sanitizeName);
    const token = convertToW3CToken(variable, value, variablePathMap, collectionName);

    setNestedValue(root, pathParts, token);
  }

  return root;
}

function convertToW3CToken(
  variable: Variable,
  value: VariableValue,
  variablePathMap: Map<string, string>,
  currentCollection: string
): W3CToken {
  // Handle aliases
  if (isVariableAlias(value)) {
    const aliasPath = variablePathMap.get(value.id);
    if (aliasPath) {
      // Remove collection prefix if same collection
      const currentPrefix = sanitizeName(currentCollection) + '.';
      const displayPath = aliasPath.startsWith(currentPrefix)
        ? aliasPath.slice(currentPrefix.length)
        : aliasPath;

      return {
        $value: `{${displayPath}}`,
        $type: mapFigmaType(variable.resolvedType)
      };
    }
  }

  // Handle resolved values
  switch (variable.resolvedType) {
    case 'COLOR':
      return {
        $value: convertColor(value as RGBA),
        $type: 'color'
      };
    case 'FLOAT':
      return {
        $value: value as number,
        $type: 'number'
      };
    case 'STRING':
      return {
        $value: value as string,
        $type: 'string'
      };
    case 'BOOLEAN':
      return {
        $value: value as boolean,
        $type: 'boolean'
      };
    default:
      return {
        $value: String(value),
        $type: 'string'
      };
  }
}

function convertColor(rgba: RGBA): W3CColorValue {
  const r = Math.round(rgba.r * 255);
  const g = Math.round(rgba.g * 255);
  const b = Math.round(rgba.b * 255);
  const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;

  return {
    colorSpace: 'srgb',
    components: [rgba.r, rgba.g, rgba.b],
    alpha: rgba.a ?? 1,
    hex
  };
}

function mapFigmaType(resolvedType: VariableResolvedDataType): W3CToken['$type'] {
  switch (resolvedType) {
    case 'COLOR': return 'color';
    case 'FLOAT': return 'number';
    case 'STRING': return 'string';
    case 'BOOLEAN': return 'boolean';
    default: return 'string';
  }
}

function isVariableAlias(value: VariableValue): value is VariableAlias {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'VARIABLE_ALIAS';
}

function sanitizeName(name: string): string {
  // Remove or replace characters that conflict with W3C token path syntax
  return name
    .replace(/[{}.]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Typography primitive extraction and reference generation

interface ExtractedTypography {
  family: string;
  size: string;
  weight: number;
  lineHeight: string;
  letterSpacing: string;
  styleName: string;
  description?: string;
}

interface PrimitiveMaps {
  families: Map<string, string>;      // value -> token name
  sizes: Map<string, string>;         // value -> token name
  weights: Map<number, string>;       // value -> token name
  lineHeights: Map<string, string>;   // value -> token name
  letterSpacings: Map<string, string>; // value -> token name
}

function buildTypographyTokensWithPrimitives(textStyles: TextStyle[]): { primitives: W3CTokenGroup; composites: W3CTokenGroup } {
  // Extract all typography data
  const extracted = textStyles.map(extractTypographyData);

  // Collect unique primitive values
  const uniqueFamilies = [...new Set(extracted.map(e => e.family))];
  const uniqueSizes = [...new Set(extracted.map(e => e.size))].sort((a, b) => parseFloat(a) - parseFloat(b));
  const uniqueWeights = [...new Set(extracted.map(e => e.weight))].sort((a, b) => a - b);
  const uniqueLineHeights = [...new Set(extracted.map(e => e.lineHeight))].sort((a, b) => {
    if (a === 'normal') return -1;
    if (b === 'normal') return 1;
    return parseFloat(a) - parseFloat(b);
  });
  const uniqueLetterSpacings = [...new Set(extracted.map(e => e.letterSpacing))].sort((a, b) => {
    return parseFloat(a) - parseFloat(b);
  });

  // Generate semantic names for primitives
  const primitiveMaps: PrimitiveMaps = {
    families: generateFamilyNames(uniqueFamilies),
    sizes: generateSizeNames(uniqueSizes),
    weights: generateWeightNames(uniqueWeights),
    lineHeights: generateLineHeightNames(uniqueLineHeights),
    letterSpacings: generateLetterSpacingNames(uniqueLetterSpacings)
  };

  // Build primitive tokens
  const primitives: W3CTokenGroup = {
    family: buildFamilyTokens(primitiveMaps.families),
    size: buildSizeTokens(primitiveMaps.sizes),
    weight: buildWeightTokens(primitiveMaps.weights),
    lineHeight: buildLineHeightTokens(primitiveMaps.lineHeights),
    letterSpacing: buildLetterSpacingTokens(primitiveMaps.letterSpacings)
  };

  // Build composite tokens with references (flat namespace)
  const composites: W3CTokenGroup = {};
  for (const data of extracted) {
    // Flatten: "Body/Small" → "body-small"
    const flatName = data.styleName
      .split('/')
      .map(sanitizeName)
      .join('-')
      .toLowerCase();
    const token = buildCompositeTypographyToken(data, primitiveMaps);
    composites[flatName] = token;
  }

  return { primitives, composites };
}

function extractTypographyData(style: TextStyle): ExtractedTypography {
  const fontName = style.fontName;
  const fontSize = style.fontSize;
  const letterSpacing = style.letterSpacing;
  const lineHeight = style.lineHeight;

  // Convert letter spacing to string with unit
  let letterSpacingStr = '0';
  if (letterSpacing.unit === 'PIXELS') {
    letterSpacingStr = `${letterSpacing.value}px`;
  } else if (letterSpacing.unit === 'PERCENT') {
    letterSpacingStr = `${letterSpacing.value}%`;
  }

  // Convert line height to string with unit
  let lineHeightStr = 'normal';
  if (lineHeight.unit === 'PIXELS') {
    lineHeightStr = `${lineHeight.value}px`;
  } else if (lineHeight.unit === 'PERCENT') {
    lineHeightStr = `${lineHeight.value}%`;
  }

  // Map font style to weight
  const fontStyle = fontName.style.toLowerCase();
  let fontWeight = 400;

  if (fontStyle.includes('thin') || fontStyle.includes('hairline')) {
    fontWeight = 100;
  } else if (fontStyle.includes('extralight') || fontStyle.includes('ultra light')) {
    fontWeight = 200;
  } else if (fontStyle.includes('light')) {
    fontWeight = 300;
  } else if (fontStyle.includes('medium')) {
    fontWeight = 500;
  } else if (fontStyle.includes('semibold') || fontStyle.includes('semi bold') || fontStyle.includes('demi')) {
    fontWeight = 600;
  } else if (fontStyle.includes('extrabold') || fontStyle.includes('ultra bold')) {
    fontWeight = 800;
  } else if (fontStyle.includes('bold')) {
    fontWeight = 700;
  } else if (fontStyle.includes('black') || fontStyle.includes('heavy')) {
    fontWeight = 900;
  }

  return {
    family: fontName.family,
    size: `${fontSize}px`,
    weight: fontWeight,
    lineHeight: lineHeightStr,
    letterSpacing: letterSpacingStr,
    styleName: style.name,
    description: style.description || undefined
  };
}

// Semantic name generators
function generateFamilyNames(families: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const family of families) {
    const lower = family.toLowerCase();
    let name: string;
    if (lower.includes('mono') || lower.includes('code') || lower.includes('consola') || lower.includes('courier')) {
      name = 'mono';
    } else if (lower.includes('serif') && !lower.includes('sans')) {
      name = 'serif';
    } else {
      name = 'sans';
    }
    // Handle duplicates by adding index
    if ([...map.values()].includes(name)) {
      let i = 2;
      while ([...map.values()].includes(`${name}-${i}`)) i++;
      name = `${name}-${i}`;
    }
    map.set(family, name);
  }
  return map;
}

function generateSizeNames(sizes: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const scaleNames = ['xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'];

  // Find a good "base" size (typically 14-16px)
  const baseIndex = sizes.findIndex(s => {
    const px = parseFloat(s);
    return px >= 14 && px <= 16;
  });

  const startIndex = baseIndex >= 0 ? Math.max(0, 2 - baseIndex) : 0;

  sizes.forEach((size, i) => {
    const nameIndex = startIndex + i;
    const name = nameIndex < scaleNames.length ? scaleNames[nameIndex] : `${nameIndex - scaleNames.length + 10}xl`;
    map.set(size, name);
  });

  return map;
}

function generateWeightNames(weights: number[]): Map<number, string> {
  const map = new Map<number, string>();
  const weightNames: Record<number, string> = {
    100: 'thin',
    200: 'extralight',
    300: 'light',
    400: 'regular',
    500: 'medium',
    600: 'semibold',
    700: 'bold',
    800: 'extrabold',
    900: 'black'
  };

  for (const weight of weights) {
    map.set(weight, weightNames[weight] || `w${weight}`);
  }
  return map;
}

function generateLineHeightNames(lineHeights: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const scaleNames = ['none', 'tight', 'snug', 'normal', 'relaxed', 'loose'];

  lineHeights.forEach((lh, i) => {
    if (lh === 'normal') {
      map.set(lh, 'normal');
    } else {
      // Skip 'normal' in naming if it exists
      const adjustedIndex = lineHeights[0] === 'normal' ? i : i + 1;
      const name = adjustedIndex < scaleNames.length ? scaleNames[adjustedIndex] : `${adjustedIndex}`;
      map.set(lh, name);
    }
  });
  return map;
}

function generateLetterSpacingNames(letterSpacings: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const scaleNames = ['tighter', 'tight', 'normal', 'wide', 'wider', 'widest'];

  // Find zero/normal index
  const normalIndex = letterSpacings.findIndex(ls => parseFloat(ls) === 0);
  const startIndex = normalIndex >= 0 ? Math.max(0, 2 - normalIndex) : 0;

  letterSpacings.forEach((ls, i) => {
    const nameIndex = startIndex + i;
    const name = nameIndex < scaleNames.length ? scaleNames[nameIndex] : `spacing-${nameIndex}`;
    map.set(ls, name);
  });
  return map;
}

// Token builders
function buildFamilyTokens(families: Map<string, string>): W3CTokenGroup {
  const tokens: W3CTokenGroup = {};
  for (const [value, name] of families) {
    tokens[name] = { $value: value, $type: 'fontFamily' };
  }
  return tokens;
}

function buildSizeTokens(sizes: Map<string, string>): W3CTokenGroup {
  const tokens: W3CTokenGroup = {};
  for (const [value, name] of sizes) {
    tokens[name] = { $value: value, $type: 'dimension' };
  }
  return tokens;
}

function buildWeightTokens(weights: Map<number, string>): W3CTokenGroup {
  const tokens: W3CTokenGroup = {};
  for (const [value, name] of weights) {
    tokens[name] = { $value: value, $type: 'fontWeight' };
  }
  return tokens;
}

function buildLineHeightTokens(lineHeights: Map<string, string>): W3CTokenGroup {
  const tokens: W3CTokenGroup = {};
  for (const [value, name] of lineHeights) {
    tokens[name] = { $value: value, $type: 'dimension' };
  }
  return tokens;
}

function buildLetterSpacingTokens(letterSpacings: Map<string, string>): W3CTokenGroup {
  const tokens: W3CTokenGroup = {};
  for (const [value, name] of letterSpacings) {
    tokens[name] = { $value: value, $type: 'dimension' };
  }
  return tokens;
}

function buildCompositeTypographyToken(data: ExtractedTypography, maps: PrimitiveMaps): W3CToken {
  const familyRef = `{font.family.${maps.families.get(data.family)}}`;
  const sizeRef = `{font.size.${maps.sizes.get(data.size)}}`;
  const weightRef = `{font.weight.${maps.weights.get(data.weight)}}`;
  const lineHeightRef = `{font.lineHeight.${maps.lineHeights.get(data.lineHeight)}}`;
  const letterSpacingRef = `{font.letterSpacing.${maps.letterSpacings.get(data.letterSpacing)}}`;

  const typographyValue: W3CTypographyValue = {
    fontFamily: familyRef,
    fontSize: sizeRef,
    fontWeight: weightRef,
    lineHeight: lineHeightRef,
    letterSpacing: letterSpacingRef
  };

  return {
    $value: typographyValue,
    $type: 'typography',
    $description: data.description
  };
}

// Convert Figma effect styles to W3C shadow tokens
function buildShadowTokens(effectStyles: EffectStyle[]): W3CTokenGroup {
  const root: W3CTokenGroup = {};

  for (const style of effectStyles) {
    // Only process styles that have shadow effects
    const shadowEffects = style.effects.filter(
      (e): e is DropShadowEffect | InnerShadowEffect =>
        e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'
    );

    if (shadowEffects.length === 0) continue;

    const pathParts = style.name.split('/').map(sanitizeName);
    const token = convertEffectStyleToToken(style, shadowEffects);
    setNestedValue(root, pathParts, token);
  }

  return root;
}

function convertEffectStyleToToken(
  style: EffectStyle,
  shadowEffects: (DropShadowEffect | InnerShadowEffect)[]
): W3CToken {
  // Convert each shadow effect to W3C format
  const shadows: W3CShadowValue[] = shadowEffects
    .filter(effect => effect.visible !== false)
    .map(effect => {
      const color = effect.color;
      const r = Math.round(color.r * 255);
      const g = Math.round(color.g * 255);
      const b = Math.round(color.b * 255);
      const a = color.a ?? 1;

      // Format color as rgba
      const colorStr = a < 1
        ? `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`
        : `rgb(${r}, ${g}, ${b})`;

      return {
        color: colorStr,
        offsetX: `${effect.offset.x}px`,
        offsetY: `${effect.offset.y}px`,
        blur: `${effect.radius}px`,
        spread: `${effect.spread ?? 0}px`,
        inset: effect.type === 'INNER_SHADOW'
      };
    });

  // If single shadow, return as object; if multiple, return as array
  const value: W3CShadowValue | W3CShadowLayersValue = shadows.length === 1 ? shadows[0] : shadows;

  return {
    $value: value,
    $type: 'shadow',
    $description: style.description || undefined
  };
}

// Order token groups according to priority
// Colors → Typography → Spacing → Shadows → Borders
function orderTokenGroups(tokens: W3CTokenGroup): W3CTokenGroup {
  const orderedKeys: string[] = [];

  // Define category patterns in order of priority
  const categoryPatterns = [
    /^color/i,                                    // Colors
    /^typography$|^font$/i,                       // Typography (composites and primitives)
    /spacing|dimension|size|width|height|gap/i,  // Spacing
    /shadow|elevation/i,                          // Shadows
    /border|radius|stroke/i                       // Borders
  ];

  const keys = Object.keys(tokens);
  const categorized = new Set<string>();

  // Sort keys into categories
  for (const pattern of categoryPatterns) {
    for (const key of keys) {
      if (!categorized.has(key) && pattern.test(key)) {
        orderedKeys.push(key);
        categorized.add(key);
      }
    }
  }

  // Add any remaining uncategorized keys at the end
  for (const key of keys) {
    if (!categorized.has(key)) {
      orderedKeys.push(key);
      categorized.add(key);
    }
  }

  // Build ordered object
  const ordered: W3CTokenGroup = {};
  for (const key of orderedKeys) {
    ordered[key] = tokens[key];
  }

  return ordered;
}

// Sort tokens within groups: primitives (direct values) before aliases (references)
function sortPrimitivesBeforeAliases(tokens: W3CTokenGroup): W3CTokenGroup {
  const sorted: W3CTokenGroup = {};

  const entries = Object.entries(tokens);

  // Separate tokens and groups
  const tokenEntries: Array<[string, W3CToken]> = [];
  const groupEntries: Array<[string, W3CTokenGroup]> = [];

  for (const [key, value] of entries) {
    if (isToken(value)) {
      tokenEntries.push([key, value as W3CToken]);
    } else if (typeof value === 'object' && value !== null) {
      groupEntries.push([key, value as W3CTokenGroup]);
    }
  }

  // Sort tokens: non-references first, then references
  tokenEntries.sort((a, b) => {
    const aIsRef = isReferenceValue(a[1].$value);
    const bIsRef = isReferenceValue(b[1].$value);
    if (aIsRef === bIsRef) return 0;
    return aIsRef ? 1 : -1; // non-references first
  });

  // Add sorted tokens
  for (const [key, value] of tokenEntries) {
    sorted[key] = value;
  }

  // Recursively sort nested groups
  for (const [key, value] of groupEntries) {
    sorted[key] = sortPrimitivesBeforeAliases(value);
  }

  return sorted;
}

// Check if a token value is a reference (string starting with {)
function isReferenceValue(value: unknown): boolean {
  if (typeof value === 'string' && value.startsWith('{')) {
    return true;
  }
  // Check nested values in typography tokens
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    for (const v of Object.values(obj)) {
      if (typeof v === 'string' && v.startsWith('{')) {
        return true;
      }
    }
  }
  return false;
}

function setNestedValue(obj: W3CTokenGroup, path: string[], value: W3CToken): void {
  let current = obj;

  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key] as W3CTokenGroup;
  }

  current[path[path.length - 1]] = value;
}

// HTML Preview Generation

// Build a lookup map of all color tokens for resolving references
function buildColorLookup(tokens: W3CTokenGroup, path: string[] = []): Map<string, { hex: string; alpha: number }> {
  const lookup = new Map<string, { hex: string; alpha: number }>();

  for (const [key, value] of Object.entries(tokens)) {
    const currentPath = [...path, key];

    if (isToken(value)) {
      const token = value as W3CToken;
      if (token.$type === 'color' && typeof token.$value === 'object' && token.$value !== null && 'hex' in token.$value) {
        const colorVal = token.$value as W3CColorValue;
        const colorData = {
          hex: colorVal.hex || '#000000',
          alpha: colorVal.alpha ?? 1
        };

        // Store with full path: "Colors.Mode.red.500"
        const fullPath = currentPath.join('.');
        lookup.set(fullPath, colorData);

        // Also store with various shorter paths for easier matching
        // Skip first 2 levels (collection.mode): "red.500"
        if (currentPath.length > 2) {
          lookup.set(currentPath.slice(2).join('.'), colorData);
        }
        // Skip first level (collection): "Mode.red.500"
        if (currentPath.length > 1) {
          lookup.set(currentPath.slice(1).join('.'), colorData);
        }
        // Just the last 2 parts: "red.500"
        if (currentPath.length >= 2) {
          lookup.set(currentPath.slice(-2).join('.'), colorData);
        }
        // Just the last 3 parts: "category.red.500"
        if (currentPath.length >= 3) {
          lookup.set(currentPath.slice(-3).join('.'), colorData);
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      // Recurse into nested groups
      const nested = buildColorLookup(value as W3CTokenGroup, currentPath);
      nested.forEach((v, k) => lookup.set(k, v));
    }
  }

  return lookup;
}

// Resolve a reference like {Colors.red.500} to its color value
function resolveColorReference(ref: string, lookup: Map<string, { hex: string; alpha: number }>): { hex: string; alpha: number } | null {
  // Remove curly braces: {Colors.red.500} -> Colors.red.500
  const key = ref.replace(/^\{|\}$/g, '');
  const keyParts = key.split('.');

  // Try direct lookup
  if (lookup.has(key)) {
    return lookup.get(key)!;
  }

  // Try matching by checking if lookup path ends with the reference parts
  for (const [lookupKey, value] of lookup.entries()) {
    // Check if ends with full key
    if (lookupKey.endsWith('.' + key) || lookupKey === key) {
      return value;
    }

    // Check if the lookup key contains all parts of the reference in sequence
    const lookupParts = lookupKey.split('.');
    let keyIdx = 0;
    for (const part of lookupParts) {
      if (part === keyParts[keyIdx]) {
        keyIdx++;
        if (keyIdx === keyParts.length) {
          return value;
        }
      }
    }
  }

  return null;
}

let colorLookup: Map<string, { hex: string; alpha: number }>;
let fontPrimitiveLookup: Map<string, string | number>;

// Build lookup for font primitives to resolve references like {font.size.base}
function buildFontPrimitiveLookup(tokens: W3CTokenGroup, path: string[] = []): Map<string, string | number> {
  const lookup = new Map<string, string | number>();

  for (const [key, value] of Object.entries(tokens)) {
    const currentPath = [...path, key];

    if (isToken(value)) {
      const token = value as W3CToken;
      // Only include font primitive types
      if (token.$type === 'fontFamily' || token.$type === 'dimension' || token.$type === 'fontWeight') {
        const fullPath = currentPath.join('.');
        lookup.set(fullPath, token.$value as string | number);
      }
    } else if (typeof value === 'object' && value !== null) {
      const nested = buildFontPrimitiveLookup(value as W3CTokenGroup, currentPath);
      nested.forEach((v, k) => lookup.set(k, v));
    }
  }

  return lookup;
}

// Resolve a font reference like {font.size.base} to its value
function resolveFontReference(ref: string): string | number {
  if (!ref.startsWith('{')) return ref;
  const key = ref.replace(/^\{|\}$/g, '');
  return fontPrimitiveLookup.get(key) ?? ref;
}

function generateHtmlPreview(tokens: W3CTokenGroup, fileUrl: string | null, fileName: string): string {
  // Build lookups for resolving references
  colorLookup = buildColorLookup(tokens);
  fontPrimitiveLookup = buildFontPrimitiveLookup(tokens);

  const css = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #323232;
      background: #fafafa;
    }
    .sidebar {
      position: fixed;
      top: 0;
      left: 0;
      width: 200px;
      height: 100vh;
      background: #fff;
      border-right: 1px solid #e5e5e5;
      padding: 24px 16px;
      overflow-y: auto;
    }
    .sidebar-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #939393;
      margin-bottom: 12px;
    }
    .sidebar-nav {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .sidebar-nav a {
      color: #666;
      text-decoration: none;
      font-size: 13px;
      padding: 6px 10px;
      border-radius: 4px;
      transition: background 0.15s, color 0.15s;
    }
    .sidebar-nav a:hover {
      background: #f0f0f0;
      color: #323232;
    }
    .main-content {
      margin-left: 200px;
      padding: 32px;
    }
    .container { max-width: 1200px; }
    h1 { font-size: 28px; font-weight: 600; margin-bottom: 8px; }
    .subtitle { color: #747474; margin-bottom: 32px; }
    section { margin-bottom: 48px; scroll-margin-top: 16px; }
    .section-title { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
    .section-desc { color: #747474; margin-bottom: 16px; }
    .subsection-title {
      color: #747474; font-weight: 600; text-transform: uppercase;
      font-size: 11px; letter-spacing: 0.5px; margin-bottom: 12px; margin-top: 24px;
    }
    .token-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 8px;
    }
    .token-row {
      display: flex; align-items: center; gap: 16px;
      padding: 8px 12px; border-radius: 6px;
      background: rgba(38, 38, 38, 0.03);
    }
    .color-swatch {
      width: 40px; height: 40px; border-radius: 6px;
      border: 1px solid rgba(38, 38, 38, 0.11);
      flex-shrink: 0; position: relative;
    }
    .color-swatch.transparent {
      background-image:
        linear-gradient(45deg, #ccc 25%, transparent 25%),
        linear-gradient(-45deg, #ccc 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #ccc 75%),
        linear-gradient(-45deg, transparent 75%, #ccc 75%);
      background-size: 10px 10px;
      background-position: 0 0, 0 5px, 5px -5px, -5px 0px;
    }
    .color-swatch-inner {
      position: absolute; inset: 0; border-radius: 5px;
    }
    .token-info { flex: 1; min-width: 0; }
    .token-name { font-weight: 600; color: #323232; }
    .token-value { font-family: monospace; font-size: 12px; color: #747474; word-break: break-all; }
    .token-value.reference { color: #747474; }
    .number-preview {
      width: 40px; height: 40px; border-radius: 6px;
      border: 2px solid #323232; display: flex;
      align-items: center; justify-content: center;
      flex-shrink: 0; font-weight: 600; font-size: 12px;
    }
    .radius-preview { background: transparent; }
    .spacing-preview-container { width: 80px; height: 32px; display: flex; align-items: center; flex-shrink: 0; }
    .spacing-bar { background: #323232; border-radius: 2px; }
    .color-palette { display: flex; gap: 4px; flex-wrap: wrap; }
    .palette-swatch {
      display: flex; flex-direction: column; align-items: center; gap: 4px;
    }
    .palette-swatch .color-swatch { width: 48px; height: 48px; cursor: pointer; }
    .palette-label { font-size: 11px; color: #747474; }
    .ref-placeholder {
      width: 40px; height: 40px; border-radius: 6px;
      border: 1px dashed rgba(38, 38, 38, 0.2);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; font-size: 11px; color: #939393;
    }
    .typography-row {
      display: flex; flex-direction: column; gap: 8px;
      padding: 16px; border-radius: 8px;
      background: rgba(38, 38, 38, 0.03);
      margin-bottom: 8px;
    }
    .typography-preview {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #323232;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .typography-meta {
      display: flex; flex-wrap: wrap; gap: 8px 16px;
      font-size: 12px; color: #747474; font-family: monospace;
    }
    .typography-meta span { display: inline-flex; align-items: center; gap: 4px; }
    .typography-meta .label { color: #939393; }
    .shadow-row {
      display: flex; align-items: center; gap: 16px;
      padding: 12px 16px; border-radius: 8px;
      background: rgba(38, 38, 38, 0.03);
      margin-bottom: 8px;
    }
    .shadow-preview {
      width: 64px; height: 64px; border-radius: 8px;
      background: #ffffff; flex-shrink: 0;
    }
    .shadow-info { flex: 1; min-width: 0; }
    .shadow-meta {
      display: flex; flex-wrap: wrap; gap: 6px 12px;
      font-size: 12px; color: #747474; font-family: monospace;
      margin-top: 4px;
    }
    .shadow-meta span { display: inline-flex; align-items: center; gap: 4px; }
    .shadow-meta .label { color: #939393; }
  `;

  let sidebarItems: string[] = [];
  let sectionsHtml = '';

  // Process each collection
  for (const [collectionName, collectionData] of Object.entries(tokens)) {
    if (typeof collectionData !== 'object' || collectionData === null) continue;

    const collectionId = collectionName.toLowerCase().replace(/\s+/g, '-');
    sidebarItems.push(`<a href="#${collectionId}">${escapeHtml(collectionName)}</a>`);

    const modes = collectionData as W3CTokenGroup;

    // Check if this collection has modes (nested structure) or direct tokens
    const modeEntries = Object.entries(modes);
    const hasMultipleModes = modeEntries.length > 1 || (modeEntries.length === 1 && !isToken(modeEntries[0][1]));

    if (hasMultipleModes) {
      for (const [modeName, modeData] of modeEntries) {
        if (typeof modeData !== 'object' || modeData === null) continue;

        const sectionId = `${collectionName}-${modeName}`.toLowerCase().replace(/\s+/g, '-');
        const isFirstMode = modeEntries[0][0] === modeName;

        sectionsHtml += `
          <section id="${isFirstMode ? collectionId : sectionId}">
            <div class="section-title">${escapeHtml(collectionName)} / ${escapeHtml(modeName)}</div>
            ${renderTokenGroup(modeData as W3CTokenGroup, [])}
          </section>
        `;
      }
    } else {
      sectionsHtml += `
        <section id="${collectionId}">
          <div class="section-title">${escapeHtml(collectionName)}</div>
          ${renderTokenGroup(modes, [])}
        </section>
      `;
    }
  }

  const sidebarHtml = sidebarItems.join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Design Tokens Preview</title>
  <style>${css}</style>
</head>
<body>
  <aside class="sidebar">
    <div class="sidebar-title">Categories</div>
    <nav class="sidebar-nav">
      ${sidebarHtml}
    </nav>
  </aside>
  <main class="main-content">
    <div class="container">
      <h1>${escapeHtml(fileName)}</h1>
      <p class="subtitle">${fileUrl ? `<a href="${fileUrl}" target="_blank" style="color: #0d99ff;">Open in Figma ↗</a> · ` : ''}Click any value to copy.</p>
      ${sectionsHtml}
    </div>
  </main>
  <script>
    document.addEventListener('click', async (e) => {
      const row = e.target.closest('[data-copy]');
      if (row) {
        try {
          await navigator.clipboard.writeText(row.dataset.copy);
          const name = row.querySelector('.token-name');
          if (name) {
            const orig = name.textContent;
            name.textContent = 'Copied!';
            setTimeout(() => name.textContent = orig, 1000);
          }
        } catch (err) { console.error('Copy failed', err); }
      }
    });
  </script>
</body>
</html>`;
}

function renderTokenGroup(group: W3CTokenGroup, path: string[]): string {
  let html = '';
  const colorTokens: Array<{ name: string; token: W3CToken }> = [];
  const typographyTokens: Array<{ name: string; token: W3CToken }> = [];
  const shadowTokens: Array<{ name: string; token: W3CToken }> = [];
  const numberTokens: Array<{ name: string; token: W3CToken }> = [];
  const stringTokens: Array<{ name: string; token: W3CToken }> = [];
  const subgroups: Array<{ name: string; group: W3CTokenGroup }> = [];

  for (const [key, value] of Object.entries(group)) {
    if (isToken(value)) {
      const token = value as W3CToken;
      if (token.$type === 'color') {
        colorTokens.push({ name: key, token });
      } else if (token.$type === 'typography') {
        typographyTokens.push({ name: key, token });
      } else if (token.$type === 'shadow') {
        shadowTokens.push({ name: key, token });
      } else if (token.$type === 'number') {
        numberTokens.push({ name: key, token });
      } else {
        stringTokens.push({ name: key, token });
      }
    } else if (typeof value === 'object' && value !== null) {
      subgroups.push({ name: key, group: value as W3CTokenGroup });
    }
  }

  // Render color tokens
  if (colorTokens.length > 0) {
    // Check if this looks like a color palette (numeric keys like 50, 100, 200...)
    const isPalette = colorTokens.every(t => /^\d+$/.test(t.name)) && colorTokens.length > 3;

    if (isPalette) {
      colorTokens.sort((a, b) => parseInt(a.name) - parseInt(b.name));
      html += `<div class="color-palette">`;
      for (const { name, token } of colorTokens) {
        const colorVal = getColorDisplay(token);
        // Skip unresolved references in palette view
        if (!colorVal.hex) continue;
        html += `
          <div class="palette-swatch" data-copy="${escapeHtml(colorVal.copyValue)}" style="cursor:pointer">
            <div class="color-swatch ${colorVal.alpha < 1 ? 'transparent' : ''}">
              <div class="color-swatch-inner" style="background-color: ${colorVal.cssColor}"></div>
            </div>
            <span class="palette-label">${escapeHtml(name)}</span>
          </div>
        `;
      }
      html += `</div>`;
    } else {
      html += `<div class="token-grid">`;
      for (const { name, token } of colorTokens) {
        html += renderColorToken(name, token);
      }
      html += `</div>`;
    }
  }

  // Render typography tokens
  if (typographyTokens.length > 0) {
    for (const { name, token } of typographyTokens) {
      html += renderTypographyToken(name, token);
    }
  }

  // Render shadow tokens
  if (shadowTokens.length > 0) {
    for (const { name, token } of shadowTokens) {
      html += renderShadowToken(name, token);
    }
  }

  // Render number tokens
  if (numberTokens.length > 0) {
    numberTokens.sort((a, b) => {
      const valA = typeof a.token.$value === 'number' ? a.token.$value : 0;
      const valB = typeof b.token.$value === 'number' ? b.token.$value : 0;
      return valA - valB;
    });

    // Detect if spacing or radius based on path
    const isSpacing = path.some(p => p.toLowerCase().includes('spacing'));

    html += `<div class="token-grid">`;
    for (const { name, token } of numberTokens) {
      html += renderNumberToken(name, token, isSpacing);
    }
    html += `</div>`;
  }

  // Render string/boolean tokens
  if (stringTokens.length > 0) {
    html += `<div class="token-grid">`;
    for (const { name, token } of stringTokens) {
      html += renderStringToken(name, token);
    }
    html += `</div>`;
  }

  // Render subgroups
  for (const { name, group: subgroup } of subgroups) {
    html += `<div class="subsection-title">${escapeHtml(name)}</div>`;
    html += renderTokenGroup(subgroup, [...path, name]);
  }

  return html;
}

function isToken(value: unknown): value is W3CToken {
  return typeof value === 'object' && value !== null && '$value' in value && '$type' in value;
}

function getColorDisplay(token: W3CToken): { hex: string; alpha: number; cssColor: string; copyValue: string; isReference: boolean; refPath: string } {
  const value = token.$value;

  if (typeof value === 'string' && value.startsWith('{')) {
    // Reference token - try to resolve it
    const resolved = resolveColorReference(value, colorLookup);
    if (resolved) {
      const cssColor = resolved.alpha < 1
        ? `${resolved.hex}${Math.round(resolved.alpha * 255).toString(16).padStart(2, '0')}`
        : resolved.hex;
      return { hex: resolved.hex, alpha: resolved.alpha, cssColor, copyValue: resolved.hex, isReference: true, refPath: value };
    }
    // Couldn't resolve - show as unresolved reference
    return { hex: '', alpha: 1, cssColor: 'transparent', copyValue: value, isReference: true, refPath: value };
  }

  if (typeof value === 'object' && value !== null && 'hex' in value) {
    const colorVal = value as W3CColorValue;
    const alpha = colorVal.alpha ?? 1;
    const hex = colorVal.hex || '#000000';
    const cssColor = alpha < 1
      ? `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
      : hex;
    return { hex, alpha, cssColor, copyValue: hex, isReference: false, refPath: '' };
  }

  return { hex: '', alpha: 1, cssColor: 'transparent', copyValue: '', isReference: false, refPath: '' };
}

function renderColorToken(name: string, token: W3CToken): string {
  const colorVal = getColorDisplay(token);

  // Unresolved reference - show placeholder
  if (colorVal.isReference && !colorVal.hex) {
    return `
      <div class="token-row" data-copy="${escapeHtml(colorVal.copyValue)}" style="cursor:pointer">
        <div class="ref-placeholder">ref</div>
        <div class="token-info">
          <div class="token-name">${escapeHtml(name)}</div>
          <div class="token-value reference">${escapeHtml(colorVal.refPath)}</div>
        </div>
      </div>
    `;
  }

  // Build display value
  let displayValue = colorVal.hex;
  if (colorVal.alpha < 1) {
    displayValue = `${colorVal.hex} (${Math.round(colorVal.alpha * 100)}%)`;
  }
  // If it's a resolved reference, show the reference path too
  if (colorVal.isReference && colorVal.refPath) {
    displayValue = `${displayValue} → ${colorVal.refPath}`;
  }

  return `
    <div class="token-row" data-copy="${escapeHtml(colorVal.copyValue)}" style="cursor:pointer">
      <div class="color-swatch ${colorVal.alpha < 1 ? 'transparent' : ''}">
        <div class="color-swatch-inner" style="background-color: ${colorVal.cssColor}"></div>
      </div>
      <div class="token-info">
        <div class="token-name">${escapeHtml(name)}</div>
        <div class="token-value ${colorVal.isReference ? 'reference' : ''}">${escapeHtml(displayValue)}</div>
      </div>
    </div>
  `;
}

function renderNumberToken(name: string, token: W3CToken, isSpacing: boolean): string {
  const value = typeof token.$value === 'number' ? token.$value : 0;

  if (isSpacing) {
    const barWidth = Math.min(Math.max(value, 2), 80);
    const barHeight = Math.min(Math.max(value, 2), 32);
    return `
      <div class="token-row" data-copy="${value}px" style="cursor:pointer">
        <div class="spacing-preview-container">
          <div class="spacing-bar" style="width: ${barWidth}px; height: ${barHeight}px;"></div>
        </div>
        <div class="token-info">
          <div class="token-name">${escapeHtml(name)}</div>
          <div class="token-value">${value}px</div>
        </div>
      </div>
    `;
  }

  // Radius preview
  const previewRadius = Math.min(value, 20);
  return `
    <div class="token-row" data-copy="${value}px" style="cursor:pointer">
      <div class="number-preview radius-preview" style="border-radius: ${previewRadius}px;">
        ${value}
      </div>
      <div class="token-info">
        <div class="token-name">${escapeHtml(name)}</div>
        <div class="token-value">${value}px</div>
      </div>
    </div>
  `;
}

function renderStringToken(name: string, token: W3CToken): string {
  const value = String(token.$value);
  return `
    <div class="token-row" data-copy="${escapeHtml(value)}" style="cursor:pointer">
      <div class="number-preview" style="font-size: 10px;">
        ${token.$type === 'boolean' ? (token.$value ? '✓' : '✗') : 'Aa'}
      </div>
      <div class="token-info">
        <div class="token-name">${escapeHtml(name)}</div>
        <div class="token-value">${escapeHtml(value)}</div>
      </div>
    </div>
  `;
}

function renderTypographyToken(name: string, token: W3CToken): string {
  const typo = token.$value as W3CTypographyValue;

  // Resolve references for preview (need actual CSS values)
  const resolvedFamily = String(resolveFontReference(typo.fontFamily));
  const resolvedSize = String(resolveFontReference(typo.fontSize));
  const resolvedWeight = resolveFontReference(typo.fontWeight);
  const resolvedLineHeight = String(resolveFontReference(typo.lineHeight));
  const resolvedLetterSpacing = String(resolveFontReference(typo.letterSpacing));

  // Build inline style for preview using resolved values
  const previewStyle = `font-size: ${resolvedSize}; font-weight: ${resolvedWeight}; line-height: ${resolvedLineHeight}; letter-spacing: ${resolvedLetterSpacing}`;

  // Build copy value as CSS with resolved values
  const copyValue = `font-family: ${resolvedFamily}, -apple-system, BlinkMacSystemFont, sans-serif; font-size: ${resolvedSize}; font-weight: ${resolvedWeight}; line-height: ${resolvedLineHeight}; letter-spacing: ${resolvedLetterSpacing}`;

  // Check if values are references (for display)
  const isRef = (val: string) => val.startsWith('{');
  const formatValue = (ref: string, resolved: string | number) => {
    if (isRef(ref)) {
      return `${resolved} <span style="color:#939393">${ref}</span>`;
    }
    return String(resolved);
  };

  return `
    <div class="typography-row" data-copy="${escapeHtml(copyValue)}" style="cursor:pointer">
      <div class="token-name">${escapeHtml(name)}</div>
      <div class="typography-preview" style="${previewStyle}">
        The quick brown fox jumps over the lazy dog
      </div>
      <div class="typography-meta">
        <span><span class="label">Family:</span> ${formatValue(typo.fontFamily, resolvedFamily)}</span>
        <span><span class="label">Size:</span> ${formatValue(typo.fontSize, resolvedSize)}</span>
        <span><span class="label">Weight:</span> ${formatValue(String(typo.fontWeight), resolvedWeight)}</span>
        <span><span class="label">Line:</span> ${formatValue(typo.lineHeight, resolvedLineHeight)}</span>
        <span><span class="label">Letter:</span> ${formatValue(typo.letterSpacing, resolvedLetterSpacing)}</span>
      </div>
    </div>
  `;
}

function renderShadowToken(name: string, token: W3CToken): string {
  const value = token.$value;

  // Handle single shadow or array of shadows
  const shadows: W3CShadowValue[] = Array.isArray(value) ? value : [value as W3CShadowValue];

  // Build CSS box-shadow value
  const cssBoxShadow = shadows.map(s => {
    const inset = s.inset ? 'inset ' : '';
    return `${inset}${s.offsetX} ${s.offsetY} ${s.blur} ${s.spread} ${s.color}`;
  }).join(', ');

  // Build copy value
  const copyValue = `box-shadow: ${cssBoxShadow}`;

  // Get first shadow for display info
  const firstShadow = shadows[0];
  const layerCount = shadows.length;

  return `
    <div class="shadow-row" data-copy="${escapeHtml(copyValue)}" style="cursor:pointer">
      <div class="shadow-preview" style="box-shadow: ${cssBoxShadow}"></div>
      <div class="shadow-info">
        <div class="token-name">${escapeHtml(name)}</div>
        <div class="shadow-meta">
          <span><span class="label">Color:</span> ${escapeHtml(firstShadow.color)}</span>
          <span><span class="label">Offset:</span> ${escapeHtml(firstShadow.offsetX)} ${escapeHtml(firstShadow.offsetY)}</span>
          <span><span class="label">Blur:</span> ${escapeHtml(firstShadow.blur)}</span>
          <span><span class="label">Spread:</span> ${escapeHtml(firstShadow.spread)}</span>
          ${layerCount > 1 ? `<span><span class="label">Layers:</span> ${layerCount}</span>` : ''}
          ${firstShadow.inset ? `<span>inset</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
