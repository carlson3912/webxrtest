import React, { useState } from 'react';
import VideoScreenWeb from './Video.tsx';
import StereoVR from './StereoVR.tsx';
import SideBySideVideo from './SideBySideVideo.tsx';
import FisheyeVR from './Sphere.tsx';

export function Player() {
  const [streamLeft, setStreamLeft] = useState(null);
  const [streamRight, setStreamRight] = useState(null);
  const [url, setUrl] = useState("ws://10.33.12.42:8766");
 
  return (
    <div>
      {/* VR Mode - Comment out this line to disable VR */}
      <StereoVR streamLeft={streamLeft} streamRight={streamRight} />
      {/* <FisheyeVR
  leftSrc={streamLeft}
  rightSrc={streamRight}
  domeRadius={3}
  fov={220}
/>  */}
      {/* Side-by-Side Mode - Uncomment this line to enable side-by-side viewing */}
      {/* <SideBySideVideo streamLeft={streamLeft} streamRight={streamRight} /> */}

      {/* Keep VideoScreenWeb hidden; it just provides the streams */}
      <VideoScreenWeb
        setStreamLeft={setStreamLeft}
        setStreamRight={setStreamRight}
        setIsConnected={() => {}}
        setLocalStream={() => {}}
        vector={{ x: 0, y: 0, z: 0 }}
        call={true}
        signalingUrl="10.33.13.62"
      />
    </div>
  );
}
