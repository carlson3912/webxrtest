// WebXR type declarations
declare global {
  interface Navigator {
    xr?: XRSystem;
  }

  interface XRSystem {
    isSessionSupported(sessionMode: string): Promise<boolean>;
    requestSession(sessionMode: string, options?: XRSessionInit): Promise<XRSession>;
  }

  interface XRSessionInit {
    optionalFeatures?: string[];
    requiredFeatures?: string[];
  }

  interface XRSession extends EventTarget {
    renderState: XRRenderState;
    inputSources: XRInputSourceArray;
    updateRenderState(state: XRRenderStateInit): void;
    requestReferenceSpace(type: string): Promise<XRReferenceSpace>;
    requestAnimationFrame(callback: XRFrameRequestCallback): number;
    end(): Promise<void>;
  }

  interface XRRenderState {
    baseLayer: XRWebGLLayer | null;
  }

  interface XRRenderStateInit {
    baseLayer?: XRWebGLLayer;
  }

  interface XRWebGLLayer {
    framebuffer: WebGLFramebuffer | null;
    getViewport(view: XRView): XRViewport | null;
  }

  interface XRViewport {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  interface XRReferenceSpace {}

  interface XRFrame {
    session: XRSession;
    getViewerPose(referenceSpace: XRReferenceSpace): XRViewerPose | null;
    getJointPose?(joint: XRJointSpace, referenceSpace: XRReferenceSpace): XRJointPose | null;
  }

  interface XRViewerPose {
    transform: XRRigidTransform;
    views: XRView[];
  }

  interface XRView {
    eye: string;
    projectionMatrix: Float32Array;
    transform: XRRigidTransform;
  }

  interface XRRigidTransform {
    position: DOMPointReadOnly;
    orientation: DOMPointReadOnly;
    matrix: Float32Array;
    inverse: XRRigidTransform;
  }

  interface XRInputSourceArray extends Array<XRInputSource> {}

  interface XRInputSource {
    handedness: string;
    hand?: XRHand;
  }

  interface XRHand extends Map<string, XRJointSpace> {}

  interface XRJointSpace {}

  interface XRJointPose {
    transform: XRRigidTransform;
    radius?: number;
  }

  type XRHandJoint = string;

  type XRFrameRequestCallback = (time: DOMHighResTimeStamp, frame: XRFrame) => void;

  // WebGL XR extensions
  interface WebGLRenderingContext {
    makeXRCompatible(): Promise<void>;
  }

  // XRWebGLLayer constructor
  var XRWebGLLayer: {
    new (session: XRSession, gl: WebGLRenderingContext): XRWebGLLayer;
  };
}

export {};
