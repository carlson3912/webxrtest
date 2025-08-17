import React, { useState } from 'react';
import VideoScreenWeb from './Video.tsx';
import StereoVR from './StereoVR.tsx';

export function Player() {
  const [streamLeft, setStreamLeft] = useState<MediaStream | null>(null);
  const [streamRight, setStreamRight] = useState<MediaStream | null>(null);

  return (
    <div>
      <StereoVR streamLeft={streamLeft} streamRight={streamRight} />

      {/* Keep VideoScreenWeb hidden; it just provides the streams */}
      <VideoScreenWeb
        setStreamLeft={setStreamLeft}
        setStreamRight={setStreamRight}
        setIsConnected={() => {}}
        setLocalStream={() => {}}
        vector={{ x: 0, y: 0, z: 0 }}
        call={true}
        signalingUrl="10.33.12.68"
      />
    </div>
  );
}
