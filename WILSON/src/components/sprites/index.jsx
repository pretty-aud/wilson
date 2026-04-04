// ═══════════════════════════════════════════════════════════════════
//  PET BREED REGISTRY & SPRITE COMPONENTS
//  Extracted from O.T.T.E.R. v0.3 for app-wide use in WILSON
// ═══════════════════════════════════════════════════════════════════

export const PET_BREEDS = {
  otter:   { label: 'Otter',   weight: 14 },
  bird:    { label: 'Bird',    weight: 14 },
  octopus: { label: 'Octopus', weight: 14 },
  blob:    { label: 'Blob',    weight: 14 },
  demon:   { label: 'Demon',   weight: 2  },
  rabbit:  { label: 'Rabbit',  weight: 14 },
  pig:     { label: 'Pig',     weight: 14 },
  monkey:  { label: 'Monkey',  weight: 14 },
};

export function pickRandomBreed() {
  const entries = Object.entries(PET_BREEDS);
  const totalWeight = entries.reduce((sum, [, b]) => sum + b.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const [key, breed] of entries) {
    roll -= breed.weight;
    if (roll <= 0) return key;
  }
  return 'otter';
}

// Shared eye renderer — all breeds reuse same eye positions
function renderPetEyes(p, form, petState, dimO) {
  if (form === 'corpse') {
    return <>{p(4,4)}{p(6,4)}{p(5,5)}{p(4,6)}{p(6,6)}{p(9,4)}{p(11,4)}{p(10,5)}{p(9,6)}{p(11,6)}</>;
  }
  if (form === 'ghost') {
    return <>{p(4,4)}{p(5,4)}{p(6,4)}{p(4,5)}{p(6,5)}{p(4,6)}{p(5,6)}{p(6,6)}{p(9,4)}{p(10,4)}{p(11,4)}{p(9,5)}{p(11,5)}{p(9,6)}{p(10,6)}{p(11,6)}</>;
  }
  if (petState === 'sleeping') {
    return <>{p(4,5)}{p(5,5)}{p(6,5)}{p(9,5)}{p(10,5)}{p(11,5)}</>;
  }
  if (petState === 'happy') {
    return <>{p(4,5)}{p(5,4)}{p(6,5)}{p(9,5)}{p(10,4)}{p(11,5)}</>;
  }
  if (petState === 'starving') {
    return <>{p(4,4)}{p(6,4)}{p(5,5)}{p(4,6)}{p(6,6)}{p(9,4)}{p(11,4)}{p(10,5)}{p(9,6)}{p(11,6)}</>;
  }
  if (petState === 'lonely') {
    return <>{p(5,4,dimO)}{p(5,5,dimO)}{p(10,4,dimO)}{p(10,5,dimO)}{p(6,6,dimO)}</>;
  }
  if (petState === 'hungry') {
    return (
      <>
        <g className="otter-blink">{p(5,4)}{p(5,5)}{p(10,4)}{p(10,5)}</g>
        {p(4,3)}{p(5,3)}{p(10,3)}{p(11,3)}
      </>
    );
  }
  return <g className="otter-blink">{p(5,4)}{p(5,5)}{p(10,4)}{p(10,5)}</g>;
}

function spriteProps(form, petState, isThinking) {
  let cls = 'otter-bob';
  if (isThinking) cls = 'otter-think';
  else if (form === 'ghost') cls = 'ghost-float';
  else if (petState === 'sleeping') cls = 'otter-bob-slow';
  else if (petState === 'happy') cls = 'otter-happy';
  return {
    cls,
    size: form === 'baby' ? 51 : 68,
    opacity: form === 'ghost' ? 0.5 : 1,
    rotation: form === 'corpse' ? 'rotate(90deg)' : 'none',
  };
}

export function EggSprite({ wobble = false, color = '#f97316' }) {
  const o = color;
  const p = (x, y) => <rect key={`${x}_${y}`} x={x} y={y} width="1.1" height="1.1" fill={o}/>;
  return (
    <div className={wobble ? 'egg-wobble' : ''}>
      <svg width="57" height="57" viewBox="0 0 10 12" xmlns="http://www.w3.org/2000/svg" style={{ imageRendering: 'pixelated' }}>
        {p(4,0)}{p(5,0)}
        {p(3,1)}{p(6,1)}
        {p(2,2)}{p(7,2)}
        {p(1,3)}{p(8,3)}
        {p(1,4)}{p(8,4)}
        {p(1,5)}{p(8,5)}
        {p(1,6)}{p(8,6)}
        {p(1,7)}{p(8,7)}
        {p(2,8)}{p(7,8)}
        {p(3,9)}{p(6,9)}
        {p(4,10)}{p(5,10)}
        {p(3,5)}{p(4,4)}{p(5,5)}{p(6,4)}
      </svg>
    </div>
  );
}

function OtterSprite({ petState = 'content', form = 'adult', isThinking = false, color = '#f97316' }) {
  const o = color, dimO = color === '#f97316' ? '#d97706' : color;
  const p = (x, y, fill) => <rect key={`o${x}_${y}`} x={x} y={y} width="1.1" height="1.1" fill={fill || o}/>;
  const { cls, size, opacity, rotation } = spriteProps(form, petState, isThinking);
  return (
    <div className={cls} style={{ opacity, transform: rotation }}>
      <svg width={size} height={size} viewBox="0 0 16 18" xmlns="http://www.w3.org/2000/svg" style={{ imageRendering: 'pixelated' }}>
        {p(3,0)}{p(4,0)}{p(2,1)}{p(5,1)}{p(11,0)}{p(12,0)}{p(10,1)}{p(13,1)}
        {p(2,2)}{p(3,2)}{p(4,2)}{p(5,2)}{p(6,2)}{p(7,2)}{p(8,2)}{p(9,2)}{p(10,2)}{p(11,2)}{p(12,2)}{p(13,2)}
        {p(1,3)}{p(14,3)}{p(1,4)}{p(14,4)}{p(1,5)}{p(14,5)}{p(1,6)}{p(14,6)}{p(1,7)}{p(14,7)}{p(1,8)}{p(14,8)}
        {p(2,9)}{p(3,9)}{p(4,9)}{p(5,9)}{p(6,9)}{p(7,9)}{p(8,9)}{p(9,9)}{p(10,9)}{p(11,9)}{p(12,9)}{p(13,9)}
        {renderPetEyes(p, form, petState, dimO)}
        {p(7,6)}{p(8,6)}{p(6,7)}{p(9,7)}{p(7,8)}{p(8,8)}
        {p(3,10)}{p(4,10)}{p(5,10)}{p(6,10)}{p(7,10)}{p(8,10)}{p(9,10)}{p(10,10)}{p(11,10)}{p(12,10)}
        {p(3,11)}{p(12,11)}{p(3,12)}{p(12,12)}{p(3,13)}{p(12,13)}{p(3,14)}{p(12,14)}
        {p(3,15)}{p(4,15)}{p(5,15)}{p(6,15)}{p(7,15)}{p(8,15)}{p(9,15)}{p(10,15)}{p(11,15)}{p(12,15)}
        {p(6,12)}{p(7,12)}{p(8,12)}{p(9,12)}{p(5,13)}{p(10,13)}{p(6,14)}{p(7,14)}{p(8,14)}{p(9,14)}
        {p(2,11)}{p(2,12)}{p(2,13)}{p(1,12)}{p(1,13)}{p(13,11)}{p(13,12)}{p(13,13)}{p(14,12)}{p(14,13)}
        {p(4,16)}{p(5,16)}{p(6,16)}{p(9,16)}{p(10,16)}{p(11,16)}
        {p(4,17)}{p(6,17)}{p(9,17)}{p(11,17)}{p(5,17)}{p(10,17)}
        {p(13,14)}{p(14,13)}{p(14,14)}{p(15,12)}{p(15,13)}
      </svg>
    </div>
  );
}

function BirdSprite({ petState = 'content', form = 'adult', isThinking = false, color = '#f97316' }) {
  const o = color, dimO = color === '#f97316' ? '#d97706' : color;
  const p = (x, y, fill) => <rect key={`b${x}_${y}`} x={x} y={y} width="1.1" height="1.1" fill={fill || o}/>;
  const { cls, size, opacity, rotation } = spriteProps(form, petState, isThinking);
  return (
    <div className={cls} style={{ opacity, transform: rotation }}>
      <svg width={size} height={size} viewBox="0 0 16 18" xmlns="http://www.w3.org/2000/svg" style={{ imageRendering: 'pixelated' }}>
        {p(7,0)}{p(8,0)}{p(6,1)}{p(9,1)}
        {p(3,2)}{p(4,2)}{p(5,2)}{p(6,2)}{p(7,2)}{p(8,2)}{p(9,2)}{p(10,2)}{p(11,2)}{p(12,2)}
        {p(2,3)}{p(13,3)}{p(2,4)}{p(13,4)}{p(2,5)}{p(13,5)}{p(2,6)}{p(13,6)}
        {p(2,7)}{p(13,7)}{p(2,8)}{p(13,8)}
        {p(3,9)}{p(4,9)}{p(5,9)}{p(6,9)}{p(7,9)}{p(8,9)}{p(9,9)}{p(10,9)}{p(11,9)}{p(12,9)}
        {renderPetEyes(p, form, petState, dimO)}
        {p(14,5)}{p(15,5)}{p(14,6)}
        {p(4,10)}{p(5,10)}{p(6,10)}{p(7,10)}{p(8,10)}{p(9,10)}{p(10,10)}{p(11,10)}
        {p(4,11)}{p(11,11)}{p(4,12)}{p(11,12)}{p(4,13)}{p(11,13)}
        {p(4,14)}{p(5,14)}{p(6,14)}{p(7,14)}{p(8,14)}{p(9,14)}{p(10,14)}{p(11,14)}
        {p(2,10)}{p(3,10)}{p(1,11)}{p(2,11)}{p(1,12)}{p(2,12)}
        {p(12,10)}{p(13,10)}{p(13,11)}{p(14,11)}{p(13,12)}{p(14,12)}
        {p(6,12)}{p(7,12)}{p(8,12)}{p(9,12)}
        {p(3,13)}{p(2,14)}{p(3,14)}
        {p(5,15)}{p(6,15)}{p(7,15)}{p(9,15)}{p(10,15)}{p(11,15)}
        {p(5,16)}{p(7,16)}{p(9,16)}{p(11,16)}
      </svg>
    </div>
  );
}

function OctopusSprite({ petState = 'content', form = 'adult', isThinking = false, color = '#f97316' }) {
  const o = color, dimO = color === '#f97316' ? '#d97706' : color;
  const p = (x, y, fill) => <rect key={`oc${x}_${y}`} x={x} y={y} width="1.1" height="1.1" fill={fill || o}/>;
  const { cls, size, opacity, rotation } = spriteProps(form, petState, isThinking);
  return (
    <div className={cls} style={{ opacity, transform: rotation }}>
      <svg width={size} height={size} viewBox="0 0 16 18" xmlns="http://www.w3.org/2000/svg" style={{ imageRendering: 'pixelated' }}>
        {p(4,0)}{p(5,0)}{p(6,0)}{p(7,0)}{p(8,0)}{p(9,0)}{p(10,0)}{p(11,0)}
        {p(3,1)}{p(12,1)}{p(2,2)}{p(13,2)}{p(2,3)}{p(13,3)}
        {p(2,4)}{p(13,4)}{p(2,5)}{p(13,5)}{p(2,6)}{p(13,6)}
        {p(2,7)}{p(13,7)}{p(3,8)}{p(12,8)}
        {p(4,9)}{p(5,9)}{p(6,9)}{p(7,9)}{p(8,9)}{p(9,9)}{p(10,9)}{p(11,9)}
        {renderPetEyes(p, form, petState, dimO)}
        {p(7,7)}{p(8,7)}
        {p(3,10)}{p(4,10)}{p(3,11)}{p(4,12)}{p(3,13)}{p(3,14)}
        {p(5,10)}{p(6,10)}{p(5,11)}{p(6,12)}{p(5,13)}{p(6,14)}{p(5,15)}
        {p(7,10)}{p(8,10)}{p(7,11)}{p(8,12)}{p(7,13)}{p(8,14)}{p(8,15)}{p(7,16)}
        {p(9,10)}{p(10,10)}{p(10,11)}{p(9,12)}{p(10,13)}{p(9,14)}{p(10,15)}
        {p(11,10)}{p(12,10)}{p(12,11)}{p(11,12)}{p(12,13)}{p(12,14)}
      </svg>
    </div>
  );
}

function BlobSprite({ petState = 'content', form = 'adult', isThinking = false, color = '#f97316' }) {
  const o = color, dimO = color === '#f97316' ? '#d97706' : color;
  const p = (x, y, fill) => <rect key={`bl${x}_${y}`} x={x} y={y} width="1.1" height="1.1" fill={fill || o}/>;
  const { cls, size, opacity, rotation } = spriteProps(form, petState, isThinking);
  return (
    <div className={cls} style={{ opacity, transform: rotation }}>
      <svg width={size} height={size} viewBox="0 0 16 18" xmlns="http://www.w3.org/2000/svg" style={{ imageRendering: 'pixelated' }}>
        {p(5,1)}{p(6,1)}{p(7,1)}{p(8,1)}{p(9,1)}{p(10,1)}
        {p(4,2)}{p(11,2)}{p(3,3)}{p(12,3)}
        {p(2,4)}{p(13,4)}{p(2,5)}{p(13,5)}{p(2,6)}{p(13,6)}
        {p(2,7)}{p(13,7)}{p(2,8)}{p(13,8)}
        {p(2,9)}{p(13,9)}{p(2,10)}{p(13,10)}{p(2,11)}{p(13,11)}
        {p(3,12)}{p(12,12)}{p(4,13)}{p(11,13)}
        {p(5,14)}{p(6,14)}{p(7,14)}{p(8,14)}{p(9,14)}{p(10,14)}
        {renderPetEyes(p, form, petState, dimO)}
        {p(7,8)}{p(8,8)}
      </svg>
    </div>
  );
}

function DemonSprite({ petState = 'content', form = 'adult', isThinking = false, color = '#f97316' }) {
  const o = color, dimO = color === '#f97316' ? '#d97706' : color;
  const p = (x, y, fill) => <rect key={`dm${x}_${y}`} x={x} y={y} width="1.1" height="1.1" fill={fill || o}/>;
  const { cls, size, opacity, rotation } = spriteProps(form, petState, isThinking);
  return (
    <div className={cls} style={{ opacity, transform: rotation }}>
      <svg width={size} height={size} viewBox="0 0 16 18" xmlns="http://www.w3.org/2000/svg" style={{ imageRendering: 'pixelated' }}>
        {p(3,0)}{p(4,0)}{p(4,1)}{p(11,0)}{p(12,0)}{p(11,1)}
        {p(4,2)}{p(5,2)}{p(6,2)}{p(7,2)}{p(8,2)}{p(9,2)}{p(10,2)}{p(11,2)}
        {p(3,3)}{p(12,3)}{p(2,4)}{p(13,4)}
        {p(2,5)}{p(13,5)}{p(2,6)}{p(13,6)}{p(2,7)}{p(13,7)}
        {p(2,8)}{p(13,8)}{p(2,9)}{p(13,9)}{p(2,10)}{p(13,10)}
        {p(3,11)}{p(12,11)}{p(4,12)}{p(11,12)}
        {p(5,13)}{p(6,13)}{p(7,13)}{p(8,13)}{p(9,13)}{p(10,13)}
        {renderPetEyes(p, form, petState, dimO)}
        {p(6,8)}{p(7,8)}{p(8,8)}{p(9,8)}{p(6,9)}{p(9,9)}
        {p(0,5)}{p(1,5)}{p(0,6)}{p(1,6)}{p(0,7)}{p(1,7)}{p(0,8)}
        {p(14,5)}{p(15,5)}{p(14,6)}{p(15,6)}{p(14,7)}{p(15,7)}{p(15,8)}
        {p(0,4)}{p(15,4)}
        {p(6,14)}{p(7,14)}{p(8,14)}{p(9,14)}
      </svg>
    </div>
  );
}

function RabbitSprite({ petState = 'content', form = 'adult', isThinking = false, color = '#f97316' }) {
  const o = color, dimO = color === '#f97316' ? '#d97706' : color;
  const p = (x, y, fill) => <rect key={`rb${x}_${y}`} x={x} y={y} width="1.1" height="1.1" fill={fill || o}/>;
  const { cls, size, opacity, rotation } = spriteProps(form, petState, isThinking);
  return (
    <div className={cls} style={{ opacity, transform: rotation }}>
      <svg width={size} height={size} viewBox="0 0 16 18" xmlns="http://www.w3.org/2000/svg" style={{ imageRendering: 'pixelated' }}>
        {p(4,0)}{p(5,0)}{p(4,1)}{p(5,1)}{p(4,2)}{p(5,2)}
        {p(10,0)}{p(11,0)}{p(10,1)}{p(11,1)}{p(10,2)}{p(11,2)}
        {p(2,3)}{p(3,3)}{p(4,3)}{p(5,3)}{p(6,3)}{p(7,3)}{p(8,3)}{p(9,3)}{p(10,3)}{p(11,3)}{p(12,3)}{p(13,3)}
        {p(1,4)}{p(14,4)}{p(1,5)}{p(14,5)}{p(1,6)}{p(14,6)}{p(1,7)}{p(14,7)}
        {p(1,8)}{p(14,8)}
        {p(2,9)}{p(3,9)}{p(4,9)}{p(5,9)}{p(6,9)}{p(7,9)}{p(8,9)}{p(9,9)}{p(10,9)}{p(11,9)}{p(12,9)}{p(13,9)}
        {renderPetEyes(p, form, petState, dimO)}
        {p(7,6)}{p(8,6)}{p(7,7)}{p(7,8)}{p(8,8)}
        {p(4,10)}{p(5,10)}{p(6,10)}{p(7,10)}{p(8,10)}{p(9,10)}{p(10,10)}{p(11,10)}
        {p(3,11)}{p(12,11)}{p(3,12)}{p(12,12)}{p(3,13)}{p(12,13)}
        {p(4,14)}{p(5,14)}{p(6,14)}{p(7,14)}{p(8,14)}{p(9,14)}{p(10,14)}{p(11,14)}
        {p(6,12)}{p(7,12)}{p(8,12)}{p(9,12)}
        {p(13,12)}{p(14,12)}{p(13,13)}{p(14,13)}
        {p(4,15)}{p(5,15)}{p(6,15)}{p(9,15)}{p(10,15)}{p(11,15)}
        {p(4,16)}{p(5,16)}{p(10,16)}{p(11,16)}
      </svg>
    </div>
  );
}

function PigSprite({ petState = 'content', form = 'adult', isThinking = false, color = '#f97316' }) {
  const o = color, dimO = color === '#f97316' ? '#d97706' : color;
  const p = (x, y, fill) => <rect key={`pg${x}_${y}`} x={x} y={y} width="1.1" height="1.1" fill={fill || o}/>;
  const { cls, size, opacity, rotation } = spriteProps(form, petState, isThinking);
  return (
    <div className={cls} style={{ opacity, transform: rotation }}>
      <svg width={size} height={size} viewBox="0 0 16 18" xmlns="http://www.w3.org/2000/svg" style={{ imageRendering: 'pixelated' }}>
        {p(1,0)}{p(2,0)}{p(1,1)}{p(2,1)}{p(13,0)}{p(14,0)}{p(13,1)}{p(14,1)}
        {p(3,1)}{p(4,1)}{p(5,1)}{p(6,1)}{p(7,1)}{p(8,1)}{p(9,1)}{p(10,1)}{p(11,1)}{p(12,1)}
        {p(2,2)}{p(13,2)}{p(2,3)}{p(13,3)}{p(2,4)}{p(13,4)}{p(2,5)}{p(13,5)}
        {p(2,6)}{p(13,6)}{p(2,7)}{p(13,7)}{p(2,8)}{p(13,8)}
        {p(3,9)}{p(4,9)}{p(5,9)}{p(6,9)}{p(7,9)}{p(8,9)}{p(9,9)}{p(10,9)}{p(11,9)}{p(12,9)}
        {renderPetEyes(p, form, petState, dimO)}
        {p(6,6)}{p(7,6)}{p(8,6)}{p(9,6)}{p(6,7)}{p(9,7)}{p(7,7)}{p(8,7)}
        {p(3,10)}{p(4,10)}{p(5,10)}{p(6,10)}{p(7,10)}{p(8,10)}{p(9,10)}{p(10,10)}{p(11,10)}{p(12,10)}
        {p(2,11)}{p(13,11)}{p(2,12)}{p(13,12)}{p(2,13)}{p(13,13)}{p(2,14)}{p(13,14)}
        {p(3,15)}{p(4,15)}{p(5,15)}{p(6,15)}{p(7,15)}{p(8,15)}{p(9,15)}{p(10,15)}{p(11,15)}{p(12,15)}
        {p(6,12)}{p(7,12)}{p(8,12)}{p(9,12)}{p(5,13)}{p(10,13)}{p(6,14)}{p(7,14)}{p(8,14)}{p(9,14)}
        {p(14,11)}{p(15,11)}{p(15,12)}{p(14,12)}
        {p(4,16)}{p(5,16)}{p(10,16)}{p(11,16)}
      </svg>
    </div>
  );
}

function MonkeySprite({ petState = 'content', form = 'adult', isThinking = false, color = '#f97316' }) {
  const o = color, dimO = color === '#f97316' ? '#d97706' : color;
  const p = (x, y, fill) => <rect key={`mk${x}_${y}`} x={x} y={y} width="1.1" height="1.1" fill={fill || o}/>;
  const { cls, size, opacity, rotation } = spriteProps(form, petState, isThinking);
  return (
    <div className={cls} style={{ opacity, transform: rotation }}>
      <svg width={size} height={size} viewBox="0 0 16 18" xmlns="http://www.w3.org/2000/svg" style={{ imageRendering: 'pixelated' }}>
        {p(1,1)}{p(2,1)}{p(1,2)}{p(2,2)}{p(13,1)}{p(14,1)}{p(13,2)}{p(14,2)}
        {p(3,0)}{p(4,0)}{p(5,0)}{p(6,0)}{p(7,0)}{p(8,0)}{p(9,0)}{p(10,0)}{p(11,0)}{p(12,0)}
        {p(2,1)}{p(13,1)}{p(2,2)}{p(13,2)}{p(2,3)}{p(13,3)}{p(2,4)}{p(13,4)}{p(2,5)}{p(13,5)}
        {p(2,6)}{p(13,6)}{p(2,7)}{p(13,7)}{p(2,8)}{p(13,8)}
        {p(3,9)}{p(4,9)}{p(5,9)}{p(6,9)}{p(7,9)}{p(8,9)}{p(9,9)}{p(10,9)}{p(11,9)}{p(12,9)}
        {renderPetEyes(p, form, petState, dimO)}
        {p(6,6)}{p(7,6)}{p(8,6)}{p(9,6)}{p(7,7)}{p(8,7)}
        {p(4,10)}{p(5,10)}{p(6,10)}{p(7,10)}{p(8,10)}{p(9,10)}{p(10,10)}{p(11,10)}
        {p(4,11)}{p(11,11)}{p(4,12)}{p(11,12)}{p(4,13)}{p(11,13)}
        {p(4,14)}{p(5,14)}{p(6,14)}{p(7,14)}{p(8,14)}{p(9,14)}{p(10,14)}{p(11,14)}
        {p(6,12)}{p(7,12)}{p(8,12)}{p(9,12)}
        {p(2,10)}{p(3,10)}{p(2,11)}{p(3,11)}{p(2,12)}{p(1,12)}
        {p(12,10)}{p(13,10)}{p(12,11)}{p(13,11)}{p(13,12)}{p(14,12)}
        {p(5,15)}{p(6,15)}{p(9,15)}{p(10,15)}
        {p(5,16)}{p(6,16)}{p(9,16)}{p(10,16)}
        {p(12,13)}{p(13,13)}{p(14,13)}{p(14,14)}{p(13,14)}{p(13,15)}
      </svg>
    </div>
  );
}

// Breed → sprite selector
export function PetSprite({ breed = 'otter', petState = 'content', form = 'adult', isThinking = false, color = '#f97316' }) {
  const props = { petState, form, isThinking, color };
  switch (breed) {
    case 'bird':    return <BirdSprite {...props} />;
    case 'octopus': return <OctopusSprite {...props} />;
    case 'blob':    return <BlobSprite {...props} />;
    case 'demon':   return <DemonSprite {...props} />;
    case 'rabbit':  return <RabbitSprite {...props} />;
    case 'pig':     return <PigSprite {...props} />;
    case 'monkey':  return <MonkeySprite {...props} />;
    default:        return <OtterSprite {...props} />;
  }
}

// Dream cloud icons
const DREAM_ICON = {
  content: 'heart', happy: 'heart',
  hungry: 'sad', starving: 'sad', lonely: 'sad',
  sleeping: 'sleep'
};

function DreamCloudIcon({ type, o }) {
  if (type === 'heart') {
    return (
      <svg width="14" height="14" viewBox="0 0 7 7" xmlns="http://www.w3.org/2000/svg" style={{ imageRendering: 'pixelated' }}>
        <rect x="1" y="0" width="2" height="1" fill={o}/><rect x="4" y="0" width="2" height="1" fill={o}/>
        <rect x="0" y="1" width="3" height="1" fill={o}/><rect x="4" y="1" width="3" height="1" fill={o}/>
        <rect x="0" y="2" width="7" height="1" fill={o}/>
        <rect x="1" y="3" width="5" height="1" fill={o}/>
        <rect x="2" y="4" width="3" height="1" fill={o}/>
        <rect x="3" y="5" width="1.1" height="1.1" fill={o}/>
      </svg>
    );
  }
  if (type === 'sad') {
    return (
      <svg width="15" height="15" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
        <circle cx="10" cy="10" r="9" fill="none" stroke={o} strokeWidth="1.5"/>
        <circle cx="7" cy="8" r="1.2" fill={o}/>
        <circle cx="13" cy="8" r="1.2" fill={o}/>
        <path d="M6.5 14 Q10 11 13.5 14" fill="none" stroke={o} strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    );
  }
  return null;
}

export function DreamCloud({ petState, sleepCycle = 0, visible = false, color = '#f97316' }) {
  if (!visible) return null;
  if (!petState || petState === 'dead') return null;
  const iconType = DREAM_ICON[petState];
  if (!iconType) return null;
  const isSleep = iconType === 'sleep';
  const sleepText = ['Z', 'Zz', 'Zzz'][sleepCycle % 3];
  const o = color;
  return (
    <div className="absolute -top-[3.6rem] left-1/4 -translate-x-1/2 cloud-bob pointer-events-none">
      <div className="relative">
        <svg width="40" height="32" viewBox="0 0 11 9" xmlns="http://www.w3.org/2000/svg" style={{ imageRendering: 'pixelated' }}>
          <rect x="3" y="0" width="5" height="1" fill={o}/>
          <rect x="2" y="1" width="1.1" height="1.1" fill={o}/><rect x="8" y="1" width="1.1" height="1.1" fill={o}/>
          <rect x="1" y="2" width="1.1" height="1.1" fill={o}/><rect x="9" y="2" width="1.1" height="1.1" fill={o}/>
          <rect x="0" y="3" width="1" height="3" fill={o}/><rect x="10" y="3" width="1" height="3" fill={o}/>
          <rect x="1" y="6" width="1.1" height="1.1" fill={o}/><rect x="9" y="6" width="1.1" height="1.1" fill={o}/>
          <rect x="2" y="7" width="1.1" height="1.1" fill={o}/><rect x="8" y="7" width="1.1" height="1.1" fill={o}/>
          <rect x="3" y="8" width="5" height="1" fill={o}/>
        </svg>
        <span className="absolute inset-0 flex items-center justify-center">
          {isSleep ? (
            <span className="font-mono text-[10px] font-bold" style={{ color: o, letterSpacing: '1px' }}>{sleepText}</span>
          ) : (
            <DreamCloudIcon type={iconType} o={o} />
          )}
        </span>
      </div>
      <svg width="7" height="9" viewBox="0 0 3 4" xmlns="http://www.w3.org/2000/svg" style={{ imageRendering: 'pixelated', position: 'absolute', bottom: '-8px', left: '50%', marginLeft: '2px' }}>
        <rect x="2" y="0" width="1.1" height="1.1" fill={o}/>
        <rect x="1" y="2" width="1.1" height="1.1" fill={o}/>
        <rect x="0" y="3" width="1.1" height="1.1" fill={o}/>
      </svg>
    </div>
  );
}
