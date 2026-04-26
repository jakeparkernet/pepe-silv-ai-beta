import { Events } from "./Events.js"

class Ticker {
    constructor (options = {}) {
        this.update = this.update.bind(this);
        
        const DEFAULT_FPS = 60;

        this.fps = options["fps"] || DEFAULT_FPS
        this.events = new Events();

        requestAnimationFrame(this.update);
    }

    update () {
        if (this.prevTime == null) {
            this.prevTime = now();
        }

        let deltaTime = now() - prevTime;

        this.events.fire("tick", deltaTime);
    }
}

export { Ticker };