import { Events } from "../utils/Events.js";

class UrlInput {
    constructor ({container, input, submitButton}) {
        this.onSubmit = this.onSubmit.bind(this);

        this.container = container;
        this.input = input;
        this.submitButton = submitButton;

        this.events = new Events();

        this.submitButton.addEventListener('click', this.onSubmit);
    }

    show () {
        this.container.style.display = "flex";
    }

    hide () {
        this.container.style.display = "none";
    }

    onSubmit (event) {
        this.events.fire("url-submitted", this.input.value);
        console.log("click");
    }
}

export { UrlInput };