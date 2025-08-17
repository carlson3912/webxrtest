import React, { useRef, useState, useEffect } from 'react';

interface StereoVRProps {
  streamLeft: MediaStream | null;
  streamRight: MediaStream | null;
}

export default function StereoVR({ streamLeft, streamRight }: StereoVRProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const leftVideoRef = useRef<HTMLVideoElement>(null);
  const rightVideoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState('');
  
  useEffect(() => {
    // Whenever streamLeft updates, set it as srcObject for left video element
    if (leftVideoRef.current && streamLeft) {
      leftVideoRef.current.srcObject = streamLeft;
      leftVideoRef.current.play().catch(console.warn);
    }
  }, [streamLeft]);

  useEffect(() => {
    if (rightVideoRef.current && streamRight) {
      rightVideoRef.current.srcObject = streamRight;
      rightVideoRef.current.play().catch(console.warn);
    }
  }, [streamRight]);

  const updateStatus = (msg: string) => {
    console.log(msg);
    setStatus(msg);
  };

  const startVR = async () => {
    updateStatus('Starting VR...');

    if (!navigator.xr) {
      updateStatus('WebXR not supported');
      alert('WebXR not supported in this browser');
      return;
    }

    const isVRSupported = await navigator.xr.isSessionSupported('immersive-vr');
    if (!isVRSupported) {
      updateStatus('VR not supported');
      alert('VR not supported in this browser');
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { xrCompatible: true });
    if (!gl) {
      updateStatus('WebGL not supported');
      return;
    }

    // Video elements
    const leftVideo = leftVideoRef.current!;
    const rightVideo = rightVideoRef.current!;

    const handleVideoError = (videoEl: HTMLVideoElement, name: string) => {
      videoEl.onerror = () => {
        const err = videoEl.error;
        if (!err) return;
        updateStatus(`${name} video error: ${err.message}`);
      };
    };

    handleVideoError(leftVideo, 'Left');
    handleVideoError(rightVideo, 'Right');

    // Set video properties for better loading
    leftVideo.muted = true;
    rightVideo.muted = true;
    leftVideo.playsInline = true;
    rightVideo.playsInline = true;
    leftVideo.preload = 'metadata';
    rightVideo.preload = 'metadata';

    // Wait for videos to load
    updateStatus('Loading videos...');
    
    const waitForVideo = (video: HTMLVideoElement): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (video.readyState >= 2) {
          resolve();
          return;
        }
        
        const onLoadedData = () => {
          video.removeEventListener('loadeddata', onLoadedData);
          video.removeEventListener('error', onError);
          resolve();
        };
        
        const onError = () => {
          video.removeEventListener('loadeddata', onLoadedData);
          video.removeEventListener('error', onError);
          reject(new Error(`Video failed to load: ${video.src}`));
        };
        
        video.addEventListener('loadeddata', onLoadedData);
        video.addEventListener('error', onError);
        video.load();
      });
    };

    try {
      await Promise.all([
        waitForVideo(leftVideo),
        waitForVideo(rightVideo)
      ]);
      updateStatus('Videos loaded, starting playback...');
      
      await leftVideo.play();
      await rightVideo.play();
      updateStatus('Videos playing');
    } catch (err) {
      updateStatus(`Video error: ${err}`);
      console.error('Video play failed', err);
      return;
    }

    // Shaders - fixed vertex shader
    const vertexShaderSource = `
      attribute vec2 position;
      varying vec2 vUV;
      void main() {
        vUV = (position + 1.0) / 2.0;
        // Flip Y coordinate for proper video orientation
        vUV.y = 1.0 - vUV.y;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;
    const fragmentShaderSource = `
      precision mediump float;
      varying vec2 vUV;
      uniform sampler2D videoTexture;
      void main() {
        vec4 color = texture2D(videoTexture, vUV);
        // Add fallback color for debugging
        if (color.a < 0.1) {
          gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); // Red for debugging
        } else {
          gl_FragColor = color;
        }
      }
    `;

    const compileShader = (src: string, type: number) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(shader);
        updateStatus(`Shader compile error: ${error}`);
        console.error('Shader compile error:', error);
      }
      return shader;
    };

    const vertexShader = compileShader(vertexShaderSource, gl.VERTEX_SHADER);
    const fragmentShader = compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);

    const program = gl.createProgram()!;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const error = gl.getProgramInfoLog(program);
      updateStatus(`Program link error: ${error}`);
      console.error('Program link error:', error);
    }
    gl.useProgram(program);

    const quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const posLoc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const leftTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, leftTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const rightTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, rightTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const videoUniformLoc = gl.getUniformLocation(program, 'videoTexture');

    let session: XRSession;
    try {
      updateStatus('Requesting XR session...');
      session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor']
      });
      updateStatus('XR session created');
    } catch (err) {
      updateStatus(`Failed to start XR session: ${err}`);
      console.error('Failed to start XR session', err);
      return;
    }

    await gl.makeXRCompatible();
    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });

    const refSpace = await session.requestReferenceSpace('local-floor');
    updateStatus('Reference space created, starting render loop...');

    session.addEventListener('end', () => {
      updateStatus('XR session ended');
    });

    let frameCount = 0;
    const onXRFrame = (time: DOMHighResTimeStamp, frame: XRFrame) => {
      frameCount++;
      
      if (frameCount % 60 === 0) { // Log every 60 frames
        updateStatus(`Rendering frame ${frameCount}`);
      }

      const pose = frame.getViewerPose(refSpace);
      if (!pose) {
        session.requestAnimationFrame(onXRFrame);
        return;
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, session.renderState.baseLayer!.framebuffer);
      gl.clearColor(0.1, 0.1, 0.1, 1); // Slightly gray background for debugging
      gl.clear(gl.COLOR_BUFFER_BIT);

      pose.views.forEach((view, i) => {
        const viewport = session.renderState.baseLayer!.getViewport(view);
        gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);

        const video = i === 0 ? leftVideo : rightVideo;
        const texture = i === 0 ? leftTexture : rightTexture;

        // More detailed video ready check
        if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
          if (frameCount < 10) { // Only log for first few frames
            console.warn(`Eye ${i} video not ready: readyState=${video.readyState}, dimensions=${video.videoWidth}x${video.videoHeight}`);
          }
          // Render a colored quad as fallback
          gl.clearColor(i === 0 ? 0.2 : 0.0, 0.0, i === 1 ? 0.2 : 0.0, 1.0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          return;
        }

        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.activeTexture(gl.TEXTURE0);
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        } catch (err) {
          console.error(`texImage2D failed for eye ${i}:`, err);
          return;
        }
        
        gl.uniform1i(videoUniformLoc, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      });

      session.requestAnimationFrame(onXRFrame);
    };

    session.requestAnimationFrame(onXRFrame);
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      {!started && (
        <div>
          <button
            style={{ 
              fontSize: '24px', 
              padding: '12px 24px',
              marginBottom: '20px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer'
            }}
            onClick={async () => {
              setStarted(true);
              await startVR();
            }}
          >
            Start VR Experiment
          </button>
          <p style={{ fontSize: '16px', color: '#666' }}>
            Make sure your video files (/pi_L.mp4 and /pi_R.mp4) are accessible from your ngrok server.
          </p>
        </div>
      )}
      
      {status && (
        <div style={{ 
          padding: '10px', 
          backgroundColor: '#f8f9fa', 
          border: '1px solid #dee2e6', 
          borderRadius: '5px',
          marginBottom: '10px',
          fontSize: '14px'
        }}>
          Status: {status}
        </div>
      )}
      
      <video
        ref={leftVideoRef}
        src="/pi_L_web.mp4"
        crossOrigin="anonymous"
        style={{ display: 'none' }}
        muted
        playsInline
      />
      <video
        ref={rightVideoRef}
        src="/pi_R_web.mp4"
        crossOrigin="anonymous"
        style={{ display: 'none' }}
        muted
        playsInline
      />
      <canvas 
        ref={canvasRef} 
        style={{ 
          width: '100%', 
          height: '400px',
          border: '1px solid #ccc',
          display: started ? 'block' : 'none'
        }} 
      />
    </div>
  );
}