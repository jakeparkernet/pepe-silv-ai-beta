class Events {
    constructor() {
        this.addListener = this.addListener.bind(this);
        this.removeListener = this.removeListener.bind(this);
        this.fire = this.fire.bind(this);

        this.listeners = {};
    }

    addListener (key, callback) {
        if (this.listeners[key] == null) {
            this.listeners[key] = [];
        }

        if (this.listeners[key].includes(callback)) {
            return;
        }

        this.listeners[key].push(callback);
    }

    removeListener (key, callback) {
        if (this.listeners[key] == null) {
            return;
        }
        
        let index = this.listeners[key].indexOf(callback);

        if (index < 0) {
            return;
        }

        this.listeners[key].splice(index, 1);
    }

    fire (key, args) {
        if (this.listeners[key] == null) {
            return;
        }

        let callbacks = this.listeners[key];
        for (let i = 0; i < callbacks.length; i++) {
            callbacks[i](args);
        }
    }
}

export { Events };