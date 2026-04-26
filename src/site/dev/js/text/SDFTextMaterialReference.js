import {
  ShaderMaterial,
  Color,
  DoubleSide,
  Vector3
} from "three";

class SDFTextMaterialReference {
  constructor(params = {}) {
    const {
      map = null,
      color = 0xffffff,
      opacity = 1.0,
      threshold = 0.5,
      softness = 0.1,
      outlineColor = 0x000000,
      outlineThickness = 0.0,
      outlineOpacity = 0.0,
      useInstancing = true,
      light = null,
      lightTarget = null,
      camera = null,
      ambientStrength = 0.12,
      diffuseStrength = 0.18,
      specularStrength = 0.9,
      sheenStrength = 0.45,
      sheenPower = 36.0,
      lightIntensityScale = 0.01
    } = params;

    this._light = light;
    this._lightTarget = lightTarget;
    this._camera = camera;
    this._tmpTargetPosition = new Vector3();

    const uniforms = {
      uMap: { value: map },
      uColor: { value: new Color(color) },
      uOpacity: { value: opacity },
      uThreshold: { value: threshold },
      uSoftness: { value: softness },
      uOutlineColor: { value: new Color(outlineColor) },
      uOutlineThickness: { value: outlineThickness },
      uOutlineOpacity: { value: outlineOpacity },
      uLightPosition: { value: new Vector3() },
      uLightDirection: { value: new Vector3(0, 0, -1) },
      uLightColor: { value: new Color(0xffffff) },
      uLightIntensity: { value: 1.0 },
      uLightAngleCos: { value: Math.cos(Math.PI / 4) },
      uLightPenumbraCos: { value: Math.cos(Math.PI / 3) },
      uCameraPosition: { value: new Vector3() },
      uAmbientStrength: { value: ambientStrength },
      uDiffuseStrength: { value: diffuseStrength },
      uSpecularStrength: { value: specularStrength },
      uSheenStrength: { value: sheenStrength },
      uSheenPower: { value: sheenPower },
      uLightIntensityScale: { value: lightIntensityScale }
    };

    const vertexShader = useInstancing ? `
      attribute vec2 aGlyphPos;
      attribute vec2 aGlyphScale;
      attribute vec4 aGlyphUVRect;
      attribute float aInstanceVisible;

      varying float vVisible;
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      void main() {
        vec3 localPos = position;
        localPos.xy = localPos.xy * aGlyphScale + aGlyphPos;

        mat4 worldMatrix = modelMatrix * instanceMatrix;
        vec4 worldPosition = worldMatrix * vec4(localPos, 1.0);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;

        vUv = mix(aGlyphUVRect.xy, aGlyphUVRect.zw, uv);
        vVisible = aInstanceVisible;
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(worldMatrix) * vec3(0.0, 0.0, 1.0));
      }
    ` : `
      varying float vVisible;
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
        vUv = uv;
        vVisible = 1.0;
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
      }
    `;

    const fragmentShader = `
      #ifdef GL_OES_standard_derivatives
      #extension GL_OES_standard_derivatives : enable
      #endif

      uniform sampler2D uMap;
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uThreshold;
      uniform float uSoftness;
      uniform vec3 uOutlineColor;
      uniform float uOutlineThickness;
      uniform float uOutlineOpacity;
      uniform vec3 uLightPosition;
      uniform vec3 uLightDirection;
      uniform vec3 uLightColor;
      uniform float uLightIntensity;
      uniform float uLightAngleCos;
      uniform float uLightPenumbraCos;
      uniform vec3 uCameraPosition;
      uniform float uAmbientStrength;
      uniform float uDiffuseStrength;
      uniform float uSpecularStrength;
      uniform float uSheenStrength;
      uniform float uSheenPower;
      uniform float uLightIntensityScale;

      varying float vVisible;
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      void main() {
        if (vVisible < 0.5) {
          discard;
        }

        vec4 tex = texture2D(uMap, vUv);
        float dist = tex.a > 0.0 ? tex.a : max(max(tex.r, tex.g), tex.b);
        float width = fwidth(dist);
        float softness = max(uSoftness * width, 1e-6);
        float alpha = smoothstep(uThreshold - softness, uThreshold + softness, dist);

        float outlineAlpha = 0.0;
        if (uOutlineThickness > 0.0) {
          float outlineEdge = uThreshold - uOutlineThickness;
          outlineAlpha = smoothstep(outlineEdge - softness, outlineEdge + softness, dist);
        }

        vec3 baseColor = uColor;
        float baseAlpha = alpha;

        if (uOutlineThickness > 0.0) {
          float mask = clamp(outlineAlpha - alpha, 0.0, 1.0);
          baseColor = mix(baseColor, uOutlineColor, mask);
          baseAlpha = max(alpha, outlineAlpha * uOutlineOpacity);
        }

        baseAlpha *= uOpacity;
        if (baseAlpha <= 0.0) {
          discard;
        }

        vec3 N = normalize(vWorldNormal);
        vec3 L = normalize(uLightPosition - vWorldPosition);
        vec3 V = normalize(uCameraPosition - vWorldPosition);
        vec3 H = normalize(L + V);

        float NdotL = max(dot(N, L), 0.0);
        float NdotH = max(dot(N, H), 0.0);

        vec3 lightToFragment = normalize(vWorldPosition - uLightPosition);
        float spotCos = dot(lightToFragment, normalize(uLightDirection));
        float spotFactor = smoothstep(uLightPenumbraCos, uLightAngleCos, spotCos);

        float attenuation = spotFactor * uLightIntensity * uLightIntensityScale;
        float diffuseTerm = NdotL * uDiffuseStrength * attenuation;
        float specularTerm = pow(NdotH, uSheenPower) * uSpecularStrength * attenuation;
        float sheenTerm = pow(NdotH, max(1.0, uSheenPower * 0.5)) * uSheenStrength * attenuation;

        vec3 litColor =
          (baseColor * (uAmbientStrength + diffuseTerm))
          + (uLightColor * specularTerm)
          + (baseColor * sheenTerm);

        gl_FragColor = vec4(litColor, baseAlpha);
      }
    `;

    const material = new ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: DoubleSide
    });

    material.extensions = material.extensions || {};
    material.extensions.derivatives = true;

    material.onBeforeRender = () => {
      this._updateLightingUniforms();
    };

    this._material = material;
    this._uniforms = uniforms;
  }

  _updateLightingUniforms() {
    if (this._light) {
      this._light.getWorldPosition(this._uniforms.uLightPosition.value);
      this._uniforms.uLightColor.value.copy(this._light.color);
      this._uniforms.uLightIntensity.value = this._light.intensity;
      this._uniforms.uLightAngleCos.value = Math.cos(this._light.angle ?? (Math.PI / 4));

      const outerAngle = Math.min(
        Math.PI * 0.5,
        (this._light.angle ?? (Math.PI / 4)) * (1.0 + (this._light.penumbra ?? 0.0))
      );
      this._uniforms.uLightPenumbraCos.value = Math.cos(outerAngle);

      if (this._lightTarget && typeof this._lightTarget.getWorldPosition === "function") {
        const targetPosition = this._lightTarget.getWorldPosition(this._tmpTargetPosition);
        this._uniforms.uLightDirection.value
          .copy(targetPosition)
          .sub(this._uniforms.uLightPosition.value)
          .normalize();
      }
    }

    if (this._camera) {
      this._camera.getWorldPosition(this._uniforms.uCameraPosition.value);
    }
  }

  getMaterial() {
    return this._material;
  }

  set map(tex) {
    this._uniforms.uMap.value = tex;
  }
  get map() {
    return this._uniforms.uMap.value;
  }

  set color(value) {
    this._uniforms.uColor.value.set(value);
  }
  get color() {
    return this._uniforms.uColor.value;
  }

  set opacity(value) {
    this._uniforms.uOpacity.value = value;
  }
  get opacity() {
    return this._uniforms.uOpacity.value;
  }

  set threshold(value) {
    this._uniforms.uThreshold.value = value;
  }
  get threshold() {
    return this._uniforms.uThreshold.value;
  }

  set softness(value) {
    this._uniforms.uSoftness.value = value;
  }
  get softness() {
    return this._uniforms.uSoftness.value;
  }

  set outlineColor(value) {
    this._uniforms.uOutlineColor.value.set(value);
  }
  get outlineColor() {
    return this._uniforms.uOutlineColor.value;
  }

  set outlineThickness(value) {
    this._uniforms.uOutlineThickness.value = value;
  }
  get outlineThickness() {
    return this._uniforms.uOutlineThickness.value;
  }

  set outlineOpacity(value) {
    this._uniforms.uOutlineOpacity.value = value;
  }
  get outlineOpacity() {
    return this._uniforms.uOutlineOpacity.value;
  }

  set ambientStrength(value) {
    this._uniforms.uAmbientStrength.value = value;
  }
  get ambientStrength() {
    return this._uniforms.uAmbientStrength.value;
  }

  set diffuseStrength(value) {
    this._uniforms.uDiffuseStrength.value = value;
  }
  get diffuseStrength() {
    return this._uniforms.uDiffuseStrength.value;
  }

  set specularStrength(value) {
    this._uniforms.uSpecularStrength.value = value;
  }
  get specularStrength() {
    return this._uniforms.uSpecularStrength.value;
  }

  set sheenStrength(value) {
    this._uniforms.uSheenStrength.value = value;
  }
  get sheenStrength() {
    return this._uniforms.uSheenStrength.value;
  }

  set sheenPower(value) {
    this._uniforms.uSheenPower.value = value;
  }
  get sheenPower() {
    return this._uniforms.uSheenPower.value;
  }

  set lightIntensityScale(value) {
    this._uniforms.uLightIntensityScale.value = value;
  }
  get lightIntensityScale() {
    return this._uniforms.uLightIntensityScale.value;
  }
}

export { SDFTextMaterialReference };
