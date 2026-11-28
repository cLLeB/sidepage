import { useMemo } from 'react'
import { Viewer, DocumentGate } from '@embedpdf/react/runtime'
import type { OpenInput } from '@embedpdf/react/runtime'
import { Stage, stagePlugin, useStage, useStageState } from '@embedpdf/react/stage'
import { RenderLayer, renderPlugin } from '@embedpdf/react/render'
import { interactionPlugin } from '@embedpdf/react/interaction'
import { SelectionLayer, selectionPlugin } from '@embedpdf/react/selection'
import { localEngine } from '@embedpdf/engine'

// Trial: the PDF drawn by EmbedPDF (PDFium) instead of PDF.js, to compare how reading feels. Turned on by
// localStorage 'sidepage:engine' = 'embed'.
const engine = localEngine()
const plugins = [stagePlugin({ zoom: { mode: 'fit-width' } }), renderPlugin(), interactionPlugin(), selectionPlugin()]

function Zoom() {
  const stage = useStage()
  const { zoomLevel } = useStageState()
  return (
    <div className="viewer-bar">
      <button className="tool" onClick={() => stage.zoomOut()}>−</button>
      <span className="zoom-level">{Math.round(zoomLevel * 100)}%</span>
      <button className="tool" onClick={() => stage.zoomIn()}>+</button>
      <button className="tool" onClick={() => stage.zoomTo({ mode: 'fit-width' })}>Fit width</button>
    </div>
  )
}

export default function EmbedPdfView({ file }: { file: File }) {
  const documents = useMemo(() => [{
    source: async (): Promise<OpenInput> => ({ kind: 'bytes', id: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }),
  }], [file])
  return (
    <div className="viewer">
      <Viewer engine={engine} plugins={plugins} initialDocuments={documents}>
        <DocumentGate fallback={<div className="viewer-message">Opening…</div>}>
          <Zoom />
          <Stage style={{ flex: 1, minHeight: 0 }}>{() => <><RenderLayer /><SelectionLayer /></>}</Stage>
        </DocumentGate>
      </Viewer>
    </div>
  )
}
