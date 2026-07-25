import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export type ClientEffectLevel = 'off' | 'subtle' | 'full';

export interface PostEffectProfile {
  bloom: number;
  ssao: number;
  depthOfField: number;
  lensFlare: number;
  sunRays: number;
}

const POST_EFFECT_SHADER = {
  name: 'BunnylandRoomPostEffects',
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    cameraNear: { value: 0.08 },
    cameraFar: { value: 180 },
    focusDistance: { value: 5.4 },
    sunPosition: { value: new THREE.Vector2(0.5, 0.5) },
    sunVisible: { value: 0 },
    bloomStrength: { value: 0 },
    ssaoStrength: { value: 0 },
    depthOfFieldStrength: { value: 0 },
    lensFlareStrength: { value: 0 },
    sunRayStrength: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    #include <common>
    #include <packing>

    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 resolution;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform float focusDistance;
    uniform vec2 sunPosition;
    uniform float sunVisible;
    uniform float bloomStrength;
    uniform float ssaoStrength;
    uniform float depthOfFieldStrength;
    uniform float lensFlareStrength;
    uniform float sunRayStrength;
    varying vec2 vUv;

    float sceneDepth(vec2 uv) {
      float depth = texture2D(tDepth, clamp(uv, vec2(0.001), vec2(0.999))).x;
      return -perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
    }

    vec3 colorAt(vec2 uv) {
      return texture2D(tDiffuse, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
    }

    void main() {
      vec2 texel = 1.0 / max(resolution, vec2(1.0));
      vec3 source = colorAt(vUv);
      vec3 nearby = source;
      vec3 result = source;
      if (bloomStrength > 0.0 || depthOfFieldStrength > 0.0) {
        nearby =
          colorAt(vUv + vec2(texel.x, 0.0)) +
          colorAt(vUv - vec2(texel.x, 0.0)) +
          colorAt(vUv + vec2(0.0, texel.y)) +
          colorAt(vUv - vec2(0.0, texel.y)) +
          colorAt(vUv + texel * 1.75) +
          colorAt(vUv - texel * 1.75) +
          colorAt(vUv + vec2(texel.x, -texel.y) * 1.75) +
          colorAt(vUv + vec2(-texel.x, texel.y) * 1.75);
        nearby *= 0.125;
        vec3 bright = max(nearby - vec3(0.78), vec3(0.0));
        result += bright * bloomStrength * 0.72;
      }

      float centerDepth = sceneDepth(vUv);
      if (ssaoStrength > 0.0) {
        float occlusion = 0.0;
        vec2 aoTexel = texel * 2.25;
        float neighborDepth = sceneDepth(vUv + vec2(aoTexel.x, 0.0));
        occlusion += smoothstep(0.025, 0.9, max(centerDepth - neighborDepth, 0.0));
        neighborDepth = sceneDepth(vUv - vec2(aoTexel.x, 0.0));
        occlusion += smoothstep(0.025, 0.9, max(centerDepth - neighborDepth, 0.0));
        neighborDepth = sceneDepth(vUv + vec2(0.0, aoTexel.y));
        occlusion += smoothstep(0.025, 0.9, max(centerDepth - neighborDepth, 0.0));
        neighborDepth = sceneDepth(vUv - vec2(0.0, aoTexel.y));
        occlusion += smoothstep(0.025, 0.9, max(centerDepth - neighborDepth, 0.0));
        result *= 1.0 - (occlusion * 0.25 * ssaoStrength);
      }

      if (depthOfFieldStrength > 0.0) {
        float focusDelta = abs(centerDepth - focusDistance) / max(focusDistance, 1.0);
        float depthBlur = smoothstep(0.38, 1.35, focusDelta) * depthOfFieldStrength;
        result = mix(result, nearby, depthBlur);
      }

      if (sunVisible > 0.0 && (lensFlareStrength > 0.0 || sunRayStrength > 0.0)) {
        vec2 sunDelta = vUv - sunPosition;
        sunDelta.x *= resolution.x / max(resolution.y, 1.0);
        float sunDistance = length(sunDelta);
        float sunDepth = texture2D(tDepth, clamp(sunPosition, vec2(0.001), vec2(0.999))).x;
        float sunClear = smoothstep(0.994, 0.9998, sunDepth);
        vec3 sunlight = vec3(1.0, 0.88, 0.67);
        float flare = pow(max(0.0, 1.0 - sunDistance * 3.1), 5.0);
        float halo = pow(max(0.0, 1.0 - abs(sunDistance - 0.18) * 6.5), 8.0);
        result += sunlight * (flare + halo * 0.12) * lensFlareStrength * sunClear;

        if (sunRayStrength > 0.0) {
          float rayVisibility = 0.0;
          rayVisibility += step(0.997, texture2D(tDepth, mix(vUv, sunPosition, 0.18)).x);
          rayVisibility += step(0.997, texture2D(tDepth, mix(vUv, sunPosition, 0.34)).x);
          rayVisibility += step(0.997, texture2D(tDepth, mix(vUv, sunPosition, 0.50)).x);
          rayVisibility += step(0.997, texture2D(tDepth, mix(vUv, sunPosition, 0.66)).x);
          float rayFalloff = pow(max(0.0, 1.0 - sunDistance * 0.72), 2.0);
          result += sunlight * rayVisibility * 0.25 * rayFalloff * sunRayStrength * sunClear;
        }
      }

      gl_FragColor = vec4(result, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

export class RoomPostEffects {
  private readonly composer: EffectComposer;
  private readonly effectPass: ShaderPass;
  private profile: PostEffectProfile = {
    bloom: 0,
    ssao: 0,
    depthOfField: 0,
    lensFlare: 0,
    sunRays: 0,
  };
  private profileScale = 0;
  private width = 1;
  private height = 1;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    const target = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: true,
      stencilBuffer: false,
      type: THREE.UnsignedByteType,
    });
    target.texture.name = 'BunnylandPostEffects.color';
    target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    target.depthTexture.name = 'BunnylandPostEffects.depth';
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(Math.min(renderer.getPixelRatio(), 1));
    this.composer.addPass(new RenderPass(scene, camera));
    this.effectPass = new ShaderPass(POST_EFFECT_SHADER);
    this.effectPass.material.name = 'BunnylandRoomPostEffects';
    this.composer.addPass(this.effectPass);
    this.effectPass.uniforms.cameraNear.value = camera.near;
    this.effectPass.uniforms.cameraFar.value = camera.far;
  }

  setProfile(profile: PostEffectProfile, scale: number): void {
    this.profile = { ...profile };
    this.profileScale = scale;
    this.effectPass.uniforms.bloomStrength.value = profile.bloom * scale;
    this.effectPass.uniforms.ssaoStrength.value = profile.ssao * scale;
    this.effectPass.uniforms.depthOfFieldStrength.value = profile.depthOfField * scale;
    this.effectPass.uniforms.lensFlareStrength.value = profile.lensFlare * scale;
    this.effectPass.uniforms.sunRayStrength.value = profile.sunRays * scale;
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.composer.setSize(this.width, this.height);
    this.effectPass.uniforms.resolution.value.set(this.width, this.height);
  }

  render(
    delta: number,
    focusDistance: number,
    sunPosition: THREE.Vector2,
    sunVisible: boolean,
  ): void {
    this.effectPass.uniforms.tDepth.value = this.composer.readBuffer.depthTexture;
    this.effectPass.uniforms.focusDistance.value = focusDistance;
    this.effectPass.uniforms.sunPosition.value.copy(sunPosition);
    this.effectPass.uniforms.sunVisible.value = sunVisible ? 1 : 0;
    this.composer.render(delta);
  }

  capturePng(
    width: number,
    height: number,
    focusDistance: number,
    sunPosition: THREE.Vector2,
    sunVisible: boolean,
  ): string {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      canvas,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    renderer.outputColorSpace = this.renderer.outputColorSpace;
    renderer.toneMapping = this.renderer.toneMapping;
    renderer.toneMappingExposure = this.renderer.toneMappingExposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = this.renderer.shadowMap.type;
    const effects = new RoomPostEffects(renderer, this.scene, this.camera);
    effects.setProfile(this.profile, this.profileScale);
    effects.setSize(width, height);
    effects.render(0, focusDistance, sunPosition, sunVisible);
    renderer.getContext().finish();
    const dataUrl = canvas.toDataURL('image/png');
    effects.dispose();
    renderer.dispose();
    return dataUrl;
  }

  dispose(): void {
    this.effectPass.dispose();
    this.composer.dispose();
  }
}
