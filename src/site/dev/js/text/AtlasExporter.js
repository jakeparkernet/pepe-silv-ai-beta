// AtlasExporter.js

function downloadFile(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

class AtlasExporter {
    export(font, activeChars) {
        if (!font) return;

        const json =
            typeof font.toJSON === "function"
                ? font.toJSON()
                : { ...font, glyphs: font.glyphs || {} };

        if (Array.isArray(activeChars)) {
            json.meta = json.meta || {};
            json.meta.exportedGlyphs = activeChars;
        }

        const jsonBlob = new Blob([JSON.stringify(json, null, 2)], {
            type: "application/json"
        });
        const jsonName = `${font.family || "font"}-dynamic-sdf.json`;
        downloadFile(jsonName, jsonBlob);

        const canvas = font.atlasCanvas;
        if (!canvas) return;

        canvas.toBlob((blob) => {
            if (!blob) return;
            const pngName = `${font.family || "font"}-dynamic-sdf.png`;
            downloadFile(pngName, blob);
        }, "image/png");
    }
}

export { AtlasExporter };
