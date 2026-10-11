import { useEffect, useState } from 'react'

// A single picture (JPG, PNG, GIF, WebP, …), shown to fit the panel. Tap it to see it at full size and scroll.
export default function ImageView({ file }: { file: File }) {
  const [url, setUrl] = useState('')
  const [full, setFull] = useState(false)

  useEffect(() => {
    const made = URL.createObjectURL(file)
    setUrl(made)
    return () => URL.revokeObjectURL(made)
  }, [file])

  return (
    <div className="viewer">
      <div className={full ? 'viewer-body image-host full' : 'viewer-body image-host'}>
        {url && <img src={url} alt={file.name} onClick={() => setFull(!full)} />}
      </div>
    </div>
  )
}
