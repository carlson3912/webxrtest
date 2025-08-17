import React from 'react';
import { Player } from './Player.tsx';
import StereoVR from './StereoVR.tsx';
function App() {
  const [startPlaying, setStartPlaying] = React.useState(false);
  return (
    // <StereoVR />
    <div>
      <button onClick={() => setStartPlaying(true)}>Start Playing</button>
      {startPlaying ? <Player /> : null}
    </div>
  )
}

export default App;