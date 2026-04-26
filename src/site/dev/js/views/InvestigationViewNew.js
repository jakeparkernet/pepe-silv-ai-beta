import { View } from "./View.js";
import * as THREE from "three";
import { ViewPool } from "../utils/ViewPool.js";

class InvestigationViewNew extends View {

    setModel(investigationModel) {
        const root = this.getRootGroup();

        // -----------------------------
        // Layout config (tweak freely)
        // -----------------------------
        const layout = {
            newsStartX: 10,
            newsStartY: -6,

            subjectStartX: -10,
            subjectStartY: -6,

            subjectStackYStep: 4,
            arcRadius: 9,
            subjectArcRadiusStep: 2,

            topOwnerY: 10,

            relationshipZ: -0.001
        };

        // computed convenience
        layout.topOwnerX = (layout.newsStartX + layout.subjectStartX) / 2;

        // -----------------------------
        // Helper: build a chain from relationships
        // Rule: bigger (owner) -> smaller (owned)
        // So to walk "up" from a start entity toward owners:
        // find rel where rel.target === current, then next = rel.source.
        // -----------------------------
        const buildChain = (startEntity, relationshipList, stopEntityIdOrNull) => {
            const entities = [];
            const relationships = [];

            if (startEntity === null) return { entities, relationships };

            const visitedEntityIds = new Set();
            let current = startEntity;

            while (current !== null) {
                if (visitedEntityIds.has(current.id)) break;
                visitedEntityIds.add(current.id);

                // If startEntity itself is the stop, don't include it (defensive)
                if (stopEntityIdOrNull !== null && current.id === stopEntityIdOrNull) break;

                entities.push(current);

                let nextRel = null;
                for (let i = 0; i < relationshipList.length; i++) {
                    const rel = relationshipList[i];
                    if (rel !== null && rel.target !== null && rel.target.id === current.id) {
                        nextRel = rel;
                        break;
                    }
                }

                if (nextRel === null) break;

                const nextOwner = nextRel.source;

                // If the next owner is topOwner, stop here (do NOT include topOwner in entities/arc)
                if (
                    stopEntityIdOrNull !== null &&
                    nextOwner !== null &&
                    nextOwner.id === stopEntityIdOrNull
                ) {
                    break;
                }

                relationships.push(nextRel);
                current = nextOwner;
            }

            return { entities, relationships };
        };

        // -----------------------------
        // Helper: position entities along a semicircle
        // Semicircle is defined with bottom-most point at (startX, startY)
        // Center is (startX, startY + radius)
        // Theta spans [-pi/2 .. +pi/2] with equal spacing.
        // dir: -1 bulges left, +1 bulges right.
        // -----------------------------
        const positionChainOnArc = (chainEntities, startX, startY, radius, dir, z) => {
            const n = chainEntities.length;
            if (n === 0) return;

            const centerX = startX;
            const centerY = startY + radius;

            // If only one node, it's exactly at the bottom point.
            if (n === 1) {
                const e = chainEntities[0];
                const ev = this.entityViews.get(e.id);
                if (ev !== null) {
                    ev.getRootGroup().position.set(startX, startY, z);
                    ev.getRootGroup().updateMatrixWorld();
                }
                return;
            }

            const thetaStart = -Math.PI / 2;
            const thetaEnd = Math.PI / 2;

            for (let k = 0; k < n; k++) {
                const t = k / (n - 1);
                const theta = thetaStart + (thetaEnd - thetaStart) * t;

                // Bottom and top land at x=centerX because cos(±pi/2)=0.
                // Midpoint bulges outward by dir * radius.
                const x = centerX + dir * (radius * Math.cos(theta));
                const y = centerY + (radius * Math.sin(theta));

                const e = chainEntities[k];
                const ev = this.entityViews.get(e.id);
                if (ev !== null) {
                    ev.getRootGroup().position.set(x, y, z);
                    ev.getRootGroup().updateMatrixWorld();
                }
            }
        };

        // -----------------------------
        // Helper: draw relationship segments (views already exist elsewhere)
        // Relationship views now ALWAYS get setModel(relationshipModel)
        // -----------------------------
        const drawnEdges = new Set(); // key: "sourceId->targetId"

        const drawRelationshipModelBetweenOnce = (relationshipModel) => {
            if (relationshipModel === null) return;
            const source = relationshipModel.source;
            const target = relationshipModel.target;
            if (source === null || target === null) return;

            const key = `${source.id}->${target.id}`;
            if (drawnEdges.has(key)) return;
            drawnEdges.add(key);

            drawRelationshipModelBetween(relationshipModel);
        };

        const drawRelationshipModelBetween = (relationshipModel) => {
            if (relationshipModel === null) return;

            const fromEntity = relationshipModel.source;
            const toEntity = relationshipModel.target;
            if (fromEntity === null || toEntity === null) return;

            const fromView = this.entityViews.get(fromEntity.id);
            const toView = this.entityViews.get(toEntity.id);
            if (fromView === null || toView === null) return;

            const relationshipView = ViewPool.getView("relationship");
            relationshipView.setModel(relationshipModel); // <-- required change

            root.add(relationshipView.getRootGroup());

            fromView.getRootGroup().updateMatrixWorld();
            toView.getRootGroup().updateMatrixWorld();

            const fromPos = root.localToWorld(fromView.getRootGroup().position.clone());
            const toPos = root.localToWorld(toView.getRootGroup().position.clone());

            relationshipView.setEndpoints(fromPos, toPos);
            relationshipView.getRootGroup().position.setComponent(2, layout.relationshipZ);
        };

        // Utility: find a specific relationship in a list by endpoints
        const findRelationship = (relationshipList, sourceId, targetId) => {
            for (let i = 0; i < relationshipList.length; i++) {
                const rel = relationshipList[i];
                if (rel === null || rel.source === null || rel.target === null) continue;
                if (rel.source.id === sourceId && rel.target.id === targetId) return rel;
            }
            return null;
        };

        // -----------------------------
        // 1) Create entity views (same spirit as your current code)
        // -----------------------------
        const entities = investigationModel.entities;
        const newsSite = investigationModel.newsSite;

        this.entityViews = new Map();

        // Create views for all entities (including news site already in the map)
        entities.forEach((entity) => {
            const entityView = ViewPool.getView("entity_view_new");
            entityView.setModel(entity);
            root.add(entityView.getRootGroup());
            this.entityViews.set(entity.id, entityView);
        });

        // -----------------------------
        // 2) Place topOwner (if present)
        // -----------------------------
        const topOwner = investigationModel.topOwner !== null ? investigationModel.topOwner : null;
        if (topOwner !== null) {
            const topView = this.entityViews.get(topOwner.id);
            if (topView !== null) {
                topView.getRootGroup().position.set(layout.topOwnerX, layout.topOwnerY, 0);
                topView.getRootGroup().updateMatrixWorld();
            }
        }

        // -----------------------------
        // 3) Build chains + position arcs
        // -----------------------------
        const subjectRelationships = investigationModel.subjectRelationships !== null
            ? investigationModel.subjectRelationships
            : [];

        const newsSiteRelationships = investigationModel.newsSiteRelationships !== null
            ? investigationModel.newsSiteRelationships
            : [];

        const stopId = topOwner !== null ? topOwner.id : null;

        // News site: exactly one arc (per your latest note)
        const newsChain = buildChain(newsSite, newsSiteRelationships, stopId);
        positionChainOnArc(
            newsChain.entities,
            layout.newsStartX,
            layout.newsStartY,
            layout.arcRadius,
            -1, // bulge left
            0
        );

        // Subjects: one arc per subject, stacked downward
        const subjects = investigationModel.article !== null ? investigationModel.article.subjects : [];
        for (let i = 0; i < subjects.length; i++) {
            const subject = subjects[i];
            const chain = buildChain(subject, subjectRelationships, stopId);

            const startX = layout.subjectStartX;
            const startY = layout.subjectStartY - (i * layout.subjectStackYStep);

            const radius = layout.arcRadius + (i * layout.subjectArcRadiusStep);

            positionChainOnArc(
                chain.entities,
                startX,
                startY,
                radius,
                +1, // bulge right
                0
            );
        }

        // -----------------------------
        // 4) Draw relationships for each chain, then final-connect to topOwner if present
        // -----------------------------

        // News chain edges come directly from buildChain().relationships
        for (let k = 0; k < newsChain.relationships.length; k++) {
            drawRelationshipModelBetween(newsChain.relationships[k]);
        }

        // Final connect to topOwner, if present (look it up in newsSiteRelationships)
        if (topOwner !== null && newsChain.entities.length > 0) {
            const chainEnd = newsChain.entities[newsChain.entities.length - 1];
            const topRel = findRelationship(newsSiteRelationships, topOwner.id, chainEnd.id);
            if (topRel !== null) drawRelationshipModelBetween(topRel);
        }

        // Subject chains
        for (let i = 0; i < subjects.length; i++) {
            const subject = subjects[i];
            const chain = buildChain(subject, subjectRelationships, stopId);

            for (let k = 0; k < chain.relationships.length; k++) {
                drawRelationshipModelBetween(chain.relationships[k]);
            }

            if (topOwner !== null && chain.entities.length > 0) {
                const chainEnd = chain.entities[chain.entities.length - 1];
                const topRel = findRelationship(subjectRelationships, topOwner.id, chainEnd.id);
                if (topRel !== null) drawRelationshipModelBetween(topRel);
            }
        }


        // -----------------------------
        // 5) Add relationships: news site -> subjects
        // These exist in investigationModel.relationships:
        // source = newsSite, target = subject
        // -----------------------------
        const subjectIdSet = new Set(subjects.map((s) => s.id));

        // (Your existing code iterates `investigationModel.relationships.values()`;
        // keeping that behavior as-is)
        for (const rel of investigationModel.relationships.values()) {
            if (rel === null || rel.source === null || rel.target === null) continue;

            const isNewsToSubject =
                rel.source.id === newsSite.id &&
                subjectIdSet.has(rel.target.id);

            if (isNewsToSubject) {
                drawRelationshipModelBetweenOnce(rel);
            }
        }


        // -----------------------------
        // Evidence placeholder (unchanged spirit)
        // -----------------------------
        const evidence = investigationModel.evidence;
        evidence.forEach((evidencePiece) => {
            console.log(evidencePiece.excerpt);
            // make view
        });
    }

}

export { InvestigationViewNew };
