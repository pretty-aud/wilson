import React, { useState, useEffect } from 'react';

// Video thumbnail component — extracts first frame from video and shows play icon overlay
const VideoThumbnail = ({ asset }) => {
  const [thumbnail, setThumbnail] = useState(null);

  useEffect(() => {
    if (!asset?.content || !asset?.mediaType) return;
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const dataUrl = `data:${asset.mediaType};base64,${asset.content}`;
    video.src = dataUrl;
    video.currentTime = 0.1;
    video.onloadeddata = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setThumbnail(canvas.toDataURL('image/jpeg', 0.7));
      video.src = '';
    };
    video.onerror = () => {
      setThumbnail(null);
    };
  }, [asset?.content, asset?.mediaType]);

  return (
    <div className="w-full h-full relative">
      {thumbnail ? (
        <img src={thumbnail} alt="Video thumbnail" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-stone-800 flex items-center justify-center">
          <span style={{ fontSize: '8px', color: '#666' }}>Video</span>
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center">
          <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <polygon points="8,5 20,12 8,19" />
          </svg>
        </div>
      </div>
    </div>
  );
};

export default VideoThumbnail;
