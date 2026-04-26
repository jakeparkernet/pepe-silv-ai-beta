import { TextService } from "./TextService.js";

export function bigStringTest(parentView) {
    let bigStr = "";
    let lineLength = 500;
    for (let i = 0; i < 100000; i++) {
        bigStr += "a";

        if (i % lineLength == 0) {
            bigStr += "\n";
        }
    }

    let text = TextService.getText("title", {text: bigStr});
    parentView.addToRoot(text);
    text.position.set(-200, 50, -100);
}