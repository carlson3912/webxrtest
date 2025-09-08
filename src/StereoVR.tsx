import React, { useRef, useState, useEffect } from 'react';

interface StereoVRProps {
  streamLeft: MediaStream | null;
  streamRight: MediaStream | null;
  url: string;
}

export default function StereoVR({ streamLeft, streamRight, url }: StereoVRProps) {
  const canvasRef = useRef(null);
  const leftVideoRef = useRef(null);
  const rightVideoRef = useRef(null);
  const lastHandSendRef = useRef<number>(0);
  const logsRef = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  
  useEffect(() => {
    // Whenever streamLeft updates, set it as srcObject for left video element
    if (leftVideoRef.current && streamLeft) {
      leftVideoRef.current.srcObject = streamLeft;
      leftVideoRef.current.play().catch(e => console.log(`Left video play warning: ${e.message}`));
    }
  }, [streamLeft]);

  useEffect(() => {
    if (rightVideoRef.current && streamRight) {
      rightVideoRef.current.srcObject = streamRight;
      rightVideoRef.current.play().catch(e => console.log(`Right video play warning: ${e.message}`));
    }
  }, [streamRight]);

  const updateStatus = (msg: string) => {
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
      addLog(`Video play failed: ${err}`);
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
        addLog(`Shader compile error: ${error}`);
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
        optionalFeatures: ['hand-tracking']
      });
      updateStatus('XR session created');
      
    } catch (err) {
      updateStatus(`Failed to start XR session: ${err}`);
      return;
    }

    await gl.makeXRCompatible();
    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });

    const refSpace = await session.requestReferenceSpace('viewer');
    updateStatus('Reference space created, starting render loop...');

    // Setup WebSocket connection for hand tracking data
    await setupHandTrackingWebSocket();

    session.addEventListener('end', () => {
      updateStatus('XR session ended');
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    });

    let frameCount = 0;
    const onXRFrame = (time: DOMHighResTimeStamp, frame: XRFrame) => {
      frameCount++;
      

      const pose = frame.getViewerPose(refSpace);
      if (!pose) {
        session.requestAnimationFrame(onXRFrame);
        return;
      }

      // Handle hand tracking

      handleHandTracking(frame, refSpace);
      

      gl.bindFramebuffer(gl.FRAMEBUFFER, session.renderState.baseLayer!.framebuffer);
      gl.clearColor(0.1, 0.1, 0.1, 1); // Slightly gray background for debugging
      gl.clear(gl.COLOR_BUFFER_BIT);

      pose.views.forEach((view, i) => {
        const viewport = session.renderState.baseLayer!.getViewport(view);
        if (!viewport) return;
        
        gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);

        const video = i === 0 ? leftVideo : rightVideo;
        const texture = i === 0 ? leftTexture : rightTexture;

        // More detailed video ready check
        if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
          // Render a colored quad as fallback
          gl.clearColor(i === 0 ? 0.2 : 0.0, 0.0, i === 1 ? 0.2 : 0.0, 1.0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          return;
        }

        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.activeTexture(gl.TEXTURE0);
       
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        
        
        gl.uniform1i(videoUniformLoc, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      });

      session.requestAnimationFrame(onXRFrame);
    };

    session.requestAnimationFrame(onXRFrame);
  };

  const setupHandTrackingWebSocket = () => {
    return new Promise((resolve, reject) => {
      try {
        // Connect to the same signaling server but on a different endpoint for hand tracking
        let webSocket = new WebSocket(url);
        
        webSocket.onopen = () => {
          webSocket.send(JSON.stringify({
            role: "teleop",
            robot_id: "motion"
          }));
          wsRef.current = webSocket;
          updateStatus('Hand tracking WebSocket connected');
          console.log('Hand tracking WebSocket connected');
          resolve(true);
        };
        
        webSocket.onerror = (error) => {
          resolve(false);
          console.log(`Hand tracking WebSocket error: ${error}`);
          updateStatus('Hand tracking WebSocket error');
        };
        
        webSocket.onclose = () => {
          console.log('Hand tracking WebSocket closed');
          updateStatus('Hand tracking WebSocket closed');
        };
        
      } catch (error) {
        console.log(`Failed to setup hand tracking WebSocket: ${error}`);
        updateStatus('Failed to setup hand tracking WebSocket');
      }
    });
    
  };

  const handleHandTracking = (frame: XRFrame, referenceSpace: XRReferenceSpace) => {
    // addLog(`Handling hand tracking for ${frame.session.inputSources.length} input sources`);
    const now = performance.now(); // current time in ms
    const sendInterval = 1000 / 60; // 30 Hz → ~33.33 ms per send
  
    if (now - lastHandSendRef.current < sendInterval) {
      return; // skip sending this frame
    }
    lastHandSendRef.current = now;
    if (!wsRef.current){
      // addLog('Hand tracking WebSocket not set');
    }
    else if (wsRef.current.readyState !== WebSocket.OPEN) {
      console.log('Hand tracking WebSocket not open');
    }

    const handData: any = {};

    // Process each input source (hands)
    // Joint order as specified in the table
const JOINT_ORDER = [
  "wrist",                              // 0
  "thumb-metacarpal",                   // 1
  "thumb-phalanx-proximal",            // 2
  "thumb-phalanx-distal",              // 3
  "thumb-tip",                         // 4
  "index-finger-metacarpal",           // 5
  "index-finger-phalanx-proximal",     // 6
  "index-finger-phalanx-intermediate", // 7
  "index-finger-phalanx-distal",       // 8
  "index-finger-tip",                  // 9
  "middle-finger-metacarpal",          // 10
  "middle-finger-phalanx-proximal",    // 11
  "middle-finger-phalanx-intermediate", // 12
  "middle-finger-phalanx-distal",      // 13
  "middle-finger-tip",                 // 14
  "ring-finger-metacarpal",            // 15
  "ring-finger-phalanx-proximal",      // 16
  "ring-finger-phalanx-intermediate",  // 17
  "ring-finger-phalanx-distal",        // 18
  "ring-finger-tip",                   // 19
  "pinky-finger-metacarpal",           // 20
  "pinky-finger-phalanx-proximal",     // 21
  "pinky-finger-phalanx-intermediate", // 22
  "pinky-finger-phalanx-distal",       // 23
  "pinky-finger-tip"                   // 24
];

// Updated hand tracking code
// Process each input source (hands)
for (const inputSource of frame.session.inputSources) {
  if (inputSource.hand) {
    const handedness = inputSource.handedness; // 'left' or 'right'
    const hand = inputSource.hand;
    
    // Create the continuous array in the correct order with a single loop
    const continuousArray: number[] = [];
    
    for (let i = 0; i < JOINT_ORDER.length; i++) {
      const jointName = JOINT_ORDER[i];
      const joint = hand.get(jointName as XRHandJoint);
      
      if (joint && frame.getJointPose) {
        const jointPose = frame.getJointPose(joint, referenceSpace);
        if (jointPose) {
          // Add the 16 matrix values for this joint
          continuousArray.push(...Array.from(jointPose.transform.matrix));
        } else {
          // Joint pose not available - add identity matrix (16 values)
          continuousArray.push(
            1, 0, 0, 0,  // Column 1
            0, 1, 0, 0,  // Column 2
            0, 0, 1, 0,  // Column 3
            0, 0, 0, 1   // Column 4
          );
        }
      } else {
        // Joint not found - add identity matrix (16 values)
        console.warn(`Joint ${jointName} not found`);
        continuousArray.push(
          1, 0, 0, 0,  // Column 1
          0, 1, 0, 0,  // Column 2
          0, 0, 1, 0,  // Column 3
          0, 0, 0, 1   // Column 4
        );
      }
    }
    
    // Store the continuous array (should be 25 joints * 16 values = 400 total)
    handData[handedness] = continuousArray
    
    // Optional: Also store individual joint data if you need it elsewhere
    // handData.hands[handedness].joints = jointData;
  }
}

    // Send hand tracking data if we have any hands
    if (Object.keys(handData).length > 0) {
      try {
        wsRef.current!.send(JSON.stringify(handData));
      } catch (error) {
        console.log(`Failed to send hand tracking data: ${error}`);
      }
    }

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