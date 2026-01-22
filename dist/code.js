"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __async = (__this, __arguments, generator) => {
    return new Promise((resolve, reject) => {
      var fulfilled = (value) => {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      };
      var rejected = (value) => {
        try {
          step(generator.throw(value));
        } catch (e) {
          reject(e);
        }
      };
      var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
      step((generator = generator.apply(__this, __arguments)).next());
    });
  };

  // src/code.ts
  var require_code = __commonJS({
    "src/code.ts"(exports) {
      figma.showUI(__html__, { width: 280, height: 180 });
      figma.ui.onmessage = (msg) => __async(exports, null, function* () {
        if (msg.type === "export-json" || msg.type === "export-html") {
          const file = yield exportTokens(msg.type === "export-html");
          const message = { type: "export-complete", files: file ? [file] : [] };
          figma.ui.postMessage(message);
        }
      });
      function exportTokens(asHtml) {
        return __async(this, null, function* () {
          const variables = yield figma.variables.getLocalVariablesAsync();
          const collections = yield figma.variables.getLocalVariableCollectionsAsync();
          const textStyles = yield figma.getLocalTextStylesAsync();
          const effectStyles = yield figma.getLocalEffectStylesAsync();
          if (collections.length === 0 && textStyles.length === 0 && effectStyles.length === 0) {
            return null;
          }
          const variablesByCollection = /* @__PURE__ */ new Map();
          for (const variable of variables) {
            const existing = variablesByCollection.get(variable.variableCollectionId) || [];
            existing.push(variable);
            variablesByCollection.set(variable.variableCollectionId, existing);
          }
          const variablePathMap = /* @__PURE__ */ new Map();
          for (const variable of variables) {
            const collection = collections.find((c) => c.id === variable.variableCollectionId);
            const collectionPrefix = collection ? sanitizeName(collection.name) : "";
            const variablePath = variable.name.split("/").map(sanitizeName).join(".");
            variablePathMap.set(variable.id, `${collectionPrefix}.${variablePath}`);
          }
          const merged = {};
          for (const collection of collections) {
            const collectionVariables = variablesByCollection.get(collection.id) || [];
            if (collectionVariables.length === 0) continue;
            const collectionKey = sanitizeName(collection.name);
            merged[collectionKey] = {};
            for (const mode of collection.modes) {
              const modeKey = sanitizeName(mode.name);
              const tokens = buildTokensForMode(collectionVariables, mode.modeId, variablePathMap, collection.name);
              merged[collectionKey][modeKey] = tokens;
            }
          }
          if (textStyles.length > 0) {
            const { primitives, composites } = buildTypographyTokensWithPrimitives(textStyles);
            merged["font"] = primitives;
            merged["typography"] = composites;
          }
          if (effectStyles.length > 0) {
            const shadowTokens = buildShadowTokens(effectStyles);
            merged["Shadows"] = { "Default": shadowTokens };
          }
          const ordered = orderTokenGroups(merged);
          const sorted = sortPrimitivesBeforeAliases(ordered);
          const fileUrl = figma.fileKey ? `https://www.figma.com/file/${figma.fileKey}` : null;
          const fileName = figma.root.name;
          if (asHtml) {
            return { filename: "tokens-preview.html", content: generateHtmlPreview(sorted, fileUrl, fileName) };
          } else {
            return { filename: "tokens.json", content: JSON.stringify(sorted, null, 2) };
          }
        });
      }
      function buildTokensForMode(variables, modeId, variablePathMap, collectionName) {
        const root = {};
        for (const variable of variables) {
          const value = variable.valuesByMode[modeId];
          if (value === void 0) continue;
          const pathParts = variable.name.split("/").map(sanitizeName);
          const token = convertToW3CToken(variable, value, variablePathMap, collectionName);
          setNestedValue(root, pathParts, token);
        }
        return root;
      }
      function convertToW3CToken(variable, value, variablePathMap, currentCollection) {
        if (isVariableAlias(value)) {
          const aliasPath = variablePathMap.get(value.id);
          if (aliasPath) {
            const currentPrefix = sanitizeName(currentCollection) + ".";
            const displayPath = aliasPath.startsWith(currentPrefix) ? aliasPath.slice(currentPrefix.length) : aliasPath;
            return {
              $value: `{${displayPath}}`,
              $type: mapFigmaType(variable.resolvedType)
            };
          }
        }
        switch (variable.resolvedType) {
          case "COLOR":
            return {
              $value: convertColor(value),
              $type: "color"
            };
          case "FLOAT":
            return {
              $value: value,
              $type: "number"
            };
          case "STRING":
            return {
              $value: value,
              $type: "string"
            };
          case "BOOLEAN":
            return {
              $value: value,
              $type: "boolean"
            };
          default:
            return {
              $value: String(value),
              $type: "string"
            };
        }
      }
      function convertColor(rgba) {
        var _a;
        const r = Math.round(rgba.r * 255);
        const g = Math.round(rgba.g * 255);
        const b = Math.round(rgba.b * 255);
        const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
        return {
          colorSpace: "srgb",
          components: [rgba.r, rgba.g, rgba.b],
          alpha: (_a = rgba.a) != null ? _a : 1,
          hex
        };
      }
      function mapFigmaType(resolvedType) {
        switch (resolvedType) {
          case "COLOR":
            return "color";
          case "FLOAT":
            return "number";
          case "STRING":
            return "string";
          case "BOOLEAN":
            return "boolean";
          default:
            return "string";
        }
      }
      function isVariableAlias(value) {
        return typeof value === "object" && value !== null && "type" in value && value.type === "VARIABLE_ALIAS";
      }
      function sanitizeName(name) {
        return name.replace(/[{}.]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      }
      function buildTypographyTokensWithPrimitives(textStyles) {
        const extracted = textStyles.map(extractTypographyData);
        const uniqueFamilies = [...new Set(extracted.map((e) => e.family))];
        const uniqueSizes = [...new Set(extracted.map((e) => e.size))].sort((a, b) => parseFloat(a) - parseFloat(b));
        const uniqueWeights = [...new Set(extracted.map((e) => e.weight))].sort((a, b) => a - b);
        const uniqueLineHeights = [...new Set(extracted.map((e) => e.lineHeight))].sort((a, b) => {
          if (a === "normal") return -1;
          if (b === "normal") return 1;
          return parseFloat(a) - parseFloat(b);
        });
        const uniqueLetterSpacings = [...new Set(extracted.map((e) => e.letterSpacing))].sort((a, b) => {
          return parseFloat(a) - parseFloat(b);
        });
        const primitiveMaps = {
          families: generateFamilyNames(uniqueFamilies),
          sizes: generateSizeNames(uniqueSizes),
          weights: generateWeightNames(uniqueWeights),
          lineHeights: generateLineHeightNames(uniqueLineHeights),
          letterSpacings: generateLetterSpacingNames(uniqueLetterSpacings)
        };
        const primitives = {
          family: buildFamilyTokens(primitiveMaps.families),
          size: buildSizeTokens(primitiveMaps.sizes),
          weight: buildWeightTokens(primitiveMaps.weights),
          lineHeight: buildLineHeightTokens(primitiveMaps.lineHeights),
          letterSpacing: buildLetterSpacingTokens(primitiveMaps.letterSpacings)
        };
        const composites = {};
        for (const data of extracted) {
          const flatName = data.styleName.split("/").map(sanitizeName).join("-").toLowerCase();
          const token = buildCompositeTypographyToken(data, primitiveMaps);
          composites[flatName] = token;
        }
        return { primitives, composites };
      }
      function extractTypographyData(style) {
        const fontName = style.fontName;
        const fontSize = style.fontSize;
        const letterSpacing = style.letterSpacing;
        const lineHeight = style.lineHeight;
        let letterSpacingStr = "0";
        if (letterSpacing.unit === "PIXELS") {
          letterSpacingStr = `${letterSpacing.value}px`;
        } else if (letterSpacing.unit === "PERCENT") {
          letterSpacingStr = `${letterSpacing.value}%`;
        }
        let lineHeightStr = "normal";
        if (lineHeight.unit === "PIXELS") {
          lineHeightStr = `${lineHeight.value}px`;
        } else if (lineHeight.unit === "PERCENT") {
          lineHeightStr = `${lineHeight.value}%`;
        }
        const fontStyle = fontName.style.toLowerCase();
        let fontWeight = 400;
        if (fontStyle.includes("thin") || fontStyle.includes("hairline")) {
          fontWeight = 100;
        } else if (fontStyle.includes("extralight") || fontStyle.includes("ultra light")) {
          fontWeight = 200;
        } else if (fontStyle.includes("light")) {
          fontWeight = 300;
        } else if (fontStyle.includes("medium")) {
          fontWeight = 500;
        } else if (fontStyle.includes("semibold") || fontStyle.includes("semi bold") || fontStyle.includes("demi")) {
          fontWeight = 600;
        } else if (fontStyle.includes("extrabold") || fontStyle.includes("ultra bold")) {
          fontWeight = 800;
        } else if (fontStyle.includes("bold")) {
          fontWeight = 700;
        } else if (fontStyle.includes("black") || fontStyle.includes("heavy")) {
          fontWeight = 900;
        }
        return {
          family: fontName.family,
          size: `${fontSize}px`,
          weight: fontWeight,
          lineHeight: lineHeightStr,
          letterSpacing: letterSpacingStr,
          styleName: style.name,
          description: style.description || void 0
        };
      }
      function generateFamilyNames(families) {
        const map = /* @__PURE__ */ new Map();
        for (const family of families) {
          const lower = family.toLowerCase();
          let name;
          if (lower.includes("mono") || lower.includes("code") || lower.includes("consola") || lower.includes("courier")) {
            name = "mono";
          } else if (lower.includes("serif") && !lower.includes("sans")) {
            name = "serif";
          } else {
            name = "sans";
          }
          if ([...map.values()].includes(name)) {
            let i = 2;
            while ([...map.values()].includes(`${name}-${i}`)) i++;
            name = `${name}-${i}`;
          }
          map.set(family, name);
        }
        return map;
      }
      function generateSizeNames(sizes) {
        const map = /* @__PURE__ */ new Map();
        const scaleNames = ["xs", "sm", "base", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"];
        const baseIndex = sizes.findIndex((s) => {
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
      function generateWeightNames(weights) {
        const map = /* @__PURE__ */ new Map();
        const weightNames = {
          100: "thin",
          200: "extralight",
          300: "light",
          400: "regular",
          500: "medium",
          600: "semibold",
          700: "bold",
          800: "extrabold",
          900: "black"
        };
        for (const weight of weights) {
          map.set(weight, weightNames[weight] || `w${weight}`);
        }
        return map;
      }
      function generateLineHeightNames(lineHeights) {
        const map = /* @__PURE__ */ new Map();
        const scaleNames = ["none", "tight", "snug", "normal", "relaxed", "loose"];
        lineHeights.forEach((lh, i) => {
          if (lh === "normal") {
            map.set(lh, "normal");
          } else {
            const adjustedIndex = lineHeights[0] === "normal" ? i : i + 1;
            const name = adjustedIndex < scaleNames.length ? scaleNames[adjustedIndex] : `${adjustedIndex}`;
            map.set(lh, name);
          }
        });
        return map;
      }
      function generateLetterSpacingNames(letterSpacings) {
        const map = /* @__PURE__ */ new Map();
        const scaleNames = ["tighter", "tight", "normal", "wide", "wider", "widest"];
        const normalIndex = letterSpacings.findIndex((ls) => parseFloat(ls) === 0);
        const startIndex = normalIndex >= 0 ? Math.max(0, 2 - normalIndex) : 0;
        letterSpacings.forEach((ls, i) => {
          const nameIndex = startIndex + i;
          const name = nameIndex < scaleNames.length ? scaleNames[nameIndex] : `spacing-${nameIndex}`;
          map.set(ls, name);
        });
        return map;
      }
      function buildFamilyTokens(families) {
        const tokens = {};
        for (const [value, name] of families) {
          tokens[name] = { $value: value, $type: "fontFamily" };
        }
        return tokens;
      }
      function buildSizeTokens(sizes) {
        const tokens = {};
        for (const [value, name] of sizes) {
          tokens[name] = { $value: value, $type: "dimension" };
        }
        return tokens;
      }
      function buildWeightTokens(weights) {
        const tokens = {};
        for (const [value, name] of weights) {
          tokens[name] = { $value: value, $type: "fontWeight" };
        }
        return tokens;
      }
      function buildLineHeightTokens(lineHeights) {
        const tokens = {};
        for (const [value, name] of lineHeights) {
          tokens[name] = { $value: value, $type: "dimension" };
        }
        return tokens;
      }
      function buildLetterSpacingTokens(letterSpacings) {
        const tokens = {};
        for (const [value, name] of letterSpacings) {
          tokens[name] = { $value: value, $type: "dimension" };
        }
        return tokens;
      }
      function buildCompositeTypographyToken(data, maps) {
        const familyRef = `{font.family.${maps.families.get(data.family)}}`;
        const sizeRef = `{font.size.${maps.sizes.get(data.size)}}`;
        const weightRef = `{font.weight.${maps.weights.get(data.weight)}}`;
        const lineHeightRef = `{font.lineHeight.${maps.lineHeights.get(data.lineHeight)}}`;
        const letterSpacingRef = `{font.letterSpacing.${maps.letterSpacings.get(data.letterSpacing)}}`;
        const typographyValue = {
          fontFamily: familyRef,
          fontSize: sizeRef,
          fontWeight: weightRef,
          lineHeight: lineHeightRef,
          letterSpacing: letterSpacingRef
        };
        return {
          $value: typographyValue,
          $type: "typography",
          $description: data.description
        };
      }
      function buildShadowTokens(effectStyles) {
        const root = {};
        for (const style of effectStyles) {
          const shadowEffects = style.effects.filter(
            (e) => e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW"
          );
          if (shadowEffects.length === 0) continue;
          const pathParts = style.name.split("/").map(sanitizeName);
          const token = convertEffectStyleToToken(style, shadowEffects);
          setNestedValue(root, pathParts, token);
        }
        return root;
      }
      function convertEffectStyleToToken(style, shadowEffects) {
        const shadows = shadowEffects.filter((effect) => effect.visible !== false).map((effect) => {
          var _a, _b;
          const color = effect.color;
          const r = Math.round(color.r * 255);
          const g = Math.round(color.g * 255);
          const b = Math.round(color.b * 255);
          const a = (_a = color.a) != null ? _a : 1;
          const colorStr = a < 1 ? `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})` : `rgb(${r}, ${g}, ${b})`;
          return {
            color: colorStr,
            offsetX: `${effect.offset.x}px`,
            offsetY: `${effect.offset.y}px`,
            blur: `${effect.radius}px`,
            spread: `${(_b = effect.spread) != null ? _b : 0}px`,
            inset: effect.type === "INNER_SHADOW"
          };
        });
        const value = shadows.length === 1 ? shadows[0] : shadows;
        return {
          $value: value,
          $type: "shadow",
          $description: style.description || void 0
        };
      }
      function orderTokenGroups(tokens) {
        const categoryPatterns = [
          /^color/i,
          // Colors
          /^typography$|^font$/i,
          // Typography (composites and primitives)
          /spacing|dimension|size|width|height|gap/i,
          // Spacing
          /shadow|elevation/i,
          // Shadows
          /border|radius|stroke/i
          // Borders
        ];
        const keys = Object.keys(tokens);
        const categorized = /* @__PURE__ */ new Set();
        const categoryGroups = categoryPatterns.map(() => []);
        const uncategorizedKeys = [];
        for (const key of keys) {
          let matched = false;
          for (let i = 0; i < categoryPatterns.length; i++) {
            if (categoryPatterns[i].test(key)) {
              categoryGroups[i].push(key);
              categorized.add(key);
              matched = true;
              break;
            }
          }
          if (!matched) {
            uncategorizedKeys.push(key);
          }
        }
        function groupHasReferences(data) {
          for (const value of Object.values(data)) {
            if (isToken(value)) {
              if (isReferenceValue(value.$value)) {
                return true;
              }
            } else if (typeof value === "object" && value !== null) {
              if (groupHasReferences(value)) {
                return true;
              }
            }
          }
          return false;
        }
        for (const group of categoryGroups) {
          group.sort((a, b) => {
            const aHasRefs = groupHasReferences(tokens[a]);
            const bHasRefs = groupHasReferences(tokens[b]);
            if (aHasRefs === bHasRefs) return 0;
            return aHasRefs ? 1 : -1;
          });
        }
        const orderedKeys = [...categoryGroups.flat(), ...uncategorizedKeys];
        const ordered = {};
        for (const key of orderedKeys) {
          ordered[key] = tokens[key];
        }
        return ordered;
      }
      function sortPrimitivesBeforeAliases(tokens) {
        const sorted = {};
        const entries = Object.entries(tokens);
        const tokenEntries = [];
        const groupEntries = [];
        for (const [key, value] of entries) {
          if (isToken(value)) {
            tokenEntries.push([key, value]);
          } else if (typeof value === "object" && value !== null) {
            groupEntries.push([key, value]);
          }
        }
        tokenEntries.sort((a, b) => {
          const aIsRef = isReferenceValue(a[1].$value);
          const bIsRef = isReferenceValue(b[1].$value);
          if (aIsRef === bIsRef) return 0;
          return aIsRef ? 1 : -1;
        });
        for (const [key, value] of tokenEntries) {
          sorted[key] = value;
        }
        for (const [key, value] of groupEntries) {
          sorted[key] = sortPrimitivesBeforeAliases(value);
        }
        return sorted;
      }
      function isReferenceValue(value) {
        if (typeof value === "string" && value.startsWith("{")) {
          return true;
        }
        if (typeof value === "object" && value !== null) {
          const obj = value;
          for (const v of Object.values(obj)) {
            if (typeof v === "string" && v.startsWith("{")) {
              return true;
            }
          }
        }
        return false;
      }
      function setNestedValue(obj, path, value) {
        let current = obj;
        for (let i = 0; i < path.length - 1; i++) {
          const key = path[i];
          if (!(key in current)) {
            current[key] = {};
          }
          current = current[key];
        }
        current[path[path.length - 1]] = value;
      }
      function buildColorLookup(tokens, path = []) {
        var _a;
        const lookup = /* @__PURE__ */ new Map();
        for (const [key, value] of Object.entries(tokens)) {
          const currentPath = [...path, key];
          if (isToken(value)) {
            const token = value;
            if (token.$type === "color" && typeof token.$value === "object" && token.$value !== null && "hex" in token.$value) {
              const colorVal = token.$value;
              const colorData = {
                hex: colorVal.hex || "#000000",
                alpha: (_a = colorVal.alpha) != null ? _a : 1
              };
              const fullPath = currentPath.join(".");
              lookup.set(fullPath, colorData);
              if (currentPath.length > 2) {
                lookup.set(currentPath.slice(2).join("."), colorData);
              }
              if (currentPath.length > 1) {
                lookup.set(currentPath.slice(1).join("."), colorData);
              }
              if (currentPath.length >= 2) {
                lookup.set(currentPath.slice(-2).join("."), colorData);
              }
              if (currentPath.length >= 3) {
                lookup.set(currentPath.slice(-3).join("."), colorData);
              }
            }
          } else if (typeof value === "object" && value !== null) {
            const nested = buildColorLookup(value, currentPath);
            nested.forEach((v, k) => lookup.set(k, v));
          }
        }
        return lookup;
      }
      function resolveColorReference(ref, lookup) {
        const key = ref.replace(/^\{|\}$/g, "");
        const keyParts = key.split(".");
        if (lookup.has(key)) {
          return lookup.get(key);
        }
        for (const [lookupKey, value] of lookup.entries()) {
          if (lookupKey.endsWith("." + key) || lookupKey === key) {
            return value;
          }
          const lookupParts = lookupKey.split(".");
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
      var colorLookup;
      var fontPrimitiveLookup;
      function buildFontPrimitiveLookup(tokens, path = []) {
        const lookup = /* @__PURE__ */ new Map();
        for (const [key, value] of Object.entries(tokens)) {
          const currentPath = [...path, key];
          if (isToken(value)) {
            const token = value;
            if (token.$type === "fontFamily" || token.$type === "dimension" || token.$type === "fontWeight") {
              const fullPath = currentPath.join(".");
              lookup.set(fullPath, token.$value);
            }
          } else if (typeof value === "object" && value !== null) {
            const nested = buildFontPrimitiveLookup(value, currentPath);
            nested.forEach((v, k) => lookup.set(k, v));
          }
        }
        return lookup;
      }
      function resolveFontReference(ref) {
        if (ref === void 0 || ref === null) return "";
        if (typeof ref === "number") return ref;
        if (typeof ref !== "string") return String(ref);
        if (!ref.startsWith("{")) return ref;
        const key = ref.slice(1, -1);
        const resolved = fontPrimitiveLookup.get(key);
        return resolved !== void 0 ? resolved : ref;
      }
      function generateHtmlPreview(tokens, fileUrl, fileName) {
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
    .category-title {
      font-size: 16px;
      font-weight: 600;
      padding: 12px 16px;
      background: linear-gradient(to right, #1a1a1a, #2d2d2d);
      color: #ffffff;
      border-radius: 6px;
      margin-bottom: 20px;
      letter-spacing: 0.3px;
    }
    .mode-title {
      font-size: 14px;
      font-weight: 600;
      color: #333;
      padding: 8px 0;
      margin-bottom: 16px;
      border-bottom: 1px solid #e0e0e0;
    }
    .mode-section {
      margin-bottom: 32px;
    }
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
        const highLevelCategories = [
          { name: "Colors", pattern: /^color/i },
          { name: "Typography", pattern: /^typography$|^font$/i },
          { name: "Spacing", pattern: /spacing|dimension|size|width|height|gap/i },
          { name: "Shadows", pattern: /shadow|elevation/i },
          { name: "Borders", pattern: /border|radius|stroke/i }
        ];
        const categorizedCollections = /* @__PURE__ */ new Map();
        const uncategorized = [];
        for (const [collectionName, collectionData] of Object.entries(tokens)) {
          if (typeof collectionData !== "object" || collectionData === null) continue;
          let matched = false;
          for (const category of highLevelCategories) {
            if (category.pattern.test(collectionName)) {
              if (!categorizedCollections.has(category.name)) {
                categorizedCollections.set(category.name, []);
              }
              categorizedCollections.get(category.name).push([collectionName, collectionData]);
              matched = true;
              break;
            }
          }
          if (!matched) {
            uncategorized.push([collectionName, collectionData]);
          }
        }
        let sidebarItems = [];
        let sectionsHtml = "";
        function renderCollectionContent(collectionName, collectionData, categoryName) {
          let html = "";
          const entries = Object.entries(collectionData);
          const basePath = [categoryName, collectionName];
          const hasDirectTokens = entries.some(([_, value]) => isToken(value));
          if (hasDirectTokens) {
            html += renderTokenGroup(collectionData, basePath);
          } else {
            for (const [modeName, modeData] of entries) {
              if (typeof modeData !== "object" || modeData === null) continue;
              html += `
          <div class="mode-section">
            <div class="mode-title">${escapeHtml(modeName)}</div>
            ${renderTokenGroup(modeData, basePath)}
          </div>
        `;
            }
          }
          return html;
        }
        function collectionHasReferences(data) {
          for (const value of Object.values(data)) {
            if (isToken(value)) {
              if (isReferenceValue(value.$value)) {
                return true;
              }
            } else if (typeof value === "object" && value !== null) {
              if (collectionHasReferences(value)) {
                return true;
              }
            }
          }
          return false;
        }
        for (const category of highLevelCategories) {
          const collections = categorizedCollections.get(category.name);
          if (!collections || collections.length === 0) continue;
          collections.sort((a, b) => {
            const aHasRefs = collectionHasReferences(a[1]);
            const bHasRefs = collectionHasReferences(b[1]);
            if (aHasRefs === bHasRefs) return 0;
            return aHasRefs ? 1 : -1;
          });
          const categoryId = category.name.toLowerCase();
          sidebarItems.push(`<a href="#${categoryId}">${escapeHtml(category.name)}</a>`);
          sectionsHtml += `
      <section id="${categoryId}">
        <div class="category-title">${escapeHtml(category.name)}</div>
    `;
          for (const [collectionName, collectionData] of collections) {
            sectionsHtml += renderCollectionContent(collectionName, collectionData, category.name);
          }
          sectionsHtml += `</section>`;
        }
        if (uncategorized.length > 0) {
          sidebarItems.push(`<a href="#other">Other</a>`);
          sectionsHtml += `
      <section id="other">
        <div class="category-title">Other</div>
    `;
          for (const [collectionName, collectionData] of uncategorized) {
            sectionsHtml += renderCollectionContent(collectionName, collectionData, "Other");
          }
          sectionsHtml += `</section>`;
        }
        const sidebarHtml = sidebarItems.join("\n");
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(fileName)} design tokens</title>
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
      <h1>${escapeHtml(fileName)} design tokens</h1>
      <p class="subtitle">${fileUrl ? `<a href="${fileUrl}" target="_blank" style="color: #0d99ff;">Open in Figma \u2197</a> \xB7 ` : ""}Click any value to copy.</p>
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
  <\/script>
</body>
</html>`;
      }
      function renderTokenGroup(group, path) {
        let html = "";
        const colorTokens = [];
        const typographyTokens = [];
        const shadowTokens = [];
        const numberTokens = [];
        const stringTokens = [];
        const subgroups = [];
        for (const [key, value] of Object.entries(group)) {
          if (isToken(value)) {
            const token = value;
            if (token.$type === "color") {
              colorTokens.push({ name: key, token });
            } else if (token.$type === "typography") {
              typographyTokens.push({ name: key, token });
            } else if (token.$type === "shadow") {
              shadowTokens.push({ name: key, token });
            } else if (token.$type === "number" || token.$type === "fontWeight") {
              numberTokens.push({ name: key, token });
            } else if (token.$type === "dimension" || token.$type === "fontFamily") {
              stringTokens.push({ name: key, token });
            } else {
              stringTokens.push({ name: key, token });
            }
          } else if (typeof value === "object" && value !== null) {
            subgroups.push({ name: key, group: value });
          }
        }
        if (colorTokens.length > 0) {
          const isPalette = colorTokens.every((t) => /^\d+$/.test(t.name)) && colorTokens.length > 3;
          if (isPalette) {
            colorTokens.sort((a, b) => parseInt(a.name) - parseInt(b.name));
            html += `<div class="color-palette">`;
            for (const { name, token } of colorTokens) {
              const colorVal = getColorDisplay(token);
              if (!colorVal.hex) continue;
              html += `
          <div class="palette-swatch" data-copy="${escapeHtml(colorVal.copyValue)}" style="cursor:pointer">
            <div class="color-swatch ${colorVal.alpha < 1 ? "transparent" : ""}">
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
        if (typographyTokens.length > 0) {
          for (const { name, token } of typographyTokens) {
            html += renderTypographyToken(name, token);
          }
        }
        if (shadowTokens.length > 0) {
          for (const { name, token } of shadowTokens) {
            html += renderShadowToken(name, token);
          }
        }
        if (numberTokens.length > 0) {
          numberTokens.sort((a, b) => {
            const valA = typeof a.token.$value === "number" ? a.token.$value : 0;
            const valB = typeof b.token.$value === "number" ? b.token.$value : 0;
            return valA - valB;
          });
          const pathLower = path.map((p) => p.toLowerCase()).join(".");
          const isSpacing = pathLower.includes("spacing") || pathLower.includes("gap");
          const isBorder = pathLower.includes("border") || pathLower.includes("radius") || pathLower.includes("stroke");
          html += `<div class="token-grid">`;
          for (const { name, token } of numberTokens) {
            html += renderNumberToken(name, token, isSpacing, isBorder);
          }
          html += `</div>`;
        }
        if (stringTokens.length > 0) {
          html += `<div class="token-grid">`;
          for (const { name, token } of stringTokens) {
            html += renderStringToken(name, token);
          }
          html += `</div>`;
        }
        for (const { name, group: subgroup } of subgroups) {
          html += `<div class="subsection-title">${escapeHtml(name)}</div>`;
          html += renderTokenGroup(subgroup, [...path, name]);
        }
        return html;
      }
      function isToken(value) {
        return typeof value === "object" && value !== null && "$value" in value && "$type" in value;
      }
      function getColorDisplay(token) {
        var _a;
        const value = token.$value;
        if (typeof value === "string" && value.startsWith("{")) {
          const resolved = resolveColorReference(value, colorLookup);
          if (resolved) {
            const cssColor = resolved.alpha < 1 ? `${resolved.hex}${Math.round(resolved.alpha * 255).toString(16).padStart(2, "0")}` : resolved.hex;
            return { hex: resolved.hex, alpha: resolved.alpha, cssColor, copyValue: resolved.hex, isReference: true, refPath: value };
          }
          return { hex: "", alpha: 1, cssColor: "transparent", copyValue: value, isReference: true, refPath: value };
        }
        if (typeof value === "object" && value !== null && "hex" in value) {
          const colorVal = value;
          const alpha = (_a = colorVal.alpha) != null ? _a : 1;
          const hex = colorVal.hex || "#000000";
          const cssColor = alpha < 1 ? `${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}` : hex;
          return { hex, alpha, cssColor, copyValue: hex, isReference: false, refPath: "" };
        }
        return { hex: "", alpha: 1, cssColor: "transparent", copyValue: "", isReference: false, refPath: "" };
      }
      function renderColorToken(name, token) {
        const colorVal = getColorDisplay(token);
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
        let displayValue = colorVal.hex;
        if (colorVal.alpha < 1) {
          displayValue = `${colorVal.hex} (${Math.round(colorVal.alpha * 100)}%)`;
        }
        if (colorVal.isReference && colorVal.refPath) {
          displayValue = `${displayValue} \u2192 ${colorVal.refPath}`;
        }
        return `
    <div class="token-row" data-copy="${escapeHtml(colorVal.copyValue)}" style="cursor:pointer">
      <div class="color-swatch ${colorVal.alpha < 1 ? "transparent" : ""}">
        <div class="color-swatch-inner" style="background-color: ${colorVal.cssColor}"></div>
      </div>
      <div class="token-info">
        <div class="token-name">${escapeHtml(name)}</div>
        <div class="token-value ${colorVal.isReference ? "reference" : ""}">${escapeHtml(displayValue)}</div>
      </div>
    </div>
  `;
      }
      function renderNumberToken(name, token, isSpacing, isBorder) {
        const value = typeof token.$value === "number" ? token.$value : 0;
        const isFontWeight = token.$type === "fontWeight";
        const displayValue = isFontWeight ? String(value) : `${value}px`;
        if (isFontWeight) {
          return `
      <div class="token-row" data-copy="${value}" style="cursor:pointer">
        <div class="number-preview" style="font-weight: ${value}; font-size: 14px;">
          Aa
        </div>
        <div class="token-info">
          <div class="token-name">${escapeHtml(name)}</div>
          <div class="token-value">${value}</div>
        </div>
      </div>
    `;
        }
        if (isSpacing) {
          const barWidth = Math.min(Math.max(value * 2, 4), 100);
          return `
      <div class="token-row" data-copy="${displayValue}" style="cursor:pointer">
        <div class="spacing-preview-container">
          <div class="spacing-bar" style="width: ${barWidth}px; height: 8px;"></div>
        </div>
        <div class="token-info">
          <div class="token-name">${escapeHtml(name)}</div>
          <div class="token-value">${displayValue}</div>
        </div>
      </div>
    `;
        }
        if (isBorder) {
          const previewRadius = Math.min(value, 20);
          return `
      <div class="token-row" data-copy="${displayValue}" style="cursor:pointer">
        <div class="number-preview radius-preview" style="border-radius: ${previewRadius}px;">
          ${value}
        </div>
        <div class="token-info">
          <div class="token-name">${escapeHtml(name)}</div>
          <div class="token-value">${displayValue}</div>
        </div>
      </div>
    `;
        }
        return `
    <div class="token-row" data-copy="${displayValue}" style="cursor:pointer">
      <div class="number-preview" style="font-size: 12px; font-weight: 500;">
        ${value}
      </div>
      <div class="token-info">
        <div class="token-name">${escapeHtml(name)}</div>
        <div class="token-value">${displayValue}</div>
      </div>
    </div>
  `;
      }
      function renderStringToken(name, token) {
        var _a;
        let value;
        if (typeof token.$value === "object" && token.$value !== null) {
          value = JSON.stringify(token.$value);
        } else {
          value = String((_a = token.$value) != null ? _a : "");
        }
        const isFontFamily = token.$type === "fontFamily";
        const isDimension = token.$type === "dimension";
        let preview = "Aa";
        let previewStyle = "font-size: 10px;";
        if (token.$type === "boolean") {
          preview = token.$value ? "\u2713" : "\u2717";
        } else if (isFontFamily) {
          preview = "Aa";
          previewStyle = `font-family: "${escapeHtml(value)}", -apple-system, BlinkMacSystemFont, sans-serif; font-size: 16px;`;
        } else if (isDimension) {
          preview = escapeHtml(value);
          previewStyle = "font-size: 12px; font-weight: 600; color: #333;";
        }
        return `
    <div class="token-row" data-copy="${escapeHtml(value)}" style="cursor:pointer">
      <div class="number-preview" style="${previewStyle}">
        ${preview}
      </div>
      <div class="token-info">
        <div class="token-name">${escapeHtml(name)}</div>
        <div class="token-value">${escapeHtml(value)}</div>
      </div>
    </div>
  `;
      }
      function renderTypographyToken(name, token) {
        var _a;
        const typo = token.$value;
        if (!typo || typeof typo !== "object" || !typo.fontFamily) {
          const rawValue = typeof token.$value === "object" ? JSON.stringify(token.$value) : String((_a = token.$value) != null ? _a : "");
          return `
      <div class="token-row" data-copy="${escapeHtml(rawValue)}" style="cursor:pointer">
        <div class="number-preview" style="font-size: 10px;">Aa</div>
        <div class="token-info">
          <div class="token-name">${escapeHtml(name)}</div>
          <div class="token-value">${escapeHtml(rawValue)}</div>
        </div>
      </div>
    `;
        }
        const resolvedFamily = String(resolveFontReference(typo.fontFamily));
        let resolvedSize = String(resolveFontReference(typo.fontSize));
        const resolvedWeight = resolveFontReference(typo.fontWeight);
        const resolvedLineHeight = String(resolveFontReference(typo.lineHeight));
        const resolvedLetterSpacing = String(resolveFontReference(typo.letterSpacing));
        if (!resolvedSize || resolvedSize.startsWith("{")) {
          resolvedSize = "16px";
        }
        if (resolvedSize && !resolvedSize.includes("px") && !resolvedSize.includes("%") && !resolvedSize.includes("em") && !resolvedSize.includes("rem")) {
          const num = parseFloat(resolvedSize);
          if (!isNaN(num)) {
            resolvedSize = `${num}px`;
          }
        }
        const sizeNum = parseFloat(resolvedSize);
        const cappedSize = !isNaN(sizeNum) ? `${Math.min(sizeNum, 48)}px` : "16px";
        const previewStyle = `font-family: '${resolvedFamily}', -apple-system, BlinkMacSystemFont, sans-serif; font-size: ${cappedSize}; font-weight: ${resolvedWeight}; line-height: ${resolvedLineHeight}; letter-spacing: ${resolvedLetterSpacing}`;
        const copyValue = `font-family: ${resolvedFamily}, -apple-system, BlinkMacSystemFont, sans-serif; font-size: ${resolvedSize}; font-weight: ${resolvedWeight}; line-height: ${resolvedLineHeight}; letter-spacing: ${resolvedLetterSpacing}`;
        const isRef = (val) => typeof val === "string" && val.startsWith("{");
        const formatValue = (ref, resolved) => {
          if (isRef(ref)) {
            return `${resolved} <span style="color:#939393">${escapeHtml(ref)}</span>`;
          }
          return String(resolved);
        };
        return `
    <div class="typography-row" data-copy="${escapeHtml(copyValue)}" style="cursor:pointer">
      <div class="token-name">${escapeHtml(name)}</div>
      <div class="typography-preview" style="${previewStyle}" title="Size: ${cappedSize}">
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
      function renderShadowToken(name, token) {
        const value = token.$value;
        const shadows = Array.isArray(value) ? value : [value];
        const cssBoxShadow = shadows.map((s) => {
          const inset = s.inset ? "inset " : "";
          return `${inset}${s.offsetX} ${s.offsetY} ${s.blur} ${s.spread} ${s.color}`;
        }).join(", ");
        const copyValue = `box-shadow: ${cssBoxShadow}`;
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
          ${layerCount > 1 ? `<span><span class="label">Layers:</span> ${layerCount}</span>` : ""}
          ${firstShadow.inset ? `<span>inset</span>` : ""}
        </div>
      </div>
    </div>
  `;
      }
      function escapeHtml(str) {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      }
    }
  });
  require_code();
})();
