import * as THREE from "three";
import { OBB } from "../thirdparty/three.js-r181/examples/jsm/math/OBB.js";
import { Paper } from "../components/Paper.js";
import { View } from "./View.js";
import { TextService } from "../services/TextService.js";
import { InputService } from "../services/InputService.js";

class EvidenceView extends View {
    constructor(options = {}) {
        super();

        this.updateLines = this.updateLines.bind(this);
        this.getCollider = this.getCollider.bind(this);
        this.onClick = this.onClick.bind(this);
        this.paper = new Paper(options.paperOptions ?? options.paper ?? {});
        this.addToRoot(this.paper.getRootGroup());

        this.textContainer = new THREE.Group();
        this.rootGroup.add(this.textContainer);

        this.textContainer.position.set(0, 0, 0);
        this.textContainer.scale.set(1, 1, 1);
        this.textContainer.quaternion.set(0, 0, 0, 1);
        this.textObjects = new Map();

        this.fontMult = 0.01;
        this.headerSize = 1;
        this.contentSize = 0.8;

        this.headerX = -4.2;
        this.contentX = -3.8;
        this.contentSpacing = 0.75;

        this.headerWidth = 8.5 / this.fontMult;
        this.headerHeight = 1 / this.fontMult;

        this.contentWidth = 8.5 / this.fontMult;
        this.contentHeight = 1 / this.fontMult;
    }

    syncTextVisibility(visible = true) {
        this.textContainer.visible = !!visible;

        for (const label of this.textObjects.values()) {
            label?.userData?.__sdfTextInstance?.setVisible?.(visible);
        }
    }

    show() {
        super.show();
        this.paper?.show?.();
        this.syncTextVisibility(true);
    }

    hide() {
        this.paper?.hide?.();
        this.syncTextVisibility(false);
        super.hide();
    }

    setLabelsVisible(visible = true) {
        this.syncTextVisibility(visible);
    }

    getCollider() {
        return InputService.createWorldObbFromObject(
            this.getRootGroup(),
            this.getDefaultSize()
        );
    }

    onClick(payload = {}) {
        const detailData = this.model;
        window[`apps_${performance.timeOrigin}`]?.pepe?.openDetailPanel?.({
            title: "Evidence Details",
            kind: "evidence",
            data: detailData
        });
        console.log("Evidence clicked", detailData);
    }

    update () {
        let curY = 5.5;

        let lines = {};
        lines["excerptLabel"] = {
                text: "Excerpt:",
                size: this.fontMult * this.headerSize,
                position: [this.headerX, curY, 0],
                autoScale: false,
                wrapMode: "word",
                maxWidth: this.headerWidth,
                maxHeight: this.headerHeight,
                padding: 0,
                align: "left",
                anchor: "top-left",
                breakLongWords: false,
            };

        curY -= this.contentSpacing;
        lines["excerpt"] = {
                text: `"${this.model.excerpt}"`,
                size: this.fontMult * this.contentSize,
                position: [this.contentX, curY, 0],
                autoScale: false,
                wrapMode: "word",
                maxWidth: this.contentWidth,
                maxHeight: this.contentHeight,
                padding: 0,
                align: "left",
                anchor: "top-left",
                breakLongWords: false,
            };

        curY -= 4;
        lines["dateLabel"] = {
                text: "Date:",
                size: this.fontMult * this.headerSize,
                position: [this.headerX, curY, 0],
                autoScale: false,
                wrapMode: "word",
                maxWidth: this.headerWidth,
                maxHeight: this.headerHeight,
                padding: 0,
                align: "left",
                anchor: "top-left",
                breakLongWords: false,
            };

        curY -= this.contentSpacing;
        lines["date"] = {
                text: this.model.date,
                size: this.fontMult * this.contentSize,
                position: [this.contentX, curY, 0],
                autoScale: false,
                wrapMode: "word",
                maxWidth: this.contentWidth,
                maxHeight: this.contentHeight,
                padding: 0,
                align: "left",
                anchor: "top-left",
                breakLongWords: false,
            };

        curY -= 2;
        lines["sourceLabel"] = {
                text: "Source:",
                size: this.fontMult * this.headerSize,
                position: [this.headerX, curY, 0],
                autoScale: false,
                wrapMode: "word",
                maxWidth: this.headerWidth,
                maxHeight: this.headerHeight,
                padding: 0,
                align: "left",
                anchor: "top-left",
                breakLongWords: false,
            };

        curY -= this.contentSpacing;
        lines["source"] = {
                text: this.model.source,
                size: this.fontMult * this.contentSize,
                position: [this.contentX, curY, 0],
                autoScale: false,
                wrapMode: "word",
                maxWidth: this.contentWidth,
                maxHeight: this.contentHeight,
                padding: 0,
                align: "left",
                anchor: "top-left",
                breakLongWords: false,
            };

        this.updateLines(lines);
    }

    updateLines(lines) {
        if (lines == null) return;

        for (const [key, text] of Object.entries(lines)) {
            this.updateLine(key, text);
        }
    }

    updateLine(key, params) {
        let label = this.textObjects.get(key);

        if (typeof params === "string") {
            params = { text: params }
        }

        if (label == null) {
            label = TextService.getText("typewriter-black", params);
            this.textObjects.set(key, label);
            this.textContainer.add(label);

            if (params.position) {
                label.position.fromArray(params.position);
            }

            if (params.size) {
                label.scale.multiplyScalar(params.size);
            }

            this.textContainer.position.set(0.5, -0.8, 0);
            label.userData.__sdfTextInstance?.setVisible?.(this.textContainer.visible);
        }

        if (label.userData.__sdfTextInstance.text != params.text) {
            label.userData.__sdfTextInstance.updateText(params.text, params);
        }
    }

    setScale(scale) {
        this.getRootGroup().scale.setScalar(scale);
    }

    getDimensions() {
        const size = this.paper.getSize();
        const scale = this.getRootGroup().scale.x;

        return {
            width: size.x * scale,
            height: size.y * scale
        };
    }

    refreshSize() {
        if (this.size == null) {
            this.size = this.getDefaultSize();
            return true;
        }

        return false;
    }

    getDefaultSize() {
        return this.paper.getSize();
    }
}

export { EvidenceView };
