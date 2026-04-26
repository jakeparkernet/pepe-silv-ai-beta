// TextLayoutEngine.js

class TextLayoutEngine {
  /**
   * Layout text into positioned glyphs (world-space).
   *
   * @param {SDFont} font
   * @param {string} text
   * @param {object} options
   * @returns {{
   *   glyphs: Array<{
   *     char: string,
   *     x: number, y: number,     // world-space glyph origin (top-left)
   *     w: number, h: number,     // world-space quad size
   *     u0: number, v0: number,   // atlas UVs
   *     u1: number, v1: number,
   *     lineIndex: number
   *   }>,
   *   metrics: {
   *     width: number,
   *     height: number,
   *     lineCount: number,
   *     lineWidths: number[],
   *     minX: number,
   *     maxX: number,
   *     minY: number,
   *     maxY: number
   *   }
   * }}
   */
  static layoutText(font, text, options = {}) {
    const {
      fontSize = 1,
      maxWidth = null,
      wrapMode = "none",
      align = "center",
      letterSpacing = 0,
      lineHeightMult = 1.0
    } = options;

    if (!font || !font.size || !font.lineHeight) {
      throw new Error("TextLayoutEngine.layoutText: font with size and lineHeight is required.");
    }

    const scale = fontSize / font.size;
    const lineHeightWorld = font.lineHeight * lineHeightMult * scale;

    const lines = [];
    let currentLine = [];
    const lineWidths = [];

    // Single shared state for all helpers
    const state = {
      penX: 0,
      baselineY: 0,
      prevChar: null,
      currentLineWidth: 0
    };

    // Special-case empty text
    if (!text || text.length === 0) {
      return {
        glyphs: [],
        metrics: {
          width: 0,
          height: 0,
          lineCount: 0,
          lineWidths: [],
          minX: 0,
          maxX: 0,
          minY: 0,
          maxY: 0
        }
      };
    }

    if (wrapMode === "word" && maxWidth != null) {
      TextLayoutEngine._layoutWordWrapped(
        font,
        text,
        { scale, maxWidth, letterSpacing, lineHeightWorld },
        { lines, lineWidths, currentLine, state }
      );
    } else if (wrapMode === "char" && maxWidth != null) {
      TextLayoutEngine._layoutCharWrapped(
        font,
        text,
        { scale, maxWidth, letterSpacing, lineHeightWorld },
        { lines, lineWidths, currentLine, state }
      );
    } else {
      TextLayoutEngine._layoutNoWrap(
        font,
        text,
        { scale, letterSpacing, lineHeightWorld },
        { lines, lineWidths, currentLine, state }
      );
    }

    if (lines.length > 0 && lineWidths.length < lines.length) {
      lineWidths.push(state.currentLineWidth);
    }

    // Alignment + bounds in one pass
    const { glyphs, metrics } = TextLayoutEngine._alignAndComputeBounds(
      lines,
      lineWidths,
      align
    );

    return { glyphs, metrics };
  }

  // --- Internal helpers ---

  static _layoutNoWrap(font, text, params, ctx) {
    const { scale, letterSpacing, lineHeightWorld } = params;
    let { lines, lineWidths, currentLine, state } = ctx;
    let { penX, baselineY, prevChar, currentLineWidth } = state;

    // Start with one line
    if (lines.length === 0 && currentLine.length === 0) {
      lines.push(currentLine);
    }

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (ch === "\n") {
        // Finish current line & start a new one
        lineWidths.push(currentLineWidth);
        currentLine = [];
        currentLineWidth = 0;
        penX = 0;
        baselineY -= lineHeightWorld;
        prevChar = null;
        lines.push(currentLine);
        continue;
      }

      const glyph = font.getGlyph(ch);
      if (!glyph) {
        prevChar = ch;
        continue; // skip missing glyphs
      }

      const kerningUnits = font.getKerning(prevChar, ch);
      const kerningWorld = kerningUnits * scale;

      penX += kerningWorld;

      const x = penX + glyph.xOffset * scale;
      const y = baselineY + glyph.yOffset * scale;
      const w = glyph.width * scale;
      const h = glyph.height * scale;

      currentLine.push({
        char: ch,
        x,
        y,
        w,
        h,
        u0: glyph.u0,
        v0: glyph.v0,
        u1: glyph.u1,
        v1: glyph.v1,
        lineIndex: lines.length - 1
      });

      penX += glyph.xAdvance * scale + letterSpacing;
      currentLineWidth = penX;

      prevChar = ch;
    }

    // Update ctx state back (even though we commit later)
    ctx.state.penX = penX;
    ctx.state.baselineY = baselineY;
    ctx.state.prevChar = prevChar;
    ctx.state.currentLineWidth = currentLineWidth;
  }

  static _layoutCharWrapped(font, text, params, ctx) {
    const { scale, maxWidth, letterSpacing, lineHeightWorld } = params;
    let { lines, lineWidths, currentLine, commitLineRef, state } = ctx;
    let { penX, baselineY, prevChar, currentLineWidth } = state;

    const pushNewLine = () => {
      lineWidths.push(currentLineWidth);
      currentLine = [];
      currentLineWidth = 0;
      penX = 0;
      baselineY -= lineHeightWorld;
      prevChar = null;
      lines.push(currentLine);
    };

    // Start with one line
    if (lines.length === 0 && currentLine.length === 0) {
      lines.push(currentLine);
    }

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (ch === "\n") {
        pushNewLine();
        continue;
      }

      const glyph = font.getGlyph(ch);
      if (!glyph) {
        prevChar = ch;
        continue;
      }

      const kerningUnits = font.getKerning(prevChar, ch);
      const kerningWorld = kerningUnits * scale;

      const advance = kerningWorld + glyph.xAdvance * scale + letterSpacing;
      if (penX > 0 && penX + advance > maxWidth) {
        // wrap
        pushNewLine();
      }

      // recalc kerning for potentially reset prevChar
      const effectiveKerningUnits = font.getKerning(prevChar, ch);
      const effectiveKerningWorld = effectiveKerningUnits * scale;
      penX += effectiveKerningWorld;

      const x = penX + glyph.xOffset * scale;
      const y = baselineY + glyph.yOffset * scale;
      const w = glyph.width * scale;
      const h = glyph.height * scale;

      currentLine.push({
        char: ch,
        x,
        y,
        w,
        h,
        u0: glyph.u0,
        v0: glyph.v0,
        u1: glyph.u1,
        v1: glyph.v1,
        lineIndex: lines.length - 1
      });

      penX += glyph.xAdvance * scale + letterSpacing;
      currentLineWidth = penX;
      prevChar = ch;
    }

    ctx.state.penX = penX;
    ctx.state.baselineY = baselineY;
    ctx.state.prevChar = prevChar;
    ctx.state.currentLineWidth = currentLineWidth;
  }

  static _layoutWordWrapped(font, text, params, ctx) {
    const { scale, maxWidth, letterSpacing, lineHeightWorld } = params;
    let { lines, lineWidths, currentLine, state } = ctx;
    let { penX, baselineY, prevChar, currentLineWidth } = state;

    const pushNewLine = () => {
      lineWidths.push(currentLineWidth);
      currentLine = [];
      currentLineWidth = 0;
      penX = 0;
      baselineY -= lineHeightWorld;
      prevChar = null;
      lines.push(currentLine);
    };

    // Start with one line
    if (lines.length === 0 && currentLine.length === 0) {
      lines.push(currentLine);
    }

    // Split text into paragraphs on '\n'
    const paragraphs = text.split("\n");

    for (let p = 0; p < paragraphs.length; p++) {
      const paragraph = paragraphs[p];

      // tokens: words + whitespace chunks
      const tokens = paragraph.match(/\S+|\s+/g) || [];

      for (let t = 0; t < tokens.length; t++) {
        const token = tokens[t];
        const isWhitespace = /^\s+$/.test(token);

        // First, measure token width (simulate layout, no glyph pushes)
        const { advance: tokenAdvance } = TextLayoutEngine._measureToken(
          font,
          token,
          {
            scale,
            letterSpacing
          },
          prevChar
        );

        // Wrap before this token if needed (ignore pure whitespace as "line starters")
        if (!isWhitespace && maxWidth != null && penX > 0 && penX + tokenAdvance > maxWidth) {
          pushNewLine();
        }

        // Now layout token for real
        const placed = TextLayoutEngine._layoutToken(
          font,
          token,
          {
            scale,
            letterSpacing,
            baselineY,
            lineIndex: lines.length - 1,
            startPenX: penX,
            startPrevChar: prevChar
          }
        );

        // Append glyphs into currentLine
        for (let g = 0; g < placed.glyphs.length; g++) {
          currentLine.push(placed.glyphs[g]);
        }

        penX = placed.penX;
        prevChar = placed.prevChar;
        currentLineWidth = penX;
      }

      // End of paragraph: if not last paragraph, force newline
      if (p < paragraphs.length - 1) {
        pushNewLine();
      }
    }

    ctx.state.penX = penX;
    ctx.state.baselineY = baselineY;
    ctx.state.prevChar = prevChar;
    ctx.state.currentLineWidth = currentLineWidth;
  }

  /**
   * Simulate placing a token to get how far the pen would advance and the last character.
   */
  static _measureToken(font, token, params, prevChar) {
    const { scale, letterSpacing } = params;

    let penX = 0;
    let lastChar = prevChar;

    for (let i = 0; i < token.length; i++) {
      const ch = token[i];
      const glyph = font.getGlyph(ch);
      if (!glyph) {
        lastChar = ch;
        continue;
      }

      const kerningUnits = font.getKerning(lastChar, ch);
      const kerningWorld = kerningUnits * scale;
      penX += kerningWorld;
      penX += glyph.xAdvance * scale + letterSpacing;
      lastChar = ch;
    }

    return {
      advance: penX,
      lastChar
    };
  }

  /**
   * Actually layout a token, returning glyphs and updated pen state.
   */
  static _layoutToken(font, token, params) {
    const {
      scale,
      letterSpacing,
      baselineY,
      lineIndex,
      startPenX,
      startPrevChar
    } = params;

    let penX = startPenX;
    let prevChar = startPrevChar;
    const glyphs = [];

    for (let i = 0; i < token.length; i++) {
      const ch = token[i];
      const glyph = font.getGlyph(ch);
      if (!glyph) {
        prevChar = ch;
        continue;
      }

      const kerningUnits = font.getKerning(prevChar, ch);
      const kerningWorld = kerningUnits * scale;
      penX += kerningWorld;

      const x = penX + glyph.xOffset * scale;
      const y = baselineY + glyph.yOffset * scale;
      const w = glyph.width * scale;
      const h = glyph.height * scale;

      glyphs.push({
        char: ch,
        x,
        y,
        w,
        h,
        u0: glyph.u0,
        v0: glyph.v0,
        u1: glyph.u1,
        v1: glyph.v1,
        lineIndex
      });

      penX += glyph.xAdvance * scale + letterSpacing;
      prevChar = ch;
    }

    return {
      glyphs,
      penX,
      prevChar
    };
  }

  static _alignAndComputeBounds(lines, lineWidths, align) {
    if (lines.length === 0) {
      return {
        glyphs: [],
        metrics: {
          width: 0,
          height: 0,
          lineCount: 0,
          lineWidths: [],
          minX: 0,
          maxX: 0,
          minY: 0,
          maxY: 0
        }
      };
    }

    const lineCount = lines.length;
    const maxLineWidth = lineWidths.reduce(
      (max, w) => Math.max(max, w || 0),
      0
    );

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    const glyphs = [];

    for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
      const line = lines[lineIndex];
      const lineWidth = lineWidths[lineIndex] ?? 0;

      let shiftX = 0;
      if (align === "center") {
        shiftX = (maxLineWidth - lineWidth) * 0.5;
      } else if (align === "right") {
        shiftX = maxLineWidth - lineWidth;
      }

      for (let i = 0; i < line.length; i++) {
        const g = line[i];

        const x = g.x + shiftX;
        const y = g.y;
        const w = g.w;
        const h = g.h;

        const gx0 = x;
        const gx1 = x + w;
        const gy0 = y - h; // y is top, height extends downward
        const gy1 = y;

        if (gx0 < minX) minX = gx0;
        if (gx1 > maxX) maxX = gx1;
        if (gy0 < minY) minY = gy0;
        if (gy1 > maxY) maxY = gy1;

        glyphs.push({
          char: g.char,
          x,
          y,
          w,
          h,
          u0: g.u0,
          v0: g.v0,
          u1: g.u1,
          v1: g.v1,
          lineIndex
        });
      }
    }

    if (!Number.isFinite(minX)) {
      minX = maxX = minY = maxY = 0;
    }

    const width = maxX - minX;
    const height = maxY - minY;

    return {
      glyphs,
      metrics: {
        width,
        height,
        lineCount,
        lineWidths: lineWidths.slice(),
        minX,
        maxX,
        minY,
        maxY
      }
    };
  }
}

export { TextLayoutEngine };
