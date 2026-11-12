import React, { useState, useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { Dialog, Button } from '../../../ui';
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
    <Dialog
      title="Resolve duplicate"
      subtitle={`Page #${pageNum} • ${currentIndex + 1}/${duplicates.length} conflicts`}
      onClose={onCancel}
      width="workbench"
      className="dog-resolver"
      footer={(
        <>
          <Button variant="secondary" onClick={onExportAll}>
            Export all
          </Button>
          <Button variant="primary" onClick={handleConfirm} disabled={!selectedId}>
            Continue
          </Button>
        </>
      )}
    >
      <div className="dog-resolver-options">
        {items.map((item, idx) => {
          const selected = selectedId === item.id;
          const parsed = parseSlideContent(item.output);
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              onMouseEnter={() => handleMouseEnter(item)}
              onMouseLeave={handleMouseLeave}
              className="dog-resolver-option"
              data-selected={selected}
              aria-pressed={selected}
            >
              <span className="dog-resolver-option-head">
                <span className="dog-resolver-option-name">
                  Option {idx + 1} • {item.layout}
                </span>
                {hoveredId === item.id && !showPreview && (
                  <span className="dog-resolver-hold">Hold...</span>
                )}
              </span>

              <span className="dog-resolver-card">
                {/* Title styled like visualizer */}
                <span className="dog-resolver-title">{item.title}</span>
                {/* Subtitle styled like visualizer */}
                {parsed.subtitle && (
                  <span className="dog-resolver-sub">{parsed.subtitle}</span>
                )}
                {/* Copy content preview */}
                <span className="dog-resolver-copy">
                  {extractCopyContent(item.output).split('\n').slice(0, 2).map((line, i) => (
                    <span key={i} className="dog-resolver-line">
                      • {line.replace(/:/g, '')}
                    </span>
                  ))}
                </span>
              </span>

              {selected && (
                <span className="dog-resolver-selected">
                  <Check aria-hidden="true" />
                  <span>Selected</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Slide Preview Popup - centered.
          🚨 C4: this popup and the 714 x 402 frame inside it are pinned by
          scripts/dog-preview-probe.mjs (`resolver.*`). Its geometry is the
          extraction's, byte for byte: fixed at the viewport's centre, 740
          wide, 12px padding, a 1px edge, the header row at the Label and
          Caption steps, the frame's inline 714 x 402 and its `overflow-hidden
          rounded-control border` utilities (the probe finds the frame by
          them). Only colours moved to tokens. It renders INSIDE the Dialog
          so it stacks over the dialog's backdrop; nothing between it and the
          viewport transforms, so `fixed` is still the viewport. */}
      {showPreview && previewItem && (
        <div
          className="dog-resolver-preview fixed border z-[60] p-3 pointer-events-none"
          style={{
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: '740px',
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="dog-resolver-preview-label text-label uppercase">Preview</span>
            <span className="dog-resolver-preview-meta text-caption">#{previewItem.pageNum} • {previewItem.layout}</span>
          </div>
          <div className="dog-resolver-frame overflow-hidden rounded-control border" style={{ width: '714px', height: '402px' }}>
            <div style={{ width: '714px', height: '402px' }}>
              <LayoutVisualizer content={previewItem.output} compact />
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
};

// History Import/Export Modal

export default DuplicateResolverModal;
