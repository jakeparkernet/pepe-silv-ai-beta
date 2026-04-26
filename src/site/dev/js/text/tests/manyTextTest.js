import { TextService } from "./TextService.js";

export function manyTextTest (parentView) {
        let bigStr = "";
        let lineLength = 500;
        for (let i = 0; i < 100000; i++) {
            bigStr += "a";

            if (i % lineLength == 0) {
                let text = TextService.getText("title", {text: bigStr});
                parentView.addToRoot(text);
                text.rotation.set(0, 0, Math.random());
            }
        }

}