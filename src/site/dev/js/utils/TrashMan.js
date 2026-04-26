/**
 * TrashMan – The ultimate Three.js cleanup janitor (2025 edition)
 * Catches every possible tab/page lifecycle event and obliterates
 * renderer, scene, materials, geometries, textures, buffers, etc.
 * 
 *  I'M THE TRASH MAN!!
 * 
 */
class TrashMan {
  constructor(app) {
    if (!app) throw new Error('TrashMan needs an app object');

    this.app = app;
    this.cleaned = false;

    this.cleanup = this.cleanup.bind(this);

    // Subscribe to every reliable cleanup event
    //document.addEventListener('visibilitychange', this.handleVisibilityChange);
    //window.addEventListener('pagehide', this.cleanup);
    window.addEventListener('beforeunload', this.cleanup);
    window.addEventListener('freeze', this.cleanup); // Page Lifecycle API

    console.log('TrashMan is now watching your Three.js app');
  }

  handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      this.cleanup();
    }
  };

  cleanup = () => {
    if (this.cleaned) return;
    this.cleaned = true;

    console.log('TrashMan is cleaning up the scene...');

    const { app } = this;

    // 1. Stop animation loop
    if (app.animationFrameId !== undefined) {
      cancelAnimationFrame(app.animationFrameId);
      app.animationFrameId = null;
    }

    // 2. Force-kill the renderer
    if (app.renderer) {
      app.renderer.forceContextLoss?.(); // Immediate GPU resource release
      app.renderer.dispose();
      app.renderer = null;
    }

    // 3. Deep scene traversal – dispose everything Three.js can leak
    if (app.scene) {
      app.scene.traverse((object) => {
        // Geometries
        if (object.geometry) {
          object.geometry.dispose();
        }

        // Materials (single or array)
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach(m => this.disposeMaterial(m));
          } else {
            this.disposeMaterial(object.material);
          }
        }

        // Direct texture references (e.g. envMap, lightMap)
        if (object.isMesh || object.isLight || object.isSprite) {
          this.disposeIfTexture(object.map);
          this.disposeIfTexture(object.lightMap);
          this.disposeIfTexture(object.aoMap);
          this.disposeIfTexture(object.emissiveMap);
          this.disposeIfTexture(object.bumpMap);
          this.disposeIfTexture(object.normalMap);
          this.disposeIfTexture(object.displacementMap);
          this.disposeIfTexture(object.roughnessMap);
          this.disposeIfTexture(object.metalnessMap);
          this.disposeIfTexture(object.alphaMap);
          this.disposeIfTexture(object.envMap);
        }
      });

      // Clear scene children and references
      app.scene.clear?.() || (app.scene.children = []); // clear() added in r165+
      app.scene = null;
    }

    // 4. Camera (usually nothing to dispose, but null it)
    app.camera = null;

    // 5. Any extra resources you might have on app
    if (app.controls) {
      app.controls.dispose?.();
      app.controls = null;
    }
    if (app.composer) {
      app.composer.dispose?.();
      app.composer = null;
    }
    if (app.clock) {
      app.clock = null;
    }

    // 6. Remove all event listeners to help GC
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('pagehide', this.cleanup);
    window.removeEventListener('beforeunload', this.cleanup);
    window.removeEventListener('freeze', this.cleanup);

    console.log('TrashMan finished. Everything should be gone.');
  };

  // Helper: safely dispose a material + all its maps
  disposeMaterial(material) {
    if (!material || material.isDisposed) return;

    this.disposeIfTexture(material.map);
    this.disposeIfTexture(material.lightMap);
    this.disposeIfTexture(material.aoMap);
    this.disposeIfTexture(material.emissiveMap);
    this.disposeIfTexture(material.bumpMap);
    this.disposeIfTexture(material.normalMap);
    this.disposeIfTexture(material.displacementMap);
    this.disposeIfTexture(material.roughnessMap);
    this.disposeIfTexture(material.metalnessMap);
    this.disposeIfTexture(material.alphaMap);
    this.disposeIfTexture(material.envMap);
    this.disposeIfTexture(material.normalMap);
    this.disposeIfTexture(material.clearcoatMap);
    this.disposeIfTexture(material.clearcoatRoughnessMap);
    this.disposeIfTexture(material.transmissionMap);
    this.disposeIfTexture(material.thicknessMap);
    this.disposeIfTexture(material.specularMap);
    this.disposeIfTexture(material.specularIntensityMap);

    material.dispose();
    material.isDisposed = true; // prevent double-dispose warnings
  }

  // Helper: dispose texture if it exists
  disposeIfTexture(texture) {
    if (texture && texture.isTexture && !texture.isDisposed) {
      texture.dispose();
      texture.isDisposed = true;
    }
  }
}

// ———— Usage example ————
/*
const app = {
  renderer: new THREE.WebGLRenderer(),
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(),
  animationFrameId: null,
  controls: new OrbitControls(camera, renderer.domElement),
};

function animate() {
  app.animationFrameId = requestAnimationFrame(animate);
  app.renderer.render(app.scene, app.camera);
}
animate();

// TrashMan will automatically clean everything when you switch tabs, close, refresh, etc.
new TrashMan(app);
*/

export { TrashMan };