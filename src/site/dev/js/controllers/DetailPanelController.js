class DetailPanelController {
    constructor({
        detailPanel = null,
        detailPanelTitle = null,
        detailPanelBody = null,
        detailPanelCloseButton = null,
        resolveEntityById = null,
        resolveEvidenceById = null
    } = {}) {
        this.detailPanel = detailPanel;
        this.detailPanelTitle = detailPanelTitle;
        this.detailPanelBody = detailPanelBody;
        this.detailPanelCloseButton = detailPanelCloseButton;
        this.resolveEntityByIdCallback = resolveEntityById;
        this.resolveEvidenceByIdCallback = resolveEvidenceById;
    }

    initializeDetailPanel() {
        this.detailPanelCloseButton?.addEventListener("click", () => this.closeDetailPanel());
    }

    formatDetailPanelContent(data) {
        if (data == null) {
            return "";
        }

        if (typeof data === "string") {
            return data;
        }

        try {
            return JSON.stringify(data, null, 2);
        }
        catch (_err) {
            return String(data);
        }
    }

    normalizeDetailInput(kind, data) {
        if (kind === "entity" && data?.model) {
            return data.model;
        }

        if (kind === "relationship" && data?.model) {
            return {
                ...data.model,
                relation: data.relation ?? data.model?.relation
            };
        }

        return data;
    }

    createDetailLayout() {
        const root = document.createElement("div");
        root.className = "detail-panel-layout";
        return root;
    }

    createDetailSection(title) {
        const section = document.createElement("section");
        section.className = "detail-section";

        if (title) {
            const heading = document.createElement("div");
            heading.className = "detail-section-title";
            heading.textContent = title;
            section.appendChild(heading);
        }

        return section;
    }

    createField(label, value) {
        if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) {
            return null;
        }

        const row = document.createElement("div");
        row.className = "detail-field";

        const labelEl = document.createElement("div");
        labelEl.className = "detail-field-label";
        labelEl.textContent = label;

        const valueEl = document.createElement("div");
        valueEl.className = "detail-field-value";
        valueEl.appendChild(this.createDetailValueNode(value));

        row.append(labelEl, valueEl);
        return row;
    }

    isProbablyUrl(value) {
        if (typeof value !== "string") {
            return false;
        }

        return /^(https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,})(\/|$)/i.test(value.trim());
    }

    normalizeUrlForHref(value) {
        const text = String(value).trim();
        if (/^https?:\/\//i.test(text)) {
            return text;
        }

        if (/^www\./i.test(text)) {
            return `https://${text}`;
        }

        return `https://www.${text}`;
    }

    createUrlLink(value) {
        const link = document.createElement("a");
        link.className = "detail-link";
        link.href = this.normalizeUrlForHref(value);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = String(value);
        return link;
    }

    resolveEntityById(entityId) {
        return this.resolveEntityByIdCallback?.(entityId) ?? null;
    }

    resolveEvidenceById(evidenceId) {
        return this.resolveEvidenceByIdCallback?.(evidenceId) ?? null;
    }

    openEntityDetailById(entityId) {
        const entity = this.resolveEntityById(entityId);
        if (entity == null) {
            return;
        }

        this.openDetailPanel({
            title: "Entity Details",
            kind: "entity",
            data: entity
        });
    }

    openEvidenceDetailById(evidenceId) {
        const evidence = this.resolveEvidenceById(evidenceId);
        if (evidence == null) {
            return;
        }

        this.openDetailPanel({
            title: "Evidence Details",
            kind: "evidence",
            data: evidence
        });
    }

    createReferenceLink(label, onClick) {
        const link = document.createElement("a");
        link.href = "#";
        link.className = "detail-link detail-ref-button";
        link.textContent = label;
        link.addEventListener("click", (event) => {
            event.preventDefault();
            onClick?.(event);
        });
        return link;
    }

    createDetailValueNode(value) {
        if (value instanceof Node) {
            return value;
        }

        if (Array.isArray(value)) {
            const wrapper = document.createElement("div");
            wrapper.className = "detail-inline-list";
            value.forEach((item, index) => {
                const node = this.createDetailValueNode(item);
                wrapper.appendChild(node);
                if (index < value.length - 1 && node.nodeType === Node.TEXT_NODE) {
                    wrapper.appendChild(document.createTextNode(", "));
                }
            });
            return wrapper;
        }

        if (typeof value === "string" && this.isProbablyUrl(value)) {
            return this.createUrlLink(value);
        }

        return document.createTextNode(String(value));
    }

    createFieldListSection(title, fields) {
        const validFields = fields
            .map(({ label, value }) => this.createField(label, value))
            .filter(Boolean);

        if (validFields.length === 0) {
            return null;
        }

        const section = this.createDetailSection(title);
        const list = document.createElement("div");
        list.className = "detail-field-list";
        validFields.forEach((field) => list.appendChild(field));
        section.appendChild(list);
        return section;
    }

    createChipSection(title, items) {
        if (Array.isArray(items) === false || items.length === 0) {
            return null;
        }

        const section = this.createDetailSection(title);
        const row = document.createElement("div");
        row.className = "detail-chip-row";

        items.forEach((item) => {
            const chip = document.createElement("div");
            chip.className = "detail-chip";
            chip.textContent = String(item);
            row.appendChild(chip);
        });

        section.appendChild(row);
        return section;
    }

    createRawSection(title, data) {
        if (data == null || (typeof data === "object" && Object.keys(data).length === 0)) {
            return null;
        }

        const section = this.createDetailSection(title);
        section.appendChild(this.renderRawValue(this.parseJsonRecursively(data)));
        return section;
    }

    createEvidenceSection(title, evidenceMap) {
        if (evidenceMap == null || typeof evidenceMap !== "object" || Object.keys(evidenceMap).length === 0) {
            return null;
        }

        const section = this.createDetailSection(title);
        const list = document.createElement("div");
        list.className = "detail-field-list";

        Object.entries(evidenceMap).forEach(([evidenceId, evidence]) => {
            const item = document.createElement("div");
            item.className = "detail-section";

            [
                this.createField("ID", this.createReferenceLink(String(evidenceId), () => this.openEvidenceDetailById(evidenceId))),
                this.createField("Source", evidence?.source ? this.createUrlLink(evidence.source) : null),
                this.createField("Date", evidence?.date),
                this.createField("Excerpt", evidence?.excerpt)
            ].filter(Boolean).forEach((field) => item.appendChild(field));

            list.appendChild(item);
        });

        section.appendChild(list);
        return section;
    }

    renderRawValue(value, key = "") {
        if (value == null) {
            const div = document.createElement("div");
            div.className = "detail-field-value";
            div.textContent = "null";
            return div;
        }

        if (Array.isArray(value)) {
            const wrapper = document.createElement("div");
            wrapper.className = "detail-raw-block";

            value.forEach((item, index) => {
                const row = document.createElement("div");
                row.className = "detail-raw-row";
                const keyEl = document.createElement("div");
                keyEl.className = "detail-raw-key";
                keyEl.textContent = `${key || "item"} ${index + 1}`;
                row.appendChild(keyEl);
                row.appendChild(this.renderRawValue(item, key));
                wrapper.appendChild(row);
            });

            return wrapper;
        }

        if (typeof value === "object") {
            const wrapper = document.createElement("div");
            wrapper.className = "detail-raw-block";

            Object.entries(value).forEach(([entryKey, entryValue]) => {
                const row = document.createElement("div");
                row.className = "detail-raw-row";
                const keyEl = document.createElement("div");
                keyEl.className = "detail-raw-key";
                keyEl.textContent = entryKey;
                row.appendChild(keyEl);
                row.appendChild(this.renderRawValue(entryValue, entryKey));
                wrapper.appendChild(row);
            });

            return wrapper;
        }

        if ((key === "source" || key.endsWith("_url") || key === "url") && this.isProbablyUrl(value)) {
            const div = document.createElement("div");
            div.className = "detail-field-value";
            div.appendChild(this.createUrlLink(value));
            return div;
        }

        if ((key === "source" || key === "target" || key === "source_entity_id" || key === "target_entity_id") && this.resolveEntityById(value)) {
            const entity = this.resolveEntityById(value);
            const div = document.createElement("div");
            div.className = "detail-field-value";
            div.appendChild(this.createReferenceLink(
                entity?.name ?? String(value),
                () => this.openEntityDetailById(value)
            ));
            return div;
        }

        if ((key === "id" || key === "evidence_id") && this.resolveEvidenceById(value)) {
            const div = document.createElement("div");
            div.className = "detail-field-value";
            div.appendChild(this.createReferenceLink(
                String(value),
                () => this.openEvidenceDetailById(value)
            ));
            return div;
        }

        const pre = document.createElement("pre");
        pre.className = "detail-pre";
        pre.textContent = String(value);
        return pre;
    }

    renderEntityDetail(entity) {
        const layout = this.createDetailLayout();
        const hero = document.createElement("section");
        hero.className = "detail-hero";

        const kicker = document.createElement("div");
        kicker.className = "detail-kicker";
        kicker.textContent = "Entity";

        const heading = document.createElement("div");
        heading.className = "detail-heading";
        heading.textContent = entity?.name ?? "Unknown Entity";

        const subheading = document.createElement("div");
        subheading.className = "detail-subheading";
        subheading.textContent = entity?.entity_type ?? entity?.type ?? "Unknown type";

        hero.append(kicker, heading, subheading);
        layout.appendChild(hero);

        [
            this.createChipSection("Aliases", entity?.aliases),
            this.createFieldListSection("Narrative", [
                { label: "Notes", value: entity?.notes },
                { label: "Context", value: entity?.context }
            ]),
            this.createChipSection("Tags", entity?.tags),
            this.createEvidenceSection("Evidence", entity?.evidence),
            this.createRawSection("Relationships", entity?.relationships),
            this.createFieldListSection("Summary", [
                { label: "ID", value: entity?.id },
                { label: "Status", value: entity?.status },
                { label: "Created", value: entity?.created_at }
            ]),
            this.createRawSection("Metadata", entity?.metadata)
        ].filter(Boolean).forEach((section) => layout.appendChild(section));

        return layout;
    }

    renderRelationshipDetail(input) {
        const model = input?.model ?? input;
        const sourceEntity = this.resolveEntityById(model?.source ?? input?.source_entity_id);
        const targetEntity = this.resolveEntityById(model?.target ?? input?.target_entity_id);
        const layout = this.createDetailLayout();
        const hero = document.createElement("section");
        hero.className = "detail-hero";

        const kicker = document.createElement("div");
        kicker.className = "detail-kicker";
        kicker.textContent = "Relationship";

        const heading = document.createElement("div");
        heading.className = "detail-heading";
        heading.textContent = model?.relation ?? input?.relation ?? "Unknown relation";

        const subheading = document.createElement("div");
        subheading.className = "detail-subheading";
        subheading.textContent = `${sourceEntity?.name ?? model?.source ?? input?.source_entity_id ?? "Unknown source"} -> ${targetEntity?.name ?? model?.target ?? input?.target_entity_id ?? "Unknown target"}`;

        hero.append(kicker, heading, subheading);
        layout.appendChild(hero);

        [
            this.createFieldListSection("Endpoints", [
                {
                    label: "Source",
                    value: sourceEntity
                        ? this.createReferenceLink(sourceEntity.name ?? model?.source, () => this.openEntityDetailById(sourceEntity.id))
                        : model?.source ?? input?.source_entity_id
                },
                { label: "Source ID", value: model?.source ?? input?.source_entity_id },
                {
                    label: "Target",
                    value: targetEntity
                        ? this.createReferenceLink(targetEntity.name ?? model?.target, () => this.openEntityDetailById(targetEntity.id))
                        : model?.target ?? input?.target_entity_id
                },
                { label: "Target ID", value: model?.target ?? input?.target_entity_id }
            ]),
            this.createEvidenceSection("Evidence", model?.evidence ?? input?.evidence),
            this.createRawSection("Raw Relationship", input)
        ].filter(Boolean).forEach((section) => layout.appendChild(section));

        return layout;
    }

    renderEvidenceDetail(evidence) {
        const layout = this.createDetailLayout();
        const hero = document.createElement("section");
        hero.className = "detail-hero";

        const kicker = document.createElement("div");
        kicker.className = "detail-kicker";
        kicker.textContent = "Evidence";

        const heading = document.createElement("div");
        heading.className = "detail-heading";
        heading.textContent = evidence?.source ?? "Evidence Source";

        const subheading = document.createElement("div");
        subheading.className = "detail-subheading";
        subheading.textContent = evidence?.date ?? "No date available";

        hero.append(kicker, heading, subheading);
        layout.appendChild(hero);

        [
            this.createFieldListSection("Summary", [
                { label: "ID", value: evidence?.id },
                {
                    label: "Source",
                    value: this.createUrlLink(evidence?.source)
                },
                { label: "Date", value: evidence?.date }
            ]),
            this.createFieldListSection("Excerpt", [
                { label: "Excerpt", value: evidence?.excerpt }
            ]),
            this.createRawSection("Raw Evidence", evidence?.raw ?? evidence)
        ].filter(Boolean).forEach((section) => layout.appendChild(section));

        return layout;
    }

    renderDetailPanelContent(kind, data, body = "") {
        const normalized = this.normalizeDetailInput(kind, data);

        if (kind === "entity") {
            return this.renderEntityDetail(normalized);
        }

        if (kind === "relationship") {
            return this.renderRelationshipDetail(normalized);
        }

        if (kind === "evidence") {
            return this.renderEvidenceDetail(normalized);
        }

        const pre = document.createElement("pre");
        pre.className = "detail-pre";
        pre.textContent = normalized != null ? this.formatDetailPanelContent(normalized) : body;
        return pre;
    }

    openDetailPanel({ title = "Details", body = "", data = null, kind = "" } = {}) {
        if (this.detailPanel == null) {
            return;
        }

        if (this.detailPanelTitle) {
            this.detailPanelTitle.textContent = title;
        }

        if (this.detailPanelBody) {
            this.detailPanelBody.innerHTML = "";
            this.detailPanelBody.appendChild(
                this.renderDetailPanelContent(kind, data, body)
            );
        }

        this.detailPanel.classList.add("is-open");
        this.detailPanel.setAttribute("aria-hidden", "false");
    }

    closeDetailPanel() {
        if (this.detailPanel == null) {
            return;
        }

        this.detailPanel.classList.remove("is-open");
        this.detailPanel.setAttribute("aria-hidden", "true");
    }

    parseJsonRecursively(value) {
        const seen = new WeakMap();

        const walk = (v) => {
            if (v === null) return null;

            const t = typeof v;

            if (t === "string") {
                const s = v.trim();
                if (s.length === 0) return v;

                const first = s[0];
                const looksJsony =
                    first === "{" ||
                    first === "[" ||
                    first === "\"" ||
                    first === "t" ||
                    first === "f" ||
                    first === "n" ||
                    first === "-" ||
                    (first >= "0" && first <= "9");

                if (!looksJsony) return v;

                try {
                    const parsed = JSON.parse(s);
                    return walk(parsed);
                }
                catch (_err) {
                    return v;
                }
            }

            if (t !== "object") return v;

            if (seen.has(v)) {
                return seen.get(v);
            }

            if (Array.isArray(v)) {
                const copy = [];
                seen.set(v, copy);

                for (let i = 0; i < v.length; i += 1) {
                    copy[i] = walk(v[i]);
                }

                return copy;
            }

            const proto = Object.getPrototypeOf(v);
            const isPlain = proto === Object.prototype || proto === null;

            if (!isPlain) {
                return v;
            }

            const copy = {};
            seen.set(v, copy);

            for (const key of Object.keys(v)) {
                copy[key] = walk(v[key]);
            }

            return copy;
        };

        return walk(value);
    }
}

export { DetailPanelController };
