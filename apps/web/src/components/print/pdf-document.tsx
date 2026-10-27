'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';

interface PdfPageImage {
  number: number;
  url: string;
  width: number;
  height: number;
}

/** Render a server PDF locally, including in browsers without a PDF plug-in. */
export function PdfDocument({
  blob,
  title,
  onReady,
  onError,
}: {
  blob: Blob;
  title: string;
  onReady: () => void;
  onError: () => void;
}) {
  const [pages, setPages] = useState<PdfPageImage[]>([]);
  const loadedPages = useRef(new Set<number>());

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | undefined;
    const urls: string[] = [];
    loadedPages.current.clear();
    setPages([]);

    void (async () => {
      const pdfjs = await import('pdfjs-dist');
      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString();
      const data = new Uint8Array(await blob.arrayBuffer());
      if (cancelled) return;
      loadingTask = pdfjs.getDocument({ data });
      const pdf = await loadingTask.promise;
      const rendered: PdfPageImage[] = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        if (cancelled) return;
        const page = await pdf.getPage(number);
        const viewport = page.getViewport({ scale: 300 / 72 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        try {
          await page.render({ canvas, viewport, background: '#ffffff' }).promise;
          const image = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((value) => {
              if (value) resolve(value);
              else reject(new Error('PDF page could not be rendered'));
            }, 'image/png');
          });
          if (cancelled) return;
          const url = URL.createObjectURL(image);
          urls.push(url);
          rendered.push({ number, url, width: canvas.width, height: canvas.height });
        } finally {
          canvas.width = 0;
          canvas.height = 0;
          page.cleanup();
        }
      }
      if (!cancelled) setPages(rendered);
    })().catch(() => {
      if (!cancelled) onError();
    });

    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
      void loadingTask?.destroy().catch(() => undefined);
    };
  }, [blob, onError]);

  return (
    <div className="print-area print-flow lab-pdf-print space-y-4" aria-label={title}>
      {pages.map((page) => (
        <div
          key={page.number}
          className="lab-pdf-page mx-auto max-w-[210mm] overflow-hidden rounded border bg-white shadow-sm"
        >
          <img
            src={page.url}
            width={page.width}
            height={page.height}
            alt={`${title} · ${page.number}/${pages.length}`}
            className="lab-pdf-page-image block h-auto w-full"
            onLoad={async (event) => {
              try {
                await event.currentTarget.decode();
                loadedPages.current.add(page.number);
                if (loadedPages.current.size === pages.length) onReady();
              } catch {
                onError();
              }
            }}
            onError={onError}
          />
        </div>
      ))}
    </div>
  );
}
