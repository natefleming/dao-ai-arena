import { useRef, useEffect, useState } from 'react';
import embed, { VisualizationSpec } from 'vega-embed';

interface VegaLiteChartProps {
  spec: VisualizationSpec;
}

export default function VegaLiteChart({ spec }: VegaLiteChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    setError(null);
    embed(containerRef.current, spec, {
      actions: { export: true, source: false, compiled: false, editor: false },
      renderer: 'svg',
      theme: 'dark',
    }).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to render chart');
    });
  }, [spec]);

  if (error) {
    return (
      <div className="mt-2 px-3 py-2 bg-red-900/20 border border-red-700/50 rounded text-xs text-red-300">
        Chart rendering failed: {error}
      </div>
    );
  }

  return (
    <div className="mt-2 border border-gray-700 rounded-lg overflow-hidden bg-gray-900/50">
      <div ref={containerRef} className="p-2" />
    </div>
  );
}
