import React, { useState, useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import LayoutVisualizer from '../LayoutVisualizer';
import { parseSlideContent } from '../parser';

const DuplicateResolverModal = ({ isOpen, duplicates, currentIndex, onSelect, onCancel, onExportAll }) => {
  const [selectedId, setSelectedId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewItem, setPreviewItem] = useState(null);
  const hoverTimerRef = useRef(null);
  
  // Reset selection when moving to new duplicate
  useEffect(() => {
    setSelectedId(null);
    setShowPreview(false);
    setPreviewItem(null);
  }, [currentIndex]);
  
  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);
  
  const handleMouseEnter = (item) => {
    setHoveredId(item.id);
    // Clear any existing timer
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
    }
    // Set timer for 0.5 seconds
    hoverTimerRef.current = setTimeout(() => {
      setPreviewItem(item);
      setShowPreview(true);
    }, 500);
  };
  
  const handleMouseLeave = () => {
    setHoveredId(null);
    // Clear timer
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    // Hide preview
    setShowPreview(false);
    setPreviewItem(null);
  };
  
  if (!isOpen || !duplicates || duplicates.length === 0) return null;
  
  const currentDuplicate = duplicates[currentIndex];
  if (!currentDuplicate) return null;
  
  const { pageNum, items } = currentDuplicate;
  
  // Extract copy content from slide output for better preview
  const extractCopyContent = (output) => {
    const copyMatch = output.match(/▸ COPY\/TEXT CONTENT:\s*\n([\s\S]*?)(?=▸|═{10,}|$)/);
    let content = '';
    if (copyMatch) {
      content = copyMatch[1].trim();
    } else {
      content = output.substring(0, 400);
    }
    // Clean up the content - remove markdown formatting and empty lines
    return content
      .split('\n')
      .map(line => line.replace(/^\*\*([^*]+)\*\*:?$/, '$1:').replace(/^[-•]\s*/, '').trim())
      .filter(line => line.length > 0)
      .slice(0, 5)
      .join('\n');
  };
  
  const handleConfirm = () => {
    if (selectedId) {
      onSelect(selectedId);
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div 
        className="bg-stone-800 border-2 border-stone-600 rounded-sm flex flex-col shadow-xl relative"
        style={{ width: '894px', height: '349px' }}
      >
        <div className="bg-stone-700 px-3 py-2 border-b-2 border-stone-600 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="font-bold text-orange-400 uppercase tracking-wide" style={{ fontSize: '16px' }}>Resolve Duplicate</h3>
            <p style={{ fontSize: '14px' }} className="text-stone-400">
              Page #{pageNum} • {currentIndex + 1}/{duplicates.length} conflicts
            </p>
          </div>
          <button onClick={onCancel} className="p-1 hover:bg-stone-600 rounded-sm transition-colors">
            <X className="w-5 h-5 text-stone-400" />
          </button>
        </div>
        
        <div className="flex-1 flex gap-2 p-2 overflow-hidden">
          {items.map((item, idx) => (
            <button
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              onMouseEnter={() => handleMouseEnter(item)}
              onMouseLeave={handleMouseLeave}
              className={`flex-1 text-left p-3 rounded-sm transition-all flex flex-col overflow-hidden ${
                selectedId === item.id 
                  ? 'bg-orange-500/20 border border-orange-500 ring-1 ring-orange-500/30' 
                  : 'bg-stone-900 border border-stone-600 hover:border-stone-500'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`font-bold ${selectedId === item.id ? 'text-orange-400' : 'text-stone-400'}`} style={{ fontSize: '13px' }}>
                  Option {idx + 1} • {item.layout}
                </span>
                {hoveredId === item.id && !showPreview && (
                  <span style={{ fontSize: '12px' }} className="text-stone-500">Hold...</span>
                )}
              </div>
              
              <div className="flex-1 bg-stone-950 p-2 rounded border border-stone-700 overflow-hidden flex flex-col">
                {/* Title styled like visualizer */}
                <p className={`font-bold truncate ${selectedId === item.id ? 'text-orange-300' : 'text-orange-400/70'}`} style={{ fontSize: '14px' }}>
                  {item.title}
                </p>
                {/* Subtitle styled like visualizer */}
                {(() => {
                  const parsed = parseSlideContent(item.output);
                  return parsed.subtitle && (
                    <p className="truncate mb-1" style={{ fontSize: '11px', color: selectedId === item.id ? '#a8a29e' : '#78716c' }}>
                      {parsed.subtitle}
                    </p>
                  );
                })()}
                {/* Copy content preview */}
                <div className="mt-1 pt-1 border-t border-stone-800">
                  {extractCopyContent(item.output).split('\n').slice(0, 2).map((line, i) => (
                    <p key={i} className="truncate leading-tight" style={{ fontSize: '10px', color: selectedId === item.id ? '#a8a29e' : '#57534e' }}>
                      • {line.replace(/:/g, '')}
                    </p>
                  ))}
                </div>
              </div>
              
              {selectedId === item.id && (
                <div className="mt-1 flex items-center gap-1 text-orange-400 flex-shrink-0">
                  <Check className="w-4 h-4" />
                  <span style={{ fontSize: '13px' }}>Selected</span>
                </div>
              )}
            </button>
          ))}
        </div>
        
        <div className="px-3 py-2 border-t-2 border-stone-600 flex items-center justify-end gap-2 flex-shrink-0">
          <button
            onClick={onExportAll}
            className="px-4 py-1.5 bg-stone-700 hover:bg-stone-600 border border-stone-600 rounded-sm text-stone-300 transition-colors"
            style={{ fontSize: '13px' }}
          >
            Export All
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedId}
            className="px-5 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:bg-stone-600 disabled:cursor-not-allowed border border-stone-600 rounded-sm text-white disabled:text-stone-400 font-bold transition-colors"
            style={{ fontSize: '13px' }}
          >
            Continue
          </button>
        </div>
      </div>
      
      {/* Slide Preview Popup - centered */}
      {showPreview && previewItem && (
        <div 
          className="fixed bg-stone-900 border-2 border-orange-500 rounded-sm shadow-2xl z-[60] p-3 pointer-events-none"
          style={{
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: '740px',
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-orange-400 uppercase">Preview</span>
            <span className="text-xs text-stone-500">#{previewItem.pageNum} • {previewItem.layout}</span>
          </div>
          <div className="overflow-hidden rounded border-2 border-stone-700" style={{ width: '714px', height: '402px' }}>
            <div style={{ width: '714px', height: '402px' }}>
              <LayoutVisualizer content={previewItem.output} compact />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// History Import/Export Modal

export default DuplicateResolverModal;
