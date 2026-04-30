const SUMMARY_BANNER_CONFIG = Object.freeze({
    baseDelayMs: 80,
    perWordStartOffsetMs: 400,
    fadeInMs: 500,
    holdMs: 300,
    settleMs: 520,
    initialOpacity: 0.78,
    settledOpacity: 0.92,
    fadeInEasing: "ease-in",
    settleEasing: "cubic-bezier(0.2, 0.8, 0.2, 1)"
});

class SummaryBannerController {
    constructor({ summaryBanner = null } = {}) {
        this.summaryBanner = summaryBanner;
    }

    renderSummaryBanner(text) {
        const banner = this.summaryBanner;
        if (!banner) return;

        banner.innerHTML = "";
        banner.classList.remove("is-visible");

        const ensureStyles = () => {
            if (banner._stylesAdded) return;
            banner._stylesAdded = true;

            const style = document.createElement("style");
            style.textContent = `
                @keyframes __banner_word_fade_in {
                    from { opacity: 0; transform: translateY(1px); filter: blur(0.25px); }
                    to { opacity: ${SUMMARY_BANNER_CONFIG.initialOpacity}; transform: translateY(0); filter: blur(0); }
                }
                @keyframes __banner_word_settle {
                    from { opacity: ${SUMMARY_BANNER_CONFIG.initialOpacity}; }
                    to { opacity: ${SUMMARY_BANNER_CONFIG.settledOpacity}; }
                }
                #summary-banner .banner-word {
                    animation-name: __banner_word_fade_in, __banner_word_settle;
                    animation-duration: ${SUMMARY_BANNER_CONFIG.fadeInMs}ms, ${SUMMARY_BANNER_CONFIG.settleMs}ms;
                    animation-timing-function: ${SUMMARY_BANNER_CONFIG.fadeInEasing}, ${SUMMARY_BANNER_CONFIG.settleEasing};
                    animation-fill-mode: forwards, forwards;
                }
            `;
            document.head.appendChild(style);
        };
        ensureStyles();

        const trimmedText = String(text ?? "").trim();
        const hasPeriod = trimmedText.endsWith(".");
        const textWithoutPeriod = hasPeriod ? trimmedText.slice(0, -1).trimEnd() : trimmedText;
        const words = textWithoutPeriod.split(/\s+/);

        const container = document.createElement("div");
        container.style.display = "inline";

        for (let i = 0; i < words.length; i += 1) {
            const span = document.createElement("span");
            span.className = "banner-word";
            span.textContent = i < words.length - 1 ? `${words[i]} ` : words[i];

            const startDelay = SUMMARY_BANNER_CONFIG.baseDelayMs + (i * SUMMARY_BANNER_CONFIG.perWordStartOffsetMs);
            const settleDelay = startDelay + SUMMARY_BANNER_CONFIG.fadeInMs + SUMMARY_BANNER_CONFIG.holdMs;

            span.style.animationDelay = `${startDelay}ms, ${settleDelay}ms`;
            container.appendChild(span);
        }

        if (!hasPeriod) {
            const periodSpan = document.createElement("span");
            periodSpan.className = "banner-word";
            periodSpan.textContent = ".";

            const periodIndex = words.length;
            const startDelay = SUMMARY_BANNER_CONFIG.baseDelayMs + (periodIndex * SUMMARY_BANNER_CONFIG.perWordStartOffsetMs);
            const settleDelay = startDelay + SUMMARY_BANNER_CONFIG.fadeInMs + SUMMARY_BANNER_CONFIG.holdMs;

            periodSpan.style.animationDelay = `${startDelay}ms, ${settleDelay}ms`;
            container.appendChild(periodSpan);
        }

        banner.appendChild(container);

        requestAnimationFrame(() => {
            banner.classList.add("is-visible");
        });
    }
}

export { SummaryBannerController };
