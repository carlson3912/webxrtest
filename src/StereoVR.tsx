// StereoVR.tsx
import React, { useEffect, useRef, useState } from 'react';

export default function StereoVR() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const leftVideoRef = useRef<HTMLVideoElement>(null);
  const rightVideoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  const startVR = async () => {
    // Check if WebXR is supported
    if (!navigator.xr) {
      console.error('WebXR not supported');
      alert('WebXR not supported in this browser');
      return;
    }

    // Check if VR is supported
    const isVRSupported = await navigator.xr.isSessionSupported('immersive-vr');
    if (!isVRSupported) {
      console.error('VR not supported');
      alert('VR not supported in this browser');
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { xrCompatible: true });
    if (!gl) {
      console.error('WebGL not supported');
      return;
    }

    // Simple shaders
    const vertexShaderSource = `
      attribute vec2 position;
      varying vec2 vUV;
      void main() {
        vUV = (position + 1.0) / 2.0;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;
    const fragmentShaderSource = `
      precision mediump float;
      varying vec2 vUV;
      uniform sampler2D videoTexture;
      void main() {
        gl_FragColor = texture2D(videoTexture, vUV);
      }
    `;

    function compileShader(src: string, type: number) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
      }
      return shader;
    }

    const vertexShader = compileShader(vertexShaderSource, gl.VERTEX_SHADER);
    const fragmentShader = compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);

    const program = gl.createProgram()!;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);

    // Full-screen quad
    const quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        -1, 1,
        1, -1,
        1, 1
      ]),
      gl.STATIC_DRAW
    );

    const posLoc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Video elements
    const leftVideo = leftVideoRef.current!;
    const rightVideo = rightVideoRef.current!;

    function handleVideoError(videoEl: HTMLVideoElement, name: string) {
      videoEl.onerror = () => {
        const err = videoEl.error;
        if (!err) return;
        switch (err.code) {
          case err.MEDIA_ERR_SRC_NOT_SUPPORTED:
            console.error(`${name} format not supported or codec issue`);
            break;
          case err.MEDIA_ERR_NETWORK:
          case err.MEDIA_ERR_DECODE:
          case err.MEDIA_ERR_ABORTED:
            console.error(`${name} failed to load (file not found or network error)`);
            break;
          default:
            console.error(`${name} unknown video error`, err);
        }
      };
    }

    handleVideoError(leftVideo, 'Left video');
    handleVideoError(rightVideo, 'Right video');

    try {
      console.log('Attempting to play left video:', leftVideo.src);
      await leftVideo.play();
    } catch (err) {
      console.error('Left video play failed:', err);
    }

    try {
      console.log('Attempting to play right video:', rightVideo.src);
      await rightVideo.play();
    } catch (err) {
      console.error('Right video play failed:', err);
    }

    // Textures
    const leftTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, leftTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const rightTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, rightTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const videoUniformLoc = gl.getUniformLocation(program, 'videoTexture');

    // XR session with proper error handling
    let session;
    try {
      session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor'],
        requiredFeatures: []
      });
      console.log('XR session created successfully');
    } catch (error) {
      console.error('Failed to create XR session:', error);
      alert('Failed to start VR session. Please try again.');
      return;
    }

    if (!session) {
      console.error('No XR session created');
      return;
    }

    // **No motion tracking:** ignore pose, just render each eye the same way
    const renderLoop = () => {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      for (let eyeIndex = 0; eyeIndex < session.renderState.baseLayer!.framebufferWidth / 2; eyeIndex++) {
        const viewport = session.renderState.baseLayer!.getViewport({ eye: eyeIndex === 0 ? 'left' : 'right' } as any);
        gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);

        const video = eyeIndex === 0 ? leftVideo : rightVideo;
        const texture = eyeIndex === 0 ? leftTexture : rightTexture;

        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

        gl.uniform1i(videoUniformLoc, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      session.requestAnimationFrame(renderLoop);
    };

    session.requestAnimationFrame(renderLoop);
  };

  return (
    <div>
      {!started && (
        <button
          style={{ fontSize: '24px', padding: '12px 24px' }}
          onClick={async () => {
            setStarted(true);
            await startVR();
          }}
        >
          Start VR
        </button>
      )}
      <video
        ref={leftVideoRef}
        src="/left_undistorted.mp4"
        crossOrigin="anonymous"
        style={{ display: 'none' }}
      />
      <video
        ref={rightVideoRef}
        src="/right_undistorted.mp4"
        crossOrigin="anonymous"
        style={{ display: 'none' }}
      />
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
