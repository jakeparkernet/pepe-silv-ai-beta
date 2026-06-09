class InvestigationModeController {
    constructor ({
        dom = {},
        submissionController = null,
        windowRef = window
    } = {}) {
        this.dom = {
            root: dom.root ?? null,
            articleRadio: dom.articleRadio ?? null,
            companyPairRadio: dom.companyPairRadio ?? null
        };
        this.submissionController = submissionController;
        this.windowRef = windowRef;
        this.isSignedIn = false;
        this.mode = "article";

        this.onModeChanged = this.onModeChanged.bind(this);

        this.dom.articleRadio?.addEventListener("change", this.onModeChanged);
        this.dom.companyPairRadio?.addEventListener("change", this.onModeChanged);
        this.applyVisibility();
        this.applyMode("article");
    }

    setSubmissionController (submissionController) {
        this.submissionController = submissionController;
        this.applyMode(this.mode);
    }

    setSignedIn (isSignedIn = false) {
        this.isSignedIn = Boolean(isSignedIn);
        if (!this.isSignedIn) {
            this.applyMode("article");
        }
        this.applyVisibility();
    }

    onModeChanged (event) {
        let value = String(event?.target?.value ?? "article");
        this.applyMode(value);
    }

    applyVisibility () {
        if (this.dom.root == null) {
            return;
        }

        this.dom.root.hidden = !this.isSignedIn;
    }

    applyMode (mode) {
        let normalizedMode = mode === "company_pair" && this.isSignedIn ? "company_pair" : "article";
        this.mode = normalizedMode;

        if (this.dom.articleRadio != null) {
            this.dom.articleRadio.checked = normalizedMode === "article";
            this.dom.articleRadio.closest(".investigation-mode-option")?.classList.toggle(
                "is-active",
                normalizedMode === "article"
            );
        }
        if (this.dom.companyPairRadio != null) {
            this.dom.companyPairRadio.checked = normalizedMode === "company_pair";
            this.dom.companyPairRadio.closest(".investigation-mode-option")?.classList.toggle(
                "is-active",
                normalizedMode === "company_pair"
            );
        }

        if (normalizedMode === "company_pair") {
            this.submissionController?.enterCompanyPairMode?.();
            return;
        }

        this.submissionController?.exitCompanyPairMode?.();
        this.submissionController?.updateSubmitButtonVisibility?.();
    }
}

export { InvestigationModeController };
