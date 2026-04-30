import * as THREE from "three";
// import { View } from "./View.js";
// import { EntityViewNew } from "./EntityViewNew.js";
// import { ThreadView } from "./ThreadView.js";
// import { StickyNote } from "../components/StickyNote.js";
// 
const appModules = window[`apps_${performance.timeOrigin}`].modules;
const { View } = appModules.views.View;
const { EntityViewNew } = appModules.views.EntityViewNew;
const { ThreadView } = appModules.views.ThreadView;
const { StickyNote } = appModules.components.StickyNote;

const DEFAULT_STATUS_CONFIG_PATH = "./status_states.json";
const DEFAULT_CARD_SPACING = 8.5;
const DEFAULT_Y_JITTER_MIN = -0.45;
const DEFAULT_Y_JITTER_MAX = 0.45;
const DEFAULT_STICKY_NOTE_OFFSET_Y = 2.4;
const DEFAULT_THREAD_Z_OFFSET = -0.12;
const DEFAULT_AMBIENT_INTENSITY = 1.1;

class ArticleStatus extends View {
    constructor({
        statusConfigPath = DEFAULT_STATUS_CONFIG_PATH,
        cardSpacing = DEFAULT_CARD_SPACING,
        yJitterMin = DEFAULT_Y_JITTER_MIN,
        yJitterMax = DEFAULT_Y_JITTER_MAX,
        stickyNoteOffsetY = DEFAULT_STICKY_NOTE_OFFSET_Y,
        threadZOffset = DEFAULT_THREAD_Z_OFFSET,
        ambientIntensity = DEFAULT_AMBIENT_INTENSITY
    } = {}) {
        super();

        this.statusConfigPath = statusConfigPath;
        this.cardSpacing = cardSpacing;
        this.yJitterMin = yJitterMin;
        this.yJitterMax = yJitterMax;
        this.stickyNoteOffsetY = stickyNoteOffsetY;
        this.threadZOffset = threadZOffset;
        this.ambientIntensity = ambientIntensity;

        this.states = [];
        this.statusCards = [];
        this.statusThreads = [];
        this.statusCardOffsets = [];
        this.currentStatusIndex = -1;
        this.isShown = false;
        this.initialized = false;
        this.initializationPromise = null;

        this.statusRoot = new THREE.Group();
        this.addToRoot(this.statusRoot);

        this.statusAmbientLight = new THREE.AmbientLight(0xffffff, this.ambientIntensity);
        this.statusAmbientLight.layers.enable(0);
        this.statusAmbientLight.layers.enable(1);
        this.statusRoot.add(this.statusAmbientLight);

        this.progressStickyNote = new StickyNote();
        this.progressStickyNote.updateLine("label", {
            text: "Progress",
            position: [0, 0, 0],
            size: 0.0069,
            wrapMode: "none",
            maxWidth: 200,
            maxHeight: 200,
            fitIterations: 20,
            align: "center",
            anchor: "center"
        });
        this.statusRoot.add(this.progressStickyNote.getRootGroup());

        this.hide();
    }

    show() {
        if (this.isShown) {
            return;
        }

        for (let i = 0; i < this.statusCards.length; i += 1) {
            this.statusCards[i]?.show?.();
        }
        this.progressStickyNote?.show?.();
        for (let i = 0; i < this.statusThreads.length; i += 1) {
            this.statusThreads[i]?.show?.();
        }
        this.isShown = true;
        super.show();
    }

    hide() {
        if (!this.isShown) {
            this.currentStatusIndex = -1;
            super.hide();
            return;
        }

        for (let i = 0; i < this.statusCards.length; i += 1) {
            this.statusCards[i]?.hide?.();
        }
        this.progressStickyNote?.hide?.();
        for (let i = 0; i < this.statusThreads.length; i += 1) {
            this.statusThreads[i]?.hide?.();
        }
        this.isShown = false;
        this.currentStatusIndex = -1;
        super.hide();
    }

    async init() {
        if (this.initialized) {
            return this;
        }

        if (this.initializationPromise != null) {
            return this.initializationPromise;
        }

        this.initializationPromise = this.loadStates()
            .then((states) => {
                this.states = states;
                this.buildStatusViews();
                this.hide();
                this.initialized = true;
                return this;
            })
            .finally(() => {
                this.initializationPromise = null;
            });

        return this.initializationPromise;
    }

    async loadStates() {
        const response = await fetch(this.statusConfigPath);
        if (!response.ok) {
            throw new Error(`ArticleStatus: failed to load "${this.statusConfigPath}" (${response.status})`);
        }

        const data = await response.json();
        if (Array.isArray(data) === false) {
            throw new Error("ArticleStatus: status config must be an array.");
        }

        return data
            .filter((entry) => entry != null && typeof entry === "object")
            .map((entry) => ({
                status: String(entry.status ?? "").trim().toLowerCase(),
                messageThree: String(entry.message_three ?? entry.message ?? entry.status ?? "").trim()
            }))
            .filter((entry) => entry.status.length > 0 && entry.messageThree.length > 0);
    }

    buildStatusViews() {
        this.clearStatusViews();
        this.progressStickyNote?.hide?.();

        if (this.states.length === 0) {
            return;
        }

        const totalWidth = (this.states.length - 1) * this.cardSpacing;
        const startX = -totalWidth * 0.5;

        for (let i = 0; i < this.states.length; i += 1) {
            const state = this.states[i];
            const card = new EntityViewNew();
            card.hide();
            card.setModel({ name: state.messageThree });

            const x = startX + (i * this.cardSpacing);
            const y = THREE.MathUtils.randFloat(this.yJitterMin, this.yJitterMax);
            card.getRootGroup().position.set(x, y, 0);

            this.statusRoot.add(card.getRootGroup());
            this.statusCards.push(card);
            this.statusCardOffsets.push(new THREE.Vector3(x, y, 0));
        }

        this.statusRoot.updateMatrixWorld(true);

        for (let i = 0; i < this.statusCards.length - 1; i += 1) {
            const leftCard = this.statusCards[i];
            const rightCard = this.statusCards[i + 1];
            const thread = new ThreadView();
            thread.hide();
            const leftCenter = leftCard.getRootGroup().localToWorld(new THREE.Vector3());
            const rightCenter = rightCard.getRootGroup().localToWorld(new THREE.Vector3());

            this.statusRoot.add(thread.getRootGroup());
            thread.setEndpoints(leftCenter, rightCenter);
            thread.getRootGroup().position.z += this.threadZOffset;
            this.statusThreads.push(thread);
        }

        this.moveStickyNoteToIndex(0);
    }

    clearStatusViews() {
        for (let i = 0; i < this.statusThreads.length; i += 1) {
            const thread = this.statusThreads[i];
            this.statusRoot.remove(thread.getRootGroup());
        }
        this.statusThreads = [];

        for (let i = 0; i < this.statusCards.length; i += 1) {
            const card = this.statusCards[i];
            this.statusRoot.remove(card.getRootGroup());
        }
        this.statusCards = [];
        this.statusCardOffsets = [];
    }

    getStatusIndex(status) {
        const normalizedStatus = String(status ?? "").trim().toLowerCase();
        return this.states.findIndex((entry) => entry.status === normalizedStatus);
    }

    moveStickyNoteToIndex(index) {
        if (this.progressStickyNote == null || this.statusCardOffsets[index] == null) {
            return;
        }

        const offset = this.statusCardOffsets[index];
        this.progressStickyNote.getRootGroup().position.set(
            offset.x,
            offset.y - this.stickyNoteOffsetY,
            0.15
        );
        this.progressStickyNote.markDirty();
    }

    getCurrentStatusWorldPosition(target = new THREE.Vector3()) {
        if (this.currentStatusIndex < 0 || this.statusCardOffsets[this.currentStatusIndex] == null) {
            return null;
        }

        return this.statusRoot.localToWorld(
            target.copy(this.statusCardOffsets[this.currentStatusIndex])
        );
    }

    async showForStatus(status) {
        await this.init();

        const statusIndex = this.getStatusIndex(status);
        if (statusIndex < 0) {
            this.hide();
            this.currentStatusIndex = -1;
            return false;
        }

        if (this.isShown && this.currentStatusIndex === statusIndex) {
            return true;
        }

        this.moveStickyNoteToIndex(statusIndex);
        this.currentStatusIndex = statusIndex;
        this.show();
        return true;
    }
}

export { ArticleStatus };
