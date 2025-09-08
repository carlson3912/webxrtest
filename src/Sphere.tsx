import React, { useRef, useEffect } from "react";
import * as THREE from "three";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";

interface FisheyeVRProps {
  leftSrc: string | MediaStream;   // URL or MediaStream for left camera
  rightSrc: string | MediaStream;  // URL or MediaStream for right camera
  domeRadius?: number; // meters
  fov?: number;      // degrees, default 220
}

const FisheyeVR: React.FC<FisheyeVRProps> = ({
  leftSrc,
  rightSrc,
  domeRadius = 6,
  fov = 220,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.xr.enabled = true;
    containerRef.current.appendChild(renderer.domElement);

    // Scene & camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, containerRef.current.clientWidth / containerRef.current.clientHeight, 0.1, 1000);

    // Video elements
    const leftVideo = document.createElement("video");
    if (leftSrc instanceof MediaStream) {
        leftVideo.srcObject = leftSrc;
      } else {
        leftVideo.src = leftSrc;
      }
    leftVideo.autoplay = true;
    leftVideo.loop = true;
    leftVideo.muted = true;
    leftVideo.play();
    const leftTexture = new THREE.VideoTexture(leftVideo);

    const rightVideo = document.createElement("video");
    if (rightSrc instanceof MediaStream) {
        rightVideo.srcObject = rightSrc;
      } else {
        rightVideo.src = rightSrc;
      }
    rightVideo.autoplay = true;
    rightVideo.loop = true;
    rightVideo.muted = true;
    rightVideo.play();
    const rightTexture = new THREE.VideoTexture(rightVideo);

    // Dome geometry function
    const createDome = (texture: THREE.Texture) => {
        // Reduce vertical FOV by 1/3
        const verticalFovDeg = (fov / 2) * (2/3); // previous phi was fov/2
        const phi = THREE.MathUtils.degToRad(verticalFovDeg);
      
        const thetaLength = THREE.MathUtils.degToRad(220); // horizontal FOV
      
        const phiLength = phi;                 // vertical FOV
        const phiStart = Math.PI / 2 - phi/2;  // center vertically
        
        const geo = new THREE.SphereGeometry(
          domeRadius,
          64,
          64,
          -thetaLength / 2,
          thetaLength,
          phiStart,
          phiLength
        );
      
        geo.scale(-1, 1, 1); // Flip normals inward
        const mat = new THREE.MeshBasicMaterial({ map: texture });
        return new THREE.Mesh(geo, mat);
      };

      const leftDome = createDome(leftTexture);
      const rightDome = createDome(rightTexture);
      
      // Position domes
      leftDome.position.set(0, 0, 0);
      rightDome.position.set(0, 0, 0);
      
      scene.add(leftDome, rightDome);
      
      // === Assign layers for stereo ===
      leftDome.layers.set(1);   // left eye layer
      rightDome.layers.set(2);  // right eye layer
      
      // === Set per-eye camera layers in XR render loop ===
      const xrCamera = renderer.xr.getCamera(camera);
      xrCamera.cameras.forEach((eyeCamera, i) => {
        if (i === 0) {
          eyeCamera.layers.enable(1); // left eye sees left dome
        } else {
          eyeCamera.layers.enable(2); // right eye sees right dome
        }
      });
      
      // === Add VR button ===
      containerRef.current.appendChild(VRButton.createButton(renderer));
      
      // === Render loop ===
      renderer.setAnimationLoop(() => {
        leftTexture.needsUpdate = true;
        rightTexture.needsUpdate = true;
        renderer.render(scene, camera);
      });

    // Handle resize
    const handleResize = () => {
      if (!containerRef.current) return;
      camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      leftTexture.dispose();
      rightTexture.dispose();
    };
  }, [leftSrc, rightSrc, domeRadius, fov]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
};

export default FisheyeVR;
