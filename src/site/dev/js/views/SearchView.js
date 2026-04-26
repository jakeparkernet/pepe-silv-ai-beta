import { JobView } from "./JobView.js";

class SearchView extends JobView {
    
    getAttachPoint(direction = "input", travelDirection = "auto") {
        const size = this.getSize().clone();
        const attachPoint = new THREE.Vector3();

        if (direction != "input") {
            if (travelDirection == "auto") {
                travelDirection = this.travelDirection;
            }

            switch (travelDirection) {
                case "left":
                    attachPoint.set(-size.x, 0, 0);
                    break;
                case "right":
                    attachPoint.set(size.x, 0, 0);
                    break;
                default:
                    attachPoint.set(0, 0, 0);
                    break;
            }
        }

        return this.getRootGroup().localToWorld(attachPoint);
    }
}

export { SearchView };