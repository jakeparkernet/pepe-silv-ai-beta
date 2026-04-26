import {
  BufferGeometry,
  Float32BufferAttribute,
  Uint16BufferAttribute
} from "three";

export function makeGlyphQuadGeometry() {
  const geom = new BufferGeometry();

  // A simple centered quad: (-0.5..0.5)
  const positions = new Float32Array([
    -0.5, -0.5, 0,
     0.5, -0.5, 0,
     0.5,  0.5, 0,
    -0.5,  0.5, 0
  ]);

  const uvs = new Float32Array([
    0, 0,
    1, 0,
    1, 1,
    0, 1
  ]);

  const indices = new Uint16BufferAttribute(
    new Uint16Array([0, 1, 2, 0, 2, 3]),
    1
  );

  geom.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geom.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);

  return geom;
}
