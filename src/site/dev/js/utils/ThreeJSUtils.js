export function disposeMesh(mesh) {
  if (mesh.geometry) mesh.geometry.dispose();

  if (Array.isArray(mesh.material)) {
    mesh.material.forEach(disposeMaterial);
  } else if (mesh.material) {
    disposeMaterial(mesh.material);
  }
}

export function disposeMaterial(material) {
  for (const key in material) {
    const value = material[key];
    if (value && value.isTexture) {
      value.dispose();
    }
  }
  material.dispose();
}

export function applyTextureProperties (texture, params) {
    for (const [key, value] of Object.entries(params)) {
        texture[key] = value;
    }

    return texture;
}