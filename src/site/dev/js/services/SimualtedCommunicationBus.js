import { Events } from "../utils/Events.js";

class SimualtedCommunicationBus {
    constructor () {
        this.events = new Events();
    }

    static getInstance() {
        if (SimualtedCommunicationBus.instance == null) {
            SimualtedCommunicationBus.instance = new SimualtedCommunicationBus();
        }

        return SimualtedCommunicationBus.instance;
    }

    enqueueJob(jobSpec) {
        return new Promise(async (resolve, reject) => {
            let data = {
                status: "ok"
            }
            resolve(data);
        });
    }
}

export { SimualtedCommunicationBus };