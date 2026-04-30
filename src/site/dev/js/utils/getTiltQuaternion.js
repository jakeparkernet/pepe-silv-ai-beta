import * as THREE from "three";
// import { forward } from "../utils/vectorConstants.js";
// 
const appModules = window[`apps_${performance.timeOrigin}`].modules;
const { forward } = appModules.utils.vectorConstants;

export function getTiltQuaternion({tiltRangeMin = -4.5, tiltRangeMax = 4.5, axis = forward} = {}) {
    return new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(
        THREE.MathUtils.randFloat(tiltRangeMin, tiltRangeMax)
    ));
}