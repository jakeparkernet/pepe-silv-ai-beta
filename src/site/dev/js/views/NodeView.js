// import { View } from "./View.js";
import * as THREE from "three";

const appModules = window[`apps_${performance.timeOrigin}`].modules;
const { View } = appModules.views.View;

class NodeView extends View {
  constructor() {
    super();

    this.id = crypto.randomUUID();
    this.size = this.getDefaultSize();

    this.travelDirection = "up";

    this.textContainer = new THREE.Group();
    this.addToRoot(this.textContainer);
  }

  getAttachPoint(direction = "input", travelDirection = "auto") {

    const axisSide = direction === "input" ? -1 : 1;
    const size = this.getSize().clone();
    const attachPoint = new THREE.Vector3();

    if (travelDirection == "auto") {
      travelDirection = this.travelDirection;
    }

    switch (travelDirection) {
      case "up":
        attachPoint.set(0, size.y * 0.5 * axisSide, 0);
        break;
      case "down":
        attachPoint.set(0, -size.y * 0.5 * axisSide, 0);
        break;
      case "left":
        attachPoint.set(-size.x * 0.5 * axisSide, 0, 0);
        break;
      case "right":
        attachPoint.set(size.x * 0.5 * axisSide, 0, 0);
        break;
      default:
        attachPoint.set(0, size.y * 0.5 * axisSide, 0);
        break;
    }

    return this.getRootGroup().localToWorld(attachPoint);
  }

  setTravelDirection (travelDirection) {
    this.travelDirection = travelDirection;
  }

  refreshSize() { }

  getSize() {
    return this.size;
  }

  getDefaultSize () {
    return new THREE.Vector3(1, 1, 1);
  }

  alignToWorldUp() {
    const root = this.getRootGroup();
    const parent = root.parent;
    if (!parent) return;

    const parentWorldQuat = parent.getWorldQuaternion(new THREE.Quaternion());
    const invParentWorldQuat = parentWorldQuat.clone().invert();

    root.quaternion.copy(invParentWorldQuat);
  }
}

export { NodeView };
