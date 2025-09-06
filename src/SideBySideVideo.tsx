import React, { useRef, useEffect, useState } from 'react';

interface SideBySideVideoProps {
  streamLeft: MediaStream | null;
  streamRight: MediaStream | null;
}

export default function SideBySideVideo({ streamLeft, streamRight }: SideBySideVideoProps) {
  const leftVideoRef = useRef(null);
  const rightVideoRef = useRef(null);
  const [status, setStatus] = useState('');
  const [videosReady, setVideosReady] = useState(false);
  
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

  const startSideBySide = async () => {
    updateStatus('Starting side-by-side video...');
    
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
      updateStatus('Videos playing in side-by-side mode');
      setVideosReady(true);
    } catch (err) {
      updateStatus(`Video error: ${err}`);
      console.error('Video play failed', err);
      return;
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      
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
      
      <div style={{ 
        display: 'flex', 
        gap: '20px', 
        justifyContent: 'center',
        flexWrap: 'wrap'
      }}>
        <div style={{ textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#333' }}>Left Camera</h3>
          <video
            ref={leftVideoRef}
            crossOrigin="anonymous"
            style={{ 
              width: '400px',
              height: '300px',
              border: '2px solid #007bff',
              borderRadius: '8px',
              backgroundColor: '#000'
            }}
            muted
            playsInline
            controls
          />
        </div>
        
        <div style={{ textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#333' }}>Right Camera</h3>
          <video
            ref={rightVideoRef}
            crossOrigin="anonymous"
            style={{ 
              width: '400px',
              height: '300px',
              border: '2px solid #28a745',
              borderRadius: '8px',
              backgroundColor: '#000'
            }}
            muted
            playsInline
            controls
          />
        </div>
      </div>
    </div>
  );
}
