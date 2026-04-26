import { InvestigationView } from "../views/InvestigationView.js";
import { InvestigationModel } from "../models/InvestigationModel.js";
import { UrlInput } from "../elements/UrlInput.js";
import { Events } from "../utils/Events.js";
import { CommunicationBus } from "../services/CommunicationBus.js";

class InvestigationController {
    constructor(scene) {
        this.startInvestigation = this.startInvestigation.bind(this);
        this.onJobUpdated = this.onJobUpdated.bind(this);

        InvestigationController.States = {
            INIT: "INIT",
            IDLE: "IDLE",
            INVESTIGATING: "INVESTIGATING",
            FINISHING: "FINISHING",
            COMPLETE: "COMPLETE"
        }

        this.investigationView = new InvestigationView();
        scene.add(this.investigationView.getRootGroup());

        this.events = new Events();

        this.jobToNode = {};
        this.nodeToJob = {};
        this.state = InvestigationController.States.INIT;
        this.setUpIdleState();
        this.setState(InvestigationController.States.IDLE);
    }

    setUpIdleState() {
        this.urlInput = new UrlInput({
            container: document.getElementById("url-input-container"),
            input: document.getElementById("url-input"),
            submitButton: document.getElementById("url-submit-button")
        });

        this.urlInput.events.addListener("url-submitted", this.startInvestigation);
    }

    async startInvestigation(url) {
        this.setState(InvestigationController.States.INVESTIGATING);
        this.investigationJobId = crypto.randomUUID();

        const investigationSpec = {
            job_spec: {
                type: "investigation",
                params: {
                    id: this.investigationJobId,
                    input: {
                        url: "https://www.theverge.com/2023/6/28/23776690/gm-energy-ultium-home-ev-charging-v2h-stationary-storage",
                    },
                    metadata: {
                        view_data: {
                            nodeType: "job"
                        }
                    }
                },
                dedupe_key: "https://www.theverge.com/2023/6/28/23776690/gm-energy-ultium-home-ev-charging-v2h-stationary-storage"
            },
            event_types: [
                "STATUS_UPDATE",
                "OUTPUT_UPDATE",
                "HISTORY_APPEND",
                "MESSAGE",
                "FULL_UPDATE",
                "ON_COMPLETE",
            ],
        };

        CommunicationBus.getInstance().events.addListener("job-updated", this.onJobUpdated);

        CommunicationBus.getInstance().enqueueJob(investigationSpec).then((result) => {
            console.log(result);
        });

        // create investigation job
        // change view
        // submit job

        //this.investigationView.showDebugTree();
    }

    onJobUpdated({ job_id, job }) {
        if (job_id == this.investigationJobId) {
            if (this.investigationModel == null) {
                this.investigationModel = new InvestigationModel(job);

                let goAheadAndAnimateThis = () => {
                    this.investigationView.applyModel(this.investigationModel);
                    setTimeout(goAheadAndAnimateThis, 1000);
                };

                goAheadAndAnimateThis();
            }

            this.investigationModel.applyJob(job);
        }
        else {
            this.investigationModel.updateJob(job);
        }

        console.log(job);
        this.investigationView.applyModel(this.investigationModel);
    }

    setState(state) {
        switch (state) {
            case InvestigationController.States.IDLE:
                break;
            case InvestigationController.States.INVESTIGATING:
                this.urlInput.hide();
                this.investigationView.show();
                break;
        }

        this.state = state;
    }
}

export { InvestigationController };